"""Independent verification of the agencies_fr build files.

Two kinds of checks, each counted as pass/fail:
  raw   re-derive stored values from the raw files with separate code (no builder or parsers import)
  live  second path: different Federal Register API queries for a sample of agencies (per-agency yearly facets,
        filtered listing counts), stored under private/acq/agencies_fr/verify/ with the manifest

Usage: python3 -I -B scripts/enrichment/agencies_fr/verify_agencies_fr.py [--no-live] [--as-of=2026-10-19]
Writes private/build/agencies_fr/verify_report.json and prints the failure count.
"""
import collections
import csv
import glob
import gzip
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch import fetch_json  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "agencies_fr")
OUT = os.path.join(ROOT, "private", "build", "agencies_fr")
FR = "https://www.federalregister.gov/api/v1/"
SAMPLE = ["food-and-drug-administration", "environmental-protection-agency", "consumer-product-safety-commission",
          "national-highway-traffic-safety-administration", "occupational-safety-and-health-administration",
          "securities-and-exchange-commission", "federal-trade-commission", "consumer-financial-protection-bureau",
          "health-and-human-services-department", "transportation-department", "federal-aviation-administration",
          "fish-and-wildlife-service", "coast-guard", "drug-enforcement-administration", "national-labor-relations-board"]

results = collections.defaultdict(lambda: {"pass": 0, "fail": 0, "failures": []})


def check(group, ok, detail):
    r = results[group]
    if ok:
        r["pass"] += 1
    else:
        r["fail"] += 1
        if len(r["failures"]) < 25:
            r["failures"].append(detail)


def load_build(ds):
    with open(os.path.join(OUT, f"{ds}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def raw(rel):
    with open(os.path.join(ACQ, rel), encoding="utf-8") as fh:
        return json.load(fh)


def verify_trends(trends_rows, agencies):
    slug_to_id = {a["slug"]: a["id"] for a in agencies}
    expected = collections.defaultdict(dict)
    for p in glob.glob(os.path.join(ACQ, "fr/facets/agency_year/*.json")):
        m = re.match(r"(ALL|RULE|PRORULE|NOTICE|PRESDOCU)_(\d{4})\.json$", os.path.basename(p))
        body = json.load(open(p, encoding="utf-8"))
        for slug, v in body.items():
            if slug in slug_to_id and isinstance(v, dict) and isinstance(v.get("count"), int):
                expected[slug_to_id[slug]][(m.group(1), m.group(2))] = v["count"]
    by_id = {r["id"]: r["item"]["trends"] for r in trends_rows}
    for fid, cells in expected.items():
        t = by_id.get(str(fid))
        if t is None:
            check("raw.trends.yearly", False, f"agency {fid} missing from trends")
            continue
        for (typ, year), n in cells.items():
            got = t["yearly"][typ].get(year)
            check("raw.trends.yearly", got == n, f"{fid} {typ} {year}: stored {got} raw {n}")
    # significant totals re-derived from the listings by document agency ids
    sig = collections.defaultdict(set)
    for p in glob.glob(os.path.join(ACQ, "fr/significant/RULE_*.json")):
        for d in json.load(open(p, encoding="utf-8")).get("results", []):
            for a in d.get("agencies") or []:
                if isinstance(a, dict) and isinstance(a.get("id"), int):
                    sig[a["id"]].add(d.get("html_url") or (d.get("document_number"), d.get("publication_date")))
    for fid, t in by_id.items():
        if fid == "federal-register":
            continue
        check("raw.trends.significant", t["significantTotals"]["RULE"] == len(sig.get(int(fid), ())),
              f"{fid}: stored {t['significantTotals']['RULE']} raw {len(sig.get(int(fid), ()))}")
    return by_id


def verify_live(by_id, agencies, as_of):
    slug_to_id = {a["slug"]: a["id"] for a in agencies}
    method = "federalregister.gov API v1, verification query (second path)"
    for slug in SAMPLE:
        fid = str(slug_to_id[slug])
        t = by_id.get(fid)
        for typ in ("RULE", "PRORULE", "NOTICE"):
            q = urllib.parse.urlencode({"conditions[agencies][]": slug, "conditions[type][]": typ})
            body = fetch_json(f"{FR}documents/facets/yearly?{q}", f"verify/yearly_{slug}_{typ}.json", method)
            series = {k[:4]: v["count"] for k, v in body.items() if isinstance(v, dict)}
            for year, n in series.items():
                if year < "1994":
                    continue
                got = t["yearly"][typ].get(year, 0) if t else None
                check("live.yearly_per_agency_facet", got == n, f"{slug} {typ} {year}: stored {got} live {n}")
        q = urllib.parse.urlencode({"conditions[agencies][]": slug, "conditions[type][]": "RULE",
                                    "conditions[significant]": "1", "per_page": "1", "fields[]": "document_number"})
        body = fetch_json(f"{FR}documents.json?{q}", f"verify/significant_{slug}.json", method)
        got = t["significantTotals"]["RULE"] if t else None
        check("live.significant_listing_count", got == body.get("count"), f"{slug}: stored {got} live {body.get('count')}")
        q = urllib.parse.urlencode({"conditions[agencies][]": slug, "conditions[comment_date][gte]": as_of,
                                    "per_page": "1", "fields[]": "document_number"})
        body = fetch_json(f"{FR}documents.json?{q}", f"verify/comments_{slug}_{as_of}.json", method)
        got = t["openComments"]["count"] if t else None
        check("live.open_comment_count", got == body.get("count"), f"{slug}: stored {got} live {body.get('count')}")


def verify_profiles(rows, agencies):
    by_id = {str(a["id"]): a for a in agencies}
    check("raw.profiles.count", len(rows) == len(agencies), f"{len(rows)} rows vs {len(agencies)} agencies")
    for r in rows:
        p = r["item"]["profile"]
        a = by_id.get(r["id"])
        if not a:
            check("raw.profiles.hierarchy", False, f"{r['id']} not in directory")
            continue
        check("raw.profiles.hierarchy", (p["parent"] or {}).get("id") == a.get("parent_id"), f"{r['id']} parent")
        kids = sorted(c for c in a.get("child_ids") or [] if str(c) in by_id)
        check("raw.profiles.hierarchy", sorted(c["id"] for c in p["children"]) == kids, f"{r['id']} children")
        check("raw.profiles.name", p["name"] == a["name"] and r["title"] == a["name"], f"{r['id']} name")
    # CFR parts: re-derive the top part per agency from the lookup with separate parsing
    lookup = json.load(open(os.path.join(OUT, "lookups", "fr_cfr_pairs_by_agency.json"), encoding="utf-8"))
    best = {}
    for row in lookup["rows"]:
        entries = [c.split(",") for c in row["pairs"].split(";") if c.count(",") == 4]
        entries = [(int(e[1]), e[0]) for e in entries if e[1].isdigit()]
        if entries:
            top_n = max(n for n, _ in entries)
            best[row["agency"]] = (top_n, {k for n, k in entries if n == top_n})
    for r in rows:
        cp = r["item"]["profile"]["cfrParts"]
        if r["id"] in best:
            n, keys = best[r["id"]]
            first = cp["top"][0] if cp and cp["top"] else None
            ok = first is not None and first["docs"] == n and f"{first['title']}:{first['part']}" in keys
            check("raw.profiles.cfr_top_part", ok, f"{r['id']}: stored {first} raw {n} {sorted(keys)[:3]}")


def verify_agenda(rows):
    with open(os.path.join(ACQ, "reginfo/REGINFO_RIN_DATA_202510.xml.gz"), "rb") as fh:
        data = gzip.decompress(fh.read())
    expected = {}
    for _, el in ET.iterparse(__import__("io").BytesIO(data)):
        if el.tag == "RIN_INFO":
            rin = (el.findtext("RIN") or "").strip()
            expected[rin] = {"stage": (el.findtext("RULE_STAGE") or "").strip(),
                             "priority": (el.findtext("PRIORITY_CATEGORY") or "").strip(),
                             "title": re.sub(r"\s+", " ", el.findtext("RULE_TITLE") or "").strip(),
                             "agency": (el.findtext("AGENCY/NAME") or "").strip()}
            el.clear()
    stored = {r["id"]: r["item"]["agenda"] for r in rows}
    check("raw.agenda.rin_set", set(stored) == set(expected), f"{len(set(expected) ^ set(stored))} RINs differ")
    for rin, e in expected.items():
        s = stored.get(rin)
        if not s:
            continue
        ok = s["stage"] == (e["stage"] or "Not recorded") and s["priority"] == (e["priority"] or "Not recorded") \
            and s["title"] == e["title"] and s["agency"]["name"] == e["agency"]
        check("raw.agenda.fields", ok, f"{rin}")


def verify_budget(rows):
    for r in rows:
        b = r["item"]["budget"]
        body = raw(f"usaspending/budget/{b['toptierCode']}.json")
        by_fy = {y["fiscal_year"]: y for y in body.get("agency_data_by_year", [])}
        for y in b["years"]:
            src = by_fy.get(y["fy"]) or {}
            ok = y["budgetaryResources"] == src.get("agency_budgetary_resources") and y["obligated"] == src.get("agency_total_obligated") \
                and y["outlayed"] == src.get("agency_total_outlayed")
            check("raw.budget.values", ok, f"{b['toptierCode']} FY{y['fy']}")
            if y["sharePct"] is not None:
                share = 100 * src["agency_budgetary_resources"] / src["total_budgetary_resources"]
                check("raw.budget.share", abs(share - y["sharePct"]) < 0.0006, f"{b['toptierCode']} FY{y['fy']} share")


def verify_spending(rows):
    pop = {}
    fips = {}
    with open(os.path.join(ACQ, "census/NST-EST2025-ALLDATA.csv"), encoding="latin-1", newline="") as fh:
        for row in csv.DictReader(fh):
            if row["SUMLEV"] == "040":
                fips[row["NAME"]] = int(row["POPESTIMATE2025"])
    for r in rows:
        s = r["item"]["spending"]
        body = raw(f"usaspending/geo/{s['toptierCode']}_fy2025.json")
        src = {x["shape_code"]: x["aggregated_amount"] for x in body.get("results", [])}
        total = sum(v for v in src.values() if isinstance(v, (int, float)))
        check("raw.spending.total", abs(total - s["total"]) < 0.02, f"{s['toptierCode']} total")
        for st in s["states"]:
            check("raw.spending.amount", abs(src.get(st["code"], 0) - st["fy2025"]) < 0.01, f"{s['toptierCode']} {st['code']}")
            people = fips.get(st["name"])
            if st["perResident"] is not None:
                check("raw.spending.per_resident", people is not None and abs(st["fy2025"] / people - st["perResident"]) < 0.006,
                      f"{s['toptierCode']} {st['code']} per resident")
            else:
                check("raw.spending.per_resident_not_recorded", people is None, f"{s['toptierCode']} {st['code']} has population")


def main(argv):
    as_of = next((a.split("=", 1)[1] for a in argv if a.startswith("--as-of=")), "2026-10-19")
    agencies = [a for a in raw("fr/agencies.json") if isinstance(a.get("id"), int)]
    trends = load_build("fr_agency_trends")
    by_id = verify_trends(trends["rows"], agencies)
    if "--no-live" not in argv:
        verify_live(by_id, agencies, as_of)
    verify_profiles(load_build("fr_agency_profiles")["rows"], agencies)
    verify_agenda(load_build("unified_agenda_pipeline")["rows"])
    verify_budget(load_build("agency_budget_trends")["rows"])
    verify_spending(load_build("agency_spending_by_state")["rows"])
    report = {k: v for k, v in sorted(results.items())}
    failures = sum(v["fail"] for v in report.values())
    checks = sum(v["pass"] + v["fail"] for v in report.values())
    with open(os.path.join(OUT, "verify_report.json"), "w", encoding="utf-8") as fh:
        json.dump({"checks": checks, "failures": failures, "groups": report}, fh, indent=1)
    for k, v in report.items():
        print(f"{k}: pass {v['pass']} fail {v['fail']}" + (f"  e.g. {v['failures'][:3]}" if v["fail"] else ""))
    print(json.dumps({"checks": checks, "failures": failures}))


if __name__ == "__main__":
    main(sys.argv[1:])
