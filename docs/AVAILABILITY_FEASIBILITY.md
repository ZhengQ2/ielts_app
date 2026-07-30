# M2.6 — Opening-status and test-date feasibility

**Decision date:** 2026-07-28
**Outcome:** ship a narrow IELTS USA status overlay; do not claim global opening status, live test
dates, or seats.

## Evidence reviewed

| Official source | What it supports | Decision |
|---|---|---|
| [IELTS test-centre finder](https://ielts.org/test-centres) | Centre and offering discovery; it directs readers to the test centre for specific availability | Keep as the master listing, never as proof that a centre is open |
| [British Council booking guidance](https://takeielts.britishcouncil.org/take-ielts/book) | General paper/computer cadence and an outbound booking flow; computer dates depend on local demand | No centre/date/seat ingestion |
| [IDP booking guidance](https://ielts.idp.com/singapore/about/ielts-registration-and-booking) and country test-date pages | Country-level schedules and instructions to select location, type, date and time in the booking journey | No globally consistent centre/date/seat ingestion |
| [IELTS USA Test Center Network](https://go.ieltsusa.org/TestCenterNetwork) | Public registration links, explicit “not accepting registrations” text, and a separate future-location list that states there are no scheduled or planned dates | Supported US-only status overlay |
| [British Council IELTS affiliate programme](https://takeielts.britishcouncil.org/ielts-partner-organisations/affiliate-programme) | A legitimate route to referral links and a commercial relationship | Apply later and ask specifically for an authorised availability feed; the public page does not promise one |
| [British Council terms of use](https://www.britishcouncil.org/terms) | Ordinary text links are generally allowed; copying British Council content into another product requires permission | Continue linking; do not reproduce booking content or inspect private endpoints |

No public, documented global availability API was found in the official material reviewed. This
is a bounded finding, not proof that no private partner feed exists.

The IELTS USA network page is anonymous, server-rendered and permitted by its
[`robots.txt`](https://go.ieltsusa.org/robots.txt). The automation requests it once per weekly run,
identifies itself, stores only small factual status signals plus attribution, and never enters a
booking session.

## Implemented contract

- `registration_available` means the operator currently publishes a registration link. It does
  **not** mean that a date or seat is available.
- `future_location` means IELTS USA explicitly lists the place as potential/future with no
  scheduled or planned dates.
- `not_accepting_registrations` is used only for an explicit operator statement.
- No matched evidence means **unknown**, never closed.
- A snapshot older than 15 days is ignored in the product. This allows one missed weekly run, then
  automatically degrades every assertion to “verify with operator.”
- The source parser and matcher emit a machine-readable diagnostic. A major parse/match collapse
  blocks replacement of the last good snapshot; newly unmatched directory centres create a CI
  warning, while unchanged or operator-only unmatched rows remain in the artifact without weekly
  alert noise.

As of the decision date, all 28 IELTS USA centres in the committed directory match the operator
page: 23 have operator-published registration links and 5 are explicitly future locations. Two
additional operator rows say “not accepting registrations” but are not present in the IELTS.org
master, so they are retained only as source diagnostics.

## What would unlock live dates

An operator-provided contract or documented feed must define:

1. a stable centre identifier that can be reconciled with the directory;
2. whether a row means a scheduled sitting, an open registration window, or an actual remaining
   seat;
3. test module/category, delivery mode, timezone and update timestamp;
4. authentication, rate limits, display/retention rights and attribution;
5. geographic coverage and failure/SLA semantics.

Until then the supported product action is “Check dates and book on the operator site.”

## British Council bounded pilot

Anonymous browser testing found that the global British Council registration flow can enumerate
countries, cities and venues before login, but repeated browsing can time out after a small number
of searches. That behaviour is treated as a provider boundary, not something to bypass.

The experimental coordinator in `packages/ingest/src/bc-availability-pilot.ts` therefore makes no
network requests itself. A future browser adapter may run only from an isolated CI/AWS worker and
must obey all of these controls:

- country-level checks only; never one booking journey per centre;
- one active check, eight countries at most per run and at least 15 seconds between checks;
- no retry after timeout, throttle or challenge;
- a 48-hour circuit breaker after the first provider failure;
- persistent cursor and last-good observations so a failed run erases nothing;
- no login, candidate cookies, CAPTCHA handling, booking or payment;
- no user-triggered requests from the website or mobile app.

The current 729 British Council centres span 116 countries. Eight country checks per day can rotate
through the directory within the existing 15-day evidence window, but the resulting signal can only
mean “the registration directory listed this centre.” It cannot support a date or seat claim.

The pilot remains disabled until its browser portion can run from an isolated worker. Its first
15-day rotation is successful only if it completes without a throttle/challenge, retains all prior
evidence through simulated failures, and produces no unexplained country-level listing cliff. Any
provider restriction ends the experiment and leaves British Council dates as unknown.

## IDP India full-scale validator

IDP India exposes anonymous JSON endpoints for test types, modules, cities and exact future dates
before personal details. M2.7 now discovers this graph at runtime and can validate every exposed
combination:

- execution requires both `GITHUB_ACTIONS=true` and `M2_7_LIVE_EXPERIMENT=true`;
- requests are serial with a three-second minimum interval, no retries and immediate stop behavior
  for timeouts, HTTP 403/429, challenge text, non-JSON data or an unexpected response shape;
- each session keeps the operator's exact test/module/city labels and date, and is called available
  only when `SeatAvailable` is greater than zero;
- the official “IELTS on Computer Test Centres” section is bounded away from IDP's student-placement
  branches, must yield at least 20 unique centres, and is compared with the directory using unique
  branch/address evidence;
- the output is a diagnostic artifact and is never committed or displayed; invalid captures,
  incomplete coverage and systemic result cliffs fail the safety gate.

The current source graph has 406 test/module/city combinations and the official computer-centre
page has 46 entries. Since availability ids are city-level rather than stable centre ids, ambiguous
or unmatched sessions stay in diagnostics with `centreId: null`.

The 2026-07-30 full-scale GitHub Actions gate completed all 422 serial requests with HTTP 200 and no
challenge signal, timeout or provider-boundary stop. It parsed 13,882 dated sessions from all 406
combinations, rejected no capture, and found 41 safe centre-inventory matches, three provider-only
centres and two address-review cases.

## IDP China full-scale validator

IDP China's public date-search application uses first-party JSON endpoints with SM4-CBC response
envelopes. The decryption key and IV are protocol material shipped to every browser in the site's
public JavaScript; the validator uses them only to read the same anonymous data displayed by the
page. It:

- confirms the exact Academic (`22`) and General Training (`23`) project set;
- fetches and reconciles both complete official centre inventories;
- requests all sessions in one response because the provider's page ordering is unstable across
  paginated calls;
- validates exact dates, capacity, registrations and full-booked state, and requires every session
  centre id to exist in the official centre inventory;
- uses English source names for matching and keeps Chinese names/addresses as non-display evidence.

The current complete response contains 1,137 sessions across 27 centres. Thirteen centres match the
IELTS.org directory and 14 do not; the 14 remain explicit provider-only discoveries rather than
being guessed onto a fuzzy city/district match.

## M2.7 provider validation outcome

All live checks in this phase ran from manually dispatched GitHub Actions jobs. Provider-facing
tests were not run from a developer machine.

IDP Global exposes a public first-party session-search API. Its responses contain stable venue ids,
venue names and addresses, coordinates, test category/module/format, local date/time, fee metadata,
and `seatAvailability.remaining`. The directory keeps IELTS.org's original fee string authoritative;
provider fee fields are diagnostic evidence only. A venue is called `available` only when the
operator response explicitly reports more than zero remaining seats.

The full-scale validator uses the exact confirmed standard Academic-on-computer request shape,
scans every country/city returned for that offering, scopes a second request by the confirmed
`testLocationIds` filter, deduplicates overlapping venue ids, and looks 45 days ahead. It has a
1.5-second minimum interval, no concurrency, no retry, and immediate stop behavior for timeouts,
403, 429, CAPTCHA/challenge text, non-JSON responses, or location-filter leakage. Publication
remains disabled; results are uploaded as a 30-day diagnostic artifact.

The 2026-07-29 full-scale GitHub Actions run covered all 357 exposed cities and 501 discovered
venues in 74 countries. All 859 serial requests succeeded, with no challenge signal, timeout,
HTTP 403/429, source-shape failure, or rejected capture. It parsed 8,128 explicitly available
future sessions: 6,360 matched a directory centre automatically, 55 were ambiguous, and 1,713 were
unmatched. Ambiguous and unmatched records remain unpublished rather than being guessed.

The regional surfaces remain quarantined from publication while their full-scale validators run:

- IDP India and IDP China produce complete diagnostics but do not alter the public dataset or the
  operator-published price strings.
- NEEA is British Council's China partner, not an IDP partner, and requires login plus reCAPTCHA.
- British Council Global returned CDN HTTP 403 in the bounded Actions probe. No bypass was attempted.
