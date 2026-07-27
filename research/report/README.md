# Research artifacts

Preserved inputs from the feasibility phase. Nothing here is part of the app build.

- `build_report.js` — generates `docs/IELTS_Centre_App_Feasibility.docx` via the `docx`
  package. Run with `npm install && node build_report.js` from this directory.
- `pg-*.jpg` — page images captured during the feasibility write-up.
- `../dump_ielts_sitemap.py` — the original standalone sitemap audit script. Superseded by
  `packages/ingest` (which parses `<loc>` only and verifies the closing `</urlset>`), kept
  because it documents the region-difference investigation described in DEV_PLAN §5.1.
- `../sitemap-snapshots/` — slug dumps captured 2026-07-21. Note `ALL_slugs.txt` is
  double-counted: it includes `xhtml:link` alternates, so every slug appears twice, the
  second time with a trailing `"`. The current ingester avoids this bug.
