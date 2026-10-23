"""Acquire the official eCFR sources for the ecfr_full stream (resumable; raw bodies gzip-stored with a manifest).

  python3 -I -B acquire.py titles                 eCFR titles.json snapshot (per-title "up to date as of")
  python3 -I -B acquire.py govinfo                GovInfo bulk ECFR-title{n}.xml for every title (primary text source)
  python3 -I -B acquire.py structure [DATE]       eCFR structure JSON per title at each title's up_to_date_as_of
                                                  (or at DATE, e.g. 2026-09-30 = the ecfr_hierarchy snapshot)
  python3 -I -B acquire.py versions               eCFR versioner content versions per title (2017 onward history)
  python3 -I -B acquire.py fr START END           Federal Register API: every RULE document published START..END
                                                  (YYYY-MM), one request per month (pages of 1,000)

Sources (all keyless, public domain):
  https://www.govinfo.gov/bulkdata/ECFR/title-{n}/ECFR-title{n}.xml
  https://www.ecfr.gov/api/versioner/v1/{titles.json, structure/{date}/title-{n}.json, versions/title-{n}.json}
  https://www.federalregister.gov/api/v1/documents.json
The bulk-text path never uses the eCFR /api/versioner/v1/full/ endpoint (robots.txt asks crawlers not to index it);
that endpoint is used only by verify_ecfr_full.py for the 300-section second-path sample and by the site's live
"as of" view.
"""
from __future__ import annotations

import calendar
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib as fl  # noqa: E402

ECFR = "https://www.ecfr.gov/api/versioner/v1"
GOVINFO = "https://www.govinfo.gov/bulkdata"
FR = "https://www.federalregister.gov/api/v1/documents.json"
FR_FIELDS = [
    "document_number", "citation", "volume", "start_page", "end_page", "publication_date", "effective_on",
    "cfr_references", "title", "type", "action", "html_url", "correction_of",
]


def latest_titles() -> dict:
    man = fl.read_manifest()
    snaps = sorted(p for p in man if p.startswith("api/titles/"))
    if not snaps:
        raise SystemExit("run `acquire.py titles` first")
    return json.loads(fl.load(snaps[-1]))


def cmd_titles() -> None:
    url = f"{ECFR}/titles.json"
    status, body, ctype = fl.get(url, accept="application/json")
    stamp = fl.utc_now().replace(":", "").replace("-", "")
    e = fl.save(url, f"api/titles/titles-{stamp}.json.gz", body, status, ctype)
    data = json.loads(body)
    print(json.dumps({"saved": e["path"], "titles": len(data["titles"]), "reserved": sum(1 for t in data["titles"] if t["reserved"])}))


def cmd_govinfo() -> None:
    man = fl.read_manifest()
    status, body, _ = fl.get(f"{GOVINFO}/json/ECFR", accept="application/json")
    folders = [f for f in json.loads(body)["files"] if f.get("folder") and str(f.get("name", "")).startswith("title-")]
    done = 0
    for folder in sorted(folders, key=lambda f: int(f["name"].split("-")[1])):
        n = int(folder["name"].split("-")[1])
        rel = f"govinfo/ECFR-title{n}.xml.gz"
        _, lbody, _ = fl.get(folder["link"], accept="application/json")
        files = [f for f in json.loads(lbody)["files"] if f.get("name") == f"ECFR-title{n}.xml"]
        if len(files) != 1:
            raise SystemExit(f"title {n}: bulk listing does not name ECFR-title{n}.xml")
        meta = files[0]
        if fl.exists(rel, man) and man[rel].get("bulk_last_modified") == meta["formattedLastModifiedTime"]:
            continue
        status, xml, ctype = fl.get(meta["link"], accept="application/xml")
        if len(xml) != int(meta["size"]):
            raise SystemExit(f"title {n}: {len(xml)} bytes received, listing says {meta['size']}")
        fl.save(meta["link"], rel, xml, status, ctype, {"bulk_last_modified": meta["formattedLastModifiedTime"], "bulk_listed_size": meta["size"], "cfr_title": n})
        done += 1
        print(json.dumps({"title": n, "bytes": len(xml), "bulk_last_modified": meta["formattedLastModifiedTime"]}), flush=True)
    print(json.dumps({"fetched": done, "folders": len(folders)}))


def cmd_structure(date: str | None) -> None:
    man = fl.read_manifest()
    for t in latest_titles()["titles"]:
        if t["reserved"]:
            continue
        d = date or t["up_to_date_as_of"]
        rel = f"api/structure/{d}/title-{t['number']}.json.gz"
        if fl.exists(rel, man):
            continue
        url = f"{ECFR}/structure/{d}/title-{t['number']}.json"
        status, body, ctype = fl.get(url, accept="application/json")
        fl.save(url, rel, body, status, ctype, {"cfr_title": t["number"], "as_of": d})
        print(json.dumps({"title": t["number"], "date": d, "bytes": len(body)}), flush=True)


def version_pages(n: int) -> list[str]:
    """Relative paths of every stored versions page for title n (page 1 is title-{n}.json.gz)."""
    first = json.loads(fl.load(f"api/versions/title-{n}.json.gz"))
    total = int(first.get("meta", {}).get("total_pages") or 1)
    return [f"api/versions/title-{n}.json.gz"] + [f"api/versions/title-{n}/page-{k}.json.gz" for k in range(2, total + 1)]


def cmd_versions() -> None:
    """Every content version per title. The endpoint returns 1,000 rows per page (meta.total_pages); all pages kept."""
    man = fl.read_manifest()
    for t in latest_titles()["titles"]:
        if t["reserved"]:
            continue
        n = t["number"]
        rel = f"api/versions/title-{n}.json.gz"
        if not fl.exists(rel, man):
            url = f"{ECFR}/versions/title-{n}.json"
            status, body, ctype = fl.get(url, accept="application/json")
            data = json.loads(body)
            fl.save(url, rel, body, status, ctype, {"cfr_title": n, "page": 1, "result_count": data.get("meta", {}).get("result_count")})
            print(json.dumps({"title": n, "page": 1, "versions": len(data.get("content_versions", []))}), flush=True)
        for k, prel in enumerate(version_pages(n)[1:], start=2):
            if fl.exists(prel, man):
                continue
            url = f"{ECFR}/versions/title-{n}.json?page={k}"
            status, body, ctype = fl.get(url, accept="application/json")
            data = json.loads(body)
            fl.save(url, prel, body, status, ctype, {"cfr_title": n, "page": k, "result_count": data.get("meta", {}).get("result_count")})
            print(json.dumps({"title": n, "page": k, "versions": len(data.get("content_versions", []))}), flush=True)


def _months(start: str, end: str):
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    while (y, m) <= (ey, em):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def cmd_fr(start: str, end: str) -> None:
    man = fl.read_manifest()
    for y, m in _months(start, end):
        last = calendar.monthrange(y, m)[1]
        page = 1
        while True:
            rel = f"fr/rules-{y:04d}-{m:02d}-p{page}.json.gz"
            if fl.exists(rel, man):
                data = json.loads(fl.load(rel))
            else:
                params = [("per_page", "1000"), ("page", str(page)), ("order", "oldest"), ("conditions[type][]", "RULE"),
                          ("conditions[publication_date][gte]", f"{y:04d}-{m:02d}-01"),
                          ("conditions[publication_date][lte]", f"{y:04d}-{m:02d}-{last:02d}")]
                params += [("fields[]", f) for f in FR_FIELDS]
                url = FR + "?" + urllib.parse.urlencode(params)
                status, body, ctype = fl.get(url, accept="application/json")
                data = json.loads(body)
                fl.save(url, rel, body, status, ctype, {"fr_month": f"{y:04d}-{m:02d}", "page": page, "count": data.get("count")})
                print(json.dumps({"month": f"{y:04d}-{m:02d}", "page": page, "count": data.get("count"), "results": len(data.get("results") or [])}), flush=True)
            if (data.get("count") or 0) > 9999:
                raise SystemExit(f"{y}-{m}: more than 9,999 RULE documents in one month; split the window")
            if not data.get("next_page_url"):
                break
            page += 1


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit(__doc__)
    cmd = argv[0]
    if cmd == "titles":
        cmd_titles()
    elif cmd == "govinfo":
        cmd_govinfo()
    elif cmd == "structure":
        cmd_structure(argv[1] if len(argv) > 1 else None)
    elif cmd == "versions":
        cmd_versions()
    elif cmd == "fr" and len(argv) == 3:
        cmd_fr(argv[1], argv[2])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
