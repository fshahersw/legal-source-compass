"""CMS Open Payments general payments → safety.open_payments: program year × manufacturer (CMS id) × product named first on
the payment record × recipient state (records, amount), through the Open Payments datastore API's grouped queries.

  python3 -I scripts/safety_v2/open_payments_build.py [--years 2019-2025] [--top 500] [--manufacturers ID,ID] [--outdir DIR]

Universe: the --top manufacturers by general-payment amount summed over the years, from CMS's own summary "payments
grouped by reporting entities" (dataset d5762bed-26ca-4035-91c9-9d67297dc77c). For each manufacturer and year, one grouped
query over that year's General Payment Data detail dataset (sum of total_amount_of_payment_usdollars, count of records,
grouped by name_of_drug_or_biological_or_device_or_medical_supply_1, its product-type indicator and recipient_state).
A payment can list up to five products; CMS gives one amount per payment, so the amount is attributed to the FIRST product
named (product_1) and labelled that way — never split across products. Amounts: the datastore's sum rounded to cents.
Check (validate step): per manufacturer-year, records and amount equal the CMS summary's trans_general and
total_amount_general.
"""
import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

API = "https://openpaymentsdata.cms.gov/api/1/datastore/query/{}/0"
BY_ENTITY = "d5762bed-26ca-4035-91c9-9d67297dc77c"
GENERAL_DETAIL = {
    "2019": "4e54dd6c-30f8-4f86-86a7-3c109a89528e", "2020": "a08c4b30-5cf3-4948-ad40-36f404619019",
    "2021": "0380bbeb-aea1-58b6-b708-829f92a48202", "2022": "df01c2f8-dc1f-4e79-96cb-8208beaf143c",
    "2023": "fb3a65aa-c901-4a38-a813-b04b00dfa2a9", "2024": "e6b17c6a-2534-4207-a4a1-6746a14911ff",
    "2025": "fb0b1734-1410-429d-92f6-3f4b35218e5e",
}
MFR = "applicable_manufacturer_or_applicable_gpo_making_payment_id"
PRODUCT = "name_of_drug_or_biological_or_device_or_medical_supply_1"
PTYPE = "indicate_drug_or_biological_or_device_or_medical_supply_1"
STATE = "recipient_state"
PAGE = 500


def post(http, ds, body):
    status, raw = http.request(API.format(ds), data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(raw.decode())


def cents(v):
    return str(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def universe(http, years, top, only):
    rows, offset = [], 0
    while True:
        d = post(http, BY_ENTITY, {"limit": PAGE, "offset": offset, "count": offset == 0, "results": True, "keys": True})
        chunk = d.get("results") or []
        rows += chunk
        offset += len(chunk)
        if len(chunk) < PAGE:
            break
    totals = defaultdict(Decimal)
    names, summary = {}, {}
    for r in rows:
        if r.get("program_year") not in years:
            continue
        mid = r["amgpo_making_payment_id"]
        totals[mid] += Decimal(r.get("total_amount_general") or "0")
        names[mid] = r["amgpo_making_payment_name"]
        summary[(mid, r["program_year"])] = {"amount": r.get("total_amount_general"), "records": r.get("trans_general")}
    ranked = sorted(totals, key=lambda m: (-totals[m], m))
    chosen = [m for m in ranked if m in only] if only else ranked[:top]
    return chosen, names, summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2019-2025")
    ap.add_argument("--top", type=int, default=500)
    ap.add_argument("--manufacturers", default="")
    ap.add_argument("--outdir", default=str(c.BUILD / "open_payments"))
    ap.add_argument("--chunk-rows", type=int, default=5000)
    args = ap.parse_args()
    a, _, b = args.years.partition("-")
    years = [str(y) for y in range(int(a), int(b or a) + 1)]
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    http = c.Http(min_interval=1.0, log_path=out / "requests.jsonl", timeout=600)
    only = set(x for x in args.manufacturers.split(",") if x)
    chosen, names, summary = universe(http, years, args.top, only)
    tag = c.sha256_bytes(c.utc_now().encode())[:6]
    w = c.ChunkWriter(out / "chunks", f"open_payments-{tag}", max_rows=args.chunk_rows, source="cms_open_payments")
    checks = []
    for mid in chosen:
        for y in years:
            if (mid, y) not in summary:
                continue
            body = {"limit": PAGE, "offset": 0, "count": True, "results": True, "keys": True,
                    "properties": [PRODUCT, PTYPE, STATE,
                                   {"alias": "amount", "expression": {"operator": "sum", "operands": ["total_amount_of_payment_usdollars"]}},
                                   {"alias": "n", "expression": {"operator": "count", "operands": ["record_id"]}}],
                    "groupings": [PRODUCT, PTYPE, STATE],
                    "conditions": [{"property": MFR, "value": mid, "operator": "="}]}
            groups, offset, total = [], 0, None
            while True:
                body["offset"] = offset
                body["count"] = offset == 0
                d = post(http, GENERAL_DETAIL[y], body)
                if offset == 0:
                    total = int(d.get("count") or 0)
                chunk = d.get("results") or []
                groups += chunk
                offset += len(chunk)
                if len(chunk) < PAGE or offset >= total:
                    break
            merged = defaultdict(lambda: [0, Decimal(0), ""])
            for g in groups:  # the same (product, state) can come back once per product-type indicator
                st = (g.get(STATE) or "").strip().upper()
                st = st if len(st) == 2 and st.isalpha() else ""
                key = ((g.get(PRODUCT) or "").strip(), st)
                m = merged[key]
                m[0] += int(g["n"])
                m[1] += Decimal(str(g["amount"]))
                m[2] = m[2] or (g.get(PTYPE) or "").strip()
            for (product, st), (n, amount, ptype) in sorted(merged.items()):
                w.add({"program_year": int(y), "manufacturer_id": mid, "manufacturer_name": names[mid], "product": product,
                       "product_type": ptype, "state": st, "records": n, "amount_usd": cents(amount)})
            s = summary[(mid, y)]
            checks.append({"manufacturer_id": mid, "year": y, "records": [sum(v[0] for v in merged.values()), int(s["records"] or 0)],
                           "amount": [cents(sum((v[1] for v in merged.values()), Decimal(0))), cents(s["amount"] or "0")]})
    res = w.close()
    res["target"] = "open_payments"
    with open(out / "chunks" / "index.jsonl", "a") as f:
        for ch in res["chunks"]:
            f.write(json.dumps({**ch, "target": "open_payments"}) + "\n")
    bad = [x for x in checks if x["records"][0] != x["records"][1] or abs(Decimal(x["amount"][0]) - Decimal(x["amount"][1])) > Decimal("0.05")]
    (out / "validation.json").write_text(json.dumps({"checked": len(checks), "mismatches": len(bad), "checks": checks,
                                                     "rule": "records = CMS trans_general; amount within 5 cents of CMS total_amount_general",
                                                     "at": c.utc_now()}, indent=1))
    c.write_manifest(out, "open_payments", [res], {"by_entity": API.format(BY_ENTITY), "detail": {y: API.format(GENERAL_DETAIL[y]) for y in years}},
                     {"manufacturers": len(chosen), "years": years, "attribution": "amount attributed to the first product named on each payment record"})
    print(json.dumps({"manufacturers": len(chosen), "rows": res["rows"], "checked": len(checks), "mismatches": len(bad), "requests": http.requests}))
    if bad:
        print(json.dumps(bad[:5]))
        sys.exit(1)


if __name__ == "__main__":
    main()
