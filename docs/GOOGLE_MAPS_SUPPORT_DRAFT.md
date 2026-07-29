# Draft: Google Maps Platform policy clarification

Status: draft only — not sent

Subject: Clarification for an independently sourced test-centre directory

Hello Google Maps Platform Support,

We operate an IELTS test-centre directory. The centre names, addresses,
operators, test offerings, prices, contact information and booking links come
from IELTS.org and operator-published sources; they are not copied from Google
Maps.

Our current web client displays these independently sourced directory records
on a Google map. We are also planning an iOS client that uses Apple MapKit.
That client will receive only independently licensed coordinates. It will not
receive Google Geocoding/Places coordinates, Google place details, ratings,
photos or other Google Maps Content.

Could you please provide written clarification on these questions?

1. Does the current prohibition concerning use of Google Maps Core Services in
   a listings or directory service prohibit our web/iOS app from using the
   Google Maps JavaScript API or Maps SDK for iOS merely as a basemap for our
   independently sourced directory data?
2. If that use is permitted, may our own centre records and independently
   licensed coordinates be rendered as annotations on the Google map?
3. May the iOS app offer Google Maps SDK for iOS as a user-selected full-map
   alternative to Apple MapKit, provided each screen uses only one map provider
   and all Google Maps Content remains on the Google map?
4. Is Places UI Kit's documented non-Google-map exception sufficient for a
   separately attributed place-details component beside an Apple map, without
   exporting any returned Google coordinates or place fields into Apple map
   annotations?
5. Please confirm that Google Place IDs may be stored as opaque identifiers and
   later used only to request/display Google content in a permitted Google
   experience.

We are not asking to cache or create a neutral location database from Google
Maps Content, and we will not use Google-derived coordinates on Apple Maps.

If the directory restriction makes any of the proposed Google integrations
impermissible, please identify the permitted architecture, if any, or confirm
that we should omit Google Maps Platform from the directory entirely.

Project/account details:

- Google Cloud project: `[PROJECT_ID]`
- Website: `https://ielts.zhengqiu.net`
- Contact: `[NAME / EMAIL]`

Thank you.
