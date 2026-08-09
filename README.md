# IELTS Test Centre Finder

A neutral, all-operator directory of IELTS test centres — compare centres by operator, format,
price and location. Ratings are layered on later; the directory is useful on day one.

Worldwide coverage. The plan, and the research it rests on, is in
[docs/DEV_PLAN.md](docs/DEV_PLAN.md).

## Status

| Milestone | State |
|---|---|
| M0 — repo, tooling, static AWS deployment | done |
| M1 — worldwide master ingestion + directory UI | done |
| M1.5 — scheduled re-crawl + automated quality analysis | done |
| M2 — viewport loading, search, distance sorting and offering filters | done |
| M2.5 — automated remediation + quality trend gates | done |
| M2.6 — availability feasibility and future-opening notices | paused |
| M2.7 — basemap-neutral coordinate foundation | **in progress** |
| M3 — objective score and compliant Google enrichment | **next** |
| M4+ — assessments, reviews and hardening | planned |

M2.6 confirmed that the directory should not automate registration availability or opening
status. Five IELTS USA future openings remain as a manually curated exception: they are visibly
marked as not yet open and link to official candidate-interest forms. Live dates and seats are
never inferred. See [the feasibility decision](docs/AVAILABILITY_FEASIBILITY.md).

## Why the repo is shaped this way

The end goal is an iOS/Android app, so nothing that a mobile client will need lives inside the
Next.js app. `@ielts-map/core` holds the types, dedup rules, geo-confidence scoring, filtering and
formatting, with no DOM and no Node built-ins — a React Native client imports the same module and
gets identical behaviour. The web app is one consumer of it; the ingester is another.

```
packages/core     domain layer + the committed dataset   (shared, platform-agnostic)
packages/ingest   IELTS.org crawler → dataset            (Node CLI)
apps/web          Next.js directory                      (consumer)
supabase/         target Postgres schema for later
docs/, research/  plan, feasibility study, raw artifacts
```

`/data/centres.json` serves the committed dataset as a static JSON feed. The web loads it after the
page shell is visible and applies the same `filterCentres` / `sortCentres` functions a mobile
client can import, so query semantics do not drift between platforms.
`/data/centres.apple.json` is the fail-closed iOS feed: it removes Google Place IDs and any
coordinate whose provenance does not permit display on Apple Maps.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

The development server is available at `http://localhost:3000`.

The dataset is committed, so the app runs with no database, no API keys and no accounts.

## Production deployment

The production build is a static export: a private S3 bucket stores the files and CloudFront
provides HTTPS, compression and edge caching at `https://ielts.zhengqiu.net`. There is no
always-on server or database to pay for. The complete exported site is about 59 MB; the browser
downloads the centre feed separately, and CloudFront compresses it to roughly 270 KB.

The AWS CLI must be authenticated to the account that owns the `zhengqiu.net` Route 53 hosted
zone. Deploy or update the site with:

```bash
npm run deploy:aws
```

The script builds the app, deploys `infra/aws-static-site.yml`, syncs the export, and invalidates
CloudFront. Override `AWS_REGION`, `STACK_NAME`, `DOMAIN_NAME`, `ZONE_NAME`, or `HOSTED_ZONE_ID`
only when deploying a different environment. CloudFront certificates require `us-east-1`.

The `Monitor British Council USA OSR policy` GitHub Action checks the official British Council
guidance every six hours. It fails closed when the page no longer resembles the expected OSR
guidance, and changes the warning only when the intact page adds or removes the USA restriction.
Because British Council rejects direct non-browser HTTP clients, the monitor reads that exact
public source URL through the documented, rate-limited Jina Reader transport; the policy feed
records both URLs, and British Council remains the sole authority for the claim.
When the policy changes, the action uploads only `/data/after-test-policy.json` and invalidates
that CloudFront path. The hosting stack creates a GitHub OpenID Connect role restricted to this
repository's `main` branch and that single S3 object, so GitHub stores no long-lived AWS key. Run
one normal `npm run deploy:aws` after merging infrastructure changes to provision the role before
the scheduled monitor can publish a policy change.

## Rebuilding the dataset

```bash
npm run ingest --workspace @ielts-map/ingest
```

Options can be forwarded through the root script:

```bash
npm run ingest -- --country CA --limit 50
```

| Flag | Effect |
|---|---|
| `--country <ISO>` | Country to filter to (default `CA`) |
| `--limit <n>` | Crawl only the first n slugs — a quick smoke run |
| `--force` | Ignore the HTML cache and refetch |
| `--no-geocode` | Page-embedded coordinates only; no geocoder calls |
| `--google-budget <n>` | Maximum Google requests for one run (default `500`) |
| `--amap-budget <n>` | Maximum AMap requests across geocoding and localization (default `300`) |
| `--mappls-budget <n>` | Maximum Mappls requests across geocoding and localization (default `300`) |
| `--allow-large-diff` | Accept a confirmed large expansion/removal; never overrides a known-source fetch/parse failure |
| `--allow-quality-regression` | Accept a confirmed systemic quality regression; separate from the dataset-size override |
| `--no-remediate` | Run diagnostics without attempting location/city repairs |
| `--remediation-limit <n>` | Bound repair attempts per run (default `100`) |

To enrich an already-built worldwide dataset without crawling IELTS.org again:

```bash
npm run localize
```

The standalone localization command uses the same finite AMap and Mappls
defaults. Override them explicitly with `--amap-budget <n>` or
`--mappls-budget <n>` when the account quota requires a smaller ceiling.

This preserves the English IELTS.org record and adds corroborated local-language matching data.
Localized centre names may be displayed, but localized addresses are retained for search/evidence
only and are never presented as trusted directions. China uses a nearby AMap school/IELTS POI and
requires the published street number to agree when one is available; India uses Mappls and
requires the published postcode to agree. Approximate/city/postcode pins are skipped.

### Credentials

Copy `.env.example` to `.env.local` — gitignored, and loaded automatically by the
ingester. The dataset pipeline can run without credentials using page-embedded
coordinates and a deliberately slow Nominatim development fallback. The
interactive web map needs the two `NEXT_PUBLIC_` values at build time; recurring
production ingestion should use Google plus the applicable country providers.
The root `npm run dev`, `npm run build`, and `npm run deploy:aws` commands use
explicit environment variables when supplied and otherwise load the web-map
values from AWS Systems Manager Parameter Store in `us-east-1`:

- `/ielts-map/build/NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `/ielts-map/build/NEXT_PUBLIC_GOOGLE_MAP_ID`

This keeps the browser key out of the repository while ensuring a manual AWS
deployment cannot silently publish a map-less build. Developers without access
to those AWS parameters can provide both variables directly when running the
commands.

| Variable | Effect |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Private ingest-time key restricted to Google Geocoding and Places API (New). Address and venue-name searches are independent evidence paths. The web app never receives it. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser-only Maps JavaScript key, restricted to localhost:3000 and ielts.zhengqiu.net. |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Google vector Map ID used by advanced markers. |
| `AMAP_API_KEY` | Ingest-time fallback for coarse mainland-China records, plus Chinese-name POI corroboration for unresolved venues. AMap coordinates are normalized to WGS-84 before storage. |
| `AMAP_MIN_INTERVAL_MS` | Optional AMap throttle (default `350` ms between calls). Set this from the key's quota shown in the AMap console. |
| `AMAP_REQUEST_TIMEOUT_MS` | Optional per-request AMap deadline (default `8000` ms); timeouts are not cached as empty results. |
| `MAPPLS_API_KEY` | Ingest-time fallback for coarse India records and local-language matching evidence. Resolves a geocode eLoc through Place Details when necessary. |
| `PROVIDER_REQUEST_TIMEOUT_MS` | Optional per-attempt Google/Mappls deadline (default `8000` ms); transient transport and 408/429/5xx failures retry up to three times. |

Mappls must enable the **Location Coordinates** Place Details subtemplate for the key. A basic key
can successfully return an eLoc while omitting latitude/longitude; the ingester treats that as a
temporary provider-configuration failure and deliberately does not cache an empty result.

**Retention caveat.** Google allows Place IDs to be stored durably, while other
geocoding content has retention and display restrictions. The dataset keeps
`googlePlaceId` separately, and the Apple feed suppresses all Google-derived
coordinates. The remaining committed Google cache is transition debt and must
be replaced by a timestamped at-most-30-day cache or Place-ID-only memory; see
[the neutral-location migration](docs/NEUTRAL_LOCATION_MIGRATION.md).

The pipeline runs: sitemap → fetch every centre page → parse → filter by country → dedup → resolve
locations → apply reviewed corrections → analyse repair candidates → attempt bounded remediation
→ refresh local-language matching evidence for the accepted coordinate → re-analyse → compare the
quality baseline → diff → write the selected dataset (the scheduled job uses
`centres.all.json`). The matching audit records pending merge proposals, parse failures, unverified
locations, unparsed prices, legacy city values, remediation outcomes and the new-centre analysis.

Raw HTML caches to `.cache/` (gitignored), so re-runs are fast and cost the source almost nothing.
Fetches are rate-limited and identify themselves; `robots.txt` permits `/test-centres/`.

## Automation

[`.github/workflows/refresh-centres.yml`](.github/workflows/refresh-centres.yml) re-runs the whole
pipeline on a schedule — this is M1.5's self-maintaining re-crawl.

**Weekly, Mondays 05:00 UTC**, plus a manual **Run workflow** button. Weekly rather than nightly
because a run refetches all ~1,850 centre pages and the source moves far more slowly than that.
The scheduled and manual default is `ALL`; a manual run can still target one ISO country code.

Each run: installs, runs the tests, crawls with `--force`, geocodes, analyses every centre, diffs
against the committed dataset, uploads a machine-readable quality artifact, verifies the site
still builds, and commits only if something moved.

The committed `quality-baseline.<country>.json` contains deterministic affected-centre and
per-country counts. CI compares it with the final post-remediation analysis, reports existing
regressions separately from issues on legitimate new centres, and blocks systemic quality cliffs.
Ordinary deltas remain automatic. Repair work is prioritized by issue rate weighted by country
cohort size and capped by both the remediation limit and the existing provider-call budget.

### What happens when a new centre is discovered

The crawler compares both centre ids and source-page slugs with the committed dataset and previous
audit, then follows each genuinely new discovery through the complete pipeline:

1. **Parse and provenance:** canonical name/address, authoritative country assignment, booking-link
   operator, source URL, contact data, and offerings must survive parsing. A never-parsed new slug
   is recorded as unresolved instead of disappearing into a generic log.
2. **Price integrity:** the IELTS.org price string remains authoritative. Numeric amount/currency
   are checked as derived fields; unparseable strings remain visible but are excluded from numeric
   sorting and flagged.
3. **Location integrity:** country plausibility, precision, verification, independent evidence
   paths, and measured agreement are checked. A suspicious point cannot become a precise map pin;
   the centre can still be found by its canonical address. Published Plus Codes are queried as an
   independent coordinate evidence path. Coordinate origin/display rights are also recorded, and
   the new-centre report states whether the record can receive an Apple Maps pin.
4. **Identity:** pending fuzzy duplicate candidates stay separate and are named in the report.
   A new source page safely merged into an existing physical centre is reported explicitly.
5. **Publication decision:** structurally unusable records (missing country, canonical address,
   source, offerings, or every source price) are quarantined. Valid records with incomplete
   contact/location evidence are published with warnings; fully supported records are accepted
   automatically.

The JSON report is written to `.artifacts/centre-quality.<country>.json`, uploaded by GitHub
Actions for 30 days, and summarized in the job page. Repeatedly failing source pages are tracked as
ongoing rather than announced as new every week; the small committed
`quality-state.<country>.json` file provides that memory even when no dataset row changed. If a
previously known page suddenly fails, or the diff contains a systemic-looking addition/removal
cliff, the job blocks the dataset write. A confirmed legitimate expansion can use
`--allow-large-diff`; known-source failures cannot be overridden because that could silently
delete existing data.

Repairable location/city issues receive a bounded second resolution pass. A proposal is accepted
only if it removes a targeted issue, improves the quality score, and introduces no new warning or
error. Administrator-reviewed evidence is never overwritten. Previously unresolved pages are
retried by the normal full crawl, and pending duplicate pairs gain structured contact/postcode/
distance evidence without fuzzy auto-merging.

Opening status, future dates, and a second operator directory remain explicitly deferred rather
than being inferred from IELTS.org presence.

Two details make the schedule work rather than just churn:

- **Change detection ignores bookkeeping.** Every record carries `firstSeenAt`, `lastSeenAt` and
  per-source `seenAt`, all of which move on every crawl. Comparing raw records would report a
  change every single week. The diff compares only fields a reader would care about — name,
  operator, address, price, offerings, coordinates, booking link, publication eligibility — so an unchanged
  week produces no commit at all. There is a regression test pinning exactly this.
- **The geocode cache is committed** (`data/geocode-cache.json`, ~44 KB). CI checks out fresh, so
  without it every run would re-bill every address to Google. The fetched HTML is *not* committed
  and not cached in CI: the point of a scheduled crawl is to see the source as it is now.
- **No automated availability claims.** The weekly job refreshes the neutral centre directory, not
  opening status, dates, or seats. Five manually curated IELTS USA future openings are retained
  only so candidates can use their official interest forms.

To enable Google geocoding in CI, add the key as a repository secret — run this yourself, so the
key stays between you and GitHub:

```bash
gh secret set GOOGLE_MAPS_API_KEY --repo ZhengQ2/ielts_app
gh secret set AMAP_API_KEY --repo ZhengQ2/ielts_app
gh secret set MAPPLS_API_KEY --repo ZhengQ2/ielts_app
gh secret set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY --repo ZhengQ2/ielts_app
gh secret set NEXT_PUBLIC_GOOGLE_MAP_ID --repo ZhengQ2/ielts_app
```

The workflow remains buildable without the ingest keys, but its no-key geocoder
is intended for development rather than recurring worldwide automation.

To run the basemap-neutral Overture feasibility audit through its official BigQuery public mirror:

```bash
npm run neutral-pilot -- --limit 50
```

Use `--dry-run-only true` to validate the current Overture release, SQL and
BigQuery byte estimate without executing the query.

The command checks the mirrored release label, performs a dry run, enforces a maximum-bytes cap,
and writes diagnostics only under `.artifacts/`; it cannot modify the product dataset.

## Reviewed corrections

Every centre page links to a pre-filled public GitHub report for opening status, contact details
and other listing problems. Location reports currently ask the reporter to place and fine-tune a pin
on Google Maps; the chosen coordinates and map link are then included automatically in the
pre-filled issue. This keeps the static site free of a public write endpoint and database;
reporters need a GitHub account, and maintainers approve or deny each report manually.
Those submitted Google-map points remain Google-only. A neutral picker plus an explicit
cross-basemap submission grant is required before a user correction can enter the Apple feed.

Approved changes belong in
[`packages/core/data/centre-overrides.json`](packages/core/data/centre-overrides.json), with a
reason and evidence links. The ingester applies that file after every crawl, so an error already
verified against the operator or a map provider cannot be silently restored by a wrong upstream
listing. Closing the report without adding an override is the denial path.

## Things worth knowing before you touch the ingester

These each cost real debugging time during the feasibility work, and there is a regression test for
each one:

- **Never size-cap a sitemap fetch.** The pages are ~95 KB and IDP centres cluster in the *tail* of
  every one, so a truncated read silently returns a British-Council-only world. Downloads are
  required to end with `</urlset>`.
- **Parse `<loc>` only.** Each `<url>` carries `xhtml:link` alternates repeating the same URL;
  reading hrefs double-counts every slug. (`research/sitemap-snapshots/ALL_slugs.txt` has this bug
  baked in — it is kept as a record, not as data.)
- **The operator comes from the booking-link domain, never the slug or the name.** Plenty of
  centres carry no operator branding at all. And every page footer links both `ielts.idp.com` and
  `takeielts.britishcouncil.org`, so a whole-page domain scan labels every British Council centre
  as IDP.
- **Only British Council centres have a real id** (`location=` in the booking link). IDP booking
  links are byte-identical across centres, so the IELTS.org slug base and
  same-operator exact-address agreement are the only automatic fallbacks.
  Fuzzy name/postcode/proximity matches stay separate and enter the audit queue.
- **Don't trust IELTS.org's city field.** It is broken site-wide ("IELTS test in ?"). City is
  filled only by a country-specific rule, a verified geocoder, or a reviewed
  override. Safe legacy values are labelled and queued for replacement.
- **A new sitemap slug is not automatically a new physical centre.** It may be a duplicate offering
  page, a currently unparseable page, or a genuine centre. The quality report records which branch
  occurred and the automated publication decision.

## Maps

The web app uses Google Maps JavaScript with advanced markers. The public browser key is separate
from the private ingest key and restricted by HTTP referrer. Coordinates are stored as WGS-84
only; conversion to a local provider's coordinate system happens only at that provider boundary.

## Testing

```bash
npm test
```

Covers dedup identity rules, the geo confidence cascade, address parsing against every real page
shape observed, parser/operator detection, new-centre quarantine, pin suppression, price-string
preservation, operator-status matching/expiry, discovery-failure tracking, and systemic-diff
safety gates.

## Not in this phase

No live test dates or seat counts: the official sources reviewed expose no documented global feed,
and the app does not inspect login-gated or undocumented booking endpoints. No ratings, reviews or
accounts yet (M3/M4). No Supabase wiring: the schema is written but the dataset is still a
committed JSON file.
