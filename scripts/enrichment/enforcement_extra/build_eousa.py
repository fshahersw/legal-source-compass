"""EOUSA National Caseload Data, FY2025 annual release (ANNUAL DATA.ZIP + DISK28 code tables) -> eousa_caseload_annual.

What the release's README says each file is (quoted in the dataset summary):
  deliverable 4   counters by lead charge x program category (criminal matters received/pending/closed; cases filed
                  this FY and received this FY, filed this FY but received earlier, pending, closed; defendants)
  deliverable 7   lead charge and program category details with district and case ID
  deliverable 10  public cases not under seal with a Business (B) or Property (P) participant type
  deliverable 15  cumulative number of sealed cases, 1999 to present
  deliverable 16  "Government is Defendant" cases
Every row of the FY2025 files carries FY 2025 (deliverable 10 also lists some earlier years); the release holds no
FY2004-FY2024 series. Only counts are published: no case name, participant name, address or case ID.

  python3 -I -B build_eousa.py
"""
from __future__ import annotations

import collections
import csv
import json
import os
import sys
import zipfile

from common import ACQ, LOOKUPS, compact, latest_manifest, with_source, write_build
from eousa import charge_title, code_tables, count, court_id_for, open_text, read_rows

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import corpus_writer as writer  # noqa: E402

DATASET = "eousa_caseload_annual"
ANNUAL = os.path.join(ACQ, "eousa", "FY2025_ANNUAL_DATA.ZIP")
LOOKUP = os.path.join(ACQ, "eousa", "FY2025_DISK28.ZIP")
PAGE = "https://www.justice.gov/usao/resources/foia-library/national-caseload-data/2025"
ANNUAL_URL = "https://media.justice.gov/video/usao/data/YearPrevious2025/ANNUAL%20DATA.ZIP"
D4C = "deliverable_4_annual_cases_counters_defendant_by_lead_charge_prog_cat.csv"
D4M = "deliverable_4_annual_matters_counters_suspects_by_lead_charge_prog_cat.csv"
D7 = "deliverable_7_annual_combined_details_by_program_category_and_lead_charge.csv"
D10 = "deliverable_10_annual_details.csv"
D15 = "deliverable_15_annual_details.csv"
D16 = "deliverable_16_paragraph_25c_annual_cumulative.csv"
TOP = 15


def known_courts() -> set[str]:
    p = os.path.join(LOOKUPS, "court_spine_districts.json")
    with open(p, encoding="utf-8") as f:
        return set(json.load(f)["ids"])


def top(counter: collections.Counter, n: int = TOP) -> list[tuple[str, int]]:
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def build() -> str:
    courts = known_courts()
    with zipfile.ZipFile(LOOKUP) as z:
        tables = code_tables(z.read("global_LIONS.txt").decode("latin-1"))
        readme_lookup = z.read("README.txt").decode("latin-1")
    with zipfile.ZipFile(ANNUAL) as z:
        readme = z.read("README.txt").decode("latin-1")
        prog = tables.get("GS_PROG_CAT", {})
        master = tables.get("GS_PROG_CAT_MASTER", {})
        charges = tables.get("GS_CHARGE_TYPE", {})
        districts = tables.get("GS_DISTRICT", {})

        def prog_label(code: str) -> str:
            return prog.get(code, {}).get("description") or "Not in the GS_PROG_CAT table"

        def master_of(code: str) -> str:
            m = prog.get(code, {}).get("master")
            return m if m else "Not recorded"

        def master_label(m: str) -> str:
            return master.get(m, {}).get("description") or m

        # deliverable 7: per district lead charge / program category records
        d7 = collections.defaultdict(lambda: {"records": 0, "master": collections.Counter(), "prog": collections.Counter(),
                                              "title": collections.Counter(), "charge": collections.Counter(), "fy": collections.Counter()})
        d7_total = 0
        for _, row in read_rows(open_text(z, D7), 3, 2):
            fy, dist, _cid, lc, pc = row[0], row[1].strip(), row[2], row[3].strip(), row[4].strip()
            u = d7[dist]
            u["records"] += 1
            u["fy"][fy] += 1
            u["master"][master_of(pc)] += 1
            u["prog"][pc] += 1
            u["title"][charge_title(lc) or "Not a U.S. Code title"] += 1
            u["charge"][lc or "Not recorded"] += 1
            d7_total += 1
        # deliverables 16 and 10: distinct cases per district (first three columns are fixed)
        gov_def = collections.defaultdict(lambda: {"cases": set(), "rows": 0})
        busprop = collections.defaultdict(lambda: {"civil": set(), "criminal": set(), "rows": 0, "fy": collections.Counter()})
        r16 = csv.reader(open_text(z, D16))
        next(r16)
        for row in r16:
            if len(row) >= 3:
                gov_def[row[1].strip()]["cases"].add(row[2])
                gov_def[row[1].strip()]["rows"] += 1
        r10 = csv.reader(open_text(z, D10))
        next(r10)
        for row in r10:
            if len(row) >= 3:
                u = busprop[row[1].strip()]
                (u["civil"] if row[2][4:5] == "V" else u["criminal"]).add(row[2])
                u["rows"] += 1
                u["fy"][row[0]] += 1
        # deliverable 4 (national) and 15
        cases_counters = collections.defaultdict(collections.Counter)
        for header, row in read_rows(open_text(z, D4C), 1, 9):
            pc = row[2].strip() if len(row) == len(header) else row[-9]
            vals = row[-8:]
            for k, v in zip(header[-8:], vals):
                cases_counters[master_of(row[-9].strip())][k] += count(v)
        matter_counters = collections.defaultdict(collections.Counter)
        for header, row in read_rows(open_text(z, D4M), 1, 7):
            for k, v in zip(header[-6:], row[-6:]):
                matter_counters[master_of(row[-7].strip())][k] += count(v)
        sealed = [{"fy": int(r[0]), "sealed_cases": int(r[1])} for r in list(csv.reader(open_text(z, D15)))[1:] if len(r) == 2 and r[0].isdigit()]

    entry = latest_manifest("acq/enforcement_extra/eousa/FY2025_ANNUAL_DATA.ZIP")
    lentry = latest_manifest("acq/enforcement_extra/eousa/FY2025_DISK28.ZIP")
    rows = []
    unlinked = []
    all_districts = sorted(set(d7) | set(gov_def) | set(busprop))
    for dist in all_districts:
        cid = court_id_for(dist, courts)
        if not cid:
            unlinked.append(dist)
        name = districts.get(dist, {}).get("description") or dist
        u7 = d7.get(dist)
        g = gov_def.get(dist)
        b = busprop.get(dist)
        criminal = None
        if u7:
            criminal = {
                "records": u7["records"],
                "by_program_master": [{"code": m, "label": master_label(m), "records": n} for m, n in top(u7["master"], 40)],
                "top_program_categories": [{"code": c, "label": prog_label(c), "records": n} for c, n in top(u7["prog"])],
                "top_usc_titles": [{"title": t, "records": n} for t, n in top(u7["title"], 10)],
                "top_lead_charges": [{"code": c, "label": charges.get(c, {}).get("description") or "Not in the GS_CHARGE_TYPE table", "records": n}
                                     for c, n in top(u7["charge"])],
            }
        civil_gov = {"cases": len(g["cases"]), "participant_rows": g["rows"]} if g else None
        bp = {"civil_cases": len(b["civil"]), "criminal_cases": len(b["criminal"]), "participant_rows": b["rows"]} if b else None
        profile = {"fy": 2025, "district_code": dist, "district_name": name, "court_id": cid,
                   "criminal_lead_charge_records": criminal, "government_defendant_civil": civil_gov, "business_property": bp}
        top_master = criminal["by_program_master"][:3] if criminal else []
        title = f"U.S. Attorney's Office, {name.title()}: FY2025 caseload release counts"
        facts = [
            ["District (EOUSA code)", f"{name} ({dist})"],
            ["Release", "EOUSA National Caseload Data, FY2025 annual release (ANNUAL DATA.ZIP, updated November 24, 2025)"],
            ["Criminal matter/case records with a lead charge and program category (deliverable 7)", f"{criminal['records']:,}" if criminal else "Not recorded"],
            ["Largest program groups", "; ".join(f"{m['label'].title()} {m['records']:,}" for m in top_master) if top_master else "Not recorded"],
            ["Civil cases with the Government as defendant (deliverable 16, distinct case IDs)", f"{civil_gov['cases']:,}" if civil_gov else "Not recorded"],
            ["Public cases with a business or property participant (deliverable 10, distinct case IDs)",
             f"{bp['civil_cases']:,} civil, {bp['criminal_cases']:,} criminal" if bp else "Not recorded"],
            ["Source", "Executive Office for United States Attorneys (DOJ), National Caseload Data FY2025"],
        ]
        links = [{"url": f"/courts/{cid}", "label": "District court profile"}] if cid else []
        cells = compact({"district": name, "code": dist, "court_id": cid, "criminal_records": criminal["records"] if criminal else None,
                         "gov_defendant_cases": civil_gov["cases"] if civil_gov else None,
                         "top_program": top_master[0]["label"].title() if top_master else None})
        filters = {"scope": ["district"]}
        if cid:
            filters["court"] = [cid]
        rows.append(writer.record(DATASET, f"eousa:2025:{cid or dist.lower()}", title, source_url=PAGE, cells=cells, facts=facts,
                                  text=f"{name} U.S. Attorney criminal program categories lead charges", filters=filters,
                                  subtitle=f"{criminal['records']:,} criminal lead-charge records" if criminal else "No criminal lead-charge records",
                                  links=links, extra={"profile": profile}))
    national = {
        "fy": 2025,
        "lead_charge_records_total": d7_total,
        "cases_counters_by_program_master": [{"code": m, "label": master_label(m), **dict(c)} for m, c in sorted(cases_counters.items(), key=lambda kv: -sum(kv[1].values()))],
        "matters_counters_by_program_master": [{"code": m, "label": master_label(m), **dict(c)} for m, c in sorted(matter_counters.items(), key=lambda kv: -sum(kv[1].values()))],
        "sealed_cases_by_fy": sealed,
        "government_defendant_cases": sum(len(g["cases"]) for g in gov_def.values()),
    }
    totals_cases = collections.Counter()
    for c in cases_counters.values():
        totals_cases.update(c)
    totals_matters = collections.Counter()
    for c in matter_counters.values():
        totals_matters.update(c)
    facts = [
        ["Release", "EOUSA National Caseload Data, FY2025 annual release"],
        ["Criminal lead-charge/program-category records (deliverable 7)", f"{d7_total:,}"],
        ["Deliverable 4 case counters, FY2025 (sum over lead charge x program category)", "; ".join(f"{k} {v:,}" for k, v in sorted(totals_cases.items()))],
        ["Deliverable 4 matter counters, FY2025", "; ".join(f"{k} {v:,}" for k, v in sorted(totals_matters.items()))],
        ["Sealed cases (deliverable 15), latest FY", f"FY{sealed[-1]['fy']}: {sealed[-1]['sealed_cases']:,}" if sealed else "Not recorded"],
        ["Source", "Executive Office for United States Attorneys (DOJ), National Caseload Data FY2025"],
    ]
    rows.append(writer.record(DATASET, "eousa:2025:national", "U.S. Attorneys' offices: FY2025 caseload release counts (national)", source_url=PAGE,
                              cells={"district": "All districts", "criminal_records": d7_total, "gov_defendant_cases": national["government_defendant_cases"]},
                              facts=facts, text="U.S. Attorneys national caseload release counts", filters={"scope": ["national"]},
                              subtitle=f"{d7_total:,} criminal lead-charge records", links=[], extra={"profile": national}))
    rows = [with_source(r) for r in rows]
    rows.sort(key=lambda r: r["id"])
    summary = {
        "source": {"publisher": "U.S. Department of Justice, Executive Office for United States Attorneys", "page": PAGE,
                   "file": ANNUAL_URL, "sha256": entry and entry["sha256"], "lookup_file": "https://media.justice.gov/video/usao/data/YearPrevious2025/DISK28.ZIP",
                   "lookup_sha256": lentry and lentry["sha256"],
                   "terms": "DOJ public domain (https://www.justice.gov/legalpolicies); released under 5 U.S.C. 552(a)(2)(D)."},
        "readme": readme.strip(),
        "lookup_readme_excerpt": readme_lookup.strip()[:1500],
        "coverage": "FY2025 only: every row of the FY2025 ANNUAL DATA files carries fiscal year 2025 (deliverable 10 also lists cases with earlier fiscal years). No earlier annual release of these files is published on the FY pages checked (YearPrevious2005-2024 ANNUAL DATA.ZIP return 404).",
        "caution": "The deliverables are EOUSA's FOIA 'TRAC deliverables'; their population is defined only by the README text quoted here. They are not the Annual Statistical Report's caseload totals and should not be read as all matters or cases handled.",
        "national": national,
        "districts_without_court_link": unlinked,
        "notes": ["Program-category and charge labels come from the GS_PROG_CAT, GS_PROG_CAT_MASTER and GS_CHARGE_TYPE tables on DISK28 of the same release.",
                  "Lead-charge codes split by an unquoted comma in the CSV are re-joined (deliverable 4 and 7 rows are read from both ends).",
                  "Case IDs, case names and participant names in deliverables 7, 10 and 16 are counted only, never stored."],
    }
    listing_block = writer.listing([("district", "District"), ("criminal_records", "Criminal lead-charge records"),
                                    ("top_program", "Largest program group"), ("gov_defendant_cases", "Government-defendant civil cases")],
                                   [("scope", "Scope", {"district": "District", "national": "National"})])
    inputs = [{"url": ANNUAL_URL, "path": entry["path"], "sha256": entry["sha256"]},
              {"url": summary["source"]["lookup_file"], "path": lentry["path"], "sha256": lentry["sha256"]}]
    out = write_build(DATASET, "U.S. Attorneys' caseload release counts by district (EOUSA, FY2025)", rows, listing_block, summary, inputs)
    print(json.dumps({"dataset": DATASET, "records": len(rows), "unlinked": unlinked, "lead_charge_records": d7_total,
                      "cases_counters": dict(totals_cases), "matter_counters": dict(totals_matters)}))
    return out


if __name__ == "__main__":
    build()
