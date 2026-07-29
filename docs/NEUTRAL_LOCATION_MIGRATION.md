# Basemap-neutral location migration

Decision date: 2026-07-28

## Decision

The iOS app will use Apple MapKit. Its test-centre annotations will come only
from coordinates whose provenance explicitly permits display on any basemap.
Google-derived coordinates remain usable by the existing Google-map web client,
but are removed server-side from Apple and neutral exports.

There is no provider-policy loophole in this design. A coordinate's accuracy
and its display rights are independent properties.

Relevant primary sources:

- [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)
- [Google Maps service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Google Geocoding API policies](https://developers.google.com/maps/documentation/geocoding/policies)
- [Apple MapKit for SwiftUI](https://developer.apple.com/documentation/mapkit/mapkit-for-swiftui)
- [Apple Place IDs](https://developer.apple.com/documentation/mapkit/identifying-unique-locations-with-place-ids)
- [Overture Places](https://docs.overturemaps.org/guides/places/)
- [OpenStreetMap licence](https://www.openstreetmap.org/copyright)
- [Public Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)

## Implemented foundation

- `Geo` can carry explicit origin, licence, attribution, source-record ID and
  display rights.
- Legacy sources use a fail-closed policy table. Google is
  `google_maps_only`; Overture, OSM/Nominatim and administrator-owned points
  can be `any_basemap`; every unaudited provider is
  `provider_review_required`.
- `centreForMap()` removes an ineligible coordinate and the Google Place ID
  before a client receives the record.
- `/data/centres.apple.json` is a static Apple-safe feed with coverage counts
  and a per-centre policy decision.
- Automated new-centre analysis records coordinate origin, display rights and
  whether the centre can have an Apple pin.
- The policy and export boundary have regression tests.

### Current strict coverage

| Apple feed state | Centres |
|---|---:|
| Displayable coordinate | 1 |
| Coordinate suppressed | 1,507 |
| No coordinate | 2 |
| Total | 1,510 |

This low starting value is intentional. It prevents an iOS implementation from
silently treating 1,362 Google-derived points, 141 page embeds and 4 AMap
points as portable data.

## Overture pilot

The repeatable pilot command is:

```bash
npm run neutral-pilot -- --limit 50
```

It reads Overture's official `bigquery-public-data.overture_maps.place` and
`overture_maps.address` mirrors. The table's release label is checked
automatically. Before running, the script performs a dry run and refuses any
query above 110 GB by default. `--dry-run-only true` performs the release,
schema and cost check without executing the query.

The 2026-06-17.0 pilot selected two deterministic centres from each of the 25
largest Google-backed country cohorts.

| Result | Centres | Rate |
|---|---:|---:|
| Accepted: two independent evidence paths | 7 | 14% |
| Review only | 11 | 22% |
| No acceptable candidate | 32 | 64% |

The query's upper-bound estimate was 100,410,038,563 bytes. The script uses
both a dry run and `maximum_bytes_billed`; cost remains bounded even if
BigQuery's free tier or billing policy changes.

Discovery is country-scoped and uses canonical source name tokens, all
Overture name variants, address/postcode fields and non-generic contact data.
It does not use the current restricted coordinate for lookup, ranking or
acceptance. The restricted point is read only after matching to report the
distance discrepancy. Every report row is hard-coded as `diagnosticOnly: true`
and `eligibleForMigration: false`; the command has no code path that writes
`centres.all.json`.

Each centre retains its top five candidates, including rejected alternatives,
with explicit decision reasons. Full Overture dataset/property/record/licence
lineage is preserved. The manually reviewed 50-point sample is stored as a
regression fixture, alongside executable tests for the known wrong-address,
same-building/different-business, wrong-city, campus-only and generic-name
failure modes.

### What the pilot proves

Overture is a useful discovery source with meaningful international coverage.
It is not a complete geocoder and is not reliable enough to become the sole
source of truth. Exact postcodes, operator names and proximity produced
convincing false positives such as railway stations, another branch of the same
operator, and unrelated businesses in the same mall. City/postcode are now
context only; distance cannot make a candidate pass. Exact acceptance requires
two independent identity paths from venue name, street address or
non-generic contact data. Campus and missing-room/building matches remain
review-only.

The strong pilot candidates used CDLA-Permissive-2.0 and, in a small number of
records, Apache-2.0 sources. Production import must preserve the actual
record-level `sources[].license` values rather than assuming every future
Overture record has the same licence.

## Production migration design

For every new or still-restricted centre:

1. Parse the canonical IELTS.org name, address, postcode, city and country.
2. Resolve the city/locality boundary from an open, monthly local index.
3. Search Overture Places and Addresses inside that boundary using source name
   variants, canonical address, postcode and contacts. This search must not use
   an existing Google coordinate.
4. Independently geocode the canonical street address using a provider that
   contractually allows stored, cross-basemap coordinates. The preferred cheap
   path is a small self-hosted OSM/Pelias or Nominatim-compatible service; the
   public Nominatim endpoint must not be used for recurring bulk work.
5. Accept a portable point only when the Overture venue result and the
   independently geocoded address agree within the existing street/campus
   thresholds, country/postcode checks pass, and record-level licences are
   allow-listed.
6. Persist the top five candidates, decision/rejection reasons, both evidence
   paths and full record lineage. A one-path result stays in the review queue
   and the centre remains list-only on Apple Maps.
7. For user corrections, use a neutral map picker and obtain an explicit grant
   to store/display the submitted coordinate on any basemap. Google-map
   correction pins must remain Google-only.

```text
IELTS.org name/address
        |
        +--> Overture venue candidate --------+
        |                                     |
        +--> portable address geocoder -------+--> agreement gate
                                                      |
                                        +-------------+-------------+
                                        |                           |
                                  neutral coordinate           list only/review
```

## Next implementation slice

Build a local neutral lookup index for one high-value cohort, recommended:
Canada, the UK, UAE, Oman and Saudi Arabia.

That slice should:

1. download current Overture Places and Divisions only for the selected
   localities;
2. add the independent storable-address geocoder;
3. rerun candidates without Google coordinates;
4. promote only two-path agreements to `source: "overture"` with explicit
   provenance;
5. regenerate the Apple feed and report its coverage gain; and
6. add a monthly refresh plus a cheap new-centre lookup against the local
   index.

Only after this slice produces an acceptable precision/coverage result should
the iOS MapKit shell be built. Otherwise the app would launch with a map that
correctly hides almost every pin.

## Remaining policy work

- Obtain written Google confirmation about use of Google Maps Platform in an
  independently sourced directory. A draft is in
  `docs/GOOGLE_MAPS_SUPPORT_DRAFT.md`.
- Replace the committed indefinite Google geocode cache with a timestamped,
  at-most-30-day cache or Place-ID-only memory. Existing unchanged centres can
  reuse their restricted Google points only for the Google client during the
  transition.
- Audit `page_embed` and each local provider contract before changing
  `provider_review_required`.
- Keep Apple search/geocoder results inside Apple-map experiences. Apple Place
  IDs may be stored; that exception does not make Apple coordinates a neutral
  database.
