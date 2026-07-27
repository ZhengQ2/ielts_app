# Dev Plan — IELTS Test Centre Finder ("Yelp for IELTS")

**Scope:** Canada-first, single-metro MVP · Solo / side-project build
**Target first city:** Toronto or Vancouver (pick one, curate deeply)
**Core sequencing:** Build the *centre directory* first, layer *ratings* on top.

---

## 1. Product goal

Let a test-taker compare IELTS centres in one city by **operator, format, price, location, and a trustworthy rating**, then decide where to book. The directory is useful on day one; ratings are the differentiator added incrementally.

**Explicit non-goals for MVP:** in-app booking/payments, multi-city, CELPIP/PTE, mobile-native app, accounts beyond what reviews require. *(Note: a simple outbound "Book on operator site" link is easy and can come in a later stage — see §9. We redirect, we don't process payments.)*

---

## 2. Architecture & stack

Recommended, solo-friendly, swappable:

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One codebase, SSR for SEO, strong portfolio signal |
| DB + Auth + Storage | **Supabase (Postgres)** | Auth, row-level security, file storage out of the box |
| Maps | **Mapbox GL** | Cheaper than Google; avoids entangling maps with Google's review terms |
| Ratings (external) | **Google Places API, live-fetched** | See §7 compliance guardrail — store `place_id` only |
| Hosting | **Vercel** (app) + Supabase (data) | Free tiers cover an MVP comfortably |
| Styling | Tailwind CSS | Fast, consistent |

**Guiding principle:** the app owns its facts and its first-party reviews; Google data is rendered live and attributed, never stored.

---

## 3. Data model (Postgres / Supabase)

```
operators            -- lookup table so new providers are a row, not a migration
  id                uuid pk
  name              text          -- 'IDP', 'British Council', 'IELTS USA', later 'Paragon (CELPIP)', 'PTE' ...
  test_type         text          -- 'IELTS' for now; 'CELPIP' / 'PTE' when scope widens
  region            text          -- 'CA', 'US', ...  (same brand can differ by country)
  website           text

centres
  id                uuid pk
  name              text
  operator_id       uuid fk -> operators.id   -- was a hardcoded enum; now extensible
  external_id       text          -- BC only: booking-link location= id. IDP has none on IELTS.org → use ielts_org_slug + fuzzy match
  ielts_org_slug    text          -- the IELTS.org page slug; per-page identity (esp. for IDP centres)
  operator_source   text          -- how operator was derived: 'booking_domain' (reliable) | 'slug' | 'name' | 'unknown'
  formats           text[]        -- ['computer_delivered'] (paper is being retired worldwide; CD-only in practice)
  test_frequency    text          -- coarse, hand-curated: 'daily' | 'weekly' | 'monthly'
  sessions_per_day  smallint      -- e.g. up to 2; nullable
  address           text          -- source of truth for location; always shown
  city              text          -- derived from address, NOT from IELTS.org's broken city field
  lat, lng          numeric       -- NULLABLE; embedded coord, else geocoded, else approximate
  geo_precision     text          -- 'rooftop'|'street'|'postcode'|'city'|'country'|'approximate'|null (§5.3)
  geo_source        text          -- 'page_embed'|'google'|'mapbox'|'nominatim'|'amap'|'kakao'|'naver'|'crowd'|'admin'
  geo_confidence    numeric       -- 0..1 from the scoring rule (§5.3); low = show area, not a pin
  google_place_id   text          -- OPTIONAL; only where a Google business listing exists (for ratings/photos)
  price_cad         numeric       -- our own record of published fee
  price_updated_at  date
  transit_note      text
  hero_image_url    text          -- our own / licensed / user photo
  booking_url       text          -- deep link to operator booking page; captured at curation, surfaced later
  is_active         bool          -- DERIVED (not manual): listed by a live authoritative source & not closed
  confidence        numeric       -- cross-source agreement 0..1 (see §5.3)
  first_seen_at     timestamptz
  last_seen_at      timestamptz   -- last time a crawl saw it in an authoritative source
  created_at        timestamptz

sources             -- registry of where each fact came from (provenance is first-class)
  id                uuid pk
  name              text          -- 'IDP finder', 'IELTS.org', 'British Council', 'Google Places', 'crowd'
  authority         numeric       -- trust weight 0..1 (IDP finder high; IELTS.org lower — see §5)
  last_crawled_at   timestamptz

centre_sources      -- which sources currently list a centre + freshness (the freshness engine)
  centre_id fk, source_id fk
  external_slug     text          -- e.g. IDP detail-page slug or IELTS.org slug
  seen_at           timestamptz
  still_present     bool          -- set false when a re-crawl no longer finds it
  raw               jsonb         -- last parsed payload, for audit/diffing

-- NOTE: no test_dates / live-availability table. There is no public API for dates or
-- seat availability, so this feature is dropped from MVP (see §5). We capture only a
-- coarse test_frequency per centre, which is stable and hand-curatable.

assessments         -- paid student "field assessment" (structured, labelled)
  id, centre_id fk, reviewer_id
  noise, staff, checkin_speed, equipment, facilities  -- each smallint 1..5
  comment           text
  visited_on        date
  verified          bool          -- always true for paid assessments
  created_at

reviews             -- organic first-party user reviews
  id, centre_id fk, user_id, rating smallint 1..5, body text,
  taken_on date, created_at, status enum('pending','approved','removed')

centre_scores       -- materialized/derived, see §5
  centre_id fk, composite numeric, breakdown jsonb, updated_at
```

`google_place_id` is the only Google-derived value persisted. Ratings/photos from Google are fetched at render time.

---

## 4. The rating system

Three input layers, combined into one transparent composite. Never a black box — show the breakdown.

**A. Objective baseline (computed, no visit).** Fills every centre so nothing launches blank.
- test frequency (daily / weekly / monthly — a curated attribute, not live dates)
- price (relative to city median)
- transit/parking access

**B. Structured field assessments (paid students).** 1–5 on each: **noise, staff helpfulness, check-in speed, equipment/room condition, facilities.** Labelled "Verified field assessment" — an inspector model, not fake organic reviews. Governed by a fixed rubric so scores are comparable across reviewers.

**C. Organic user reviews (the moat).** Real test-takers, 1–5 + text, moderated.

**Composite (Bayesian shrinkage so thin data doesn't dominate):**

```
score = (C + Σ weighted_ratings) / (C + Σ weights)
  where C = smoothing constant (e.g. 5 "virtual" votes at the city mean)
  weights: verified user review 1.0 > paid assessment 0.8
           > objective baseline 0.5 > single anecdote 0.2
```

A centre with one 5★ review is pulled toward the city mean until it has enough data. Weight by source reliability. Recompute `centre_scores` on write (trigger or scheduled job).

---

## 5. Data sourcing plan

**Conclusion after fetch-testing every candidate (July 2026): IELTS.org is the single master; IDP is an optional enrichment overlay — NOT a hybrid of two masters.** Operator-direct fragments badly and is partly unfetchable; IELTS.org is the only enumerable, neutral, global superset. Its cost is dirtiness (a cleaning problem), not access or coverage (which are the hard problems).

### 5.1 The specific sources — what actually works (fetch-verified)

| Source | Fetch test result | Usable? | Role |
|---|---|---|---|
| **IELTS.org** — enumerate via **XML sitemap** `ielts.org/sitemap.xml` → `…section-testCentres-…-p1..p10.xml`; pages `ielts.org/test-centres/{slug}` | **SSR + enumerable** ✅ — full address, price, booking link; **superset**: includes IDP, BC, *and* India centres IDP's own site omits. Dirty (dupes, stale, broken city field) | ✅ **Yes, with cleanup** | **MASTER LIST** — neutral, global, enumerable |
| **IDP finder** `ielts.idp.com/find-test-centres/{country}` | **SSR** — name, address, **lat/long**, phone, format, OSR, slug. Clean. But **omits India & China** | ✅ **Yes** | **Optional enrichment overlay** — adds coordinates to the IDP subset |
| **British Council** `takeielts…/find-test-location` & `ors/find-test` | **Empty HTML — client-rendered** | ❌ **No** | Reach BC only *via IELTS.org* |
| **IELTS USA** `go.ieltsusa.org/TestCenterNetwork` | SSR but **thin**: city+name+format+reg link; no address/coords/price | ⚠️ Partial, US-only | Later |
| **IDP India** `ieltsidpindia.com` | separate site; India *is* on IELTS.org | ⚠️ | Use IELTS.org's India entries |
| **IDP China** `idpielts.cn` | **client-rendered** (fetch returned head only, no body) | ❌ | Use IELTS.org's China entries |
| **China booking (NEEA)** `ielts.neea.cn` | **login-gated** — not a data source | ❌ | Only the booking-redirect target |
| **Google Places** Geocoding + Places API | works | — | **Optional** enrichment (geocode fallback, ratings/photos where a listing exists) |
| ~~ieltscanada.ca~~ | static, Conestoga only, self-declared "partial" | ❌ | **Skip** |

**China & India are already in the master — verified.** `ielts.org/test-centres/british-council-beijing` is SSR with address, CNY prices (2170 Academic/GT, 2220 UKVI), and a booking link to NEEA; India centres (e.g. `…/idp-education-india-mumbai-2`) are present too. So IELTS.org covers exactly the markets that fragment under operator-direct — no NEEA/idpielts.cn/ieltsidpindia adapters needed.

**Corrected earlier claims (I was wrong twice, now fetch-checked):** (1) IELTS.org *is* enumerable — the HTML `/sitemap` omits centres but the **XML sitemap** has a `testCentres` section (10 paginated files) listing them all. (2) China is *not* a separate ecosystem for our purposes — its centres are on IELTS.org; NEEA is only the (login-gated) booking target, and IDP China's own site is client-rendered.

**Telling BC from IDP — use the booking-link domain, NOT the slug (fetch-verified, corrected):** the slug is **not** a reliable operator signal — many centres have no operator prefix at all (verified: `global-village-calgary`, `ces-exams-calgary`, `ozi-international-cali`, `heliopolis-life-skills`). The page name/H1 is also silent for those. The reliable signal is the **"Book A Test" link domain**: `bxsearch.ielts.idp.com` ⇒ IDP; `ieltsregistration.britishcouncil.org` ⇒ BC. **China (corrected — NOT ambiguous):** `ielts.neea.cn` ⇒ **BC** (British Council routes through NEEA); `idpielts.cn` ⇒ **IDP**. In China the IDP slug is also clean: `idp-ielts-china-<city>-<district>` (e.g. `idp-ielts-china-shanghai-xuhui`, `…-beijing-haidian`).

**`external_id` only exists for BC (fetch-verified, corrected):** BC booking links carry a per-centre `location=` id (e.g. `13776`); **IDP booking links are generic** (`…/wizard?utm_source=ielts.org`, identical across centres, no id). So the dedup/identity key is: BC → `location=`; **IDP → the IELTS.org page slug + name/address** (there is no IDP-side id on IELTS.org). Cross-matching an IDP centre to IDP's own finder is by name/address, not a shared key.

**NO region/IP effect — earlier claim RETRACTED (root-caused to a fetch-tool artifact):** during analysis a diagnostic fetch tool silently **truncated each sitemap page at ~168 of ~200 entries** (~80k-char cap; no closing `</urlset>`). IDP centres are **clustered in the tail of every page** (on p3 they occupy indices 180–194; the first 170 are all British Council). So the truncated fetch returned zero IDP and looked "BC-only," which was misread as a region/datacenter difference. Proof: the truncated feed's first 5 slugs are identical to the full page's, and its last received slug is index **167/200** — right before the IDP block at 180. **The sitemap is the same for all callers; there is no evidence of region-, IP-, or client-dependent content.**

Real, still-valid takeaways: (1) **Fetch the whole file** — these pages are ~90–95 KB; naive fetchers that cap response size will silently drop the tail (where IDP lives). Verify each download ends with `</urlset>` and parse from `<loc>` only. (2) IDP entries are a **minority and tail-clustered** (~15 of 200 on p3), so partial fetches disproportionately lose IDP. (3) Always fetch **all 10 pages and union**; pages are **unsorted** (operators interleaved within a page, IDP block at the end). (4) Ground-truth counts come from a **full, non-truncating download** (e.g. a plain `urllib`/`curl` script), not size-limited fetch tools.

**Coordinates correlate with operator (verified):** IDP-operated IELTS.org pages carry a static map with lat/long (Global Village & CES Calgary both did); BC/China pages don't (BITTS Sydney, Beijing) → geocode those (§5.3).

**Other field notes:** formats come from the test-type list. Don't trust IELTS.org's city field — broken site-wide ("…test in ?"); derive city from the address.

### 5.2 Ingestion — master + optional overlay

- **Common normalised record**: `{operator, external_id, name, address, city, postcode, lat?, lng?, formats, price?, phone?, booking_url}`.
- **IELTS.org adapter (master).** Read the XML sitemap `testCentres` pages → fetch each SSR centre page → parse operator, address, price, booking link. Filter to the target country (via address). Then run dedup (§5.4) + activeness (§5.5) hard — that's where the dirt is neutralised.
- **IDP overlay (optional quality boost).** For centres whose operator is IDP, match to the IDP finder record by the IDP slug (it appears in both) and pull **coordinates** + cleaner fields. Purely additive; skip it and the app still works (just geocode instead).
- **India and China come free with the master** (both are in IELTS.org). Their booking links point to region-specific (sometimes login-gated) booking sites — fine as outbound redirects. Only **IELTS USA** (thin, US-only) would need its own adapter.
- `external_id` = operator's own id (IDP slug; BC `location=` from the booking link). Dedup key, no Google dependence.
- Store raw hits in `centre_sources` with `seen_at`; on re-crawl flip `still_present=false` for anything gone. Respect `robots.txt`, rate-limit, cache.

### 5.3 Address → coordinates (a confidence cascade, not a single geocode)

Every IELTS.org page has an **Address block, but quality varies wildly** (fetch-verified): `kottayam` = full address + postcode `686631` (name is just a city); `…kfupm-2` = vague/wrong "KFUPM square, Alkhobar/Dammam" (but name is a precise institution); `idp-ielts-china-shanghai-xuhui` = full address + postcode `200030` + district + an embedded coordinate. Coordinates are embedded on **some** pages via a Google static-map URL (Shanghai IDP-China `31.29635,121.50268`; most Canada IDP) but **not others** (IDP-India Kottayam, BC KFUPM) — so "IDP pages have coords" is too coarse; check per page.

Resolve location per centre, top-down, storing `geo_precision`:

1. **Embedded coordinate if the page has a static-map URL** — parse the `center=lat,lng`. **China caveat:** it's a Google-API coord and Google in China is GCJ-02-shifted (~500 m off on non-Google basemaps) → treat as suspect, cross-check against the address.
2. **Geocode the address AND the name; keep the higher-confidence hit.** These fail oppositely: Kottayam's *address* wins (name is a city), KFUPM's *name* wins (address is vague). Compare the geocoder's precision field and take the better.
3. **Postcode + country** is a strong fallback (`686631`, `200030` geocode tightly).
4. **Region-appropriate geocoder** where Google is weak: **Amap/Baidu** for China (parse the structured Chinese address; returns China-correct coords), **Naver/Kakao** for Korea. Google/Mapbox/Nominatim elsewhere.
5. **Else approximate pin + `geo_precision`** (rooftop / street / postcode / city / approximate). Never render a confident pin for a city-level match — show the address text + area.
6. **Never drop a centre** for a rough location; add a crowd **"fix this location"** + admin override for the stubborn tail (KFUPM-style). Google Places business data (ratings/photos) is separate enrichment, only where a listing exists.

For the **Canada MVP** this is largely a non-issue — addresses are clean and Google works; the vague-address / bad-datum cases (Saudi, India, China, Korea) are expansion concerns the schema (precision + override) is ready for.

**Choosing between the address-hit and the name-hit (scoring — how to tell which is better).** Every serious geocoder returns a precision signal; combine it with what you already parsed. Score each candidate: `tier` (rooftop 4 / interpolated 3 / postcode 2 / city 1 / country 0) `+1` if it echoes the record's **postcode**, `+1` if **city** matches, and **reject outright if country ≠ expected** (a precise pin in the wrong country loses to a postcode pin in the right one). Then **triangulate**: geocode both the address and the name — if the two hits fall within ~250 m, keep the higher-tier one at high confidence; if they diverge >~2 km, cap both at `approximate` and flag (Kottayam's two agree; KFUPM's disagree — the disagreement *is* the signal). Validate the winner by reverse-geocoding and checking it echoes the expected city/postcode. Persist `geo_precision`, `geo_source`, `geo_confidence`.

**When every candidate is weak (both bad).** Degrade, never drop: postcode+country → city+country → country centroid, each tagged coarser; show the **address text + an approximate area**, not a false marker. For the failing tail *only*, do a second lookup at the operator's own site (IDP finder / `idpielts.cn` / `ieltsidpindia.com` / BC booking — often a cleaner address), then fall back to a crowd **"fix this location"** + admin override (highest priority). The centre stays listed and name/city-searchable regardless.

**Weak-Google countries beyond CN/KR (don't hardcode a list).** Route geocoding through a **provider registry**: `country → ordered chain`, default `[google, mapbox, nominatim]`, local providers slotted in where configured. One wrapper (e.g. `geopy`) yields a uniform result to score with the rule above. Lean on **postcodes** where the postal system is strong (Europe, India). After each batch, **measure precision per country** (% rooftop/street vs approximate) — that dashboard, not a guess, tells you which countries need a local provider or manual effort. (Informal-addressing regions — parts of Sub-Saharan Africa, MENA, rural South/SE Asia — cap at district level for *any* provider; that's a data-reality ceiling, not a provider choice.)

**Local-provider access caveats (verified July 2026 — real onboarding cost, not drop-in):**
- **Amap / Gaode** (`restapi.amap.com/v3/geocode/geo`, ~2,000/day free): key requires a **verifiable Chinese mobile number**; console/docs Chinese-only; returns **GCJ-02** coords (convert for WGS-84 basemaps like Mapbox/OSM).
- **Korea — prefer Kakao over Naver.** **Kakao Local API** (`dapi.kakao.com/v2/local/search/address.json`) does address geocoding + reverse, handles **both** road-name and land-lot (jibeon) address systems, returns **WGS-84** (no datum conversion), and needs only a **Kakao Developers REST key** — lower friction than Naver. **Naver** (NCP Maps) needs an NCP account + **identity + payment**, Korea-only, and a **2025 notice discontinued free Maps usage / blocked new apps** → use as fallback only. For Kakao, confirm current **free quota** and any **non-Korean signup** requirement (phone verification) on the dev site.
- Implication: keep these as **opt-in per-country providers behind the registry**; do **not** gate the MVP on them — Canada runs cleanly on Google/Mapbox.

**Display / basemap layer — separate from the ingestion geocoding above.** Ingestion (§5.3) produces the **stored canonical coordinate** that powers distance sort / "near me" / pin position; the basemap layer only *renders*. Keep them distinct:
- **Store ONE canonical datum — WGS-84 — for every centre.** Convert to the basemap's datum **at render time**.
- **Datum by basemap:** GCJ-02 for Google-in-China, AMap, and **Apple MapKit in China**; WGS-84 for Mapbox, OSM, Apple-outside-China, Kakao/Korea. A pin is only correct when stored-datum matches basemap-datum → `WGS-84→GCJ-02` for China basemaps (incl. Apple on iOS in China; MapKit won't auto-convert your annotation), else ~500 m offset. Use a known transform lib (`coordtransform`/`eviltransform`) gated by an in-mainland-China check.
- **Platform-adaptive basemap (verified):** iOS → Apple MapKit, which itself uses **AutoNavi/AMap in China** and **TMap (SK Group) in Korea** — legal + local coverage for free. Web/Android → pick the tile provider by region (Google/Mapbox default; AMap for China; Kakao/Naver for Korea), optionally hinted by user IP/locale.
- **IP/locale picks the basemap+language, NOT correctness.** IP is noisy (VPNs, travellers). Datum conversion must key off the **centre's** region (the data shown), not the user's — a user in Canada viewing a Shanghai centre still needs the GCJ-02 conversion.
- Basemap choice does **not** populate the DB — you still run server-side geocoding at ingest regardless of what renders client-side.
- **Industry pattern (Uber, Apple):** providers are region-partitioned by **law**, not preference, and the hard regions are often handled *commercially*, not in code — Uber **exited China** (sold to Didi, 2016) and runs Korea as a **JV with TMap** (UT, Uber 51%); Apple uses **AutoNavi** in China and **TMap** in Korea. On China Android there's **no Google Play Services**, forcing a Chinese SDK regardless. Takeaway: the canonical-WGS-84 + convert-at-boundary shape here is standard; **China is realistically a separate build + local entity/ICP, i.e. a strategic decision, not a config flag** — which is why CN/KR are deferred.

### 5.4 Deduplication

IELTS.org (the master) carries the `…-ns` vs `…-ns-2` duplication, so dedup is central, not optional. **But the identity key differs by operator (verified):**

1. **BC centres — key on `location=`** from the booking link. Same id ⇒ same centre. Catches the verified Sydney BITTS dupe (both `location=13776`).
2. **IDP centres — no operator id available** (booking link is generic). Key on the IELTS.org **page slug**, then **fuzzy match** on normalised name + postcode + geo-proximity (coords are usually present for IDP pages).
3. **Fallback for all** — fuzzy name + postcode (+ geo) when the above is insufficient.
4. **Merge/reconcile** — union of formats, freshest price, keep all source rows in `centre_sources`.

> Honest risk: without a stable IDP id, IDP-centre dedup and IDP-finder cross-matching rely on fuzzy matching, which is error-prone (name variants, suite numbers). This is the single most fragile part of ingestion — budget real effort for it, and expect to hand-review ambiguous matches.

### 5.5 Deriving `is_active` and `confidence` (solves the paper-shutdown delta)

Recomputed each crawl, after dedup:

- IDP-operated + present in the **live IDP finder** and not Google-"closed" → `is_active = true`, high confidence.
- BC/other (no live-finder corroboration available) → rely on IELTS.org presence + Google not-"closed"; paper-only or broken-field records → suspect → `is_active = false` (hidden), flagged. Lower confidence than IDP-corroborated records — surface that in the UI.
- Google **"permanently closed"** → hard `is_active = false`.

Honest limitation: for BC/other centres we have **no live liveness oracle** (BC's site is unfetchable), so their activeness leans on IELTS.org freshness + Google + crowd reports — weaker than the IDP subset. Don't pretend otherwise in the data.

### 5.6 Ongoing freshness (scales *with* usage)

- **Scheduled re-crawl** (e.g. weekly) diffs the source lists → auto-adds new centres, auto-hides vanished ones.
- **Crowd signal**: a "report closed / no dates" button + review recency. A centre with recent reviews is provably alive; user reports plus a vanished listing auto-flag it. More users → fresher data, zero marginal effort.
- **End-state**: an operator partnership / affiliate feed (unlocked by the booking-referral traffic you send them) replaces crawling for true availability.

### 5.7 The two human-seeded layers (unchanged)

**Assessments (paid students).** Recruit students **already booked to take IELTS** and pay a small stipend for a rubric writeup — piggyback on tests happening anyway rather than paying ~$350/exam. Always disclosed/labelled as paid.

**Organic reviews.** Seed a handful per centre from Reddit / Facebook IELTS groups, then let them accumulate. Fully owned data.

> **Still dropped: live test dates & seat availability.** No public API; scraping the booking flow breaches ToS; paper is retiring. Needs a partnership, not a scraper.

---

## 6. Phased milestones (~6–10 weekends)

**M0 — Setup (½ weekend).** Repo, Next.js + Tailwind, Supabase project, schema migration, Vercel deploy of a hello-world.

**M1 — Master ingestion + directory (2–3 weekends).** Read the IELTS.org XML sitemap `testCentres` pages → fetch each SSR centre page → parse operator/address/price/booking link → filter to Canada → dedup (§5.4) → `centres` + `centre_sources`. Geocode where coordinates are missing (§5.3). Derive `is_active`. Build list view + Mapbox map + centre detail page. *Milestone: a neutral, all-operator Canada directory (IDP + BC), duplicates merged, dead entries hidden.*

**M1.5 — IDP overlay + scheduled re-crawl (1 weekend).** For IDP-operated centres, match the IDP finder by slug to pull coordinates + cleaner fields (optional quality boost). Add a weekly cron that re-reads the sitemap, diffs `centre_sources`, auto-adds/hides — self-maintaining.

**M6 — Expand coverage (later, incremental).** More countries fall out of the IELTS.org master automatically — just widen the country filter. India and China are already in the master (verified). Only **IELTS USA** would need a separate adapter, and only if you target the US.

**M2 — Filters & search (1 weekend).** Filter/sort by price, operator, test frequency, distance; postal-code / city search; empty & loading states.

**M3 — Objective score + Google ratings (1–2 weekends).** Compute baseline score; render live Google rating on detail pages with attribution + link back. Show score breakdown.

**M4 — Assessments + reviews (2–3 weekends).** Auth (Supabase). Assessment entry (admin/reviewer role) + rubric UI. Organic review submission, photo upload, basic moderation queue. Composite score wired in.

**M5 — Polish & launch (1 weekend).** SEO (per-centre pages), OG images, analytics, ToS + review/privacy policy, accessibility pass, deploy.

---

## 7. Key technical decisions / guardrails

- **Google Places compliance is non-negotiable.** Store only `place_id`. Fetch ratings/reviews live at render, cache within Google's allowed window only, always attribute + link to Maps. Do **not** scrape Google, Reddit, or any review site.
- **Images:** own photos, licensed operator assets, or user uploads with an upload licence. No stored Google/Street View imagery.
- **Trademarks:** use "IELTS", "IDP", "British Council" descriptively; neutral product name; no implied endorsement.
- **Paid content must be disclosed** (Competition Bureau) — hence the "verified field assessment" label, visibly separate from organic reviews.
- **Score transparency:** always expose the breakdown so users trust the number.

---

## 8. Testing & verification

- Unit-test the composite-score function (edge cases: zero reviews, one review, conflicting sources).
- Validate the Google integration renders attribution and never persists review text.
- Seed-data sanity check: every centre has operator, format, price, `place_id`, hero image before launch.
- Lighthouse / accessibility pass before M5 sign-off.

---

## 9. Post-MVP (deliberately deferred)

**Booking redirect (natural first add-on).** A per-centre "Book on operator site" button that deep-links to the correct IDP / British Council booking page (store a `booking_url` per centre). Pure outbound redirect — no payment handling, no PCI scope, low effort. This is also the affiliate/referral hook: track click-throughs and swap in referral links if operators or prep providers offer them.

Other later stages: second metro → other Ontario/BC cities · CELPIP & PTE centres (bigger addressable market) · native mobile wrapper. *(Live test dates / availability alerts remain out of scope unless an operator partnership or affiliate data feed becomes available — not viable via scraping.)*

---

## 10. Top risks (carry from feasibility study)

| Risk | Mitigation |
|---|---|
| Can't store external review data | Live-fetch + attribute; invest in first-party reviews |
| Cold-start (no ratings at launch) | Objective baseline score + seeded assessments |
| Thin market per city | Depth over breadth; one metro first |
| Paid-review credibility | Label as verified field assessments; fixed rubric; disclose |
| Google API cost creep | Mapbox for maps; lazy-load ratings; cache `place_id` |
