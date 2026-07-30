# Opening-status and test-date feasibility

**Original review:** 2026-07-28
**Revised decision:** 2026-07-30

## Decision

Do not automate or display IELTS registration availability, opening status, test dates, or seat
counts. A centre appearing on IELTS.org is a directory listing, not evidence that it is operating
or accepting bookings.

The former weekly IELTS USA status overlay and its `registration_available`,
`not_accepting_registrations`, and expiring snapshot states have been removed.

## Future-opening exception

IELTS USA publishes five potential future locations with official forms that let candidates
register their interest:

- Davenport, Iowa
- Kansas City, Missouri
- Lincoln, Nebraska
- New Haven, Connecticut
- New Orleans, Louisiana

These records remain in the directory despite having no published test price. They are explicitly
marked **Future opening**, state that there are no scheduled test dates, and link to the
operator-provided interest form. They must never be described as open, bookable, or available.

The exception is a small, manually curated listing overlay in
`packages/core/data/future-openings.json`; it is not an availability collector.

## What would unlock availability

An operator-provided contract or documented feed must define:

1. a stable centre identifier that can be reconciled with the directory;
2. whether a row means a scheduled sitting, an open registration window, or an actual remaining
   seat;
3. test module/category, delivery mode, timezone and update timestamp;
4. authentication, rate limits, display/retention rights and attribution;
5. geographic coverage and failure/SLA semantics.

Until then, ordinary centres link to the operator to check dates and book. Future openings link to
their official interest form.
