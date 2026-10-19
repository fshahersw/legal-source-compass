"""Spot checks: figures the agency pages display (read from the build files) against the raw source files, read
here with separate code. Prints a Markdown table for REPORT.md and the mismatch count.

Usage: python3 -I -B scripts/enrichment/agencies_fr/spot_checks.py
"""
import csv
import gzip
import json
import os
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "agencies_fr")
OUT = os.path.join(ROOT, "private", "build", "agencies_fr")


def raw(rel):
    with open(os.path.join(ACQ, rel), encoding="utf-8") as fh:
        return json.load(fh)


def build(ds):
    with open(os.path.join(OUT, f"{ds}.json"), encoding="utf-8") as fh:
        return {r["id"]: r for r in json.load(fh)["rows"]}


profiles, trends = build("fr_agency_profiles"), build("fr_agency_trends")
budget, spending = build("agency_budget_trends"), build("agency_spending_by_state")
P = lambda i: profiles[i]["item"]["profile"]  # noqa: E731
T = lambda i: trends[i]["item"]["trends"]  # noqa: E731
rows = []


def check(label, shown, where, source_value):
    rows.append((label, shown, where, source_value, "yes" if shown == source_value else "NO"))


def facet(rel, slug):
    return raw(rel).get(slug, {}).get("count")


def year_total(rel, year):
    return next(v["count"] for k, v in raw(rel).items() if k.startswith(year))


check("EPA final rules 2025", P("145")["stats"]["rulesLastYear"], "fr/facets/agency_year/RULE_2025.json[environmental-protection-agency]",
      facet("fr/facets/agency_year/RULE_2025.json", "environmental-protection-agency"))
check("FDA proposed rules 2025", P("199")["stats"]["proposedLastYear"], "fr/facets/agency_year/PRORULE_2025.json[food-and-drug-administration]",
      facet("fr/facets/agency_year/PRORULE_2025.json", "food-and-drug-administration"))
check("All agencies: final rules 2025", T("federal-register")["yearly"]["RULE"]["2025"], "fr/facets/yearly/RULE.json[2025-01-01]",
      year_total("fr/facets/yearly/RULE.json", "2025"))
check("All agencies: documents since 1994", sum(T("federal-register")["yearly"]["ALL"].values()), "sum of fr/facets/yearly/ALL.json",
      sum(v["count"] for v in raw("fr/facets/yearly/ALL.json").values()))
sig_epa = set()
for year in range(1994, 2027):
    for d in raw(f"fr/significant/RULE_{year}_p1.json").get("results", []):
        if any(a.get("id") == 145 for a in d.get("agencies") or []):
            sig_epa.add(d["html_url"])
check("EPA significant final rules since 1994", P("145")["stats"]["significantRules"], "fr/significant/RULE_<year>_p1.json listing EPA (id 145)", len(sig_epa))
comments = raw("fr/comments/open_2026-10-19_p1.json")["results"] + raw("fr/comments/open_2026-10-19_p2.json")["results"]
check("EPA open comment periods", P("145")["stats"]["openComments"], "fr/comments/open_2026-10-19_p*.json listing EPA",
      sum(1 for d in comments if any(a.get("id") == 145 for a in d.get("agencies") or [])))
check("All agencies: open comment periods", T("federal-register")["openComments"]["count"], "fr/comments/open_2026-10-19_p1.json count",
      raw("fr/comments/open_2026-10-19_p1.json")["count"])
eos = raw("fr/eo/executive_orders_p1.json")["results"] + raw("fr/eo/executive_orders_p2.json")["results"]
admin = {a["key"]: a for a in T("federal-register")["byAdministration"]}
check("Executive orders signed since 2025-01-20", admin["trump2"]["executiveOrders"], "fr/eo/executive_orders_p*.json signing_date >= 2025-01-20",
      sum(1 for d in eos if (d.get("signing_date") or "") >= "2025-01-20"))
check("All agencies: final rules, Biden window", admin["biden"]["RULE"], "fr/facets/type_admin/biden_2021-01-20.json[RULE]",
      raw("fr/facets/type_admin/biden_2021-01-20.json")["RULE"]["count"])
with open(os.path.join(ACQ, "reginfo/REGINFO_RIN_DATA_202510.xml.gz"), "rb") as fh:
    ua = ET.fromstring(gzip.decompress(fh.read()))
ua_rows = ua.findall("RIN_INFO")
check("Unified Agenda actions (all)", T("federal-register")["agenda"]["total"], "REGINFO_RIN_DATA_202510.xml RIN_INFO count", len(ua_rows))
epa_ua = [r for r in ua_rows if (r.findtext("PARENT_AGENCY/NAME") or r.findtext("AGENCY/NAME")) == "Environmental Protection Agency"]
check("EPA Unified Agenda actions", P("145")["stats"]["agendaActions"], "XML entries whose parent (or own) agency is EPA", len(epa_ua))
check("EPA economically significant actions", P("145")["stats"]["agendaEconomicallySignificant"], "same entries, PRIORITY_CATEGORY",
      sum(1 for r in epa_ua if r.findtext("PRIORITY_CATEGORY") == "Economically Significant"))
b068 = {y["fiscal_year"]: y for y in raw("usaspending/budget/068.json")["agency_data_by_year"]}
check("EPA FY2025 obligations", P("145")["stats"]["obligationsLatestFy"], "usaspending/budget/068.json FY2025 agency_total_obligated", b068[2025]["agency_total_obligated"])
check("EPA FY2025 budgetary resources", P("145")["stats"]["budgetaryResourcesLatestFy"], "usaspending/budget/068.json FY2025 agency_budgetary_resources", b068[2025]["agency_budgetary_resources"])
b075 = {y["fiscal_year"]: y for y in raw("usaspending/budget/075.json")["agency_data_by_year"]}
check("HHS FY2025 obligations", P("221")["stats"]["obligationsLatestFy"], "usaspending/budget/075.json FY2025", b075[2025]["agency_total_obligated"])
geo = {r["shape_code"]: r["aggregated_amount"] for r in raw("usaspending/geo/068_fy2025.json")["results"]}
va = next(s for s in spending["068"]["item"]["spending"]["states"] if s["code"] == "VA")
check("EPA FY2025 obligations, Virginia", va["fy2025"], "usaspending/geo/068_fy2025.json[VA]", round(geo["VA"], 2))
with open(os.path.join(ACQ, "census/NST-EST2025-ALLDATA.csv"), encoding="latin-1", newline="") as fh:
    pop = {r["NAME"]: int(r["POPESTIMATE2025"]) for r in csv.DictReader(fh) if r["SUMLEV"] == "040"}
check("Virginia population July 1, 2025", va["population2025"], "census NST-EST2025-ALLDATA.csv Virginia POPESTIMATE2025", pop["Virginia"])
check("EPA FY2025 obligations per Virginia resident", va["perResident"], "geo[VA] / population", round(geo["VA"] / pop["Virginia"], 2))
lookup = json.load(open(os.path.join(OUT, "lookups", "fr_cfr_pairs_by_agency.json"), encoding="utf-8"))["rows"]
epa_pairs = next(r["pairs"] for r in lookup if r["agency"] == "145").split(";")
first = epa_pairs[0].split(",")
check("EPA most-cited CFR part (documents)", P("145")["cfrParts"]["top"][0]["docs"], f"corpus lookup first pair {first[0]}", int(first[1]))
check("EPA 40 CFR 52 documents, second path", P("145")["cfrParts"]["top"][0]["docs"],
      "read-only SQL on corpus_records (agency 145, Rule/Proposed Rule, cfr_pair 40:52) = 14744", 14744)
ecfr = next(a for a in raw("ecfr/agencies.json")["agencies"] if a["slug"] == "environmental-protection-agency")
check("EPA eCFR chapters", sorted(f"{r['title']}:{r.get('chapter')}" for r in P("145")["ecfr"]["refs"]), "ecfr/agencies.json cfr_references",
      sorted(f"{r['title']}:{r.get('chapter')}" for r in ecfr["cfr_references"]))
fr_agencies = {a["id"]: a for a in raw("fr/agencies.json")}
check("FDA parent agency", P("199")["parent"]["id"], "fr/agencies.json id 199 parent_id", fr_agencies[199]["parent_id"])
subs = raw("usaspending/sub_agency/075_fy2025_p1.json")["results"]
check("FDA FY2025 sub-agency obligations", P("199")["subtierObligations"]["obligations"], "usaspending/sub_agency/075_fy2025_p1.json Food and Drug Administration",
      next(s["total_obligations"] for s in subs if s["name"] == "Food and Drug Administration"))

print("| # | Figure | Shown | Source location | Source value | Match |")
print("|---|---|---|---|---|---|")
for i, (label, shown, where, value, ok) in enumerate(rows, 1):
    print(f"| {i} | {label} | {shown} | {where} | {value} | {ok} |")
print(json.dumps({"checks": len(rows), "mismatches": sum(1 for r in rows if r[4] != "yes")}))
