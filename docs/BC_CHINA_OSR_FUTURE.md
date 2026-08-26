# Future plan: British Council mainland-China OSR venues

## Current decision

The application does **not** import British Council mainland-China One Skill Retake venue
names or addresses from the China IELTS web page. That page publishes Chinese-only rows,
mixes ordinary full-test centres with OSR-only venues, and does not state which category a
row belongs to. Inferring the category from phrases such as `雅思机考考点` or
`雅思单科重考考点` is unsafe.

The scheduled ingest therefore uses only IELTS.org's own OSR badges. The China IELTS page
is not fetched, parsed, or allowed to block the worldwide refresh. Existing candidate-facing
guidance may still link to the official WeChat Mini Program; this document concerns venue
discovery only.

## Intended authoritative source

The preferred future source is the British Council's “雅思考试官方服务平台” WeChat Mini
Program because it exposes operator-provided English venue names alongside the Chinese
operational data. It is not currently suitable for unattended GitHub-hosted collection:

- We do not own the Mini Program or have its source project/developer automation permission.
- A hosted runner cannot retain a logged-in WeChat GUI session.
- Collection must not depend on a candidate account, an eligible test result, CAPTCHA bypass,
  replayed credentials, or undocumented authenticated API calls.

Before implementation, confirm that the venue list is reachable with a dedicated,
non-candidate WeChat account and obtain any permission required for automated read-only use.

## Proposed collection architecture

1. Run a low-frequency, read-only collector on a dedicated self-hosted Mac or Android device
   with a persistent WeChat session.
2. Open the official Mini Program, select English, and navigate normally to the OSR venue list.
3. Read accessibility text where available; otherwise capture screenshots and use OCR.
4. Write the dated source snapshot, screenshots, language, collection result, and SHA-256 hashes
   to a dedicated encrypted, versioned evidence store. Use stable object keys and retain the exact
   object version referenced by an approved identity for at least as long as that identity remains
   in the registry. Workflow artifacts may contain short-lived diagnostic copies, but are not the
   evidence archive. Never store candidate, payment, or account data.
5. Compare the snapshot with the last successful observation. A failed login, verification
   prompt, incomplete render, or unexpectedly large removal preserves the previous state and
   raises an alert.
6. Send only additions, removals, renamed venues, and address changes to the internal review
   queue. Do not let the collector deploy directly.

The collector should run only after the public China IELTS page changes or on a conservative
weekly schedule. It must stop rather than retry rapidly when WeChat challenges the session.

## Identity matching

Chinese source text remains private matching evidence and is never used as the public display
name or address. Match BC China rows through the following cascade:

1. previously reviewed Chinese-name/address aliases;
2. exact structured city, district, street/building number, floor, and unit agreement;
3. AMap lookup of the official Chinese row, normalized from GCJ-02 to WGS84;
4. Google Places lookup as an independent candidate path;
5. operator, coordinates, contact information, and existing IELTS.org evidence.

Hard conflicts in city, street number, floor/unit, or country reject a match. Automatic merging
requires at least two strong evidence paths. Ambiguous rows become internal tasks. Absence from
IELTS.org does not prove that a venue is OSR-only, and the Chinese name suffix must never decide
that status.

## English-name policy

- A matched full-test centre keeps its IELTS.org English name.
- An unmatched venue uses the English name captured from the official Mini Program after its
  Chinese/English pair is reviewed.
- Google names and machine translations are candidate evidence only, never canonical names.
- If the Mini Program English name is temporarily unavailable, keep the venue pending rather
  than publish a potentially misleading translated name.

Each approved pair is retained in a versioned BC China identity registry so it is not reviewed
again on every run. Its registry entry must include the immutable evidence object reference and
version, the evidence SHA-256 hash, capture time, source language, and reviewer decision. Approval
must fail if the referenced durable object cannot be read or its hash no longer matches; a
retention-limited workflow-artifact URL is not acceptable evidence.

## Data states and safety gates

Model OSR availability, full-test status, and identity separately:

```text
offersOneSkillRetake: confirmed | unknown
fullTestStatus: confirmed | confirmed_unavailable | unknown
identityStatus: matched | reviewed_new | pending
```

The future workflow must:

- preserve prior records on source or collector failure;
- block mass removals and classification changes;
- avoid creating public duplicates while identity is pending;
- retain source screenshots and provenance for every approved English name;
- respect AMap/Google request budgets, timeouts, caching, and provider policy;
- pass a full GitHub Actions crawl and production build before deployment.

## Rollout sequence

1. Perform a one-time feasibility test with a dedicated account and no candidate data.
2. Build a snapshot-only collector that cannot write production data.
3. Add OCR/accessibility extraction and source-change alerts.
4. Add BC-China-only entity matching and internal review tasks.
5. Seed reviewed Chinese/English identities from official Mini Program evidence.
6. Enable guarded dataset updates only after repeated successful observations and a full-scale
   GitHub Actions test.
