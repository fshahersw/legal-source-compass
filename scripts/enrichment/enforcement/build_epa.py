"""Build EPA ECHO enforcement datasets from the official ICIS-FE&C case downloads.

Inputs (unchanged raw files): private/acq/enforcement/case_downloads.zip (extracted to private/acq/enforcement/echo/)
and private/acq/enforcement/NST-EST2025-ALLDATA.csv (Census Vintage 2025 state population).

Publishes:
  regulatory_epa_state_profiles  one record per state/territory with FY series, statute mix, top defendants (+ national)
  regulatory_epa_cases           record-level cases, case FY2017 onward with federal penalty >= $100,000

Usage: python3 scripts/enrichment/enforcement/build_epa.py [--dry-run]
"""
import collections
import csv
import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
from parsing import (  # noqa: E402
    ACTIVITY_TYPES,
    STATUTE_NAMES,
    case_states,
    clean_text,
    defendant_key,
    fiscal_year,
    money,
    primary_statute,
    us_date,
)

def record(*args, facts, **kwargs):
    """corpus_writer.record with facts given as {label, value} dicts; the entity view reads [label, value] pairs."""
    return writer.record(*args, facts=[[f["label"], "Not recorded" if f["value"] is None else str(f["value"])] for f in facts], **kwargs)


ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement")
ECHO_DIR = os.path.join(ACQ, "echo")
ZIP = os.path.join(ACQ, "case_downloads.zip")
ZIP_URL = "https://echo.epa.gov/files/echodownloads/case_downloads.zip"
DICT_URL = "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary"
CENSUS_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
CASE_URL = "https://echo.epa.gov/enforcement-case-report?id={}"
CASE_MIN_FY = 2017
CASE_MIN_PENALTY = 100_000
POP_YEAR = 2025

STATES = {
    "AL": ("01", "Alabama"), "AK": ("02", "Alaska"), "AZ": ("04", "Arizona"), "AR": ("05", "Arkansas"),
    "CA": ("06", "California"), "CO": ("08", "Colorado"), "CT": ("09", "Connecticut"), "DE": ("10", "Delaware"),
    "DC": ("11", "District of Columbia"), "FL": ("12", "Florida"), "GA": ("13", "Georgia"), "HI": ("15", "Hawaii"),
    "ID": ("16", "Idaho"), "IL": ("17", "Illinois"), "IN": ("18", "Indiana"), "IA": ("19", "Iowa"),
    "KS": ("20", "Kansas"), "KY": ("21", "Kentucky"), "LA": ("22", "Louisiana"), "ME": ("23", "Maine"),
    "MD": ("24", "Maryland"), "MA": ("25", "Massachusetts"), "MI": ("26", "Michigan"), "MN": ("27", "Minnesota"),
    "MS": ("28", "Mississippi"), "MO": ("29", "Missouri"), "MT": ("30", "Montana"), "NE": ("31", "Nebraska"),
    "NV": ("32", "Nevada"), "NH": ("33", "New Hampshire"), "NJ": ("34", "New Jersey"), "NM": ("35", "New Mexico"),
    "NY": ("36", "New York"), "NC": ("37", "North Carolina"), "ND": ("38", "North Dakota"), "OH": ("39", "Ohio"),
    "OK": ("40", "Oklahoma"), "OR": ("41", "Oregon"), "PA": ("42", "Pennsylvania"), "RI": ("44", "Rhode Island"),
    "SC": ("45", "South Carolina"), "SD": ("46", "South Dakota"), "TN": ("47", "Tennessee"), "TX": ("48", "Texas"),
    "UT": ("49", "Utah"), "VT": ("50", "Vermont"), "VA": ("51", "Virginia"), "WA": ("53", "Washington"),
    "WV": ("54", "West Virginia"), "WI": ("55", "Wisconsin"), "WY": ("56", "Wyoming"),
}
TERRITORIES = {
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands", "GU": "Guam", "AS": "American Samoa",
    "MP": "Northern Mariana Islands", "UM": "U.S. Minor Outlying Islands", "FM": "Federated States of Micronesia",
    "MH": "Marshall Islands", "PW": "Palau",
}
MONEY_KEYS = ["fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "fed_cost_recovery", "st_cost_recovery", "collected"]


def read(name):
    with open(os.path.join(ECHO_DIR, name), newline="", encoding="utf-8", errors="replace") as handle:
        yield from csv.DictReader(handle)


def zip_dates():
    with zipfile.ZipFile(ZIP) as archive:
        return {info.filename: "%04d-%02d-%02d" % info.date_time[:3] for info in archive.infolist()}


def population():
    by_fips = {fips: usps for usps, (fips, _) in STATES.items()}
    by_fips["72"] = "PR"
    out = {}
    with open(os.path.join(ACQ, "NST-EST2025-ALLDATA.csv"), newline="", encoding="latin-1") as handle:
        for row in csv.DictReader(handle):
            if row["SUMLEV"] == "040" and row["STATE"].zfill(2) in by_fips:
                out[by_fips[row["STATE"].zfill(2)]] = int(row[f"POPESTIMATE{POP_YEAR}"])
    return out


def load_cases():
    cases = {}
    for row in read("CASE_ENFORCEMENTS.csv"):
        aid = row["ACTIVITY_ID"].strip()
        cases[aid] = {
            "activity_id": aid,
            "case_number": row["CASE_NUMBER"].strip(),
            "name": clean_text(row["CASE_NAME"]) or clean_text(row["ACTIVITY_NAME"]),
            "type_code": row["ACTIVITY_TYPE_CODE"].strip(),
            "type": ACTIVITY_TYPES.get(row["ACTIVITY_TYPE_CODE"].strip(), clean_text(row["ACTIVITY_TYPE_DESC"]) or None),
            "fy": fiscal_year(row["FISCAL_YEAR"]),
            "region": row["REGION_CODE"].strip() or None,
            "status": clean_text(row["ACTIVITY_STATUS_DESC"]) or None,
            "status_date": us_date(row["ACTIVITY_STATUS_DATE"]),
            "case_status_date": us_date(row["CASE_STATUS_DATE"]),
            "outcome": clean_text(row["ENF_OUTCOME_DESC"]) or None,
            "doj_docket": clean_text(row["DOJ_DOCKET_NMBR"]) or None,
            "hq_division": row["HQ_DIVISION"].strip() or None,
            "voluntary_disclosure": row["VOLUNTARY_SELF_DISCLOSURE_FLAG"].strip() == "Y",
            "multimedia": row["MULTIMEDIA_FLAG"].strip() == "Y",
            "summary": clean_text(row["ENF_SUMMARY_TEXT"])[:1500] or None,
            "lead": row["LEAD"].strip() or None,
            "penalties": None,
            "sections": [],
            "defendants": [],
            "facilities": [],
            "programs": [],
            "settlements": [],
        }
    for row in read("CASE_PENALTIES.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        if case:
            case["penalties"] = {
                "fed_penalty": money(row["FED_PENALTY"]),
                "st_lcl_penalty": money(row["ST_LCL_PENALTY"]),
                "sep": money(row["TOTAL_SEP"]),
                "compliance_cost": money(row["COMPLIANCE_ACTION_COST"]),
                "fed_cost_recovery": money(row["FEDERAL_COST_RECOVERY_AMT"]),
                "st_cost_recovery": money(row["STATE_LOCAL_COST_RECOVERY_AMT"]),
                "collected": money(row["PENALTY_COLLECTED_AMT"]),
            }
    for row in read("CASE_LAW_SECTIONS.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        if case:
            case["sections"].append({
                "rank": row["RANK_ORDER"].strip(),
                "statute": row["STATUTE_CODE"].strip(),
                "section": clean_text(row["LAW_SECTION_CODE"]),
                "desc": clean_text(row["LAW_SECTION_DESC"]),
                "echo_desc": clean_text(row["ECHO_DESC"]),
            })
    for row in read("CASE_DEFENDANTS.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        name = defendant_key(row["DEFENDANT_NAME"])
        if case and name and name not in case["defendants"]:
            case["defendants"].append(name)
    for row in read("CASE_FACILITIES.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        if case:
            case["facilities"].append({
                "registry_id": row["REGISTRY_ID"].strip() or None,
                "name": clean_text(row["FACILITY_NAME"]) or None,
                "city": clean_text(row["CITY"]) or None,
                "state": row["STATE_CODE"].strip().upper() or None,
                "zip": row["ZIP"].strip() or None,
                "naics": row["PRIMARY_NAICS_CODE"].strip() or None,
                "sic": row["PRIMARY_SIC_CODE"].strip() or None,
            })
    for row in read("CASE_PROGRAMS.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        desc = clean_text(row["PROGRAM_DESC"])
        if case and desc and desc not in case["programs"]:
            case["programs"].append(desc)
    for row in read("CASE_ENFORCEMENT_CONCLUSIONS.csv"):
        case = cases.get(row["ACTIVITY_ID"].strip())
        if case:
            case["settlements"].append({
                "name": clean_text(row["ENF_CONCLUSION_NAME"]) or None,
                "lodged": us_date(row["SETTLEMENT_LODGED_DATE"]),
                "entered": us_date(row["SETTLEMENT_ENTERED_DATE"]),
                "fy": fiscal_year(row["SETTLEMENT_FY"]),
                "primary_law": row["PRIMARY_LAW"].strip() or None,
                "fed_penalty": money(row["FED_PENALTY_ASSESSED_AMT"]),
                "sep": money(row["SEP_AMT"]),
                "cost_recovery": money(row["COST_RECOVERY_AWARDED_AMT"]),
            })
    for case in cases.values():
        case["primary_statute"] = primary_statute([(s["rank"], s["statute"]) for s in case["sections"]])
        case["statutes"] = sorted({s["statute"] for s in case["sections"] if s["statute"]})
        case["states"] = case_states([f["state"] or "" for f in case["facilities"]])
    return cases


def blank_totals():
    return {"cases": 0, "judicial": 0, "administrative": 0, "penalty_cases": 0, "penalty_recorded": 0, **{k: 0.0 for k in MONEY_KEYS}}


def add(totals, case):
    totals["cases"] += 1
    if case["type_code"] == "JDC":
        totals["judicial"] += 1
    elif case["type_code"] == "AFR":
        totals["administrative"] += 1
    pen = case["penalties"]
    if pen:
        totals["penalty_recorded"] += 1
        for key in MONEY_KEYS:
            if pen[key] is not None:
                totals[key] += pen[key]
        if (pen["fed_penalty"] or 0) > 0:
            totals["penalty_cases"] += 1


def rounded(totals):
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in totals.items()}


def defendant_table(cases, limit):
    table = collections.defaultdict(lambda: {"cases": 0, "judicial": 0, "fed_penalty": 0.0, "sep": 0.0, "multi": 0, "fys": [], "statutes": collections.Counter(), "states": collections.Counter()})
    for case in cases:
        for name in case["defendants"]:
            row = table[name]
            row["cases"] += 1
            row["judicial"] += case["type_code"] == "JDC"
            pen = case["penalties"] or {}
            row["fed_penalty"] += pen.get("fed_penalty") or 0.0
            row["sep"] += pen.get("sep") or 0.0
            row["multi"] += len(case["defendants"]) > 1
            if case["fy"]:
                row["fys"].append(case["fy"])
            if case["primary_statute"]:
                row["statutes"][case["primary_statute"]] += 1
            for state in case["states"]:
                row["states"][state] += 1
    ranked = sorted(table.items(), key=lambda kv: (-kv[1]["fed_penalty"], -kv[1]["cases"], kv[0]))
    out = []
    for name, row in ranked[:limit]:
        if row["fed_penalty"] <= 0:
            break
        out.append({
            "name": name,
            "cases": row["cases"],
            "judicial": int(row["judicial"]),
            "multi_defendant_cases": int(row["multi"]),
            "fed_penalty": round(row["fed_penalty"], 2),
            "sep": round(row["sep"], 2),
            "first_fy": min(row["fys"]) if row["fys"] else None,
            "last_fy": max(row["fys"]) if row["fys"] else None,
            "statutes": [code for code, _ in row["statutes"].most_common(4)],
            "states": [code for code, _ in row["states"].most_common(6)],
        })
    return out


def top_cases(cases, limit):
    ranked = sorted((c for c in cases if c["penalties"] and (c["penalties"]["fed_penalty"] or 0) > 0), key=lambda c: (-c["penalties"]["fed_penalty"], c["case_number"]))
    return [{
        "case_number": c["case_number"],
        "name": c["name"],
        "fy": c["fy"],
        "type": c["type"],
        "statute": c["primary_statute"],
        "fed_penalty": c["penalties"]["fed_penalty"],
        "in_cases_dataset": bool(c["fy"] and c["fy"] >= CASE_MIN_FY and c["penalties"]["fed_penalty"] >= CASE_MIN_PENALTY),
    } for c in ranked[:limit]]


def profile(code, name, kind, cases, pop, retrieved, dates):
    totals, years, statutes = blank_totals(), collections.defaultdict(blank_totals), collections.defaultdict(lambda: {"totals": blank_totals(), "years": collections.defaultdict(blank_totals)})
    cited = collections.Counter()
    for case in cases:
        add(totals, case)
        if case["fy"]:
            add(years[case["fy"]], case)
        key = case["primary_statute"] or "NONE"
        add(statutes[key]["totals"], case)
        if case["fy"]:
            add(statutes[key]["years"][case["fy"]], case)
        for statute in case["statutes"]:
            cited[statute] += 1
    multistate = sum(1 for c in cases if len(c["states"]) > 1)
    years_list = [{"fy": fy, **rounded(v)} for fy, v in sorted(years.items())]
    statute_list = []
    for key, value in sorted(statutes.items(), key=lambda kv: -kv[1]["totals"]["cases"]):
        statute_list.append({
            "code": None if key == "NONE" else key,
            "name": STATUTE_NAMES.get(key) if key != "NONE" else "No primary law section recorded",
            "cited_cases": cited.get(key, 0) if key != "NONE" else None,
            **{k: rounded(value["totals"])[k] for k in ("cases", "judicial", "administrative", "penalty_cases", "fed_penalty", "sep", "fed_cost_recovery")},
            "years": [{"fy": fy, "cases": v["cases"], "fed_penalty": round(v["fed_penalty"], 2)} for fy, v in sorted(value["years"].items())] if kind == "national" else [],
        })
    recent = [c for c in cases if c["fy"] and c["fy"] >= CASE_MIN_FY]
    fy_pop = next((y for y in years_list if y["fy"] == POP_YEAR), None)
    return {
        "code": code,
        "name": name,
        "kind": kind,
        "fips": STATES.get(code, (None,))[0],
        "totals": {**rounded(totals), "multistate_cases": multistate},
        "years": years_list,
        "statutes": statute_list,
        "top_defendants": defendant_table(cases, 100 if kind == "national" else 15),
        "top_defendants_recent": defendant_table(recent, 100 if kind == "national" else 15),
        "top_cases": top_cases(cases, 25 if kind == "national" else 10),
        "population": {"year": POP_YEAR, "value": pop, "source": CENSUS_URL} if pop else None,
        "cases_per_million": round(fy_pop["cases"] / pop * 1e6, 3) if (pop and fy_pop) else (0.0 if pop else None),
        "fed_penalty_per_capita": round(fy_pop["fed_penalty"] / pop, 4) if (pop and fy_pop) else (0.0 if pop else None),
        "per_capita_fy": POP_YEAR if pop else None,
        "source": {"zip": ZIP_URL, "dictionary": DICT_URL, "retrieved": retrieved, "file_dates": dates},
    }


def money_label(value):
    return "Not recorded" if value is None else "${:,.0f}".format(value)


def main(dry):
    meta = json.load(open(os.path.join(ACQ, "case_downloads.meta.json")))
    retrieved = meta["retrieved"][:10]
    dates = zip_dates()
    file_date = dates.get("CASE_ENFORCEMENTS.csv")
    pop = population()
    cases = load_cases()
    print("cases", len(cases), "with penalties", sum(1 for c in cases.values() if c["penalties"]), file=sys.stderr)
    no_state = [c for c in cases.values() if not c["states"]]
    print("cases without facility state", len(no_state), file=sys.stderr)
    by_state = collections.defaultdict(list)
    for case in cases.values():
        for state in case["states"]:
            by_state[state].append(case)
    unknown_codes = sorted(set(by_state) - set(STATES) - set(TERRITORIES))
    print("unknown codes", {c: len(by_state[c]) for c in unknown_codes}, file=sys.stderr)

    source_facts = [
        {"label": "Source", "value": "EPA ECHO ICIS-FE&C case downloads (case_downloads.zip)"},
        {"label": "File date", "value": file_date},
        {"label": "Retrieved", "value": retrieved},
        {"label": "Scope", "value": "EPA-lead federal civil judicial and administrative formal enforcement cases"},
    ]
    rows = []
    national = profile("US", "United States (all EPA cases)", "national", list(cases.values()), sum(v for k, v in pop.items() if k in STATES), retrieved, dates)
    groups = [(code, STATES[code][1], "state") for code in STATES] + [(code, TERRITORIES.get(code, f"Facility state code {code} (as recorded)"), "territory" if code in TERRITORIES else "other") for code in sorted(set(by_state) - set(STATES))]
    profiles = [national] + [profile(code, name, kind, by_state.get(code, []), pop.get(code), retrieved, dates) for code, name, kind in groups]
    profiles.append(profile("NR", "No facility state recorded", "unrecorded", no_state, None, retrieved, dates))
    for p in profiles:
        t = p["totals"]
        rid = f"epa-profile:{p['code']}"
        title = f"{p['name']} — EPA enforcement cases"
        rows.append(record(
            "regulatory_epa_state_profiles", rid, title,
            source_url=ZIP_URL,
            subtitle=f"{t['cases']:,} cases · {t['judicial']:,} judicial · federal penalties {money_label(t['fed_penalty'])}",
            state=p["code"] if p["kind"] in ("state", "territory") else "",
            cells={"state": p["name"], "cases": t["cases"], "judicial": t["judicial"], "administrative": t["administrative"], "fed_penalty": t["fed_penalty"], "sep": t["sep"], "multistate": t["multistate_cases"]},
            facts=source_facts + [
                {"label": "Cases", "value": f"{t['cases']:,}"},
                {"label": "Civil judicial", "value": f"{t['judicial']:,}"},
                {"label": "Administrative formal", "value": f"{t['administrative']:,}"},
                {"label": "Federal penalties", "value": money_label(t["fed_penalty"])},
                {"label": "SEP value", "value": money_label(t["sep"])},
                {"label": "Federal cost recovery", "value": money_label(t["fed_cost_recovery"])},
                {"label": "Multi-state cases", "value": f"{t['multistate_cases']:,}"},
                {"label": "Attribution", "value": "Case counted in every state where one of its recorded facilities is located"},
            ],
            text=" ".join([p["name"], p["code"]] + [d["name"] for d in p["top_defendants"][:15]]),
            filters={"kind": [p["kind"]]},
            links=[{"label": "ECHO case downloads", "url": ZIP_URL}, {"label": "Data element dictionary", "url": DICT_URL}] + ([{"label": "Census Vintage 2025 population", "url": CENSUS_URL}] if p["population"] else []),
            extra={"profile": p},
        ))

    case_rows = []
    for case in sorted(cases.values(), key=lambda c: c["case_number"]):
        pen = case["penalties"]
        if not (case["fy"] and case["fy"] >= CASE_MIN_FY and pen and (pen["fed_penalty"] or 0) >= CASE_MIN_PENALTY):
            continue
        url = CASE_URL.format(case["case_number"])
        facilities = case["facilities"][:20]
        item_case = {k: case[k] for k in ("activity_id", "case_number", "name", "type", "type_code", "fy", "region", "status", "status_date", "outcome", "doj_docket", "hq_division", "voluntary_disclosure", "multimedia", "summary", "primary_statute", "statutes", "states", "defendants", "programs")}
        item_case.update({
            "penalties": pen,
            "sections": [{k: s[k] for k in ("rank", "statute", "section", "desc")} for s in case["sections"]][:12],
            "facilities": facilities,
            "facility_count": len(case["facilities"]),
            "settlements": case["settlements"][:10],
        })
        case_rows.append(record(
            "regulatory_epa_cases", f"epa-case:{case['case_number']}", case["name"] or case["case_number"],
            source_url=url,
            subtitle=f"{case['case_number']} · {case['type'] or 'Type not recorded'} · FY{case['fy']} · {case['primary_statute'] or 'statute not recorded'}",
            state=case["states"][0] if len(case["states"]) == 1 else "",
            cells={"case_number": case["case_number"], "fy": case["fy"], "type": case["type"], "statute": case["primary_statute"], "states": ", ".join(case["states"]) or None, "fed_penalty": pen["fed_penalty"], "sep": pen["sep"]},
            facts=[
                {"label": "Case number", "value": case["case_number"]},
                {"label": "Case type", "value": case["type"] or "Not recorded"},
                {"label": "Fiscal year", "value": str(case["fy"])},
                {"label": "Primary statute", "value": case["primary_statute"] or "Not recorded"},
                {"label": "Federal penalty", "value": money_label(pen["fed_penalty"])},
                {"label": "State/local penalty", "value": money_label(pen["st_lcl_penalty"])},
                {"label": "SEP value", "value": money_label(pen["sep"])},
                {"label": "Complying action cost", "value": money_label(pen["compliance_cost"])},
                {"label": "Federal cost recovery", "value": money_label(pen["fed_cost_recovery"])},
                {"label": "Status", "value": case["status"] or "Not recorded"},
                {"label": "Outcome", "value": case["outcome"] or "Not recorded"},
                {"label": "DOJ docket", "value": case["doj_docket"] or "Not recorded"},
                {"label": "Defendants", "value": "; ".join(case["defendants"][:12]) or "Not recorded"},
                {"label": "Facility states", "value": ", ".join(case["states"]) or "Not recorded"},
                {"label": "Source file", "value": f"CASE_ENFORCEMENTS / CASE_PENALTIES ({file_date}), retrieved {retrieved}"},
            ],
            text=" ".join([case["case_number"], case["name"] or "", " ".join(case["defendants"]), " ".join(f["name"] or "" for f in facilities), case["doj_docket"] or "", " ".join(case["statutes"])]),
            filters={"type": [case["type_code"]], "statute": [case["primary_statute"] or "none"], "fy": [str(case["fy"])], "state": case["states"] or ["none"]},
            badges=[case["type"] or "Type not recorded", case["primary_statute"] or "No statute"],
            links=[{"label": "ECHO enforcement case report", "url": url}, {"label": "ECHO case downloads", "url": ZIP_URL}],
            extra={"case": item_case},
        ))
    print("profiles", len(rows), "cases", len(case_rows), file=sys.stderr)
    summary_common = {"source": ZIP_URL, "dictionary": DICT_URL, "file_date": file_date, "retrieved": retrieved, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if dry:
        with open(os.path.join(ROOT, "private", "scratch", "enforcement", "epa_dry.json"), "w") as out:
            json.dump({"profile_us": rows[0]["item"]["profile"]["totals"], "tx": next(r for r in rows if r["id"] == "epa-profile:TX")["item"]["profile"]["totals"], "case_sample": case_rows[0]}, out, indent=1, default=str)
        return
    statute_options = {code: code for code in sorted(STATUTE_NAMES)}
    statute_options["none"] = "Not recorded"
    writer.publish(
        "regulatory_epa_state_profiles", "EPA enforcement by state (ECHO case data)", rows,
        listing_block=writer.listing([("state", "State"), ("cases", "Cases"), ("judicial", "Judicial"), ("administrative", "Administrative"), ("fed_penalty", "Federal penalties ($)"), ("sep", "SEP ($)"), ("multistate", "Multi-state cases")], [("kind", "Kind", {"national": "National", "state": "State", "territory": "Territory", "other": "Other code", "unrecorded": "No state recorded"})]),
        summary={**summary_common, "grain": "one record per facility state/territory code plus a national record and a no-state record", "attribution": "A case counts in every state where one of its recorded facilities is located (CASE_FACILITIES.STATE_CODE); state totals are not additive.", "time_basis": "Case fiscal year (CASE_ENFORCEMENTS.FISCAL_YEAR)", "money_basis": "CASE_PENALTIES sums across all settlements of a case", "population": CENSUS_URL, "population_year": POP_YEAR},
    )
    writer.publish(
        "regulatory_epa_cases", f"EPA enforcement cases FY{CASE_MIN_FY}+ with federal penalty ≥ ${CASE_MIN_PENALTY:,}", case_rows,
        listing_block=writer.listing([("case_number", "Case"), ("fy", "FY"), ("type", "Type"), ("statute", "Statute"), ("states", "States"), ("fed_penalty", "Federal penalty ($)"), ("sep", "SEP ($)")], [("type", "Case type", {"JDC": "Civil judicial", "AFR": "Administrative formal"}), ("statute", "Primary statute", statute_options)]),
        summary={**summary_common, "grain": "one record per case", "inclusion": f"Case FISCAL_YEAR >= {CASE_MIN_FY} and CASE_PENALTIES.FED_PENALTY >= {CASE_MIN_PENALTY}", "threshold_usd": CASE_MIN_PENALTY, "min_fy": CASE_MIN_FY},
    )


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
