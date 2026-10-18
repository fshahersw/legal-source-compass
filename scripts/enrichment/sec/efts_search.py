"""Step 2: run EDGAR full-text searches for every target MDL and store the raw hits.

Input:  private/acq/sec-companies/mdl_inputs.json (fetch_mdl_inputs.py)
Output: private/acq/sec-companies/efts_hits.json  (one entry per query with every hit, all pages)
Raw responses are cached unchanged under private/acq/sec-companies/efts/.
"""
import json
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sec_http as h  # noqa: E402
import targets as tg  # noqa: E402

ACQ = h.ACQ
SUBJECT_FORMS = "10-K,10-Q,8-K,20-F,6-K,40-F"
MAX_PAGES = 40  # 4,000 hits per query is far beyond any MDL phrase; the cap is reported if reached


def hit_row(raw):
    src = raw["_source"]
    adsh, _, filename = raw["_id"].partition(":")
    return {
        "adsh": adsh, "file": filename, "ciks": src.get("ciks") or [], "names": src.get("display_names") or [],
        "form": src.get("form"), "root_forms": src.get("root_forms") or [], "file_type": src.get("file_type"),
        "file_date": src.get("file_date"), "period_ending": src.get("period_ending"),
        "sics": src.get("sics") or [], "biz_states": src.get("biz_states") or [], "inc_states": src.get("inc_states") or [],
    }


def run_query(spec):
    phrases = spec["phrases"]
    q = " ".join(f'"{p}"' for p in phrases)
    hits, total, capped = [], None, False
    for page in range(MAX_PAGES):
        params = {"q": q}
        if spec.get("forms"):
            params["forms"] = spec["forms"]
        if page:
            params["from"] = str(page * 100)
        url = "https://efts.sec.gov/LATEST/search-index?" + urllib.parse.urlencode(params)
        data = h.get_json(url, kind="efts")
        if data is None:
            break
        block = data.get("hits") or {}
        total = (block.get("total") or {}).get("value", 0)
        rows = block.get("hits") or []
        hits.extend(hit_row(r) for r in rows)
        if len(rows) < 100 or len(hits) >= total:
            break
    else:
        capped = True
    return {**spec, "query": q, "total": total, "returned": len(hits), "capped": capped,
            "search_url": "https://efts.sec.gov/LATEST/search-index?" + urllib.parse.urlencode({"q": q, **({"forms": spec["forms"]} if spec.get("forms") else {})}),
            "hits": hits}


def specs_for(target):
    n = target["mdl"]
    out = [{"mdl": n, "tier": "A", "phrases": [t.format(n=n)]} for t in tg.NUMBER_TEMPLATES]
    if target["use_caption"]:
        out.append({"mdl": n, "tier": "B", "phrases": [target["caption"]]})
        subjects = tg.SUBJECTS.get(n)
        if subjects:
            for term in subjects[0]:
                out.append({"mdl": n, "tier": "C", "term": term, "phrases": ["MDL", term], "forms": SUBJECT_FORMS})
                out.append({"mdl": n, "tier": "C", "term": term, "phrases": ["multidistrict", term], "forms": SUBJECT_FORMS})
    return out


def main():
    inputs = json.loads((ACQ / "mdl_inputs.json").read_text())
    targets = tg.select_targets(inputs)
    specs = [s for t in targets for s in specs_for(t)]
    print(len(targets), "target MDLs;", len(specs), "queries")
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run_query, specs))
    (ACQ / "efts_hits.json").write_text(json.dumps({"retrieved": date.today().isoformat(), "targets": targets, "queries": results}))
    by_tier = {}
    for r in results:
        by_tier.setdefault(r["tier"], [0, 0])
        by_tier[r["tier"]][0] += 1
        by_tier[r["tier"]][1] += r["returned"]
    print(by_tier, "capped:", [r["query"] for r in results if r["capped"]])


if __name__ == "__main__":
    main()
