# IELTS Test Centre Finder

A neutral, all-operator directory of IELTS test centres — compare centres by operator, format,
price and location. Ratings are layered on later; the directory is useful on day one.

Canada-first. The plan, and the research it rests on, is in [docs/DEV_PLAN.md](docs/DEV_PLAN.md).

## Status — Phase 1 (M0 + M1)

| Milestone | State |
|---|---|
| M0 — repo, tooling, schema, deployable app | done |
| M1 — master ingestion + directory UI | done |
| M1.5 — IDP overlay + scheduled re-crawl | not started |
| M2+ — filters/search polish, scores, reviews | not started |

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

`apps/web/app/api/centres/route.ts` serves the dataset over HTTP using the same `filterCentres` /
`sortCentres` the UI calls. That endpoint is the seam a mobile client will fetch from, so query
semantics can never drift between platforms.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

The dataset is committed, so the app runs with no database, no API keys and no accounts.

## Rebuilding the dataset

```bash
npm run ingest --workspace @ielts-map/ingest
```

Options need to go to the script directly, since npm swallows them through the workspace
indirection:

```bash
cd packages/ingest && node --experimental-strip-types src/cli.ts --country CA --limit 50
```

| Flag | Effect |
|---|---|
| `--country <ISO>` | Country to filter to (default `CA`) |
| `--limit <n>` | Crawl only the first n slugs — a quick smoke run |
| `--force` | Ignore the HTML cache and refetch |
| `--no-geocode` | Page-embedded coordinates only; no geocoder calls |

### Credentials (all optional)

Copy `.env.example` to `.env.local` — gitignored, and loaded automatically by the
ingester. Nothing here is required: with no credentials at all, the pipeline still builds the
full dataset from page-embedded coordinates plus Nominatim.

| Variable | Effect |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Ingest-time geocoding. Tried before Nominatim; resolves the Canadian street addresses OpenStreetMap does not carry. The web app never receives it. |

**Retention caveat.** Google's Maps Platform terms cap how long their geocoding results may be
cached, with Place IDs the documented exception — so committing Google-derived coordinates to git
indefinitely is not obviously within them. Two things keep this honest: the scheduled re-crawl
(M1.5) is what refreshes those coordinates, and `googlePlaceId` is stored precisely because it is
the value that *is* durably storable. Check the current terms before launch; dropping the key falls
back to Nominatim, whose ODbL data carries no such limit.

The pipeline runs: sitemap → fetch every centre page → parse → filter by country → dedup → resolve
locations → write `packages/core/data/centres.ca.json` plus an `audit.ca.json` listing the fuzzy
merges, parse failures and low-confidence rows worth eyeballing.

Raw HTML caches to `.cache/` (gitignored), so re-runs are fast and cost the source almost nothing.
Fetches are rate-limited and identify themselves; `robots.txt` permits `/test-centres/`.

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
  links are byte-identical across centres, so IDP dedup falls back to fuzzy matching — the most
  fragile part of the pipeline, which is why every fuzzy merge is written to the audit file.
- **Don't trust IELTS.org's city field.** It is broken site-wide ("IELTS test in ?"). City is
  derived from the address block, which has no fixed schema.

## Maps

MapLibre GL with raster OpenStreetMap tiles — no API key, works on clone. That is fine for
development but **not for production**: swap in a proper tile host before launch. MapLibre keeps
the Mapbox GL API shape, so moving to Mapbox is a style-URL and token change, and
`@maplibre/maplibre-react-native` covers the mobile side with the same style object.

Coordinates are stored as WGS-84 only. Conversion to GCJ-02 happens at render time, keyed off the
*centre's* region, if and when China is ever in scope.

Geocoding and the basemap are deliberately separate concerns: Google may resolve a centre's
coordinate at ingest time, but nothing Google-rendered is displayed — the map is MapLibre over OSM
tiles. That keeps the render layer free of Google's mapping terms and cost.

## Testing

```bash
npm test
```

Covers dedup identity rules, the geo confidence cascade, address parsing against every real page
shape observed, and the parser's operator detection.

## Not in this phase

No live test dates or seat availability — no operator publishes them and scraping the booking flow
would breach their terms. No ratings, reviews or accounts yet (M3/M4). No Supabase wiring: the
schema is written but the dataset is still a committed JSON file.
