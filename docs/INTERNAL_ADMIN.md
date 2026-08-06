# Internal centre editor

The production editor is available at `https://ielts.zhengqiu.net/internal/`.

## Security model

- The HTML login shell is static and contains no centre-management credentials.
- Authentication uses an Amazon Cognito authorization-code flow with PKCE.
- Self-registration is disabled. AWS administrators create users explicitly.
- API Gateway validates the Cognito JWT, and the Lambda handler independently requires membership
  in the `admins` group before reading or writing overrides.
- The browser keeps the one-hour tokens in `sessionStorage`, not persistent local storage.
- DynamoDB uses on-demand billing and point-in-time recovery. The table and user pool are retained
  if the CloudFormation stack is removed.

## Editing behavior

The editor loads every centre from the deployed source feed. Selecting a centre opens its complete
JSON record. On save, the browser compares the edited record with the source-backed record and
stores only changed top-level fields as a durable override.

The public `/data/centres.json` endpoint merges these overrides at request time and is cached by
CloudFront for at most 60 seconds. List and map views therefore receive edits without rebuilding
the static site. Centre detail pages hydrate from that same feed while retaining their source-backed
static HTML as an offline/error fallback. The separate mobile export files remain build-time data.

Removing an override restores the source-backed record. Setting `isPublishable` to `false` removes
an ordinary centre from the merged public feed. A record marked `futureOpening` remains visible so
its interest form can be shown.

## Location approval queue

Choose **Location review** in the left column to list every centre that has a candidate coordinate
but cannot yet be treated as a confident point. The queue is calculated from the effective record,
including any saved override. It contains a centre when one or more of these rules fails:

- `geo.verification` must be `verified`;
- `geo.precision` must be `street` or `rooftop`;
- `geo.confidence` must be at least `0.5`.

A centre with `geo: null` is not in the approval queue because there is no candidate point to
approve. It needs location research or a correction submission first.

To approve a candidate:

1. Open the task and inspect the coordinate on the map.
2. Compare it with an independent source such as the venue or operator page. A provider result must
   not approve itself.
3. Check the confirmation box.
4. Choose **Draft street approval** when the street/building complex is confirmed, or **Draft
   rooftop approval** only when the exact building or entrance is confirmed.
5. Review the resulting JSON and choose **Save changes**.

The approval helper changes `precision`, `verification`, `evidencePaths`, and (when needed)
`confidence`. It preserves `source` and `provenance`: manually reviewing a Google coordinate does
not turn it into a provider-neutral coordinate. A saved approval disappears from the queue after
the effective feed refreshes.

## Before changing JSON

- JSON keys and string values require double quotes. Do not add comments or trailing commas.
- `null` means unknown or unavailable. It is different from `""`, `0`, and an empty array.
- Keep authoritative text such as `address.raw` and `priceText` exactly as published unless the
  correction is supported by better evidence.
- The editor validates the complete merged record. A malformed nested offering or coordinate is
  rejected without changing the public feed.
- A save stores complete changed top-level blocks. Editing one value inside `geo`, `address`, or
  `offerings` therefore overrides that entire block until the override is removed.

## Top-level field reference

| Field | Allowed value and editing rule |
| --- | --- |
| `id` | Stable synthetic identifier. Read-only. |
| `name` | Non-empty canonical English centre name. Do not replace it with a provider translation. |
| `operator` | `IDP`, `British Council`, `IELTS USA`, or `unknown`. |
| `operatorSource` | `booking_domain`, `slug`, `name`, or `unknown`. Prefer `booking_domain`; only change this when changing the operator evidence. |
| `externalId` | British Council booking-location identifier, otherwise a string or `null`. |
| `ieltsOrgSlug` | Static public route slug. Read-only because changing it requires a deployment. |
| `mergedSlugs` | Array of IELTS.org slugs represented by this centre. Do not remove genuine duplicate-source slugs. |
| `address` | Structured address block described below. `address.raw` remains the public source of truth. |
| `localizations` | Optional search/matching evidence. Never used as the public name or address. See below. |
| `contact` | All known phones, emails, and websites. Preserve values from every merged source. |
| `phone` | Legacy compatibility value. Prefer `contact.phones`; use one primary phone or `null`. |
| `geo` | WGS-84 coordinate and its quality/provenance, or `null` when no coordinate is known. |
| `googlePlaceId` | Google Place ID or `null`. Keep only when it belongs to this exact centre. It is never exported to non-Google clients. |
| `formats` | Unique formats available across offerings: `computer_delivered` and/or `paper_based`. Keep it consistent with `offerings`. |
| `offerings` | Array of bookable test products. Each product is described below. Entries for the same venue are offerings, not separate centres. |
| `priceFromText` | Original fee string belonging to the lowest verified parsed offering, or `null`. Never reformat it. |
| `parsedPriceFrom` | Numeric amount derived from `priceFromText`, or `null`. It is for sorting, not display. |
| `parsedCurrency` | ISO currency code associated with the summary price, such as `CNY`, or `null`. |
| `bookingUrl` | Operator booking/interest URL or `null`. Use an `https://` URL. |
| `offersOneSkillRetake` | Source-managed boolean derived from the One Skill Retake badge on the IELTS.org country listing. Override only when current operator evidence shows the listing is wrong. |
| `oneSkillRetakeOnly` | Source-managed boolean for a centre that provides OSR but no full test. It is `true` only when no merged source page or offering supplies Academic, General Training, UKVI, or SELT. |
| `futureOpening` | Optional operator-declared future-opening block. Do not infer this merely because dates are unavailable. |
| `isPublishable` | Boolean. `false` hides an ordinary centre; future openings remain visible with their warning and interest form. |
| `confidence` | Overall record confidence from `0` to `1`. This is distinct from `geo.confidence`. |
| `sources` | Provenance records for pages merged into this centre. Preserve every real source. |
| `firstSeenAt` | ISO timestamp for the first discovery. Normally source-managed; do not edit manually. |
| `lastSeenAt` | ISO timestamp for the most recent source observation. Normally source-managed; do not edit manually. |

### `address`

| Field | Allowed value and editing rule |
| --- | --- |
| `raw` | Non-empty canonical English address shown to users. |
| `lines` | Address components in display order. Keep them consistent with `raw`. |
| `city` | Normalized city used internally for matching, or `null`. It is not a public translation. |
| `citySource` | `address_rule`, `geocoder`, `legacy`, `admin`, or `null`. Use `admin` for a reviewed correction. |
| `region` | State, province, emirate, prefecture, or other first-level area, or `null`. |
| `postcode` | Published/verified postal code as a string, or `null`. Preserve leading zeroes. |
| `country` | Two-letter ISO 3166-1 code such as `CN`, or `null` only when genuinely unknown. |

### `contact`

`phones`, `emails`, and `websites` are arrays of strings. Preserve all distinct values collected
from merged IELTS.org pages. Deduplicate equivalent phone spellings, use normal email addresses,
and use `https://` websites. An empty array means none was published.

### `geo`

| Field | Allowed value and editing rule |
| --- | --- |
| `lat` | Latitude from `-90` to `90`. |
| `lng` | Longitude from `-180` to `180`. |
| `precision` | `rooftop`, `street`, `postcode`, `city`, `country`, or `approximate`. Never upgrade this only to make a dot appear. |
| `source` | `page_embed`, `google`, `google_places`, `overture`, `amap_places`, `mapbox`, `nominatim`, `amap`, `mappls`, `kakao`, `naver`, `crowd`, or `admin`. This identifies the coordinate origin, not the reviewer. |
| `coordinateSystem` | Must be `WGS84`. Convert GCJ-02 coordinates before storing them. |
| `verification` | `verified`, `approximate`, `unverified`, or `conflicted`. `verified` requires two independent evidence paths, except for an explicit administrator approval. |
| `evidencePaths` | Any combination of `page_embed`, `address`, `venue_name`, `plus_code`, `operator_map`, and `admin`. Add `admin` when a human independently confirms the point. |
| `agreementKm` | Distance between corroborating automatic candidates, or `null` when not applicable. Do not invent `0`. |
| `confidence` | Location confidence from `0` to `1`. A confident dot additionally requires at least `0.5`. |
| `provenance` | Optional licensing block described below. Preserve the actual provider even after administrator review. |

The smallest manual correction that makes a point eligible is a justified `street`/`rooftop`
precision, `verified` verification, at least `0.5` confidence, and `admin` evidence. Use the approval
buttons so these fields remain consistent.

### `geo.provenance`

| Field | Allowed value and editing rule |
| --- | --- |
| `origin` | `ielts_org`, `google_maps_platform`, `overture_maps`, `openstreetmap`, `community_submission`, `administrator`, `third_party_provider`, or `unknown`. |
| `displayRights` | `any_basemap`, `google_maps_only`, or `provider_review_required`. This controls Google/Apple/neutral exports. |
| `license` | Provider licence name or `null`. |
| `attribution` | Required attribution text or `null`. |
| `sourceRecordId` | Durable provider feature ID or `null`. |

Do not mark a Google-derived coordinate as `administrator`/`any_basemap`; administrator review can
verify accuracy but cannot change the provider's licence.

### `offerings[]`

| Field | Allowed value and editing rule |
| --- | --- |
| `label` | Source product label, such as `UKVI Academic Test`. |
| `kind` | Legacy classification: `academic`, `general_training`, `ukvi`, `osr`, `life_skills`, or `other`. |
| `module` | Preferred module axis: `academic`, `general_training`, `life_skills`, or `other`. |
| `category` | `standard` or `ukvi_selt`. SELT/UKVI Academic and General Training use their actual module plus `ukvi_selt`; Life Skills uses `life_skills` plus `ukvi_selt`. |
| `format` | `computer_delivered` or `paper_based`. “Writing on paper” is derived from the source label and is not a third stored format. |
| `priceText` | Exact authoritative source string, including currency and separators, or `null`. This is what users see. |
| `parsedPrice` | Non-negative numeric amount derived from `priceText`, or `null`. |
| `parsedCurrency` | Derived ISO currency code or `null`. |
| `priceParseStatus` | `verified` when the numeric/currency parse is lossless, `unparsed` when text exists but cannot be safely parsed, or `missing` when there is no published price. |

After changing offerings, also update `formats`, `priceFromText`, `parsedPriceFrom`, and
`parsedCurrency`. Never replace the authoritative `priceText` with a reformatted value.

### `localizations[]`

| Field | Allowed value and editing rule |
| --- | --- |
| `locale` | Currently `zh-CN` or `hi-IN`. |
| `name` | Local-language matching evidence or `null`; not displayed publicly. |
| `address` | Local-language matching evidence or `null`; not displayed publicly. |
| `nameSource` | `amap`, `mappls`, `admin`, or `null`. |
| `addressSource` | `amap`, `mappls`, `admin`, or `null`. |

### `sources[]`

| Field | Allowed value and editing rule |
| --- | --- |
| `source` | Source publisher label, normally `IELTS.org`. |
| `externalSlug` | Identifier used by that source. |
| `url` | Full source URL. |
| `seenAt` | ISO timestamp of the observation. |
| `stillPresent` | Boolean indicating whether the latest crawl still found the source record; it is not proof that the centre is open. |

### `futureOpening`

| Field | Allowed value and editing rule |
| --- | --- |
| `source` | Currently only `ielts_usa_network`. |
| `sourceUrl` | Operator page supporting the future-opening status. |
| `sourceLabel` | Operator wording retained for audit. |

## Example: independently approved coordinate

```json
{
  "lat": 39.945735,
  "lng": 116.463221,
  "precision": "rooftop",
  "source": "google",
  "coordinateSystem": "WGS84",
  "verification": "verified",
  "evidencePaths": ["address", "venue_name", "admin"],
  "agreementKm": 0,
  "confidence": 0.9,
  "provenance": {
    "origin": "google_maps_platform",
    "displayRights": "google_maps_only",
    "license": "Google Maps Platform Terms",
    "attribution": "Google Maps",
    "sourceRecordId": null
  }
}
```

This remains Google-only because the coordinate came from Google. For a coordinate independently
supplied and owned by an administrator, use `source: "admin"`, `origin: "administrator"`, and
`displayRights: "any_basemap"`, and remove an unrelated `googlePlaceId`.

## One Skill Retake fields

`offersOneSkillRetake` is maintained automatically from the One Skill Retake badge on IELTS.org's
country listing. Override this boolean only when current operator evidence shows that the listing is
wrong. `oneSkillRetakeOnly` is narrower: it is true only when an OSR-badged source card publishes no
full-test format and no merged source page or offering supplies Academic, General Training, UKVI, or
SELT. The next ingest run refreshes both fields for existing and newly discovered centres.

## Create an administrator

After deploying the infrastructure:

```bash
ADMIN_EMAIL=owner@example.com npm run admin:create-user
```

Cognito emails a temporary password. At first login, the administrator must replace it with a
password satisfying the user-pool policy. Never commit passwords or tokens to the repository.
