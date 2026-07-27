#!/usr/bin/env python3
"""
Dump every IELTS.org test-centre slug from the XML sitemap, per page, and report
the operator mix. Purpose: verify whether sitemap contents differ BY REGION
(run it from your region, then again via a VPN in another region, and diff).

No third-party deps. Python 3.8+.

Usage:
    python3 dump_ielts_sitemap.py                 # writes ./ielts_dump/ + summary
    python3 dump_ielts_sitemap.py --out mydir      # custom output dir

What it does:
  1. GET the sitemap index, find all `...section-testCentres...-p{N}.xml` sub-sitemaps.
  2. GET each, extract every <loc>.../test-centres/{slug}</loc>.
  3. Write one file per page (slugs) + a combined file.
  4. Print counts: total, per-operator-hint (british-council* / idp* / no-prefix),
     and every slug containing 'china' or 'idp-ielts-china' (the region tell).

NOTE ON OPERATOR: the slug prefix is only a *hint* — many centres have no operator
prefix. The reliable operator signal is the centre page's "Book A Test" link domain
(bxsearch.ielts.idp.com => IDP; ieltsregistration.britishcouncil.org => BC;
in China: idpielts.cn => IDP, ielts.neea.cn => BC). This script only reads the
sitemap, so it reports the slug-prefix hint, not ground truth.
"""

import argparse
import os
import re
import sys
import urllib.request

INDEX = "https://ielts.org/sitemap.xml"
UA = "Mozilla/5.0 (sitemap-audit; personal research)"

LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>", re.I)
# Only read <loc> tags — NOT the xhtml:link href alternates, which repeat each URL
# and (because of the trailing quote) would double-count every centre.
TC_RE = re.compile(r"<loc>\s*https?://ielts\.org/test-centres/([^<\s]+?)\s*</loc>", re.I)


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def sub_sitemaps(index_xml: str):
    locs = LOC_RE.findall(index_xml)
    subs = [u for u in locs if "testcentres" in u.lower()]
    # keep page order p1..pN
    def pageno(u):
        m = re.search(r"-p(\d+)\.xml", u)
        return int(m.group(1)) if m else 0
    return sorted(subs, key=pageno)


def slugs_from(page_xml: str):
    # dedupe while preserving order
    seen, out = set(), []
    for slug in TC_RE.findall(page_xml):
        if slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out


def classify(slug: str) -> str:
    s = slug.lower()
    if s.startswith("british-council"):
        return "british-council"
    if s.startswith("idp"):
        return "idp"
    return "no-prefix"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ielts_dump")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    print(f"[*] index: {INDEX}")
    try:
        idx = fetch(INDEX)
    except Exception as e:
        sys.exit(f"failed to fetch index: {e}")

    subs = sub_sitemaps(idx)
    print(f"[*] found {len(subs)} testCentres sub-sitemaps")
    if not subs:
        sys.exit("no testCentres sub-sitemaps found — sitemap layout may have changed")

    combined = []
    totals = {"british-council": 0, "idp": 0, "no-prefix": 0}
    china_hits, idp_china_hits = [], []

    for url in subs:
        m = re.search(r"-p(\d+)\.xml", url)
        page = m.group(1) if m else "x"
        try:
            xml = fetch(url)
        except Exception as e:
            print(f"    [!] p{page} fetch failed: {e}")
            continue
        slugs = slugs_from(xml)
        with open(os.path.join(args.out, f"p{page}_slugs.txt"), "w") as f:
            f.write("\n".join(slugs) + "\n")
        for s in slugs:
            totals[classify(s)] += 1
            combined.append(s)
            if "china" in s.lower():
                china_hits.append(s)
            if "idp-ielts-china" in s.lower():
                idp_china_hits.append(s)
        print(f"    p{page}: {len(slugs)} centres")

    with open(os.path.join(args.out, "ALL_slugs.txt"), "w") as f:
        f.write("\n".join(combined) + "\n")

    print("\n==== SUMMARY ====")
    print(f"total centres (all pages): {len(combined)}")
    print(f"  slug-prefix 'british-council*': {totals['british-council']}")
    print(f"  slug-prefix 'idp*'            : {totals['idp']}")
    print(f"  no operator prefix           : {totals['no-prefix']}")
    print(f"slugs containing 'china'        : {len(china_hits)}")
    print(f"slugs 'idp-ielts-china*'        : {len(idp_china_hits)}")
    if idp_china_hits:
        print("  e.g. " + ", ".join(idp_china_hits[:8]))
    print(f"\n[*] wrote per-page files + ALL_slugs.txt to ./{args.out}/")
    print("[*] Region check: run this from your region AND via a VPN elsewhere,")
    print("    then `diff` the ALL_slugs.txt files. Any difference = region-dependent data.")


if __name__ == "__main__":
    main()
