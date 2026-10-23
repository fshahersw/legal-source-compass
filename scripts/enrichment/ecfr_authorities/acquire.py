"""Acquire the official finding aids for the ecfr_authorities stream (resumable; raw bodies gzip-stored with a manifest).

  python3 -I -B acquire.py probe              record what the eCFR HTML finding-aid pages answer (redirects are NOT followed)
  python3 -I -B acquire.py govinfo [EDITION]  CFR Index and Finding Aids (GovInfo package GPO-CFR-INDEX-<year>): package
                                              and granule summaries, the text rendition of every granule, and the PDF of
                                              the Parallel Table of Authorities and Rules (second path for verification)
  python3 -I -B acquire.py pdf EDITION N      the PDF rendition of granule N of that edition (N=2 Subject/Agency Index)
  python3 -I -B acquire.py robots             the eCFR host's robots.txt (evidence)
  python3 -I -B acquire.py ecfr               eCFR admin API agencies.json and versioner titles.json

Why GovInfo for the tables: the eCFR pages /parallel-table-of-authorities/current, /subject-index/current and
/agency-indexes (and the API documentation pages) answer every programmatic request with a 302 to
https://unblock.federalregister.gov, a reCAPTCHA page that says "programmatic access to these sites is limited to access
to our extensive developer APIs". The eCFR developer API has no endpoint for these tables. They are never fetched around
that wall. The same tables are published by the Office of the Federal Register in the annual "CFR Index and Finding
Aids", served by GovInfo's documented API (keyed, public domain).

Sources:
  https://api.govinfo.gov/packages/GPO-CFR-INDEX-<year>/{summary,granules}
  https://api.govinfo.gov/packages/GPO-CFR-INDEX-<year>/granules/<granule>/{summary,htm,pdf}
  https://www.ecfr.gov/api/admin/v1/agencies.json
  https://www.ecfr.gov/api/versioner/v1/titles.json
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib as fl  # noqa: E402

GOVINFO = "https://api.govinfo.gov"
ECFR = "https://www.ecfr.gov"
BLOCKED_PAGES = [
    f"{ECFR}/parallel-table-of-authorities/current",
    f"{ECFR}/subject-index/current",
    f"{ECFR}/agency-indexes",
    f"{ECFR}/developers/documentation/api/v1",
    f"{ECFR}/developers/documentation/api/v1.json",
]
PDF_GRANULES = {4}  # the Parallel Table of Authorities and Rules


def cmd_probe() -> None:
    for url in BLOCKED_PAGES:
        print(json.dumps(fl.probe(url)))


def find_edition(requested: str | None) -> str:
    years = [requested] if requested else [str(y) for y in range(datetime.now(timezone.utc).year, datetime.now(timezone.utc).year - 4, -1)]
    for y in years:
        try:
            fl.get(f"{GOVINFO}/packages/GPO-CFR-INDEX-{y}/summary", accept="application/json")
            return y
        except fl.FetchError as e:
            if e.status != 404:
                raise
    raise SystemExit("no GPO-CFR-INDEX edition found")


def cmd_govinfo(requested: str | None) -> None:
    year = find_edition(requested)
    pkg = f"GPO-CFR-INDEX-{year}"
    url = f"{GOVINFO}/packages/{pkg}/summary"
    status, body, ctype = fl.get(url, accept="application/json")
    fl.save(url, f"govinfo/{pkg}/package_summary.json.gz", body, status, ctype, {"edition": year})
    url = f"{GOVINFO}/packages/{pkg}/granules?offsetMark=*&pageSize=100"
    status, body, ctype = fl.get(url, accept="application/json")
    fl.save(url, f"govinfo/{pkg}/granules.json.gz", body, status, ctype, {"edition": year})
    granules = json.loads(body)["granules"]
    for g in granules:
        gid = g["granuleId"]
        n = int(gid.rsplit("-", 1)[1])
        base = f"{GOVINFO}/packages/{pkg}/granules/{gid}"
        for suffix, accept in (("summary", "application/json"), ("htm", "text/html")):
            u = f"{base}/{suffix}"
            status, body, ctype = fl.get(u, accept=accept)
            ext = "json" if suffix == "summary" else "htm"
            e = fl.save(u, f"govinfo/{pkg}/{gid}.{suffix}.{ext}.gz", body, status, ctype, {"edition": year, "granule": gid, "granule_title": g["title"]})
            print(json.dumps({"granule": gid, "title": g["title"], "what": suffix, "bytes": e["bytes"]}), flush=True)
        if n in PDF_GRANULES:
            u = f"{base}/pdf"
            status, body, ctype = fl.get(u, accept="application/pdf")
            e = fl.save(u, f"govinfo/{pkg}/{gid}.pdf.gz", body, status, ctype, {"edition": year, "granule": gid, "granule_title": g["title"]})
            print(json.dumps({"granule": gid, "title": g["title"], "what": "pdf", "bytes": e["bytes"]}), flush=True)


def cmd_pdf(edition: str, number: int) -> None:
    """The PDF rendition of one granule (second path for verifying the text rendition)."""
    pkg = f"GPO-CFR-INDEX-{edition}"
    gid = f"{pkg}-{number}"
    man = fl.read_manifest()
    rel = f"govinfo/{pkg}/{gid}.pdf.gz"
    if fl.exists(rel, man):
        print(json.dumps({"granule": gid, "what": "pdf", "skipped": "already stored"}))
        return
    u = f"{GOVINFO}/packages/{pkg}/granules/{gid}/pdf"
    status, body, ctype = fl.get(u, accept="application/pdf")
    e = fl.save(u, rel, body, status, ctype, {"edition": edition, "granule": gid})
    print(json.dumps({"granule": gid, "what": "pdf", "bytes": e["bytes"]}), flush=True)


def cmd_robots() -> None:
    """robots.txt of the eCFR host, kept as evidence of what the crawl rules allow."""
    url = f"{ECFR}/robots.txt"
    status, body, ctype = fl.get(url, accept="text/plain")
    e = fl.save(url, "evidence/ecfr_robots.txt.gz", body, status, ctype)
    print(json.dumps({"saved": e["path"], "bytes": e["bytes"]}))


def cmd_ecfr() -> None:
    for url, rel in (
        (f"{ECFR}/api/admin/v1/agencies.json", "ecfr/agencies.json.gz"),
        (f"{ECFR}/api/versioner/v1/titles.json", "ecfr/titles.json.gz"),
    ):
        status, body, ctype = fl.get(url, accept="application/json")
        e = fl.save(url, rel, body, status, ctype)
        print(json.dumps({"saved": e["path"], "bytes": e["bytes"], "sha256": e["sha256"]}), flush=True)


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit(__doc__)
    cmd = argv[0]
    if cmd == "probe":
        cmd_probe()
    elif cmd == "govinfo":
        cmd_govinfo(argv[1] if len(argv) > 1 else None)
    elif cmd == "pdf" and len(argv) == 3:
        cmd_pdf(argv[1], int(argv[2]))
    elif cmd == "robots":
        cmd_robots()
    elif cmd == "ecfr":
        cmd_ecfr()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
