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

## IDP India one-session pilot

IDP India exposes test type, module, city, date, time and an “Available” label before personal
details. M2.7 now has a manual-only collector for exactly one requested combination:

- execution requires `M2_7_LIVE_EXPERIMENT=true` plus GitHub Actions or an explicitly isolated
  worker;
- the workflow has no schedule and accepts one test/module/city/date target;
- it never logs in or proceeds past public date selection;
- “Available” is accepted only when it occurs in the same DOM block as the selected session radio
  and time—not when it appears only in the calendar legend;
- the output is uploaded as a 14-day diagnostic artifact and is never committed or displayed;
- invalid captures, empty results and systemic result cliffs fail the safety gate.

The source carries a city/branch id but the IELTS.org India records have no provider centre id.
Matching therefore requires both the exact offering dimensions and a uniquely strong branch-name
match. In an offline audit of the 43 computer-test locations observed in the public selector, 41
matched uniquely; the generic Chandigarh and Chennai entries remained ambiguous. Ambiguous and
unmatched sessions stay in diagnostics with `centreId: null`.
