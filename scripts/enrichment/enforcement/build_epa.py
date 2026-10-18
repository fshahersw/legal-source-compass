"""Build EPA ECHO enforcement datasets from the official ICIS-FE&C case downloads.

Inputs (unchanged raw files): private/acq/enforcement/case_downloads.zip (extracted to private/acq/enforcement/echo/)
and private/acq/enforcement/NST-EST2025-ALLDATA.csv (Census Vintage 2025 state population).

Publishes:
  regulatory_epa_state_profiles  one record per state/territory: cases by FY opened, dollars by settlement FY, statute mix,
                                 defendant-set rankings, top cases (+ national record with collapsed duplicate records)
  regulatory_epa_cases           record-level cases with federal penalty >= $100,000 opened or settled FY2017 onward

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
    find_twins,
    fiscal_year,
    money,
    possible_duplicates,
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
                "st_lcl_penalty": money(row["STATE_LOCAL_PENALTY_AMT"]),
                "compliance_cost": money(row["COMPLIANCE_ACTION_COST"]),
            })
    for case in cases.values():
        case["primary_statute"] = primary_statute([(s["rank"], s["statute"]) for s in case["sections"]])
        case["statutes"] = sorted({s["statute"] for s in case["sections"] if s["statute"]})
        case["states"] = case_states([f["state"] or "" for f in case["facilities"]])
    return cases


SETTLED_KEYS = ("fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "cost_recovery")


def blank_year():
    return {"cases": 0, "judicial": 0, "administrative": 0, "settlements": 0, "settled_cases": 0, "penalty_settlements": 0, **{k: 0.0 for k in SETTLED_KEYS}}


def count_opened(bucket, case):
    bucket["cases"] += 1
    if case["type_code"] == "JDC":
        bucket["judicial"] += 1
    elif case["type_code"] == "AFR":
        bucket["administrative"] += 1


def add_settlement(bucket, settlement):
    bucket["settlements"] += 1
    for key in SETTLED_KEYS:
        bucket[key] += settlement.get(key) or 0.0
    if (settlement.get("fed_penalty") or 0) > 0:
        bucket["penalty_settlements"] += 1


def rounded(values):
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in values.items()}


def penalty_settlements(case, min_fy=None):
    return [s for s in case["settlements"] if (s["fed_penalty"] or 0) > 0 and (min_fy is None or (s["fy"] or 0) >= min_fy)]


def settled_on(case):
    """Latest entered date among settlements carrying a federal penalty (else any settlement) and its settlement FY."""
    pool = penalty_settlements(case) or case["settlements"]
    dated = sorted((s for s in pool if s["entered"]), key=lambda s: s["entered"])
    return (dated[-1]["entered"], dated[-1]["fy"]) if dated else (None, None)


def group_lead(case, members):
    """Lead case number of the multi-record national case this record belongs to, else None."""
    number = case["case_number"]
    return members.get(number) or (number if number in set(members.values()) else None)


def defendant_groups(cases, limit, members, min_fy=None):
    """One row per exact recorded defendant set (records of one multi-record national case form one row with the union
    of their recorded names); each record counts once, so rows are additive.
    Dollars are settlement federal penalties (settlement FY >= min_fy when given)."""
    groups = {}
    names = {}
    for case in cases:
        if not case["defendants"]:
            continue
        pays = penalty_settlements(case, min_fy)
        amount = sum(s["fed_penalty"] for s in pays)
        if amount <= 0:
            continue
        lead = group_lead(case, members)
        key = ("national case", lead) if lead else tuple(sorted(case["defendants"]))
        names.setdefault(key, set()).update(case["defendants"])
        row = groups.setdefault(key, {"cases": [], "fed_penalty": 0.0, "judicial": 0, "fys": [], "statutes": collections.Counter(), "states": collections.Counter()})
        row["cases"].append((amount, case["case_number"]))
        row["fed_penalty"] += amount
        row["judicial"] += case["type_code"] == "JDC"
        row["fys"].extend(s["fy"] for s in pays if s["fy"])
        if case["primary_statute"]:
            row["statutes"][case["primary_statute"]] += 1
        for state in case["states"]:
            row["states"][state] += 1
    ranked = sorted(groups.items(), key=lambda kv: (-kv[1]["fed_penalty"], kv[0]))
    return [{
        "defendants": sorted(names[key]),
        "national_case": key[1] if key[0] == "national case" else None,
        "cases": len(row["cases"]),
        "judicial": int(row["judicial"]),
        "fed_penalty": round(row["fed_penalty"], 2),
        "first_settlement_fy": min(row["fys"]) if row["fys"] else None,
        "last_settlement_fy": max(row["fys"]) if row["fys"] else None,
        "statutes": [code for code, _ in row["statutes"].most_common(4)],
        "states": [code for code, _ in row["states"].most_common(6)],
        "case_numbers": [number for _, number in sorted(row["cases"], reverse=True)[:5]],
    } for key, row in ranked[:limit]]


def in_case_dataset(case):
    pen = case["penalties"] or {}
    recent = (case["fy"] or 0) >= CASE_MIN_FY or any((s["fy"] or 0) >= CASE_MIN_FY for s in case["settlements"])
    return (pen.get("fed_penalty") or 0) >= CASE_MIN_PENALTY and recent


def top_cases(cases, limit, members):
    """Largest cases by case-total federal penalty; records of one multi-record national case are combined into one row."""
    bundles = {}
    for c in cases:
        if not (c["penalties"] and (c["penalties"]["fed_penalty"] or 0) > 0):
            continue
        lead = group_lead(c, members)
        bundles.setdefault(lead or c["case_number"], []).append(c)
    rows = []
    for key, records in bundles.items():
        records.sort(key=lambda c: (c["case_number"] != key, c["case_number"]))
        main_case = records[0]
        dates = [d for d in (settled_on(c) for c in records) if d[0]]
        date, fy = max(dates) if dates else (None, None)
        rows.append({
            "case_number": main_case["case_number"],
            "name": main_case["name"],
            "fy": main_case["fy"],
            "settled": date,
            "settlement_fy": fy,
            "type": main_case["type"],
            "statute": main_case["primary_statute"],
            "fed_penalty": round(sum(c["penalties"]["fed_penalty"] for c in records), 2),
            "records": [c["case_number"] for c in records],
            "defendants": sorted({d for c in records for d in c["defendants"]})[:6],
            "in_cases_dataset": in_case_dataset(main_case),
        })
    rows.sort(key=lambda r: (-r["fed_penalty"], r["case_number"]))
    return rows[:limit]


def profile(code, name, kind, cases, pop, retrieved, dates, members):
    totals = blank_year()
    unattributed = {k: 0.0 for k in SETTLED_KEYS}
    years = collections.defaultdict(blank_year)
    statutes = collections.defaultdict(lambda: {"totals": blank_year(), "years": collections.defaultdict(blank_year)})
    cited = collections.Counter()
    settled_case_years = collections.defaultdict(set)
    for case in cases:
        key = case["primary_statute"] or "NONE"
        count_opened(totals, case)
        count_opened(statutes[key]["totals"], case)
        if case["fy"]:
            count_opened(years[case["fy"]], case)
            count_opened(statutes[key]["years"][case["fy"]], case)
        for settlement in case["settlements"]:
            add_settlement(totals, settlement)
            add_settlement(statutes[key]["totals"], settlement)
            if settlement["fy"]:
                add_settlement(years[settlement["fy"]], settlement)
                add_settlement(statutes[key]["years"][settlement["fy"]], settlement)
                settled_case_years[settlement["fy"]].add(case["case_number"])
            else:
                for k in SETTLED_KEYS:
                    unattributed[k] += settlement.get(k) or 0.0
        for statute in case["statutes"]:
            cited[statute] += 1
    for fy, numbers in settled_case_years.items():
        years[fy]["settled_cases"] = len(numbers)
    totals["settled_cases"] = sum(1 for c in cases if c["settlements"])
    years_list = [{"fy": fy, **rounded(v)} for fy, v in sorted(years.items())]
    statute_list = []
    for key, value in sorted(statutes.items(), key=lambda kv: -kv[1]["totals"]["cases"]):
        t = rounded(value["totals"])
        statute_list.append({
            "code": None if key == "NONE" else key,
            "name": STATUTE_NAMES.get(key) if key != "NONE" else "No primary law section recorded",
            "cited_cases": cited.get(key, 0) if key != "NONE" else None,
            **{k: t[k] for k in ("cases", "judicial", "administrative", "fed_penalty", "sep", "cost_recovery")},
            "years": [{"fy": fy, "cases": v["cases"], "fed_penalty": round(v["fed_penalty"], 2)} for fy, v in sorted(value["years"].items()) if fy >= 1990],
        })
    fy_pop = next((y for y in years_list if y["fy"] == POP_YEAR), None)
    return {
        "code": code,
        "name": name,
        "kind": kind,
        "fips": STATES.get(code, (None,))[0],
        "basis": {"cases": "case opened (CASE_ENFORCEMENTS.FISCAL_YEAR)", "dollars": "settlement FY (CASE_ENFORCEMENT_CONCLUSIONS.SETTLEMENT_FY)"},
        "totals": {**rounded(totals), "multistate_cases": sum(1 for c in cases if len(c["states"]) > 1), "unattributed": rounded(unattributed),
                   "case_level_fed_penalty": round(sum((c["penalties"] or {}).get("fed_penalty") or 0.0 for c in cases), 2)},
        "years": years_list,
        "statutes": statute_list,
        "top_defendant_groups": defendant_groups(cases, 100 if kind == "national" else 15, members),
        "top_defendant_groups_recent": defendant_groups(cases, 100 if kind == "national" else 15, members, CASE_MIN_FY),
        "top_cases": top_cases(cases, 25 if kind == "national" else 10, members),
        "population": {"year": POP_YEAR, "value": pop, "source": CENSUS_URL} if pop else None,
        "cases_per_million": round(fy_pop["cases"] / pop * 1e6, 3) if (pop and fy_pop) else (0.0 if pop else None),
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
    view = [{"case_number": c["case_number"], "name": c["name"], "fed_penalty": (c["penalties"] or {}).get("fed_penalty"), "settlements": c["settlements"], "defendants": c["defendants"]} for c in cases.values()]
    members = find_twins(view)
    dupes = possible_duplicates(view, members)
    by_number = {c["case_number"]: c for c in cases.values()}
    national_groups = []
    for lead in sorted(set(members.values())):
        records = [lead] + sorted(m for m, l in members.items() if l == lead)
        share = (by_number[lead]["penalties"] or {}).get("fed_penalty") or 0.0
        national_groups.append({"lead_case_number": lead, "lead_name": by_number[lead]["name"], "records": records,
                                "names": [by_number[r]["name"] for r in records], "fed_penalty_per_record": share,
                                "combined_fed_penalty": round(share * len(records), 2),
                                "states": sorted({s for r in records for s in by_number[r]["states"]})})
    national_groups.sort(key=lambda g: -g["combined_fed_penalty"])
    group_of = {r: g for g in national_groups for r in g["records"]}
    dupe_list = sorted(({"case_numbers": [c["case_number"] for c in g], "names": [c["name"] for c in g], "fed_penalty_each": g[0]["fed_penalty"]} for g in dupes), key=lambda r: -r["fed_penalty_each"])
    included = list(cases.values())
    print("cases", len(cases), "national-case groups", len(national_groups), "records in groups", len(group_of), "look-alike groups (no lead marker)", len(dupes), file=sys.stderr)
    no_state = [c for c in included if not c["states"]]
    by_state = collections.defaultdict(list)
    for case in included:
        for state in case["states"]:
            by_state[state].append(case)
    print("cases without facility state", len(no_state), "codes", {c: len(by_state[c]) for c in sorted(set(by_state) - set(STATES) - set(TERRITORIES))}, file=sys.stderr)

    source_facts = [
        {"label": "Source", "value": "EPA ECHO ICIS-FE&C case downloads (case_downloads.zip)"},
        {"label": "File date", "value": file_date},
        {"label": "Retrieved", "value": retrieved},
        {"label": "Scope", "value": "EPA-lead federal civil judicial and administrative formal enforcement cases"},
        {"label": "Time basis", "value": "Case counts by fiscal year opened; dollars by settlement fiscal year"},
    ]
    rows = []
    national = profile("US", "United States (all EPA cases)", "national", included, sum(v for k, v in pop.items() if k in STATES), retrieved, dates, members)
    national["national_case_groups"] = national_groups
    national["possible_duplicates"] = {"groups": len(dupe_list), "cases": sum(len(g["case_numbers"]) for g in dupe_list), "extra_fed_penalty": round(sum(g["fed_penalty_each"] * (len(g["case_numbers"]) - 1) for g in dupe_list), 2), "largest": dupe_list[:20]}
    groups = [(code, STATES[code][1], "state") for code in STATES] + [(code, TERRITORIES.get(code, f"Facility state code {code} (as recorded)"), "territory" if code in TERRITORIES else "other") for code in sorted(set(by_state) - set(STATES))]
    profiles = [national] + [profile(code, name, kind, by_state.get(code, []), pop.get(code), retrieved, dates, members) for code, name, kind in groups]
    profiles.append(profile("NR", "No facility state recorded", "unrecorded", no_state, None, retrieved, dates, members))
    for p in profiles:
        t = p["totals"]
        rows.append(record(
            "regulatory_epa_state_profiles", f"epa-profile:{p['code']}", f"{p['name']} — EPA enforcement cases",
            source_url=ZIP_URL,
            subtitle=f"{t['cases']:,} cases opened · {t['judicial']:,} judicial · settled federal penalties {money_label(t['fed_penalty'])}",
            state=p["code"] if p["kind"] in ("state", "territory") else "",
            cells={"state": p["name"], "cases": t["cases"], "judicial": t["judicial"], "administrative": t["administrative"], "fed_penalty": t["fed_penalty"], "sep": t["sep"], "multistate": t["multistate_cases"]},
            facts=source_facts + [
                {"label": "Cases opened", "value": f"{t['cases']:,}"},
                {"label": "Civil judicial", "value": f"{t['judicial']:,}"},
                {"label": "Administrative formal", "value": f"{t['administrative']:,}"},
                {"label": "Federal penalties (settlements)", "value": money_label(t["fed_penalty"])},
                {"label": "SEP value (settlements)", "value": money_label(t["sep"])},
                {"label": "Cost recovery (settlements)", "value": money_label(t["cost_recovery"])},
                {"label": "Multi-state cases", "value": f"{t['multistate_cases']:,}"},
                {"label": "Attribution", "value": "Case counted in every state where one of its recorded facilities is located"},
                {"label": "Multi-record national cases", "value": f"{len(national_groups)} national cases recorded as several regional records that split the federal penalty; shown as one row in rankings, dollars summed"},
            ],
            text=" ".join([p["name"], p["code"]] + [d for g in p["top_defendant_groups"][:15] for d in g["defendants"]]),
            filters={"kind": [p["kind"]]},
            links=[{"label": "ECHO case downloads", "url": ZIP_URL}, {"label": "Data element dictionary", "url": DICT_URL}] + ([{"label": "Census Vintage 2025 population", "url": CENSUS_URL}] if p["population"] else []),
            extra={"profile": p},
        ))

    case_rows = []
    for case in sorted(cases.values(), key=lambda c: c["case_number"]):
        if not in_case_dataset(case):
            continue
        pen = case["penalties"]
        settled, settled_fy = settled_on(case)
        group = group_of.get(case["case_number"])
        url = CASE_URL.format(case["case_number"])
        facilities = case["facilities"][:20]
        item_case = {k: case[k] for k in ("activity_id", "case_number", "name", "type", "type_code", "fy", "region", "status", "status_date", "outcome", "doj_docket", "hq_division", "voluntary_disclosure", "multimedia", "summary", "primary_statute", "statutes", "states", "defendants", "programs")}
        item_case.update({
            "penalties": pen,
            "settled": settled,
            "settlement_fy": settled_fy,
            "settlement_fys": sorted({s["fy"] for s in case["settlements"] if s["fy"]}),
            "national_case": {"lead_case_number": group["lead_case_number"], "records": group["records"], "combined_fed_penalty": group["combined_fed_penalty"]} if group else None,
            "sections": [{k: s[k] for k in ("rank", "statute", "section", "desc")} for s in case["sections"]][:12],
            "facilities": facilities,
            "facility_count": len(case["facilities"]),
            "settlements": case["settlements"][:10],
        })
        case_rows.append(record(
            "regulatory_epa_cases", f"epa-case:{case['case_number']}", case["name"] or case["case_number"],
            source_url=url,
            subtitle=f"{case['case_number']} · {case['type'] or 'Type not recorded'} · opened FY{case['fy']} · settled {settled or 'not recorded'} · {case['primary_statute'] or 'statute not recorded'}",
            state=case["states"][0] if len(case["states"]) == 1 else "",
            cells={"case_number": case["case_number"], "fy": case["fy"], "settled": settled, "type": case["type"], "statute": case["primary_statute"], "states": ", ".join(case["states"]) or None, "fed_penalty": pen["fed_penalty"], "sep": pen["sep"]},
            facts=[
                {"label": "Case number", "value": case["case_number"]},
                {"label": "Case type", "value": case["type"] or "Not recorded"},
                {"label": "Fiscal year opened", "value": str(case["fy"])},
                {"label": "Latest settlement entered", "value": f"{settled} (FY{settled_fy})" if settled else "Not recorded"},
                {"label": "Primary statute", "value": case["primary_statute"] or "Not recorded"},
                {"label": "Federal penalty (all settlements)", "value": money_label(pen["fed_penalty"])},
                {"label": "State/local penalty", "value": money_label(pen["st_lcl_penalty"])},
                {"label": "SEP value", "value": money_label(pen["sep"])},
                {"label": "Complying action cost", "value": money_label(pen["compliance_cost"])},
                {"label": "Federal cost recovery", "value": money_label(pen["fed_cost_recovery"])},
                {"label": "Status", "value": case["status"] or "Not recorded"},
                {"label": "Outcome", "value": case["outcome"] or "Not recorded"},
                {"label": "DOJ docket", "value": case["doj_docket"] or "Not recorded"},
                {"label": "Defendants", "value": "; ".join(case["defendants"][:12]) or "Not recorded"},
                {"label": "Facility states", "value": ", ".join(case["states"]) or "Not recorded"},
                {"label": "Multi-record national case", "value": f"One of {len(group['records'])} regional records of national case {group['lead_case_number']} (records {', '.join(group['records'])}); combined federal penalty {money_label(group['combined_fed_penalty'])}" if group else "No"},
                {"label": "Source file", "value": f"CASE_ENFORCEMENTS / CASE_PENALTIES / CASE_ENFORCEMENT_CONCLUSIONS ({file_date}), retrieved {retrieved}"},
            ],
            text=" ".join([case["case_number"], case["name"] or "", " ".join(case["defendants"]), " ".join(f["name"] or "" for f in facilities), case["doj_docket"] or "", " ".join(case["statutes"])]),
            filters={"type": [case["type_code"]], "statute": [case["primary_statute"] or "none"], "fy": [str(case["fy"])], "state": case["states"] or ["none"], "national_case": ["yes" if group else "no"]},
            badges=[case["type"] or "Type not recorded", case["primary_statute"] or "No statute"] + ([f"National case: {len(group['records'])} records"] if group else []),
            links=[{"label": "ECHO enforcement case report", "url": url}, {"label": "ECHO case downloads", "url": ZIP_URL}],
            extra={"case": item_case},
        ))
    print("profiles", len(rows), "cases", len(case_rows), file=sys.stderr)
    summary_common = {"source": ZIP_URL, "dictionary": DICT_URL, "file_date": file_date, "retrieved": retrieved, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if dry:
        tx = next(r for r in rows if r["id"] == "epa-profile:TX")["item"]["profile"]
        with open(os.path.join(ROOT, "private", "scratch", "enforcement", "epa_dry.json"), "w") as out:
            json.dump({"us_totals": national["totals"], "groups": national_groups[:6], "us_top_cases": national["top_cases"][:4], "dupes": national["possible_duplicates"], "tx_totals": tx["totals"], "us_groups": national["top_defendant_groups"][:8], "us_recent": national["top_defendant_groups_recent"][:5], "us_years_tail": national["years"][-4:], "case_sample": case_rows[0]["item"]["case"]}, out, indent=1, default=str)
        return
    statute_options = {code: code for code in sorted(STATUTE_NAMES)}
    statute_options["none"] = "Not recorded"
    writer.publish(
        "regulatory_epa_state_profiles", "EPA enforcement by state (ECHO case data)", rows,
        listing_block=writer.listing([("state", "State"), ("cases", "Cases opened"), ("judicial", "Judicial"), ("administrative", "Administrative"), ("fed_penalty", "Federal penalties, settled ($)"), ("sep", "SEP ($)"), ("multistate", "Multi-state cases")], [("kind", "Kind", {"national": "National", "state": "State", "territory": "Territory", "other": "Other code", "unrecorded": "No state recorded"})]),
        summary={**summary_common, "grain": "one record per facility state/territory code plus a national record and a no-state record",
                 "attribution": "A case counts in every state where one of its recorded facilities is located (CASE_FACILITIES.STATE_CODE); state totals are not additive.",
                 "time_basis": "Case counts by fiscal year opened (CASE_ENFORCEMENTS.FISCAL_YEAR); dollars by settlement fiscal year (CASE_ENFORCEMENT_CONCLUSIONS.SETTLEMENT_FY)",
                 "money_basis": "Sums of settlement records (FED_PENALTY_ASSESSED_AMT, STATE_LOCAL_PENALTY_AMT, SEP_AMT, COMPLIANCE_ACTION_COST, COST_RECOVERY_AWARDED_AMT); settlements without an entered date are in totals.unattributed",
                 "national_cases": f"{len(national_groups)} national cases are recorded as several regional records that split the federal penalty in equal shares (same case-total penalty, identical settlement ledger, one lead-marked record, and a national-case marker or shared defendant); their dollars stay summed and rankings show one row per national case. {len(dupe_list)} look-alike groups without a lead marker are reported in the national record, not merged.",
                 "population": CENSUS_URL, "population_year": POP_YEAR},
    )
    writer.publish(
        "regulatory_epa_cases", f"EPA enforcement cases FY{CASE_MIN_FY}+ with federal penalty ≥ ${CASE_MIN_PENALTY:,}", case_rows,
        listing_block=writer.listing([("case_number", "Case"), ("fy", "Opened FY"), ("settled", "Settled"), ("type", "Type"), ("statute", "Statute"), ("states", "States"), ("fed_penalty", "Federal penalty ($)"), ("sep", "SEP ($)")], [("type", "Case type", {"JDC": "Civil judicial", "AFR": "Administrative formal"}), ("statute", "Primary statute", statute_options), ("national_case", "Multi-record national case", {"yes": "Yes", "no": "No"})]),
        summary={**summary_common, "grain": "one record per case", "inclusion": f"CASE_PENALTIES.FED_PENALTY >= {CASE_MIN_PENALTY} and (case opened FY >= {CASE_MIN_FY} or any settlement FY >= {CASE_MIN_FY})", "threshold_usd": CASE_MIN_PENALTY, "min_fy": CASE_MIN_FY},
    )


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
