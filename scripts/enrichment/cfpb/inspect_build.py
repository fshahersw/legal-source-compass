"""Diagnostic: print headline figures from the built cfpb datasets for review."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "cfpb")


def load(name):
    with open(os.path.join(OUT, f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


what = sys.argv[1] if len(sys.argv) > 1 else "national"
if what == "national":
    d = load("cfpb_complaints_national")
    rows = {r["id"]: r for r in d["rows"]}
    nat = rows["cfpb-national:all"]["item"]["national"]
    print("ids", list(rows)[:6], "...", len(rows))
    for y in nat["years"]:
        print(y["year"], y["complaints"], y["complete"], y["yoy_pct"], y["timely_rate"], y["relief_rate"], y["credit_reporting_share_pct"], y["top_product"])
    print("products")
    for p in nat["products"]:
        print("  ", p["value"], p["complaints"], p["share_pct"], p["first_month"], p["last_month"])
    print("via", [(v["value"], v["complaints"]) for v in nat["submitted_via"]])
    print("resp", [(v["value"], v["complaints"]) for v in nat["company_response"]])
    print("timely", nat["timely"], "responses", nat["responses"])
    print("tags", [(v["value"], v["complaints"]) for v in nat["tags"]])
    a = nat["analytics"]
    print("cagr", a["cagr"], "ytd", a["ytd"])
    print("shift", a["product_share_shift"]["rows"][:6])
    print("conc", [(c["year"], c["top3_share_pct"], c["hhi"]) for c in a["concentration"]])
    w = rows["cfpb-national:window-2023-10-18-2026-10-18"]["item"]["window"]
    print("window", w["complaints"], w["prior_window"], w["change_vs_prior_pct"], w["timely"], len(w["months"]))
    print("window top companies", [(c["value"], c["complaints"]) for c in w["top_companies"][:8]])
    print("window products", [(c["value"], c["complaints"]) for c in w["products"]])
    for r in d["rows"]:
        print("  row", r["id"], len(json.dumps(r)))
elif what == "states":
    d = load("cfpb_complaints_states")
    for r in d["rows"]:
        it = r["item"]
        p = it.get("state_profile")
        if p:
            print(r["id"], r["state"], p["name"], p["kind"], p["complaints"], p["analytics"].get("per_100k_2025"), p["analytics"].get("rate_change_pct"), p["analytics"].get("rank_rate_rise"), [l["url"] for l in r["item"]["links"]][:1], len(json.dumps(r)))
    rk = next(r for r in d["rows"] if r["id"] == "cfpb-states:analytics")["item"]["rankings"]
    for k, v in rk.items():
        print(k, v[:8])
elif what == "companies":
    d = load("cfpb_complaints_companies")
    for r in d["rows"][:30]:
        c = r["item"].get("company")
        if c:
            print(c["rank"], repr(c["name"]), c["complaints"], c["window"]["complaints"], c["window"]["change_vs_prior_pct"], c["timely"]["rate"], c["responses"]["relief_rate"], c["sec_match"]["status"], c["products"][0]["value"])
    print(d["summary"]["sec_links"])
    matched = [r["item"]["company"]["name"] for r in d["rows"] if r["item"].get("company") and r["item"]["company"]["sec_match"]["status"] == "matched"]
    print("matched", matched)
    rk = next(r for r in d["rows"] if r["id"] == "cfpb-companies:analytics")["item"]["rankings"]
    for k, v in rk.items():
        print(k, v[:5], v[-3:])
    print("max row bytes", max(len(json.dumps(r)) for r in d["rows"]))
elif what == "reports":
    d = load("cfpb_research_reports")
    print(d["summary"])
    print(json.dumps(d["rows"][0], indent=1)[:2500])
