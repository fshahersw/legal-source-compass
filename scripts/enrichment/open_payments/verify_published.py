"""Re-read published records from Supabase and compare them with fresh queries to the live official APIs.

Never reads the cached raw files: every comparison value is re-fetched from openpaymentsdata.cms.gov or api.fda.gov.
Run: python3 scripts/enrichment/open_payments/verify_published.py
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from op_api import datastore_post, openfda, openfda_raw, query_url  # noqa: E402
from op_sources import BY_ENTITY, GENERAL_DETAIL, NATURE_BY_ENTITY, STATE_TOTALS  # noqa: E402

ENTITIES = sys.argv[1:] or ["100000000053", "100000000057", "100000010987"]


def published(dataset, rid):
    base = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    req = urllib.request.Request(base + f"corpus_records?select=id,item&dataset=eq.{dataset}&id=eq.{rid}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.loads(r.read().decode())
    return rows[0]["item"] if rows else None


def cond(prop, value):
    return {"property": prop, "value": value, "operator": "="}


def line(label, ours, theirs, url):
    ok = ours is not None and theirs is not None and abs(float(ours) - float(theirs)) <= 1.0
    print(f"{'OK  ' if ok else 'DIFF'} {label}: published={ours} source={theirs} {url}")
    return ok


def main():
    results = []
    for eid in ENTITIES:
        item = published("company_payments_manufacturers", f"op-{eid}")
        if not item:
            print("missing", eid)
            continue
        p = item["payments"]
        y2025 = next(y for y in p["years"] if y["year"] == 2025)
        live = datastore_post(BY_ENTITY, {"conditions": [cond("amgpo_making_payment_id", eid), cond("program_year", "2025")], "limit": 5})
        row = live["results"][0] if live["results"] else {}
        results.append(line(f"company_payments_manufacturers/op-{eid} years[2025].general", y2025["general"], row.get("total_amount_general"), query_url(BY_ENTITY)))
        results.append(line(f"company_payments_manufacturers/op-{eid} years[2025].research", y2025["research"], row.get("total_amount_research"), query_url(BY_ENTITY)))
        top_nature = p["natureLatest"][0]
        live = datastore_post(NATURE_BY_ENTITY["2025"], {"conditions": [cond("amgpo_id", eid), cond("nature_of_payment_type_code", top_nature["code"])], "limit": 5})
        results.append(line(f"company_payments_manufacturers/op-{eid} natureLatest[{top_nature['code']}].amount", top_nature["amount"], (live["results"] or [{}])[0].get("total_amount"), query_url(NATURE_BY_ENTITY["2025"])))
        st = p["statesLatest"][0]
        body = {
            "properties": [{"expression": {"operator": "sum", "operands": ["total_amount_of_payment_usdollars"]}, "alias": "total"}],
            "conditions": [cond("applicable_manufacturer_or_applicable_gpo_making_payment_id", eid), cond("recipient_state", st["state"])],
            "groupings": [],
            "limit": 1,
        }
        live = datastore_post(GENERAL_DETAIL["2025"], body)
        results.append(line(f"company_payments_manufacturers/op-{eid} statesLatest[{st['state']}].amount (2025)", st["amount"], (live["results"] or [{}])[0].get("total"), query_url(GENERAL_DETAIL["2025"])))
    for state in ("CA", "NJ", "TX"):
        item = published("company_payments_states", f"op-state-{state}")
        y = next(v for v in item["payments"]["years"] if v["year"] == 2024)
        live = datastore_post(STATE_TOTALS, {"conditions": [cond("state_code", state), cond("program_year", "2024"), cond("payment_type", "General")], "limit": 10})
        total = sum(float(r[f"total_payment_amount_{k}"]) for r in live["results"] for k in ("physician", "non_physician_practitioner", "teaching_hospital"))
        results.append(line(f"company_payments_states/op-state-{state} years[2024].general", y["general"], round(total, 2), query_url(STATE_TOTALS)))
    base = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    req = urllib.request.Request(base + "corpus_records?select=id,item&dataset=eq.company_adverse_manufacturers&item->adverse->>matched=eq.true&order=ordinal.asc&limit=3", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.loads(r.read().decode())
    for row in rows:
        a = row["item"]["adverse"]
        y = next((v for v in a["years"] if v["year"] == 2024), None)
        clause = "+".join(f'device.manufacturer_d_name.exact:"{n["name"]}"' for n in a["matchedNames"])
        url, data = openfda("device/event.json", {"search": f"({clause})+AND+date_received:[20240101+TO+20241231]", "limit": 1})
        live = data["meta"]["results"]["total"] if data else 0
        results.append(line(f"company_adverse_manufacturers/{row['id']} years[2024].reports", y["reports"] if y else 0, live, url))
        # Coverage denominator: re-run the stored search clause restricted to 2024.
        stored = a.get("denominatorUrl") or ""
        if "search=" in stored:
            search = stored.split("search=", 1)[1].split("&count=", 1)[0]
            url, data = openfda_raw("device/event.json", f"search=({search})+AND+date_received:[20240101+TO+20241231]&limit=1")
            live = data["meta"]["results"]["total"] if data else 0
            results.append(line(f"company_adverse_manufacturers/{row['id']} years[2024].denominator", y["denominator"] if y else 0, live, url))
    print(f"{sum(results)} of {len(results)} checks match")


if __name__ == "__main__":
    main()
