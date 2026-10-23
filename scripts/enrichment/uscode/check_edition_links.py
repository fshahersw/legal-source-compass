"""Check that the annual-edition links a section page shows resolve on GovInfo's link service.

  python3 -I -B scripts/enrichment/uscode/check_edition_links.py [--sample 40]

Draws random (section, year) pairs from the per-section edition years in us_code_sections.json.gz (years taken from
GovInfo's own granule lists) and requests each link without following the redirect: HTTP 302 to
/content/pkg/USCODE-<year>-title<N>/ is a pass. Also counts sections by basis (section / title) and with no edition.
Writes private/build/uscode/edition_link_checks.json.
"""
import argparse
import gzip
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402
import govinfo_editions  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=40)
    args = ap.parse_args()
    with gzip.open(fetchlib.BUILD / "us_code_sections.json.gz", "rt", encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    basis, none, pool = {}, 0, []
    for r in rows:
        u = r["detail"]["usc"]
        basis[u.get("govinfo_basis")] = basis.get(u.get("govinfo_basis"), 0) + 1
        if u.get("govinfo_basis") == "section":
            if not u["govinfo_years"]:
                none += 1
            for y in u["govinfo_years"]:
                pool.append((u["title"], u["key"], y))
    rng = random.Random(2024)
    checks = []
    for title, key, year in rng.sample(pool, min(args.sample, len(pool))):
        try:
            status, _, hdrs, _ = fetchlib.request(govinfo_editions.link_url(title, key, year), follow=False,
                                                  retries=3, interval=1.0)
        except RuntimeError as error:
            status, hdrs = (400 if "HTTP 400" in str(error) else None), {}
        loc = hdrs.get("location", "")
        checks.append({"title": title, "section": key, "year": year, "status": status,
                       "resolved": status == 302 and f"/content/pkg/USCODE-{year}-title{title}" in loc})
    out = {"basis": basis, "sections_without_edition": none, "links": len(pool), "checks": checks,
           "resolved": sum(c["resolved"] for c in checks), "checked_at": fetchlib.now()}
    (fetchlib.BUILD / "edition_link_checks.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "checks"}))
    for c in checks:
        if not c["resolved"]:
            print("UNRESOLVED", c)


if __name__ == "__main__":
    main()
