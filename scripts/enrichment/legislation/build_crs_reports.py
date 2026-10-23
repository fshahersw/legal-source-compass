"""Build `crs_reports`: metadata and official links for every CRS product listed by the Congress.gov API (no report text).

  python3 -I -B build_crs_reports.py

Reads only private/build/legislation/crs_list.json (acquire_crs.py --list) and the stored /crsreport/{id} responses under
private/acq/legislation/congress/ (acquire_crs.py --details). Every listed report gets a record; authors, topics, formats and
related legislation come from the detail response and are "Not recorded" where the detail was not fetched within the
stream's request budget (detail_fetched = no). Writes private/build/legislation/crs_reports.json (publish_build.py format).
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bills_common as bc  # noqa: E402
import common as cm  # noqa: E402
import congress_api as api  # noqa: E402
from corpus_writer import listing, record  # noqa: E402

DATASET = "crs_reports"
LABEL = "Congressional Research Service reports and products (Congress.gov metadata)"
PAGE = "https://www.congress.gov/crs-product/{id}"
API_TYPE = {"HR": "hr", "S": "s", "HJRES": "hjres", "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres",
            "HRES": "hres", "SRES": "sres"}
FORMAT_HOSTS = ("https://www.congress.gov/",)


def detail(rid: str) -> dict | None:
    p = api.stored_name(f"/crsreport/{rid}", {"format": "json"})
    if not p.exists():
        return None
    return json.loads(gzip.decompress(p.read_bytes())).get("CRSReport")


def related(items: list[dict], known: set[str]) -> list[dict]:
    out, seen = [], set()
    for m in items or []:
        key = (m.get("type"), m.get("congress"), str(m.get("number")))
        if key in seen:
            continue
        seen.add(key)
        t = API_TYPE.get((m.get("type") or "").upper())
        entry = {"type": m.get("type"), "congress": m.get("congress"), "number": m.get("number"), "title": m.get("title")}
        if t and isinstance(m.get("congress"), int):
            entry["citation"] = bc.display_citation(t, m["number"], m["congress"])
            rid = bc.bill_id(m["congress"], t, m["number"])
            if rid in known:
                entry["billId"] = rid
                entry["href"] = f"/law/legislation/federal/{m['congress']}/{t}/{m['number']}"
        elif (m.get("type") or "").upper() == "PUB":
            entry["citation"] = f"Public Law {m.get('number')}"
        out.append({k: v for k, v in entry.items() if v not in (None, "")})
    return out


def known_bills() -> set[str]:
    known = set()
    for p in sorted((cm.ACQ / "billstatus_listings").glob("BILLSTATUS-*.json.gz")):
        for f in json.loads(gzip.decompress(p.read_bytes()))["files"]:
            m = re.match(r"^BILLSTATUS-(\d+)([a-z]+)(\d+)\.xml$", f.get("name", ""))
            if m:
                known.add(bc.bill_id(int(m.group(1)), m.group(2), m.group(3)))
    return known


def main() -> None:
    lst = json.loads((cm.BUILD / "crs_list.json").read_text())
    known = known_bills()
    rows, stats = [], Counter()
    types, statuses = Counter(), Counter()
    for r in sorted(lst["reports"], key=lambda r: (r.get("updateDate") or "", r["id"]), reverse=True):
        rid = r["id"]
        d = detail(rid)
        stats["records"] += 1
        stats["detail_fetched" if d else "detail_not_fetched"] += 1
        authors = [a.get("author") for a in (d or {}).get("authors", []) if a.get("author")]
        topics = [t.get("topic") for t in (d or {}).get("topics", []) if t.get("topic")]
        formats = [{"format": f.get("format"), "url": f.get("url")} for f in (d or {}).get("formats", [])
                   if (f.get("url") or "").startswith(FORMAT_HOSTS)]
        rel = related((d or {}).get("relatedMaterials", []), known)
        stats["related_bill_links"] += sum(1 for x in rel if x.get("href"))
        page = PAGE.format(id=rid)
        published = (r.get("publishDate") or "")[:10] or None
        updated = (r.get("updateDate") or "")[:10] or None
        crs = {"id": rid, "title": r.get("title"), "contentType": r.get("contentType"), "status": r.get("status"),
               "publishDate": r.get("publishDate"), "updateDate": r.get("updateDate"), "version": r.get("version"),
               "currentVersion": (d or {}).get("currentVersion"), "authors": authors if d else None,
               "topics": topics if d else None, "formats": formats if d else None, "related": rel if d else None,
               "detailFetched": bool(d), "page": page, "api": f"https://api.congress.gov/v3/crsreport/{rid}"}
        types[r.get("contentType") or "Not recorded"] += 1
        statuses[r.get("status") or "Not recorded"] += 1
        cells = {"id": rid, "title": r.get("title"), "type": r.get("contentType"), "status": r.get("status"),
                 "published": published, "updated": updated, "version": r.get("version"),
                 "authors": "; ".join(authors) if d else None, "detail_fetched": "yes" if d else "no"}
        facts = [["CRS product", rid], ["Title", r.get("title") or "Not recorded"], ["Type", r.get("contentType") or "Not recorded"],
                 ["Status", r.get("status") or "Not recorded"], ["Published", published or "Not recorded"],
                 ["Updated", updated or "Not recorded"], ["Current version (as published)", str(r.get("version") or "Not recorded")],
                 ["Authors (as published)", "; ".join(authors) if authors else "Not recorded"],
                 ["Topics", "; ".join(topics) if topics else "Not recorded"],
                 ["Source", "Congress.gov API v3 (Library of Congress), /crsreport"]]
        links = [{"url": page, "label": "Congress.gov CRS product page"}]
        links += [{"url": f["url"], "label": f"{f['format']} (Congress.gov)"} for f in formats]
        links += [{"url": x["href"], "label": x["citation"]} for x in rel if x.get("href")][:10]
        filters = {"content_type": [r.get("contentType")] if r.get("contentType") else [],
                   "status": [r.get("status")] if r.get("status") else [], "year": [published[:4]] if published else [],
                   "detail_fetched": ["yes" if d else "no"], "topic": topics[:20],
                   "related_bill": [x["billId"] for x in rel if x.get("billId")][:60]}
        filters = {k: v for k, v in filters.items() if v}
        row = record(DATASET, rid, f"{r.get('title') or 'Title not recorded'} ({rid})", source_url=page, cells=cells, facts=facts,
                     text=" ".join([rid, r.get("title") or "", " ".join(authors), " ".join(topics)]), filters=filters,
                     subtitle=f"CRS {r.get('contentType') or 'product'}", badges=[x for x in (r.get("contentType"), r.get("status")) if x],
                     links=links, extra={"kind": "crs_report"})
        row["detail"]["crs"] = crs
        rows.append(row)
    summary = {
        "source": "Congress.gov API v3 (Library of Congress), https://api.congress.gov/v3/crsreport and /crsreport/{id}",
        "licence": "Congress.gov data: government work (dc.rights 'Text is government work'); CRS products are public works of the Congressional Research Service",
        "retrieved": "2026-10-23", "records": len(rows), "listed_count": lst["listed_count"],
        "scope": "Every CRS product the Congress.gov API lists (reports, In Focus and other resources, Insight posts, testimony, infographics); metadata and official links only, no report text or summaries.",
        "detail_rule": "Authors, topics, formats (official PDF/HTML links on congress.gov) and related legislation come from the /crsreport/{id} detail. Details were fetched for Active products first, newest update first, within the stream's 8,000-request budget; the rest show 'Not recorded' (detail_fetched = no) until a later refresh.",
        "version_rule": "'version' is the current version number as the API lists it.",
        "stats": dict(stats), "content_types": dict(types), "statuses": dict(statuses),
    }
    lb = listing([("id", "Product"), ("title", "Title"), ("type", "Type"), ("status", "Status"), ("updated", "Updated"),
                  ("authors", "Authors")],
                 [("content_type", "Type", {k: k for k in sorted(types)}), ("status", "Status", {k: k for k in sorted(statuses)})])
    build = {"dataset": DATASET, "label": LABEL, "listing_block": lb, "summary": summary, "rows": rows, "built_at": cm.now_utc(),
             "inputs": [{"url": "https://api.congress.gov/v3/crsreport", "path": str((cm.BUILD / 'crs_list.json').relative_to(cm.ROOT))}]}
    (cm.BUILD / f"{DATASET}.json").write_text(json.dumps(build, ensure_ascii=False))
    print(json.dumps({"records": len(rows), **stats}))


if __name__ == "__main__":
    main()
