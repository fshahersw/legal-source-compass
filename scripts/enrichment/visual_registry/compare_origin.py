"""Registry-vs-origin comparison from responses already cached before the owner decision of 2026-10-24 (no new
fetches): Commons file-page metadata (display pass) and Library of Congress item records.

  python3 -I -B compare_origin.py

For every published image object (as recorded by the registry) whose origin response is cached: its licence family
(recorded.py, from the recorded licence text) versus the family the origin states (court_images/licenses.py
licence_family; LOC: origin.loc_rights), its recorded author versus the origin's Artist, and (where the registry
record is known) the recorded original width versus the origin's. Writes
private/build/visual_registry/origin_comparison.json (counts and every disagreement). Informational only: the builds
carry the registry's values as recorded.
"""
import json
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import origin as og  # noqa: E402
from registry import loc_item_id  # noqa: E402
from vr_common import BUILD, CACHE, LOC_RIGHTS_CSV, Store, write_json  # noqa: E402

DATASETS = ["court_images", "court_buildings", "judge_portraits_open", "agency_images", "committee_marks",
            "company_logos_open", "state_capitol_images"]


def published_objects():
    """(dataset, row id, image object) for every published photo/portrait/logo with a source page."""
    for ds in DATASETS:
        rows = json.load(open(BUILD / f"{ds}.json"))["rows"]
        if ds == "court_images":
            rows = rows[189:]
        for r in rows:
            item = r["item"]
            objs = [b["photo"] for b in item.get("buildings") or []] + list(item.get("photos") or [])
            for key in ("photo", "portrait", "logo"):
                if isinstance(item.get(key), dict):
                    objs.append(item[key])
            for o in objs:
                page = o.get("file_page") or o.get("source_page")
                if page:
                    author = o.get("author", o.get("attribution"))
                    yield ds, r["id"], page, o.get("license_family"), o.get("license"), author


def commons_page_title(page):
    p = urllib.parse.urlsplit(page)
    if p.netloc == "commons.wikimedia.org" and p.path.startswith("/wiki/File:"):
        return urllib.parse.unquote(p.path[len("/wiki/"):]).replace("_", " ")
    return None


def main():
    commons = og.Commons(CACHE)
    loc = Store("loc_items")
    statements = og.loc_statements(LOC_RIGHTS_CSV)
    out, compared, seen = [], Counter(), set()
    for ds, rid, page, family, licence, author in published_objects():
        key = (ds, page)
        if key in seen:
            continue
        seen.add(key)
        title = commons_page_title(page)
        if title:
            facts = og.file_facts(og.resolve(title, *commons.display))
            if not facts:
                continue
            compared[(ds, "commons")] += 1
            origin_family = facts["family"] or "other"
            if origin_family != family:
                out.append({"dataset": ds, "id": rid, "field": "licence family", "registry": licence,
                            "origin": facts["license"] or facts["exclusion"], "origin_url": facts["description_url"]})
            if facts["artist"] and author and facts["artist"] != author:
                out.append({"dataset": ds, "id": rid, "field": "author", "registry": author,
                            "origin": facts["artist"], "origin_url": facts["description_url"]})
            continue
        item = loc_item_id(page)
        body = loc.read(item) if item else None
        if body:
            compared[(ds, "loc")] += 1
            basis, why = og.loc_rights(json.loads(body).get("item") or {}, statements)
            origin_family = "public domain" if basis else "other"
            if origin_family != family:
                out.append({"dataset": ds, "id": rid, "field": "licence family", "registry": licence,
                            "origin": "public domain (item names Carol M. Highsmith and links statement 482_high)"
                            if basis else why, "origin_url": page})
    summary = {"compared": {f"{d}/{k}": n for (d, k), n in sorted(compared.items())},
               "disagreements": {f"{d}/{f}": n for (d, f), n in
                                 Counter((x["dataset"], x["field"]) for x in out).most_common()},
               "note": ("Only images whose origin response was cached before the owner decision are compared; "
                        "FJC-, GSA-, Federal Register- and committee-hosted images have no cached origin record.")}
    write_json(BUILD / "origin_comparison.json", {"summary": summary, "disagreements": out})
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
