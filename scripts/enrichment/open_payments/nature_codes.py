"""Derive the Open Payments summary nature-of-payment code -> label map from official data, with evidence.

CMS's "payments grouped by reporting entities and nature of payments" summary files carry only a numeric
Nature_Of_Payment_Type_Code. CMS publishes no code table for them, so this script matches, for a program year,
the per-code totals of that summary file against the per-label totals of the same year's General Payment
detail dataset (a DKAN datastore aggregation). A code is mapped to a label only when the dollar totals agree to
within $1 and the transaction counts agree exactly; anything else stays unmapped.

Run: python3 scripts/enrichment/open_payments/nature_codes.py  (writes nature_codes.json next to this file)
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op_api import datastore_all, datastore_post  # noqa: E402
from op_sources import GENERAL_DETAIL, NATURE_BY_ENTITY  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
YEARS = ["2020", "2021", "2025"]


def code_totals(year):
    totals = {}
    for row in datastore_all(NATURE_BY_ENTITY[year]):
        code = str(row["nature_of_payment_type_code"]).strip()
        t = totals.setdefault(code, {"amount": 0.0, "n": 0})
        t["amount"] += float(row["total_amount"] or 0)
        t["n"] += int(float(row["number_of_transaction"] or 0))
    return totals


def label_totals(year):
    body = {
        "properties": [
            "nature_of_payment_or_transfer_of_value",
            {"expression": {"operator": "sum", "operands": ["total_amount_of_payment_usdollars"]}, "alias": "total"},
            {"expression": {"operator": "count", "operands": ["record_id"]}, "alias": "n"},
        ],
        "groupings": ["nature_of_payment_or_transfer_of_value"],
        "limit": 200,
    }
    data = datastore_post(GENERAL_DETAIL[year], body)
    return {r["nature_of_payment_or_transfer_of_value"]: {"amount": float(r["total"]), "n": int(r["n"])} for r in data["results"]}


def match(codes, labels):
    mapping, unmatched = {}, []
    for code, c in sorted(codes.items(), key=lambda kv: int(kv[0])):
        hits = [lab for lab, l in labels.items() if abs(l["amount"] - c["amount"]) <= 1.0 and l["n"] == c["n"]]
        if len(hits) == 1:
            mapping[code] = {"label": hits[0], "amount": round(c["amount"], 2), "n": c["n"]}
        else:
            unmatched.append({"code": code, "amount": round(c["amount"], 2), "n": c["n"], "candidates": hits})
    return mapping, unmatched


def main():
    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = dict(zip(YEARS, pool.map(code_totals, YEARS)))
        labels = dict(zip(YEARS, pool.map(label_totals, YEARS)))
    result, evidence = {}, {}
    for year in YEARS:
        mapping, unmatched = match(codes[year], labels[year])
        evidence[year] = {"matched": mapping, "unmatched": unmatched, "summary_dataset": NATURE_BY_ENTITY[year], "detail_dataset": GENERAL_DETAIL[year]}
        for code, m in mapping.items():
            if code in result and result[code] != m["label"]:
                raise SystemExit(f"code {code} maps to different labels across years: {result[code]} vs {m['label']}")
            result[code] = m["label"]
    out = {"codes": dict(sorted(result.items(), key=lambda kv: int(kv[0]))), "method": __doc__.strip().splitlines()[0], "evidence": evidence}
    json.dump(out, open(os.path.join(HERE, "nature_codes.json"), "w"), indent=1)
    print(json.dumps(out["codes"], indent=1))
    for year in YEARS:
        print(year, "unmatched:", evidence[year]["unmatched"])


if __name__ == "__main__":
    main()
