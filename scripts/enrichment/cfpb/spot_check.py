"""Spot-check built CFPB figures against live queries of the documented search API (read-only).

Each check names a figure shown in a build file, the API query that should reproduce it, and compares exactly.
API responses are saved unchanged under private/acq/cfpb/api/ (manifest method=api).
Writes private/build/cfpb/spot_checks.json and prints one line per check.

Usage: python3 -I -B scripts/enrichment/cfpb/spot_check.py
"""
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from api_query import API, query  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "cfpb")


def load(name):
    with open(os.path.join(OUT, f"{name}.json"), encoding="utf-8") as handle:
        return {r["id"]: r for r in json.load(handle)["rows"]}


def qs(**params):
    pairs = [("size", "0"), ("no_aggs", "true")]
    for key, value in params.items():
        pairs.append((key, value))
    return urllib.parse.urlencode(pairs, quote_via=urllib.parse.quote)


def by_value(rows, value):
    return next((r["complaints"] for r in rows if r["value"] == value), None)


def main():
    nat = load("cfpb_complaints_national")
    sts = load("cfpb_complaints_states")
    cos = load("cfpb_complaints_companies")
    all_n = nat["cfpb-national:all"]["item"]["national"]
    win = nat["cfpb-national:window-2023-10-18-2026-10-18"]["item"]["window"]

    def year(y):
        return nat[f"cfpb-national:year:{y}"]["item"]["year"]

    def prod(slug):
        return nat[f"cfpb-national:product:{slug}"]["item"]["product"]

    def state(code):
        return sts[f"cfpb-state:{code}"]["item"]["state_profile"]

    def company(name):
        return next(r["item"]["company"] for r in cos.values() if r["item"].get("company") and r["item"]["company"]["name"] == name)

    def yval(rows, y, field="complaints"):
        return next((r[field] for r in rows if r["year"] == y), None)

    month = {m["month"]: m["complaints"] for m in all_n["months"]}
    count_checks = [
        ("All complaints, all history", "cfpb_complaints_national cfpb-national:all national.complaints", all_n["complaints"], {}),
        ("Complaints in 2015", "cfpb-national:year:2015 year.complaints", year("2015")["complaints"], {"date_received_min": "2015-01-01", "date_received_max": "2015-12-31"}),
        ("Complaints in 2020", "cfpb-national:year:2020 year.complaints", year("2020")["complaints"], {"date_received_min": "2020-01-01", "date_received_max": "2020-12-31"}),
        ("Complaints in 2025", "cfpb-national:year:2025 year.complaints", year("2025")["complaints"], {"date_received_min": "2025-01-01", "date_received_max": "2025-12-31"}),
        ("Complaints 2026 to date", "cfpb-national:year:2026 year.complaints", year("2026")["complaints"], {"date_received_min": "2026-01-01", "date_received_max": "2026-10-18"}),
        ("Complaints in March 2021", "cfpb-national:all national.months[2021-03]", month["2021-03"], {"date_received_min": "2021-03-01", "date_received_max": "2021-03-31"}),
        ("Mortgage complaints in 2018", "cfpb-national:product:mortgage product.years[2018]", yval(prod("mortgage")["years"], "2018"), {"product": "Mortgage", "date_received_min": "2018-01-01", "date_received_max": "2018-12-31"}),
        ("Debt collection complaints, all history", "cfpb-national:product:debt-collection product.complaints", prod("debt-collection")["complaints"], {"product": "Debt collection"}),
        ("Phone-submitted complaints in 2014", "cfpb-national:all national.submitted_via[Phone].years[2014]", next(r for r in all_n["submitted_via"] if r["value"] == "Phone")["years"]["2014"], {"submitted_via": "Phone", "date_received_min": "2014-01-01", "date_received_max": "2014-12-31"}),
        ("'In progress' responses, all history", "cfpb-national:all national.company_response[In progress]", by_value(all_n["company_response"], "In progress"), {"company_response": "In progress"}),
        ("Untimely (Timely response? = No), all history", "cfpb-national:all national.timely.no", all_n["timely"]["no"], {"timely": "No"}),
        ("Texas complaints, all history", "cfpb-state:TX state_profile.complaints", state("TX")["complaints"], {"state": "TX"}),
        ("New Jersey complaints in 2022", "cfpb-state:NJ state_profile.years[2022].complaints", yval(state("NJ")["years"], "2022"), {"state": "NJ", "date_received_min": "2022-01-01", "date_received_max": "2022-12-31"}),
        ("Mississippi complaints in 2025 (per-capita numerator)", "cfpb-state:MS state_profile.years[2025].complaints", yval(state("MS")["years"], "2025"), {"state": "MS", "date_received_min": "2025-01-01", "date_received_max": "2025-12-31"}),
        ("Mississippi complaints in 2022 (per-capita numerator)", "cfpb-state:MS state_profile.years[2022].complaints", yval(state("MS")["years"], "2022"), {"state": "MS", "date_received_min": "2022-01-01", "date_received_max": "2022-12-31"}),
        ("Georgia complaints in 2025 (per-capita numerator)", "cfpb-state:GA state_profile.years[2025].complaints", yval(state("GA")["years"], "2025"), {"state": "GA", "date_received_min": "2025-01-01", "date_received_max": "2025-12-31"}),
        ("Puerto Rico complaints, all history", "cfpb-state:PR state_profile.complaints", state("PR")["complaints"], {"state": "PR"}),
        ("California mortgage complaints, all history", "cfpb-state:CA state_profile.products[Mortgage]", by_value(state("CA")["products"], "Mortgage"), {"state": "CA", "product": "Mortgage"}),
        ("EQUIFAX, INC. complaints, all history", "cfpb-company EQUIFAX, INC. company.complaints", company("EQUIFAX, INC.")["complaints"], {"company": "EQUIFAX, INC."}),
        ("WELLS FARGO & COMPANY complaints in 2016", "cfpb-company WELLS FARGO & COMPANY company.years[2016]", yval(company("WELLS FARGO & COMPANY")["years"], "2016"), {"company": "WELLS FARGO & COMPANY", "date_received_min": "2016-01-01", "date_received_max": "2016-12-31"}),
        ("CAPITAL ONE untimely complaints", "cfpb-company CAPITAL ONE FINANCIAL CORPORATION company.timely.no", company("CAPITAL ONE FINANCIAL CORPORATION")["timely"]["no"], {"company": "CAPITAL ONE FINANCIAL CORPORATION", "timely": "No"}),
        ("BANK OF AMERICA monetary relief", "cfpb-company BANK OF AMERICA, NATIONAL ASSOCIATION company.company_response[Closed with monetary relief]", by_value(company("BANK OF AMERICA, NATIONAL ASSOCIATION")["company_response"], "Closed with monetary relief"), {"company": "BANK OF AMERICA, NATIONAL ASSOCIATION", "company_response": "Closed with monetary relief"}),
        ("MOHELA complaints in the 3-year window", "cfpb-company MOHELA company.window.complaints", company("MOHELA")["window"]["complaints"], {"company": "MOHELA", "date_received_min": "2023-10-18", "date_received_max": "2026-10-18"}),
        ("Block, Inc. complaints in 2025", "cfpb-company Block, Inc. company.years[2025]", yval(company("Block, Inc.")["years"], "2025"), {"company": "Block, Inc.", "date_received_min": "2025-01-01", "date_received_max": "2025-12-31"}),
        ("Preceding-window complaints 2020-10-18..2023-10-17", "cfpb-national:window window.prior_window.complaints", win["prior_window"]["complaints"], {"date_received_min": "2020-10-18", "date_received_max": "2023-10-17"}),
    ]
    results = []
    for i, (name, where, expected, params) in enumerate(count_checks, 1):
        entry, data = query(f"spot_{i:02d}", qs(**params))
        got = data["hits"]["total"]["value"]
        results.append({"check": name, "build_field": where, "build_value": expected, "api_value": got, "match": expected == got,
                        "api_url": entry["url"], "api_sha256": entry["sha256"], "retrieved_at": entry["retrieved_at"]})
        print(f"{'OK ' if expected == got else 'MISMATCH'} {name}: build {expected} api {got}", flush=True)

    # bucket checks from one window query with aggregations (same URL date range as the search page)
    entry, data = query("spot_window_aggs", urllib.parse.urlencode([("size", "0"), ("date_received_min", "2023-10-18"), ("date_received_max", "2026-10-18")]))
    aggs = data["aggregations"]

    def bucket(name, key):
        inner = aggs[name].get(name, aggs[name])
        return next((b["doc_count"] for b in inner["buckets"] if b["key"] == key), None)

    issue_total = sum(child["complaints"] for p in win["issues"] for child in p["children"] if child["value"] == "Incorrect information on your report")
    bucket_checks = [
        ("Window total", "window.complaints", win["complaints"], data["hits"]["total"]["value"]),
        ("Window: Debt collection", "window.products[Debt collection]", by_value(win["products"], "Debt collection"), bucket("product", "Debt collection")),
        ("Window: issue 'Incorrect information on your report' (summed over products)", "window.issues[*].children[Incorrect information on your report]", issue_total, bucket("issue", "Incorrect information on your report")),
        ("Window: TRANSUNION INTERMEDIATE HOLDINGS, INC.", "window.top_companies[...]", by_value(win["top_companies"], "TRANSUNION INTERMEDIATE HOLDINGS, INC."), bucket("company", "TRANSUNION INTERMEDIATE HOLDINGS, INC.")),
        ("Window: state FL", "window.states[FL]", by_value(win["states"], "FL"), bucket("state", "FL")),
        ("Window: Timely response? No", "window.timely.no", win["timely"]["no"], bucket("timely", "No")),
        ("Window: submitted via Referral", "window.submitted_via[Referral]", by_value(win["submitted_via"], "Referral"), bucket("submitted_via", "Referral")),
        ("Window: Closed with monetary relief", "window.company_response[Closed with monetary relief]", by_value(win["company_response"], "Closed with monetary relief"), bucket("company_response", "Closed with monetary relief")),
    ]
    for name, where, expected, got in bucket_checks:
        results.append({"check": name, "build_field": f"cfpb-national:window-2023-10-18-2026-10-18 {where}", "build_value": expected, "api_value": got,
                        "match": expected == got, "api_url": entry["url"], "api_sha256": entry["sha256"], "retrieved_at": entry["retrieved_at"]})
        print(f"{'OK ' if expected == got else 'MISMATCH'} {name}: build {expected} api {got}", flush=True)
    summary = {"checks": len(results), "matches": sum(r["match"] for r in results), "mismatches": [r for r in results if not r["match"]],
               "api": API, "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}
    with open(os.path.join(OUT, "spot_checks.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)
    print(json.dumps({"checks": summary["checks"], "matches": summary["matches"], "mismatches": len(summary["mismatches"])}))


if __name__ == "__main__":
    main()
