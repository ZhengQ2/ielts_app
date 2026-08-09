# Expansion Plan — IELTS Test Centre Finder

**Status:** proposal, reviewed 2026-08-09. **Method note:** the previous version of this document
leaned on `docs/DEV_PLAN.md`'s narrative, which turned out to contain at least one stale claim
(it described China/Korea coverage as "deferred" when 110 China and 21 Korea centres were already
live). This version is built directly from the code, the committed dataset, and CI config instead —
`docs/DEV_PLAN.md` and the other prose planning docs were deliberately not consulted while writing
it. Every claim below cites the file, line, or dataset field it came from.

**Dataset snapshot used throughout** (`packages/core/data/centres.all.json`, generated
2026-08-03T08:40:41Z): 1,636 centres, 1,630 publishable, 133 countries. By operator: British Council
854, IDP 753, IELTS USA 29. Geo present 1,633/1,636; precision rooftop 1,176 / street 185 /
approximate 272 / none 3. Price populated 1,630/1,636. Contact information populated 1,601/1,636
(~98%). Offerings/formats populated 1,636/1,636 (a centre with none is a quarantine trigger, so this
is expected).

---

## 1. Expansion candidates at a glance

| # | Expansion | What the code shows today | Adds a database/server? |
|---|---|---|---|
| A | Objective computed score (no human input) | No scoring code exists anywhere in `apps/web`/`packages/core`, despite the root `package.json` description already promising "ratings layered on top" | No — pure function over existing fields |
| B | Live Google Places enrichment (ratings/photos) | Google Places API is used only for *geocoding* corroboration in ingest (`googlePlaces` in `packages/ingest/src/geocode.ts`); never called from `apps/web` for business ratings/photos | No — render-time fetch only |
| C | First-party assessments & organic reviews | Full target schema already exists and is unused: `supabase/migrations/0001_init.sql` (`assessments`, `reviews`, `centre_scores`, RLS policies) — no Supabase client dependency anywhere, nothing reads/writes these tables | **Yes** — first transactional datastore + auth |
| D | Revisit availability only with an official feed | The former IELTS USA collector was removed. Ordinary centres deliberately have no automated opening/date/seat status; five curated future-opening interest locations are the only exception | No — but it requires a documented operator source |
| E | Ship non-Google map display | Only **1 of 1,636** centres currently clears the display-rights gate for a non-Google basemap (`geo-policy.ts` `LEGACY_PROVENANCE`; computed directly from `centres.all.json`). Two pilots already exist in code but neither is wired to production: `apple-map-pilot.ts`/`.swift` files, and `neutral-pilot.ts` + a live `maplibre-gl` dependency powering the diagnostic `/neutral-map` page | No — same static-export model |
| F | Complete local geocoding provider coverage | China (AMap) and India (Mappls) each have a real local provider in `geocode.ts`; Korea has none — `'kakao'`/`'naver'` exist only as `GeoSource` type values with no fetch code, and `mapbox` has **zero** implementation anywhere in the repo (config, fetch, or type) despite being an independent-provider candidate | No |
| G | Adjacent exam coverage (CELPIP / PTE) | Zero references to CELPIP/PTE/Pearson anywhere in the repo; domain model (`types.ts`, `offerings.ts`) is IELTS-specific (`TestModule`, `TestCategory`) | No (new ingest adapter only) |
| H | Native iOS/Android client | `packages/core` is confirmed genuinely platform-neutral by direct grep — no `document`/`window`/Node built-in (`fs`, `http`) references anywhere in `packages/core/src/*.ts` | No (reuses `@ielts-map/core`) |

---

## A. Objective computed score (no human input)

**Question:** the package already advertises "ratings layered on top," but no code computes
anything — is a pure function over existing fields (price, test frequency, geo precision as a
reliability proxy) worth shipping before any human-sourced data (C) exists?

**Feasibility study plan**
1. **Data-sufficiency check per field.** Price is populated for 1,630/1,636 centres — strong
   coverage. `test_frequency`/`sessions_per_day` exist in the target schema (`0001_init.sql:44-45`)
   but the live dataset type (`packages/core/src/types.ts`) should be checked field-by-field for
   whether frequency is actually populated today or only offering/format data is — run a script
   against `centres.all.json` counting non-null `testFrequency` before assuming it's usable as a
   scoring input.
2. **Precision-as-reliability proxy.** 1,176/1,636 centres are rooftop-precision; decide whether
   `geo_precision` should feed the score (a coarse-pin centre is arguably lower-confidence
   information generally) or stay purely a map-rendering concern — this is a real design choice, not
   obviously "no."
3. **Discrimination test.** Compute the candidate score offline for the top 20 cities by centre
   count; check it isn't flat (most centres scoring near-identically because inputs are thin) before
   shipping something that looks authoritative but carries no signal.
4. **Go/no-go criteria.** Go only if at least two of {price, frequency, precision} have usable
   coverage above a set threshold (e.g. 80%+) and the offline score meaningfully discriminates
   between centres in the same city.

**Key risk:** shipping a score that reads as authoritative on thin inputs — mitigate by requiring
minimum per-country data coverage before displaying it there, mirroring the existing pin-suppression
pattern already used for coordinates (`geo-policy.ts`).

**Effort:** 2–3 days; no infra change, purely additive to the static export.

---

## B. Live Google Places enrichment (ratings/photos)

**Question:** `googlePlaces` already exists in `packages/ingest/src/geocode.ts` as a geocoding
corroboration provider — is extending it (or adding a render-time call) to surface business
ratings/photos worth the compliance surface, independent of whether A or C ship?

**Feasibility study plan**
1. **Compliance re-read against the actual code path.** The current use of Google Places
   (`geocode.ts`) only ever persists `place_id`-adjacent geocode results at ingest time — confirm
   that a *ratings/photos* call would be architected as render-time-only in `apps/web`, never cached
   beyond Google's allowed window, matching the discipline already visible in how `google_place_id`
   is handled today (need to grep `apps/web` for any existing `googlePlaceId` render path first,
   since none was found in this inventory — meaning this is a genuinely new code path, not an
   extension of one).
2. **Cost model.** Estimate Places Details calls/month at current detail-page traffic; this is the
   first recurring external cost the product would take on beyond the already-budgeted ingest-time
   Google Geocoding calls (`DEFAULT_GOOGLE_REQUEST_BUDGET = 500`/run, `config.ts:104`) — a
   render-time cost model is structurally different (traffic-driven, not crawl-driven) and needs its
   own budget reasoning.
3. **Coverage check.** Not every centre will have a matching Google Business listing — measure what
   fraction of the 1,636 centres actually resolve a Place ID with a business listing (as opposed to
   just a geocoded point) before assuming broad coverage.
4. **Go/no-go criteria.** Go only if the coverage check clears a usable threshold and a bounded,
   predictable render-time cost model is confirmed.

**Key risk:** confusing "Google can geocode this address" (already true for most of the dataset)
with "Google has a Business Profile for this centre" (unmeasured) — these are different API
capabilities with different coverage.

**Effort:** 3–5 days investigation; no infra change.

---

## C. First-party assessments & organic reviews

**Question:** `supabase/migrations/0001_init.sql` already has a complete, RLS-protected schema for
this (`assessments`, `reviews`, `centre_scores`) sitting unused — is it worth actually building the
datastore + auth to populate it, or does A/B cover most of the value more cheaply?

**Feasibility study plan**
1. **Cold-start pilot before any schema work.** Recruit 5–10 students already booked for IELTS; pay
   a stipend for one rubric writeup each against the exact rubric columns already defined in the
   migration (`noise`, `staff`, `checkin_speed`, `equipment`, `facilities`, each 1–5,
   `0001_init.sql:116-120`). Use a spreadsheet, not the real datastore, to simulate the write path —
   the schema being pre-built doesn't mean the supply side (willing reviewers) is validated.
2. **Rubric reproducibility check.** Confirm two independent reviewers of the same centre land
   within 1 point on most dimensions — a rubric that isn't reproducible undermines the
   `verified boolean not null default true` guarantee the schema already encodes
   (`0001_init.sql:123`).
3. **Auth/moderation scoping.** The migration has `reviewer_id uuid` / `user_id uuid` columns with
   no foreign key to an actual users table yet, and RLS policies gate on `status = 'approved'` /
   `verified` (`0001_init.sql:150-166`) — scope the minimum real auth provider and moderation queue
   needed to satisfy those policies before writing any application code.
4. **Go/no-go criteria.** Go only if the pilot produces usable writeups within budget/turnaround and
   reviewer agreement clears a set threshold. A failed pilot is a legitimate, cheap "no" — it means
   not standing up Supabase, auth, and moderation tooling for a supply problem that was never solved.

**Key risk:** treating "the schema already exists" as evidence the feature is de-risked — it only
means the data *shape* was designed; supply (reviewers) and demand (does anyone read reviews on a
directory that has none yet) are both unvalidated.

**Effort:** ~2 weeks for the pilot; datastore + auth build is a separate, larger estimate gated on
pilot success.

---

## D. Revisit availability only with an official feed

**Question:** can any operator provide a documented source that distinguishes a scheduled sitting,
an open registration window and an actual remaining seat for a stable centre identifier?

The earlier IELTS USA experiment was removed. Its public interest page did not establish ordinary
centre availability, and treating directory presence as “open” overstated the evidence. The current
product intentionally shows no automated opening, date or seat status for ordinary centres. Five
manually reviewed IELTS USA future-opening records remain only because their official forms collect
candidate interest; they are explicitly labelled as not yet open.

**Feasibility study plan**
1. **Require an operator-supported contract or documented feed.** It must define identifier,
   test/module/delivery semantics, timezone, freshness, rate limits, retention and display rights.
2. **Test meaning before match rate.** Confirm whether each row means a scheduled event,
   registration availability or actual remaining capacity; these must not be conflated.
3. **Measure stable matching.** Reconcile the documented identifier to the directory without fuzzy
   centre-name matching as the final authority.
4. **Go/no-go criteria.** Go only when the source is documented, globally or explicitly
   market-scoped, and can fail closed without presenting stale status as current.

**Key risk:** pressure to close a high-value coverage gap by scraping login-gated or undocumented
booking endpoints. The current pause is safer than publishing an unreliable availability signal.

**Effort:** partnership/calendar dependent; implementation can reuse the existing static snapshot
and safety-gate patterns once a qualifying source exists.

---

## E. Ship non-Google map display

**Question:** right now, only **1 of 1,636** centres (a single admin-entered override) is eligible
for display on any non-Google basemap — every Google-sourced coordinate (1,018 direct geocodes + 457
via Places, 1,475/1,636 combined) is locked to Google Maps only by
`geo-policy.ts`'s `LEGACY_PROVENANCE` table. Two pilots already exist in code
(`apple-map-pilot.ts`/`.swift`, `neutral-pilot.ts` + the live `maplibre-gl` dependency behind
`/neutral-map`) but neither has produced a production coordinate. What would it take to move even a
meaningful minority of the dataset past this gate?

**Feasibility study plan**
1. **Run the existing pilots to completion, not just as diagnostics.** `apple-map-pilot.ts` and
   `neutral-pilot.ts` already exist and are wired into `package.json` scripts (`apple-map-pilot`,
   `neutral-pilot`) — run them across the full dataset (not a sample) and measure how many centres
   get an independently-corroborated coordinate from Apple MapKit search or Overture Maps, since that
   corroboration is what the quality gate (`quality.ts`) already requires for a location to count as
   "verified" (≥2 independent evidence paths).
2. **Resolve the Overture licensing question concretely.** `geo-policy.ts` marks `overture` as
   `provider_review_required` with an explicit comment that "Overture records can carry different
   source licences" and a migrated row "must persist its audited record-level provenance explicitly"
   (`geo-policy.ts:31-38`) — this reads as an unresolved design question, not a blanket rejection;
   scope what "audited record-level provenance" actually requires to clear a centre.
3. **Quantify the real ceiling.** Even with both pilots maximally successful, some centres will
   never get independent non-Google corroboration (thin/no online footprint) — measure the
   pilots' actual hit rate on a full run before promising a specific coverage number.
4. **Go/no-go criteria.** This is less a single yes/no and more a coverage question: go if the full
   pilot run clears corroboration for a meaningful fraction of centres (define the bar — e.g. 30%+ —
   before running it, so the result isn't rationalized after the fact either way).

**Key risk:** the infrastructure (pilots, dependency, diagnostic page) already exists, which can
create false confidence that this is "almost done" — the actual blocker is a licensing/provenance
review that hasn't happened yet, not a missing pilot.

**Effort:** ~1 week to run both pilots at full scale and get real coverage numbers; the licensing
review is calendar-bound by whoever needs to sign off on Overture's terms, separate from engineering
time.

---

## F. Complete local geocoding provider coverage

**Question:** China (AMap) and India (Mappls) each have a working local geocoding provider in
`geocode.ts`. Korea has none, and Mapbox — a plausible independent global corroboration source —
has zero implementation anywhere in the repo. Is either worth building?

**Feasibility study plan**
1. **Measure Korea's actual current precision first.** Before building Kakao, check how well
   Korea's 21 centres already resolve via Google/`page_embed` (16 rooftop, 3 street and 2
   approximate in the current snapshot) — if Google already resolves Korea to
   rooftop/street precision broadly, a Kakao build may not move the needle much; if it doesn't, the
   gap is real and quantifiable.
2. **Kakao pilot, minimal build.** If step 1 shows a real gap: a Kakao Developers key + address
   geocoding endpoint is low-friction (REST key only, WGS-84 output, no datum conversion needed,
   unlike AMap's GCJ-02) — time-box a standalone script against the 21 existing KR addresses to
   measure precision delta before wiring it into the full provider registry.
3. **Mapbox scoping.** Since Mapbox has zero code today, treat this as a from-scratch add: would it
   serve as (a) an independent corroboration source for the "≥2 evidence paths" quality gate
   globally, or (b) a basemap alternative (overlapping with E)? These are different justifications
   with different priorities — scope which one motivates the work before starting.
4. **Go/no-go criteria.** Build Kakao only if step 1 shows measurable precision headroom. Build
   Mapbox only if it's justified as corroboration evidence for the quality gate specifically (its
   basemap role is already covered by candidate E's Overture/MapLibre path).

**Key risk:** building a provider because the registry has a slot for it, rather than because
current precision data shows a real gap — step 1 exists specifically to prevent that.

**Effort:** ~2–3 days measurement; Kakao build itself is small (a few hundred lines, following the
existing Mappls provider as a template) if justified.

---

## G. Adjacent exam coverage (CELPIP / PTE)

**Question:** the domain model is IELTS-specific end to end (`TestModule`, `TestCategory` in
`types.ts`; offerings logic in `offerings.ts`) with zero CELPIP/PTE references anywhere. Does the
existing ingestion/dedup/quality pipeline generalize to a second exam, and does a comparably
enumerable master source exist?

**Feasibility study plan**
1. **Source audit, same method as the IELTS.org adapter.** Fetch-test CELPIP's (Paragon-operated)
   and Pearson PTE's centre-finder pages: SSR vs client-rendered, enumerable sitemap or not, what
   fields are present. Produce the same evidence table the IELTS.org/British Council/IDP audit
   presumably used (not found in code — this would be a fresh audit).
2. **Schema-fit check against the actual current types.** `operators` in the target schema already
   has a `test_type` column defaulting to `'IELTS'` (`0001_init.sql:14`) — check whether the live
   (non-Postgres) `Centre`/`Operator` types in `packages/core/src/types.ts` have an equivalent field
   or would need one added, since the live dataset and the Postgres target schema aren't guaranteed
   to be in sync (nothing in this inventory confirmed they match field-for-field).
3. **Pipeline reuse check.** CELPIP is single-operator (Paragon), which sidesteps the
   multi-operator dedup problem (`resolve.ts`) that IELTS's British-Council-vs-IDP identity problem
   required — this may be meaningfully simpler to ingest than IELTS was.
4. **Go/no-go criteria.** Go only if a source passes the same SSR/enumerable bar IELTS.org passed.

**Key risk:** treating this as a pure data problem when it's also a product-scope/branding question
— the product's own `package.json` description and domain types are currently IELTS-specific
throughout.

**Effort:** ~1 week source audit per exam; full adapter build is comparable to what an IELTS.org
adapter took if the source clears the audit (not independently estimated here since that original
build's effort isn't visible in the current code).

---

## H. Native iOS/Android client

**Question:** `packages/core` is confirmed genuinely platform-neutral (zero `document`/`window`/
Node-built-in references across `packages/core/src/*.ts`) — what's actually left to build for a
native client, and is app-store distribution worth the ops overhead?

**Feasibility study plan**
1. **Reuse audit.** Enumerate what `@ielts-map/core`'s exports (`.` and `./dataset` per its
   `package.json`) actually cover versus what's web-specific in `apps/web`: map rendering
   (`CentreMap.tsx` is Google-Maps-JS-API-specific, not reusable), marker clustering
   (`@googlemaps/markerclusterer` is web-only), and offline caching of `centres.json` (no existing
   offline story in `apps/web` to model from).
2. **Map-provider decision.** Since `apple-map-pilot.ts`/`.swift` files already exist for coordinate
   corroboration (candidate E), check whether that same Swift tooling gives any head start on an
   actual MapKit rendering integration, or whether it's purely a data-corroboration script with no
   UI code to reuse.
3. **Distribution cost model.** App Store/Play Store fees, review cadence, update latency versus the
   static site's current deploy path (`scripts/deploy-aws.sh` → S3/CloudFront, no app-store review
   in the loop) — a real process change from the zero-approval-latency deploy model in place today.
4. **Go/no-go criteria.** Go only if the reuse audit shows the *business logic* (search, filter,
   dedup, formatting) transfers cleanly — which the platform-neutrality check already suggests is
   likely — **and** a concrete mobile-only capability (offline access, push, background location) is
   named that the existing mobile-responsive web app doesn't already serve.

**Key risk:** building a native shell around an experience the mobile-responsive web app already
provides, for app-store overhead with no new capability.

**Effort:** ~1 week audit; full build is separately estimated once a concrete mobile-only capability
is named.

---

## 2. Suggested sequencing

1. **F step 1 (measure Korea precision)** is the cheapest remaining measurement; run it first and
   build Kakao only if the two approximate and three street-level records show real headroom.
2. **A (computed score)** is the cheapest build-worthy candidate and doesn't require C's
   datastore commitment — resolve it before C, since knowing whether an objective score already
   covers most of the perceived value changes how much C's rubric/schema work is worth doing.
3. **E (non-Google display)** has real sunk-cost infrastructure (two pilots, a live dependency)
   already sitting unused — running them to completion is cheap relative to the value of knowing the
   real coverage ceiling, and should happen regardless of what else is prioritized.
4. **C (assessments/reviews)** only after A's outcome is known — it's the one candidate that ends
   the current zero-datastore, zero-auth posture visible in every workspace's `package.json` today.
5. **D stays paused** until an operator-supported feed exists. **B, G and H** are independent of
   the above and of each other; their feasibility studies can run opportunistically, but none should
   consume build time before A/C settle, since C is the largest architectural commitment here.

## 3. What this plan deliberately does not do

No expansion here is assumed to ship. Every study above is scoped so that a "no" — a source turns
out client-rendered, a pilot's hit rate is too low, a rubric doesn't reproduce, Korea's precision is
already fine without Kakao — is a valid, cheap outcome grounded in a measurement taken *before*
committing build time, not an assumption inherited from a planning document.
