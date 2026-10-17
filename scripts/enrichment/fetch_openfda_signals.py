"""Fetch openFDA adverse-event and recall aggregates for mass-tort products (scripts/enrichment/mass_tort_products.json).

Writes one JSON file per MDL to private/acq/openfda/. Queries are counts only; no adverse-event narratives are stored.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "private" / "acq" / "openfda"
API = "https://api.fda.gov/"
ENDPOINTS = {
    "drug": {"events": "drug/event.json", "date": "receivedate", "recalls": "drug/enforcement.json",
             "top": "patient.reaction.reactionmeddrapt.exact", "breakdown": "serious"},
    "device": {"events": "device/event.json", "date": "date_received", "recalls": "device/recall.json",
               "top": "product_problems.exact", "breakdown": "event_type.exact"},
    "food": {"events": "food/event.json", "date": "date_created", "recalls": "food/enforcement.json",
             "top": "reactions.exact", "breakdown": "outcomes.exact"},
    "cosmetic": {"events": "food/event.json", "date": "date_created", "recalls": "food/enforcement.json",
                 "top": "reactions.exact", "breakdown": "outcomes.exact"},
}


def get(path, params):
    # openFDA reads '+' as a separator, so only literal spaces inside quoted phrases are percent-encoded.
    query = "&".join(f"{k}={str(v).replace(' ', '%20')}" for k, v in params.items())
    url = API + path + "?" + query
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return json.load(response), url
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return {"results": [], "meta": {"results": {"total": 0}}}, url
            if error.code == 429 and attempt < 3:
                time.sleep(20 * (attempt + 1))
                continue
            if error.code >= 500 and attempt < 2:
                time.sleep(5)
                continue
            if error.code >= 500:
                # openFDA rejects some aggregations on very large result sets; record the gap, keep going.
                return {"results": [], "error": f"openFDA {error.code}"}, url
            raise RuntimeError(f"{url} -> {error.code} {error.read()[:200]!r}") from None
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(5)
                continue
            raise
        finally:
            time.sleep(0.4)


def by_year(results):
    years = Counter()
    for r in results:
        years[r["time"][:4]] += r["count"]
    return dict(sorted(years.items()))


def fetch(entry):
    kind = entry["kind"]
    ep = ENDPOINTS[kind]
    search = entry.get("faers") or entry.get("maude") or entry.get("caers")
    out = {"mdl": entry["mdl"], "product": entry["product"], "kind": kind, "fetched_at": datetime.now(timezone.utc).isoformat(), "queries": {}}
    if search:
        total, url = get(ep["events"], {"search": search, "limit": 1})
        out["queries"]["events"] = url
        out["event_total"] = total.get("meta", {}).get("results", {}).get("total", 0)
        yearly, _ = get(ep["events"], {"search": search, "count": ep["date"]})
        out["events_by_year"] = by_year(yearly.get("results", []))
        breakdown, _ = get(ep["events"], {"search": search, "count": ep["breakdown"]})
        out["event_breakdown"] = {str(r["term"]): r["count"] for r in breakdown.get("results", [])}
        if breakdown.get("error"):
            out["event_breakdown_error"] = breakdown["error"]
        top, _ = get(ep["events"], {"search": search, "count": ep["top"], "limit": 12})
        out["top_terms"] = [{"term": r["term"], "count": r["count"]} for r in top.get("results", [])]
    if entry.get("recall"):
        recalls, url = get(ep["recalls"], {"search": entry["recall"], "limit": 5, "sort": "report_date:desc" if kind != "device" else "event_date_initiated:desc"})
        out["queries"]["recalls"] = url
        out["recall_total"] = recalls.get("meta", {}).get("results", {}).get("total", 0)
        out["recent_recalls"] = [
            {k: r.get(k) for k in ("recall_number", "res_event_number", "classification", "report_date", "event_date_initiated", "recalling_firm", "product_description", "reason_for_recall", "status")}
            for r in recalls.get("results", [])
        ]
        field = "classification.exact" if kind != "device" else "root_cause_description.exact"
        classes, _ = get(ep["recalls"], {"search": entry["recall"], "count": field})
        out["recall_breakdown"] = {str(r["term"]): r["count"] for r in classes.get("results", [])}
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    mapping = json.loads((Path(__file__).parent / "mass_tort_products.json").read_text())["mdls"]
    summary = []
    for entry in mapping:
        if entry["kind"] == "vehicle":
            continue
        target = OUT / f"{entry['mdl']}.json"
        if target.exists() and "--refresh" not in sys.argv and entry["mdl"] != 1871:
            result = json.loads(target.read_text())
            summary.append((entry["mdl"], entry["product"][:44], result.get("event_total"), result.get("recall_total")))
            continue
        result = fetch(entry)
        (OUT / f"{entry['mdl']}.json").write_text(json.dumps(result, indent=1))
        summary.append((entry["mdl"], entry["product"][:44], result.get("event_total"), result.get("recall_total")))
        print(f"{entry['mdl']:>5} {entry['product'][:44]:44} events={result.get('event_total')} recalls={result.get('recall_total')}", flush=True)


if __name__ == "__main__":
    main()
