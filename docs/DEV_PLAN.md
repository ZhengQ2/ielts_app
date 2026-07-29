# Dev Plan — IELTS Test Centre Finder ("Yelp for IELTS")

**Scope:** Worldwide static directory · Solo / side-project build
**Current production:** `https://ielts.zhengqiu.net`
**Core sequencing:** Reliable directory → automated data maintenance → availability feasibility →
optional ratings/reviews.

> **Implementation status (July 2026):** the early sections retain some design history, but the
> execution plan in §6 is authoritative. The shipped product uses a committed JSON dataset,
> Google Maps, and S3/CloudFront rather than requiring a database-backed runtime.

---

## 1. Product goal

Let a test-taker search worldwide, focus on a country or city, and compare IELTS centres by
**operator, offering, delivery mode, source price, and location**, then continue to the correct
operator booking or after-test service.

**Current non-goals:** in-app booking/payments, unsupported claims about opening status or test
availability, CELPIP/PTE, a native mobile app, and accounts/databases before a transactional
feature actually requires them. Booking remains an outbound operator redirect.

---

## 2. Architecture & stack

Current, deliberately low-cost implementation:

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js static export + TypeScript** | Centre detail pages are generated at build time |
| Data | **Versioned JSON in `@ielts-map/core`** | 1,510 centres do not justify an always-on database or SQLite download |
| Maps | **Google Maps JavaScript API** | Markers are viewport-driven and non-pinnable records remain listable |
| Ingest geocoding | **Google + AMap + Mappls** | Google supplies independent address/name evidence; local providers refine China/India |
| Automation | **GitHub Actions** | Weekly full crawl, quality analysis, diff gates, build verification and conditional commit |
| Hosting | **Private S3 + CloudFront + Route 53** | Static, inexpensive, no application server |
| Styling | Tailwind CSS | Fast, consistent |

**Guiding principle:** IELTS.org text remains the canonical source record; derived and geocoded
values carry explicit provenance and confidence, and unsafe precision is never presented as fact.

---

## 3. Data model

The current application uses the versioned `CentreDataset` JSON schema in `packages/core`.
The Postgres model below is retained as the future migration target only if accounts, first-party
reviews, moderation, or other transactional features make a database worthwhile.

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

-- NOTE: no test_dates / live-seat table. No documented global operator feed was found.
-- A separate expiring snapshot carries the narrow public IELTS USA registration/future
-- status evidence without pretending that a registration link guarantees a seat.

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
2. **IDP centres — no operator id available** (booking link is generic). Start with the IELTS.org
   **slug base**; only exact same-operator identity evidence such as a normalized address/postcode
   can merge automatically.
3. **Fallback for all** — fuzzy name/postcode/proximity is a proposal, never identity proof.
   Ambiguous candidates remain separate in the quality artifact.
4. **Merge/reconcile** — union offering variants, source price strings, contacts and source rows.
   Equivalent phone formatting may collapse, but useful conflicting information is preserved.

> Honest risk: without a stable IDP id, some genuine duplicates cannot be merged automatically.
> Keeping uncertain records separate is safer than silently combining two physical centres.

### 5.5 Publication eligibility is not opening status

The current pipeline derives `isPublishable`, not `is_active`. A record is unpublishable when it
lacks a usable source/address/country, has no test offering, or has no authoritative price string
for any offering. Location problems suppress a precise map pin but do not remove an otherwise
useful listing.

Presence on IELTS.org means “currently listed by the master,” not “open and accepting bookings.”
Google business status is supporting evidence, not an IELTS availability oracle. The one supported
exception is the public IELTS USA network: explicit future/not-accepting statements are shown, and
a registration link is described only as a registration link—not proof of a date or seat. All
other centres remain unknown. User corrections and reviewed overrides remain the safe interim
mechanism.

### 5.6 Ongoing freshness and self-analysis

- **Weekly full re-crawl:** re-reads the master, compares source slugs and physical-centre ids, and
  ignores timestamp-only churn.
- **Per-centre quality analysis:** checks provenance, raw/derived price integrity, city extraction,
  offerings, contacts, duplicate candidates, coordinate plausibility, evidence independence, and
  publication eligibility before writing.
- **Safe outcomes:** accept, publish with warnings, quarantine, or suppress only the map pin.
- **Persistent discovery memory:** an unparseable new page remains tracked across later runs even
  though it never produced a centre row.
- **Write gates:** a previously known source-page failure or systemic addition/removal cliff blocks
  the dataset update; GitHub receives a JSON artifact and targeted warnings.
- **Crowd signal:** correction reports capture exact user-selected coordinates and feed reviewed
  overrides that survive later crawls.
- **US operator signal:** a separate weekly IELTS USA snapshot records registration/future status,
  self-diagnoses parse/match cliffs and expires after 15 days without a successful check.
- **End-state:** an operator partnership or supported feed is still required for global opening
  status, centre-specific dates and true seat availability.

### 5.7 The two human-seeded layers (unchanged)

**Assessments (paid students).** Recruit students **already booked to take IELTS** and pay a small stipend for a rubric writeup — piggyback on tests happening anyway rather than paying ~$350/exam. Always disclosed/labelled as paid.

**Organic reviews.** Seed a handful per centre from Reddit / Facebook IELTS groups, then let them accumulate. Fully owned data.

> **Still deferred: live test dates and seat availability.** M2.6 found no documented global feed.
> A login-gated or undocumented booking endpoint is not an acceptable substitute.

---

## 6. Execution milestones

**M0 — Static foundation and AWS deployment — DONE.** Next.js/TypeScript/Tailwind monorepo,
static export, private S3 origin, CloudFront, Route 53 and production domain.

**M1 — Worldwide master ingestion and directory — DONE.** Full IELTS.org sitemap ingestion,
country attribution, raw price preservation, operator detection, contact extraction, offering-aware
deduplication, geocoding, list/map/detail views and static JSON feed.

**M1.5 — Self-maintaining refresh and quality analysis — DONE.** Weekly full crawl; per-centre
machine-readable diagnostics; independent-coordinate-evidence enforcement; quarantine and pin
suppression; persistent unresolved-discovery state; systemic-diff safety gates; CI artifact,
warnings, build verification and conditional commits.

**M2 — Search and comparison experience — DONE.** Viewport-driven map loading, country/city focus,
distance ordering, separated map/list behavior, operator/contact information, after-test links,
correction reports, and offering filters covering module, UKVI/SELT, Life Skills, delivery mode and
writing-on-paper. The selected filter also controls the displayed source price.

**M2.5 — Automated remediation and quality trend gates — DONE.** Detection now feeds bounded repair
attempts while keeping the crawler unattended:

Current baseline (2026-07-28): 1,510 centres analysed; 1,108 ready, 397 publishable with warnings,
5 quarantined, and 290 without a safe map pin. These counts describe existing debt, not new
failures.

1. A compact committed per-country baseline records affected centre ids, issue codes, decisions,
   pin eligibility and unresolved source slugs.
2. Repairable location/city issue codes receive a bounded second resolution pass. Published Plus
   Codes are an independent coordinate path; legacy/missing cities can be replaced only by
   structured non-legacy evidence.
3. The same analyser runs after remediation. A repair is accepted only when it removes a targeted
   issue, improves the weighted issue score and introduces no new warning/error. Reviewed
   administrator evidence is immutable.
4. Existing-centre regressions, new-centre debt and improvements are separated. CI blocks systemic
   global or country-level cliffs while ordinary changes remain automatic.
5. Previously unresolved pages are reprocessed by the full crawl. Pending duplicate pairs receive
   structured contact/postcode/distance evidence but fuzzy similarity never merges identities.
6. Country issue rate weighted by cohort size determines bounded repair priority; provider calls,
   cache hits, budget skips and accepted/rejected attempts are included in the artifact.

*Definition met:* a scheduled run can discover, diagnose, attempt safe repair, re-validate and
publish/quarantine a centre without human intervention; unchanged unresolved cases create no
repeated alert, and country-level quality cannot regress silently.

**M2.6 — Opening-status and test-date feasibility — DONE.** Official-source review found no
documented global centre/date/seat feed. IELTS USA does publish one usable public status source, so
the product now:

1. fetches that operator page once per weekly run and distinguishes registration links, explicit
   not-accepting statements and future locations;
2. matches by exact interest/organisation links, resolving reused link ids by centre-name evidence;
3. blocks systemic parser/match cliffs and reports unmatched records without recurring alert noise;
4. expires evidence after 15 days and falls back to unknown;
5. labels registration links without implying any date or seat is available.

British Council's public affiliate programme is a legitimate next commercial contact, but does not
publicly promise an availability feed. Full evidence and acceptance criteria are in
`docs/AVAILABILITY_FEASIBILITY.md`.

**M2.7 — Bounded provider-availability pilot — EXPERIMENTAL.** Provider surfaces were tested only
from manually dispatched GitHub Actions jobs. Every collector is serial, has a hard minimum
interval, stops without retry on the first timeout/403/429/challenge/source-shape error, and writes a
diagnostic artifact rather than publishing to the website.

- IDP Global exposes a first-party public session-search API with venue ids, exact venue metadata,
  dates, offering dimensions and remaining-seat counts. The implemented full-scale validator is
  deliberately restricted to the confirmed standard Academic-on-computer request shape and a
  45-day horizon; it deduplicates venues returned by overlapping cities and never rewrites the
  IELTS.org fee string. The 2026-07-29 full-scale GitHub Actions gate scanned all 357 exposed cities
  and all 501 discovered venues across 74 countries: 859/859 serial requests succeeded without a
  provider boundary, 8,128 future sessions were parsed, and no capture was rejected. Publication
  remains disabled until unmatched and ambiguous centre links are reviewed.
- IDP India retains the manually targeted one-session pilot. A bulk selector experiment discovered
  406 test/module/city combinations without CAPTCHA, but its automatic calendar traversal could not
  yet distinguish future session evidence safely. The bulk adapter was removed rather than
  publishing default/past calendar state.
- IDP China is excluded because its public booking route redirects to login.
- NEEA is excluded. It is a British Council-only China partner and requires login plus reCAPTCHA;
  it is not an IDP source.
- British Council Global is excluded after the bounded GitHub Actions probe received CDN HTTP 403.
  No bypass was attempted. An authorised feed remains the acceptable route to comprehensive BC
  dates.

**M3 — Objective score and compliant Google enrichment — PLANNED.** Reassess whether ratings add
enough user value to justify live API cost and compliance work before implementing them.

**M4 — First-party assessments and reviews — DEFERRED.** Add a transactional datastore and auth
only when this phase begins; the current directory does not need them.

**M5 — Product hardening — PLANNED.** Accessibility, analytics/privacy choices, policy pages,
structured SEO validation and performance budgets.

**M6 — Adjacent exams/native clients — LATER.** CELPIP/PTE coverage or a mobile wrapper only after
the IELTS data-maintenance loop is demonstrably stable.

---

## 7. Key technical decisions / guardrails

- **Google Places compliance is non-negotiable.** Store only `place_id`. Fetch ratings/reviews live at render, cache within Google's allowed window only, always attribute + link to Maps. Do **not** scrape Google, Reddit, or any review site.
- **Images:** own photos, licensed operator assets, or user uploads with an upload licence. No stored Google/Street View imagery.
- **Trademarks:** use "IELTS", "IDP", "British Council" descriptively; neutral product name; no implied endorsement.
- **Paid content must be disclosed** (Competition Bureau) — hence the "verified field assessment" label, visibly separate from organic reviews.
- **Score transparency:** always expose the breakdown so users trust the number.

---

## 8. Testing & verification

- Keep parser fixtures for every observed page shape and price-numbering system.
- Test healthy, warning, quarantined, unresolved, recurring-unresolved and later-resolved discovery
  lifecycles.
- Test dedup identity separately from offering union; fuzzy similarity alone must not merge.
- Test country plausibility, independent evidence paths, datum conversion and pin suppression.
- Run type checks, the complete unit suite and a production static export before an automated
  dataset commit.
- During M2.5, add a before/after quality-baseline test so remediation cannot trade one issue for
  another invisibly.
- Lighthouse/accessibility and policy checks remain required before M5 sign-off.

---

## 9. Post-directory sequencing

Outbound booking, results links, raw-score inquiries and correction reports are already shipped.
The next work must improve unattended data quality before adding a new data domain.

M2.6 is complete. M3 should first reassess whether objective scoring and live, compliant Google
enrichment add enough value to justify their API cost and policy surface. Ratings/reviews,
CELPIP/PTE coverage and a native client remain independent product decisions; none should force a
database or recurring server into the current static directory prematurely.

---

## 10. Top risks (carry from feasibility study)

| Risk | Mitigation |
|---|---|
| Can't store external review data | Live-fetch + attribute; invest in first-party reviews |
| Cold-start (no ratings at launch) | Objective baseline score + seeded assessments |
| Uneven evidence quality by country | Measure quality per country and target provider/remediation work from the observed tail |
| Paid-review credibility | Label as verified field assessments; fixed rubric; disclose |
| Google/API cost creep | Persist caches, cap per-run calls, use local providers only for targeted tails |
| Silent source/parser regression | Known-source and systemic-diff write gates; retain the last good dataset |
| False coordinate precision | Require independent evidence agreement; suppress unsafe pins |
| Recurring manual audit burden | Alert only on new/worsening deltas; keep unchanged debt in machine-readable artifacts |
