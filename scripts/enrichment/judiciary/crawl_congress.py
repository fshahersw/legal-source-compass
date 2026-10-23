"""Congress.gov API v3: every nomination list page for the 97th-119th Congresses (1981-2026), then the item, nominee,
action and hearing records of each nomination whose organization is "The Judiciary".

  python3 -I -B crawl_congress.py lists      list pages (about 230 requests)
  python3 -I -B crawl_congress.py details    item + nominees + actions (+ hearings when the item lists any)

Responses are stored by congress_api/fetchlib, so a re-run makes no new requests for what is already stored. The
request budget (15,000 for this stream) is enforced in congress_api.get.
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import congress_api as api  # noqa: E402

CONGRESSES = range(97, 120)
PAGE = 250
JUDICIARY_ORG = "The Judiciary"
# federal judgeships: Article III courts and the territorial district courts. Tax Court, Court of Veterans Appeals, Claims
# Court and the D.C. local courts are other organizations and stay out of scope (counted in the build report).
JUDICIAL_ORGS = {"The Judiciary", "Supreme Court of the United States", "The Supreme Court of the United States", "District Court of Guam"}


def list_pages(congress: int):
    offset = 0
    while True:
        page = api.get(f"/nomination/{congress}", limit=PAGE, offset=offset)
        if page is None:
            return
        yield page
        items = page.get("nominations") or []
        total = (page.get("pagination") or {}).get("count") or 0
        offset += PAGE
        if not items or offset >= total:
            return


def judicial_list_entries():
    out = []
    for c in CONGRESSES:
        for page in list_pages(c):
            out += [n for n in page.get("nominations") or [] if n.get("organization") in JUDICIAL_ORGS]
    return out


def cite_path(entry: dict) -> str:
    number = str(entry["number"])
    part = str(entry.get("partNumber") or "00")
    return f"/nomination/{entry['congress']}/{number}" + ("" if part in ("", "00") else f"-{int(part)}")


def details(entry: dict) -> None:
    base = cite_path(entry)
    item = api.get(base)
    if not item:
        return
    nom = item.get("nomination") or {}
    for nominee in nom.get("nominees") or []:
        api.get(f"{base}/{nominee.get('ordinal')}")
    offset = 0
    while True:
        acts = api.get(f"{base}/actions", limit=PAGE, offset=offset)
        total = ((acts or {}).get("pagination") or {}).get("count") or 0
        offset += PAGE
        if not acts or offset >= total:
            break
    if (nom.get("hearings") or {}).get("count"):
        api.get(f"{base}/hearings", limit=PAGE, offset=0)


def main(step: str) -> None:
    if step == "lists":
        orgs = collections.Counter()
        per = {}
        for c in CONGRESSES:
            n = 0
            for page in list_pages(c):
                for item in page.get("nominations") or []:
                    orgs[item.get("organization")] += 1
                    n += item.get("organization") == JUDICIARY_ORG
            per[c] = n
        print(json.dumps({"judiciary_per_congress": per, "judiciary_total": sum(per.values()),
                          "organizations_with_court_or_judge": {k: v for k, v in orgs.items() if k and ("ourt" in k or "udic" in k)}}, indent=1))
        return
    entries = judicial_list_entries()
    # four workers keep the pipe full (responses take about 2 s); fetchlib spaces request starts to api.congress.gov by 0.5 s (at most 2 requests/s)
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, _ in enumerate(pool.map(details, entries), 1):
            if i % 100 == 0:
                print(json.dumps({"done": i, "of": len(entries), "requests_used": api._count()}), flush=True)
    print(json.dumps({"done": len(entries), "requests_used": api._count()}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
