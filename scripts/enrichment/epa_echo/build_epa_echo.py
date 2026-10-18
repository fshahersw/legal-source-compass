"""Build epa_echo datasets from unchanged EPA ECHO downloads in private/acq/epa_echo/ (no network, no remote writes).

Inputs
  private/acq/epa_echo/case_downloads.zip       ICIS FE&C enforcement case files (streamed from the archive)
  private/acq/epa_echo/echo_exporter.zip        ECHO Exporter, one row per FRS facility (streamed from the archive)
  private/acq/epa_echo/census/NST-EST2025-ALLDATA.csv   Census Vintage 2025 state population (per-capita denominator)
  private/build/epa_echo/lookups/*.json         read-only corpus lookups (SEC profile titles, existing EPA profile ids)

Outputs (private/build/epa_echo/<dataset>.json, rows exactly as corpus_writer.publish would receive them)
  epa_echo_case_series     national, EPA-region and facility-state rows by fiscal year (+ an all-years row per scope)
  epa_echo_defendants      top exact defendant names by case-level federal penalties, all years
  epa_echo_state_programs  per facility state: facilities per program (CAA, CWA, RCRA, SDWA), 5-year formal actions,
                           current significant violators (ECHO Exporter)

Usage: python3 -I -B scripts/enrichment/epa_echo/build_epa_echo.py [--skip-exporter]
"""
import collections
import csv
import hashlib
import io
import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, PARENT)
sys.path.insert(0, os.path.join(PARENT, "enforcement"))

import corpus_writer as writer  # noqa: E402
import echo_parse as ep  # noqa: E402
from parsing import find_twins, possible_duplicates  # noqa: E402  (same national-case rule as regulatory_epa_*)

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "epa_echo")
BUILD = os.path.join(ROOT, "private", "build", "epa_echo")
LOOKUPS = os.path.join(BUILD, "lookups")

CASE_ZIP = os.path.join(ACQ, "case_downloads.zip")
EXPORTER_ZIP = os.path.join(ACQ, "echo_exporter.zip")
CENSUS_CSV = os.path.join(ACQ, "census", "NST-EST2025-ALLDATA.csv")
CASE_ZIP_URL = "https://echo.epa.gov/files/echodownloads/case_downloads.zip"
EXPORTER_URL = "https://echo.epa.gov/files/echodownloads/echo_exporter.zip"
EXPORTER_DICT_URL = "https://echo.epa.gov/system/files/echo_exporter_columns_7-16-2025_0.xlsx"
FEC_DICT_URL = "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary"
DOWNLOADS_PAGE = "https://echo.epa.gov/tools/data-downloads"
CENSUS_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
CASE_URL = "https://echo.epa.gov/enforcement-case-report?id={}"
POP_YEAR = 2025
PER_CAPITA_FY = 2025
PER_CAPITA_WINDOW = (2016, 2025)
DEFENDANT_LIMIT = 1000

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
REGION_NAMES = {"HQ": "EPA Headquarters (case region HQ)", "EF": "CAA Eastern Field Office (case region EF)",
                "WF": "CAA Western Field Office (case region WF)", "NR": "No case region recorded"}
TYPE_NAMES = {"JDC": "Civil judicial", "AFR": "Administrative formal", "NR": "Not recorded"}
STATUTE_NAMES = {
    "CAA": "Clean Air Act", "CWA": "Clean Water Act", "RCRA": "Resource Conservation and Recovery Act",
    "CERCLA": "Comprehensive Environmental Response, Compensation, and Liability Act", "SDWA": "Safe Drinking Water Act",
    "TSCA": "Toxic Substances Control Act", "FIFRA": "Federal Insecticide, Fungicide, and Rodenticide Act",
    "EPCRA": "Emergency Planning & Community Right-To-Know Act", "MPRSA": "Marine Protection, Research and Sanctuaries Act",
    "MWTA": "Medical Waste Tracking Act", "REFA": "Refuse Act", "MCRBMA": "Mercury-Containing And Rechargeable Battery Management Act",
    "AIM": "AIM (as recorded; not defined in the ICIS-FE&C download summary)", "APPS": "APPS (as recorded; not defined in the ICIS-FE&C download summary)",
    "NR": "No primary law section recorded",
}


def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


def manifest():
    entries = {}
    with open(os.path.join(ACQ, "_manifest.jsonl")) as handle:
        for line in handle:
            entry = json.loads(line)
            entries[entry["path"]] = entry  # last fetch of a path wins
    return entries


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def input_entry(entries, path):
    rel = os.path.relpath(path, ROOT)
    entry = entries.get(rel) or {}
    actual = sha256(path)
    if entry.get("sha256") and entry["sha256"] != actual:
        raise SystemExit(f"{rel}: sha256 differs from manifest")
    return {"url": entry.get("url"), "path": rel, "sha256": actual, "retrieved_at": entry.get("retrieved_at")}


def zip_rows(archive, name):
    with archive.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""))


def zip_dates(path):
    with zipfile.ZipFile(path) as archive:
        return {info.filename: "%04d-%02d-%02d" % info.date_time[:3] for info in archive.infolist()}


def population():
    by_fips = {fips: usps for usps, (fips, _) in STATES.items()}
    by_fips["72"] = "PR"
    out = {}
    with open(CENSUS_CSV, newline="", encoding="latin-1") as handle:
        for row in csv.DictReader(handle):
            if row["SUMLEV"] == "040" and row["STATE"].zfill(2) in by_fips:
                out[by_fips[row["STATE"].zfill(2)]] = int(row[f"POPESTIMATE{POP_YEAR}"])
    return out


# ---------------------------------------------------------------- load ICIS FE&C


def load_cases(diag):
    archive = zipfile.ZipFile(CASE_ZIP)
    cases = {}
    for row in zip_rows(archive, "CASE_ENFORCEMENTS.csv"):
        aid = ep.clean(row["ACTIVITY_ID"])
        cases[aid] = {
            "id": aid, "case_number": ep.clean(row["CASE_NUMBER"]), "name": ep.clean(row["CASE_NAME"]) or ep.clean(row["ACTIVITY_NAME"]),
            "type": ep.clean(row["ACTIVITY_TYPE_CODE"]) or None, "fy": ep.fiscal_year(row["FISCAL_YEAR"]),
            "region": ep.clean(row["REGION_CODE"]) or None, "lead": ep.clean(row["LEAD"]) or None,
            "status": ep.clean(row["ACTIVITY_STATUS_DESC"]) or None, "outcome": ep.clean(row["ENF_OUTCOME_DESC"]) or None,
            "pen": None, "sections": [], "programs": set(), "facility_states": [], "defendants": [], "conclusions": [],
        }
    diag["cases"] = len(cases)
    diag["case_fy_missing"] = sum(1 for c in cases.values() if not c["fy"])
    negatives = collections.Counter()
    for row in zip_rows(archive, "CASE_PENALTIES.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        if case is None:
            diag["penalties_orphan"] = diag.get("penalties_orphan", 0) + 1
            continue
        case["pen"] = {
            "fed_penalty": ep.money(row["FED_PENALTY"]), "st_lcl_penalty": ep.money(row["ST_LCL_PENALTY"]),
            "sep": ep.money(row["TOTAL_SEP"]), "compliance_cost": ep.money(row["COMPLIANCE_ACTION_COST"]),
            "fed_cost_recovery": ep.money(row["FEDERAL_COST_RECOVERY_AMT"]),
            "st_cost_recovery": ep.money(row["STATE_LOCAL_COST_RECOVERY_AMT"]),
            "penalty_collected": ep.money(row["PENALTY_COLLECTED_AMT"]),
        }
        for key, value in case["pen"].items():
            if value is not None and value < 0:
                negatives["case:" + key] += 1
    for row in zip_rows(archive, "CASE_LAW_SECTIONS.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        if case:
            case["sections"].append((row["RANK_ORDER"], row["STATUTE_CODE"]))
    program_names = {}
    for row in zip_rows(archive, "CASE_PROGRAMS.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        code = ep.clean(row["PROGRAM_CODE"])
        if case and code:
            case["programs"].add(code)
            program_names.setdefault(code, ep.clean(row["PROGRAM_DESC"]))
    for row in zip_rows(archive, "CASE_FACILITIES.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        if case:
            case["facility_states"].append(row["STATE_CODE"])
    settlement_flags = collections.Counter()
    for row in zip_rows(archive, "CASE_DEFENDANTS.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        name = ep.clean(row["DEFENDANT_NAME"])
        settlement_flags[ep.clean(row.get("NAMED_IN_SETTLEMENT_FLAG"))] += 1
        if not case or not name:
            continue
        hit = next((d for d in case["defendants"] if d["name"] == name), None)
        if hit is None:
            hit = {"name": name, "complaint": False, "settlement": False}
            case["defendants"].append(hit)
        hit["complaint"] |= ep.clean(row["NAMED_IN_COMPLAINT_FLAG"]) == "Y"
        hit["settlement"] |= ep.clean(row.get("NAMED_IN_SETTLEMENT_FLAG")) == "Y"
    diag["named_in_settlement_flag_values"] = dict(settlement_flags)
    collected = {}
    dollars_mismatch = 0
    conclusion_amounts = {}
    for row in zip_rows(archive, "CASE_ENFORCEMENT_CONCLUSIONS.csv"):
        case = cases.get(ep.clean(row["ACTIVITY_ID"]))
        if case is None:
            continue
        conc = {
            "conclusion_id": ep.clean(row["ENF_CONCLUSION_ID"]), "fy": ep.fiscal_year(row["SETTLEMENT_FY"]),
            "entered": ep.us_date(row["SETTLEMENT_ENTERED_DATE"]), "region": ep.clean(row["REGION_CODE"]) or None,
            "type": ep.clean(row["ACTIVITY_TYPE_CODE"]) or None,
            "fed_penalty": ep.money(row["FED_PENALTY_ASSESSED_AMT"]), "st_lcl_penalty": ep.money(row["STATE_LOCAL_PENALTY_AMT"]),
            "sep": ep.money(row["SEP_AMT"]), "compliance_cost": ep.money(row["COMPLIANCE_ACTION_COST"]),
            "cost_recovery": ep.money(row["COST_RECOVERY_AWARDED_AMT"]), "penalty_collected": None,
        }
        for key in ("fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "cost_recovery"):
            if conc[key] is not None and conc[key] < 0:
                negatives["conclusion:" + key] += 1
        case["conclusions"].append(conc)
        conclusion_amounts[conc["conclusion_id"]] = conc
        if conc["region"] != case["region"]:
            diag["conclusion_region_differs"] = diag.get("conclusion_region_differs", 0) + 1
        if conc["type"] != case["type"]:
            diag["conclusion_type_differs"] = diag.get("conclusion_type_differs", 0) + 1
    for row in zip_rows(archive, "CASE_ENFORCEMENT_CONCLUSION_DOLLARS.csv"):
        conc = conclusion_amounts.get(ep.clean(row["ENF_CONCLUSION_ID"]))
        if conc is None:
            continue
        conc["penalty_collected"] = ep.money(row["PENALTY_COLLECTED_AMT"])
        if round(ep.money(row["FED_PENALTY"]) or 0, 2) != round(conc["fed_penalty"] or 0, 2):
            dollars_mismatch += 1
    diag["conclusion_dollars_fed_penalty_mismatch"] = dollars_mismatch
    diag["negative_values"] = dict(negatives)
    case_vs_settled = 0
    for case in cases.values():
        case["statute"] = ep.primary_statute(case["sections"])
        case["states"] = ep.state_codes(case["facility_states"])
        case["programs"] = sorted(case["programs"])
        del case["sections"], case["facility_states"]
        settled = round(sum(c["fed_penalty"] or 0 for c in case["conclusions"]), 2)
        if case["pen"] is not None and round(case["pen"]["fed_penalty"] or 0, 2) != settled:
            case_vs_settled += 1
    diag["case_fed_penalty_vs_settlement_sum_mismatch"] = case_vs_settled
    diag["conclusions"] = sum(len(c["conclusions"]) for c in cases.values())
    diag["conclusions_without_fy"] = sum(1 for c in cases.values() for s in c["conclusions"] if not s["fy"])
    diag["cases_without_penalty_record"] = sum(1 for c in cases.values() if c["pen"] is None)
    diag["cases_without_facility_state"] = sum(1 for c in cases.values() if not c["states"])
    diag["multistate_cases"] = sum(1 for c in cases.values() if len(c["states"]) > 1)
    diag["lead_values"] = dict(collections.Counter(c["lead"] for c in cases.values()))
    numbers = collections.Counter(c["case_number"] for c in cases.values())
    diag["duplicate_case_numbers"] = {k: v for k, v in numbers.items() if v > 1}
    if diag["duplicate_case_numbers"]:
        raise SystemExit(f"case numbers are not unique: {list(diag['duplicate_case_numbers'])[:5]}")
    return cases, program_names


def national_groups(cases):
    view = [{"case_number": c["case_number"], "name": c["name"], "fed_penalty": (c["pen"] or {}).get("fed_penalty"),
             "settlements": [{"entered": s["entered"], "fed_penalty": s["fed_penalty"]} for s in c["conclusions"]],
             "defendants": [d["name"] for d in c["defendants"]]} for c in cases.values()]
    twins = find_twins(view)
    dupes = possible_duplicates(view, twins)
    bundle_of = dict(twins)
    for lead in set(twins.values()):
        bundle_of[lead] = lead
    return twins, [[c["case_number"] for c in g] for g in dupes], {i: g[0]["fed_penalty"] for i, g in enumerate(dupes)}, bundle_of


# ---------------------------------------------------------------- shared row helpers


def usd(value):
    return "Not recorded" if value is None else "${:,.2f}".format(value)


def num(value):
    return "Not recorded" if value is None else "{:,}".format(value)


def pct(value):
    return "n/a (prior fiscal year zero or absent)" if value is None else "{:+.1f}%".format(value)


def share(value):
    return "Not recorded (no positive federal penalty)" if value is None else "{:.1f}%".format(value * 100)


def facts(pairs):
    return [[label, "Not recorded" if value is None else str(value)] for label, value in pairs]


def scope_meta(scope):
    kind, _, code = scope.partition(":")
    if scope == "US":
        return {"kind": "national", "code": "US", "name": "United States (all EPA cases)"}
    if kind == "region":
        name = REGION_NAMES.get(code) or (f"EPA Region {int(code)} (case region {code})" if code.isdigit() else f"Case region {code} (as recorded)")
        return {"kind": "region", "code": code, "name": name}
    if code == "NR":
        return {"kind": "unrecorded", "code": "NR", "name": "No facility state recorded"}
    if code in STATES:
        return {"kind": "state", "code": code, "name": STATES[code][1]}
    if code in TERRITORIES:
        return {"kind": "territory", "code": code, "name": TERRITORIES[code]}
    return {"kind": "other", "code": code, "name": f"Facility state code {code} (as recorded)"}


def scope_order(scope):
    meta = scope_meta(scope)
    rank = {"national": 0, "region": 1, "state": 2, "territory": 3, "other": 4, "unrecorded": 5}[meta["kind"]]
    return (rank, meta["code"])


# ---------------------------------------------------------------- dataset 1: case series


def build_series(cases, program_names, bundle_of, pop, profile_ids, file_date, retrieved):
    acc = ep.aggregate_series(cases.values(), bundle_of)
    by_scope = collections.defaultdict(dict)
    for (scope, key), cell in acc.items():
        by_scope[scope][key] = ep.finalize_cell(cell)
    rows = []
    source_pairs = [
        ("Source", "EPA ECHO ICIS-FE&C case downloads (case_downloads.zip): CASE_ENFORCEMENTS, CASE_ENFORCEMENT_CONCLUSIONS, CASE_ENFORCEMENT_CONCLUSION_DOLLARS, CASE_PENALTIES, CASE_LAW_SECTIONS, CASE_PROGRAMS, CASE_FACILITIES"),
        ("File date", file_date), ("Retrieved", retrieved),
        ("Units", "Nominal U.S. dollars as recorded (not inflation-adjusted); counts of cases and settlement records"),
    ]
    latest_complete = max(fy for scope in by_scope.values() for fy in scope if fy != "all" and ep.fy_complete(fy, file_date))
    window_years = range(PER_CAPITA_WINDOW[0], PER_CAPITA_WINDOW[1] + 1)
    state_window = {}
    for scope, by_key in by_scope.items():
        meta = scope_meta(scope)
        if meta["kind"] == "state" and pop.get(meta["code"]):
            state_window[meta["code"]] = {
                "fed": sum(by_key[f]["fed_penalty"] for f in window_years if f in by_key),
                "opened": sum(by_key[f]["opened"] for f in window_years if f in by_key), "pop": pop[meta["code"]]}
    ranks = {
        "fed_penalty_total": ep.rank_desc({c: v["fed"] for c, v in state_window.items()}),
        "fed_penalty_per_resident": ep.rank_desc({c: v["fed"] / v["pop"] for c, v in state_window.items()}),
        "opened_total": ep.rank_desc({c: v["opened"] for c, v in state_window.items()}),
        "opened_per_100k_residents": ep.rank_desc({c: v["opened"] / v["pop"] * 100000 for c, v in state_window.items()}),
    }
    for scope in sorted(by_scope, key=scope_order):
        meta = scope_meta(scope)
        series = {k: v for k, v in by_scope[scope].items() if k != "all"}
        ep.add_yoy(series, in_progress={fy for fy in series if not ep.fy_complete(fy, file_date)})
        usps = meta["code"] if meta["kind"] == "state" else None
        state_field = meta["code"] if meta["kind"] in ("state", "territory") else ""
        place_links = [{"label": f"{meta['name']} place profile", "url": f"/places/{usps}"}] if usps else []
        profile_id = f"epa-profile:{meta['code']}" if meta["kind"] in ("national", "state", "territory", "other", "unrecorded") else None
        if profile_id and profile_id in profile_ids:
            place_links.append({"label": "EPA enforcement profile (regulatory_epa_state_profiles)", "url": f"/records/regulatory_epa_state_profiles/{profile_id}"})
        population_value = pop.get(meta["code"]) if meta["kind"] in ("state", "territory") else (sum(v for k, v in pop.items() if k in STATES) if meta["kind"] == "national" else None)
        for key in sorted(series) + ["all"]:
            row = by_scope[scope][key]
            is_all = key == "all"
            fy_label = "All fiscal years" if is_all else f"FY{key}"
            status = None if is_all else ("complete" if ep.fy_complete(key, file_date) else "in progress at file date")
            item = {"scope": meta, "fy": None if is_all else key, "fy_status": status, **row}
            per_capita = None
            if population_value and meta["kind"] in ("state", "territory", "national"):
                denominator = ("Resident population of the 50 states and the District of Columbia (excludes Puerto Rico and other territories), July 1, 2025"
                               if meta["kind"] == "national" else f"Resident population of {meta['name']}, July 1, 2025")
                denominator += " (Census Bureau Vintage 2025 estimates, POPESTIMATE2025)"
                if is_all:
                    window = [series[f]["fed_penalty"] for f in window_years if f in series]
                    opened_window = sum(series[f]["opened"] for f in window_years if f in series)
                    single = series.get(PER_CAPITA_FY, {}).get("fed_penalty", 0.0)
                    per_capita = {
                        "denominator": denominator,
                        "population": population_value, "population_year": POP_YEAR, "source": CENSUS_URL,
                        "fy2025_fed_penalty_per_resident": round(single / population_value, 4),
                        "fy2016_2025_fed_penalty_per_resident": round(sum(window) / population_value, 4),
                        "fy2016_2025_opened_per_100k_residents": round(opened_window / population_value * 100000, 4),
                        "formula": ("federal penalties settled (SETTLEMENT_FY basis, facility-state attribution; a multi-state case's penalty is credited in full to each of its states) / POPESTIMATE2025"
                                    if meta["kind"] != "national" else
                                    "all federal penalties settled in the download (including territories, foreign and unrecorded locations) / POPESTIMATE2025 summed over the 50 states and DC"),
                        "window": f"FY{PER_CAPITA_WINDOW[0]}-FY{PER_CAPITA_WINDOW[1]} settlement years (cases opened for the opened rate); one population year (2025) is the denominator for the whole window",
                    }
                    if meta["kind"] == "state" and meta["code"] in state_window:
                        item["rankings"] = {
                            "basis": f"{len(state_window)} jurisdictions (50 states + DC), FY{PER_CAPITA_WINDOW[0]}-FY{PER_CAPITA_WINDOW[1]}; rank 1 = highest; standard competition ranking",
                            "n": len(state_window), **{name: table[meta["code"]] for name, table in ranks.items()}}
                elif key == PER_CAPITA_FY:
                    per_capita = {"denominator": denominator, "population": population_value,
                                  "population_year": POP_YEAR, "source": CENSUS_URL,
                                  "fed_penalty_per_resident": round(row["fed_penalty"] / population_value, 4)}
            if per_capita:
                item["per_capita"] = per_capita
            if is_all:
                fys = sorted(series)
                complete = [f for f in fys if ep.fy_complete(f, file_date)]
                prior10 = [f for f in range(latest_complete - 10, latest_complete)]
                item["analytics"] = {
                    "first_fy": fys[0] if fys else None, "last_fy": fys[-1] if fys else None, "latest_complete_fy": latest_complete,
                    "peak_opened_fy": max(complete, key=lambda f: (series[f]["opened"], f)) if complete else None,
                    "peak_fed_penalty_fy": max(complete, key=lambda f: (series[f]["fed_penalty"], f)) if complete else None,
                    "latest_opened": series.get(latest_complete, {}).get("opened", 0),
                    "median_opened_prior10": ep.median([series.get(f, {}).get("opened", 0) for f in prior10]),
                    "latest_fed_penalty": series.get(latest_complete, {}).get("fed_penalty", 0.0),
                    "median_fed_penalty_prior10": ep.median([series.get(f, {}).get("fed_penalty", 0.0) for f in prior10]),
                    "prior10_window": [prior10[0], prior10[-1]],
                }
            title = f"{meta['name']} — EPA enforcement, {fy_label}"
            subtitle = (f"{row['opened']:,} cases opened · {row['concluded_cases']:,} cases concluded · "
                        f"federal penalties settled {usd(row['fed_penalty'])}")
            fact_pairs = source_pairs + [
                ("Scope", f"{meta['name']} ({meta['kind']})"),
                ("Attribution", {"national": "All cases in the download",
                                 "region": "Cases whose CASE_ENFORCEMENTS.REGION_CODE is this code (case-level region)",
                                 }.get(meta["kind"], "Cases with at least one CASE_FACILITIES row in this state code; a multi-state case counts in each of its states (not additive across states)")),
                ("Fiscal year", fy_label + (f" ({status})" if status else "")),
                ("Cases opened (CASE_ENFORCEMENTS.FISCAL_YEAR)", num(row["opened"])),
                ("Civil judicial opened", num(row["opened_judicial"])),
                ("Administrative formal opened", num(row["opened_administrative"])),
                ("Cases concluded (distinct cases with a settlement in this FY, SETTLEMENT_FY)", num(row["concluded_cases"])),
                ("Settlement records (enforcement conclusions)", num(row["conclusions"])),
                ("Federal penalties, computed sum of recorded settlement FED_PENALTY_ASSESSED_AMT", usd(row["fed_penalty"])),
                ("State/local penalties, computed sum of STATE_LOCAL_PENALTY_AMT", usd(row["st_lcl_penalty"])),
                ("SEP amounts, computed sum of SEP_AMT", usd(row["sep"])),
                ("Compliance action cost, computed sum of COMPLIANCE_ACTION_COST", usd(row["compliance_cost"])),
                ("Cost recovery, computed sum of COST_RECOVERY_AWARDED_AMT", usd(row["cost_recovery"])),
                ("Penalty collected, computed sum of CONCLUSION_DOLLARS.PENALTY_COLLECTED_AMT (not reported by all source systems)", usd(row["penalty_collected"])),
                ("Case-level totals for cases opened (CASE_PENALTIES; federal / state-local cost recovery)",
                 f"{usd(row['case_level']['fed_penalty'])} federal penalty; {usd(row['case_level']['fed_cost_recovery'])} / {usd(row['case_level']['st_cost_recovery'])} cost recovery"),
                ("Top-10 case share of settled federal penalties (computed)", share(row["top10_case_share"])),
                ("Largest single case: lead case number, settled federal penalty, share of the row's settled federal penalties (computed)",
                 "Not recorded (no positive federal penalty)" if not row["largest_case"] else
                 f"{row['largest_case']['case_number']}: {usd(row['largest_case']['fed_penalty'])}, {share(row['largest_case']['share_of_fed_penalty'])}"),
            ]
            if not is_all:
                note = row["yoy"].get("note")
                fact_pairs += [("Change vs prior FY: cases opened", f"n/a ({note})" if note else pct(row["yoy"]["opened_pct"])),
                               ("Change vs prior FY: federal penalties settled", f"n/a ({note})" if note else pct(row["yoy"]["fed_penalty_pct"]))]
            if row.get("unattributed"):
                fact_pairs.append(("Settlements without SETTLEMENT_FY (all-years row only)", f"{row['unattributed']['conclusions']:,} records, {usd(row['unattributed']['fed_penalty'])} federal penalty"))
            if per_capita:
                if is_all:
                    fact_pairs.append((f"Federal penalties settled per resident, FY2016–FY2025 (denominator: {per_capita['denominator']})", "${:,.2f}".format(per_capita["fy2016_2025_fed_penalty_per_resident"])))
                    fact_pairs.append((f"Cases opened per 100,000 residents, FY2016–FY2025 (same denominator)", "{:,.2f}".format(per_capita["fy2016_2025_opened_per_100k_residents"])))
                    if "rankings" in item:
                        rk = item["rankings"]
                        fact_pairs.append((f"Rank among {rk['n']} states and DC, FY2016–FY2025: federal penalties per resident / federal penalties total / cases opened per 100,000 / cases opened",
                                           f"{rk['fed_penalty_per_resident']} / {rk['fed_penalty_total']} / {rk['opened_per_100k_residents']} / {rk['opened_total']}"))
                else:
                    fact_pairs.append((f"Federal penalties settled per resident (denominator: {per_capita['denominator']})", "${:,.4f}".format(per_capita["fed_penalty_per_resident"])))
            links = place_links + [{"label": "ECHO case downloads", "url": CASE_ZIP_URL}, {"label": "ICIS-FE&C data dictionary", "url": FEC_DICT_URL}]
            if per_capita:
                links.append({"label": "Census NST-EST2025-ALLDATA (population denominator)", "url": CENSUS_URL})
            rid = f"epa-echo-series:{scope}:{'all' if is_all else key}"
            rows.append(writer.record(
                "epa_echo_case_series", rid, title, source_url=CASE_ZIP_URL, subtitle=subtitle, state=state_field,
                cells={"scope": meta["name"], "fy": "All" if is_all else key, "opened": row["opened"], "judicial": row["opened_judicial"],
                       "concluded": row["concluded_cases"], "fed_penalty": row["fed_penalty"], "st_lcl_penalty": row["st_lcl_penalty"],
                       "sep": row["sep"], "compliance_cost": row["compliance_cost"], "cost_recovery": row["cost_recovery"]},
                facts=facts(fact_pairs),
                text=" ".join([meta["name"], meta["code"], fy_label]),
                filters={"kind": [meta["kind"]], "scope": [scope], "fy": ["all" if is_all else str(key)], "fy_status": ["all" if is_all else ("complete" if status == "complete" else "in_progress")]},
                badges=[meta["kind"].title(), fy_label] + ([status] if status and status != "complete" else []),
                links=links, extra={"series": item},
            ))
    return rows, latest_complete


# ---------------------------------------------------------------- dataset 2: defendants


def build_defendants(cases, twins, dupes, dupe_amounts, title_rows, file_date, retrieved, national_total):
    table = ep.defendant_table(cases.values(), twins, dupes)
    index = ep.title_index(title_rows)
    variants = collections.defaultdict(set)
    for name in table:
        variants[ep.name_key(name)].add(name)
    ranked = sorted((r for r in table.values() if r["fed_penalty"] > 0), key=lambda r: (-r["fed_penalty"], r["name"]))
    ranked_sole = sorted((r for r in table.values() if r["fed_penalty_sole"] > 0), key=lambda r: (-r["fed_penalty_sole"], r["name"]))
    rank_named = {r["name"]: i for i, r in enumerate(ranked, 1)}
    rank_sole = {r["name"]: i for i, r in enumerate(ranked_sole, 1)}
    match_all = {name: ep.match_company(name, index) for name in table}
    selected = {r["name"] for r in ranked[:DEFENDANT_LIMIT]} | {r["name"] for r in ranked_sole[:DEFENDANT_LIMIT]}
    selected |= {name for name, (status, _) in match_all.items() if status in ("matched", "ambiguous")}
    order = sorted(selected, key=lambda n: (rank_named.get(n, 10 ** 9), rank_sole.get(n, 10 ** 9), n))
    stats = {"distinct_names": len(table), "names_with_fed_penalty": len(ranked), "names_with_sole_fed_penalty": len(ranked_sole),
             "published": len(order), "selection": f"union of top {DEFENDANT_LIMIT} by fed_penalty_named, top {DEFENDANT_LIMIT} by fed_penalty_sole, and every name with an exact SEC title match",
             "variant_keys_with_several_exact_names": sum(1 for v in variants.values() if len(v) > 1)}
    stats["company_match_all_names"] = dict(collections.Counter(status for status, _ in match_all.values()))
    rows, matched, ambiguous = [], [], []
    top_union, top_union_sole = set(), set()
    for name in order:
        r = table[name]
        rank, rank_s = rank_named.get(name), rank_sole.get(name)
        status, cik = match_all[name]
        if status == "matched":
            matched.append({"name": name, "cik": cik, "rank": rank, "rank_sole": rank_s})
        elif status == "ambiguous":
            ambiguous.append({"name": name, "ciks": cik})
        if rank and rank <= 10:
            top_union.update(number for _, number, *_ in r["cases"])
        if rank_s and rank_s <= 10:
            top_union_sole.update(number for _, number, *_ in r["cases"])
        top_cases = sorted(r["cases"], key=lambda c: (-c[0], c[1]))[:10]
        largest = top_cases[0][0] if top_cases else 0.0
        other = sorted(variants[ep.name_key(r["name"])] - {r["name"]})
        extra = ep.dupe_extra(r, dupe_amounts)
        settle_fys = sorted(set(r["settlement_fys"]))
        item = {
            "rank": rank, "rank_sole": rank_s, "name": r["name"], "cases_named": len(r["cases"]), "cases_sole": r["sole"],
            "cases_with_codefendants": len(r["cases"]) - r["sole"], "max_codefendants_in_a_case": r["codefendants_max"],
            "largest_case_share_of_named": round(largest / r["fed_penalty"], 6) if r["fed_penalty"] > 0 else None,
            "cases_with_fed_penalty": r["with_penalty"], "cases_without_penalty_record": r["no_penalty_record"],
            "judicial": r["judicial"], "administrative": r["administrative"],
            "named_in_complaint": r["complaint"], "named_in_settlement": r["settlement"],
            "fed_penalty_named": round(r["fed_penalty"], 2), "fed_penalty_sole": round(r["fed_penalty_sole"], 2),
            "st_lcl_penalty_named": round(r["st_lcl_penalty"], 2), "sep_named": round(r["sep"], 2),
            "compliance_cost_named": round(r["compliance_cost"], 2), "fed_cost_recovery_named": round(r["fed_cost_recovery"], 2),
            "st_cost_recovery_named": round(r["st_cost_recovery"], 2), "penalty_collected_named": round(r["penalty_collected"], 2),
            "share_of_national_fed_penalty": round(r["fed_penalty"] / national_total, 6) if national_total else None,
            "first_fy_opened": min(r["fys"]) if r["fys"] else None, "last_fy_opened": max(r["fys"]) if r["fys"] else None,
            "first_settlement_fy": settle_fys[0] if settle_fys else None, "last_settlement_fy": settle_fys[-1] if settle_fys else None,
            "statutes": [[k, v] for k, v in r["statutes"].most_common()], "states": [[k, v] for k, v in r["states"].most_common(12)],
            "regions": [[k, v] for k, v in r["regions"].most_common()],
            "top_cases": [{"case_number": n, "name": nm, "fy": fy, "type": t, "fed_penalty": round(f, 2), "url": CASE_URL.format(n)} for f, n, nm, fy, t in top_cases],
            "national_case_leads": sorted(r["national_cases"]),
            "possible_duplicate_extra_fed_penalty": extra,
            "exact_name_variants": other,
            "parent_names": None,
            "company": {"status": status, "cik": cik if status == "matched" else None, "candidates": cik if status == "ambiguous" else None,
                        "method": "exact title match after case-folding and whitespace collapsing, unique within company_sec_profiles"},
        }
        links = [{"label": f"ECHO case report {c['case_number']}", "url": c["url"]} for c in item["top_cases"][:5]]
        if status == "matched":
            links.insert(0, {"label": "SEC company profile", "url": f"/companies/{cik}"})
        links += [{"label": "ECHO case downloads", "url": CASE_ZIP_URL}]
        statutes = [k for k, _ in r["statutes"].most_common()]
        states = [k for k, _ in r["states"].most_common()]
        rid = "epa-echo-defendant:" + hashlib.sha1(r["name"].encode("utf-8")).hexdigest()[:16]
        fact_pairs = [
            ("Source", "EPA ECHO ICIS-FE&C case downloads: CASE_DEFENDANTS (DEFENDANT_NAME exact), CASE_PENALTIES (case-level totals)"),
            ("File date", file_date), ("Retrieved", retrieved), ("Period", "All fiscal years in the download"),
            ("Units", "Nominal U.S. dollars as recorded"),
            ("Defendant name (exact as recorded)", r["name"]),
            ("Rank by federal penalties in cases naming this defendant (joint credit)", f"{rank} of {stats['names_with_fed_penalty']:,}" if rank else "Not ranked (no federal penalty)"),
            ("Rank by federal penalties in sole-defendant cases (additive)", f"{rank_s} of {stats['names_with_sole_fed_penalty']:,}" if rank_s else "Not ranked (no sole-defendant federal penalty)"),
            ("Cases naming this defendant", num(len(r["cases"]))),
            ("Cases where it is the only named defendant", num(r["sole"])),
            ("Most co-defendants named on one of its cases", num(r["codefendants_max"])),
            ("Largest single case as share of its joint-credit total (computed)", share(item["largest_case_share_of_named"])),
            ("Federal penalties, computed sum of CASE_PENALTIES.FED_PENALTY over cases naming it (joint credit; overlaps co-defendants)", usd(item["fed_penalty_named"])),
            ("Federal penalties in sole-defendant cases (computed)", usd(item["fed_penalty_sole"])),
            ("SEP / state-local penalties in cases naming it (computed)", f"{usd(item['sep_named'])} / {usd(item['st_lcl_penalty_named'])}"),
            ("Civil judicial / administrative cases", f"{r['judicial']:,} / {r['administrative']:,}"),
            ("Fiscal years opened", f"FY{item['first_fy_opened']}–FY{item['last_fy_opened']}" if item["first_fy_opened"] else "Not recorded"),
            ("Primary statutes (cases)", ", ".join(f"{k} {v}" for k, v in r["statutes"].most_common(5))),
            ("Facility states (cases)", ", ".join(f"{k} {v}" for k, v in r["states"].most_common(8))),
            ("Parent company", "Not recorded (the ICIS-FE&C download has no parent field)"),
            ("Other exact names with the same case-insensitive spelling (not merged)", "; ".join(other) or "None"),
            ("Multi-record national cases among its cases (lead case numbers)", ", ".join(item["national_case_leads"]) or "None"),
            ("Possible double count from look-alike duplicate records (computed)", usd(extra) if extra else "None"),
            ("SEC company link", f"/companies/{cik} (exact unique title match)" if status == "matched" else ("Ambiguous: several SEC profiles share this title; not linked" if status == "ambiguous" else "No exact title match")),
        ]
        rows.append(writer.record(
            "epa_echo_defendants", rid, r["name"], source_url=CASE_ZIP_URL,
            subtitle=(f"#{rank} joint · " if rank else "") + (f"#{rank_s} sole · " if rank_s else "")
            + f"{len(r['cases']):,} cases · federal penalties in cases naming it {usd(item['fed_penalty_named'])}",
            cells={"rank": rank, "rank_sole": rank_s, "name": r["name"], "cases": len(r["cases"]), "judicial": r["judicial"],
                   "max_codefendants": r["codefendants_max"],
                   "fed_penalty": item["fed_penalty_named"], "fed_penalty_sole": item["fed_penalty_sole"],
                   "fys": f"{item['first_fy_opened']}–{item['last_fy_opened']}" if item["first_fy_opened"] else None,
                   "statutes": ", ".join(statutes[:3]) or None, "states": ", ".join(states[:4]) or None},
            facts=facts(fact_pairs),
            text=" ".join([r["name"]] + other + [c["case_number"] for c in item["top_cases"]] + [c["name"] or "" for c in item["top_cases"][:5]]),
            filters={"statute": statutes or ["NR"], "state": states or ["NR"], "company_linked": ["yes" if status == "matched" else "no"],
                     "national_case": ["yes" if item["national_case_leads"] else "no"],
                     "codefendants": ["sole_only" if r["sole"] == len(r["cases"]) else ("with_codefendants_only" if r["sole"] == 0 else "mixed")]},
            badges=([f"#{rank} joint"] if rank else []) + ([f"#{rank_s} sole"] if rank_s else []) + (["SEC profile"] if status == "matched" else [])
            + (["National case records"] if item["national_case_leads"] else []) + ([f"Up to {r['codefendants_max']} co-defendants"] if r["codefendants_max"] >= 5 else []),
            links=links, extra={"defendant": item},
        ))
    by_number = {c["case_number"]: c for c in cases.values()}
    union_total = sum((by_number[n]["pen"] or {}).get("fed_penalty") or 0 for n in top_union)
    stats["top10_names_union_case_fed_penalty"] = round(union_total, 2)
    stats["top10_names_union_share"] = round(union_total / national_total, 6) if national_total else None
    union_sole = sum((by_number[n]["pen"] or {}).get("fed_penalty") or 0 for n in top_union_sole)
    stats["top10_sole_names_union_case_fed_penalty"] = round(union_sole, 2)
    stats["top10_sole_names_union_share"] = round(union_sole / national_total, 6) if national_total else None
    sole_top10 = sum(r["fed_penalty_sole"] for r in ranked_sole[:10])
    stats["top10_sole_penalty_share"] = round(sole_top10 / national_total, 6) if national_total else None
    stats["company_matched_published"] = matched
    stats["company_ambiguous_published"] = ambiguous
    return rows, stats


# ---------------------------------------------------------------- dataset 3: state programs


def build_state_programs(exporter_date, retrieved):
    cutoff = "%04d-%s" % (int(exporter_date[:4]) - 5, exporter_date[5:])
    acc = collections.defaultdict(ep.new_program_acc)
    archive = zipfile.ZipFile(EXPORTER_ZIP)
    n = 0
    for row in zip_rows(archive, "ECHO_EXPORTER.csv"):
        code = ep.clean(row.get("FAC_STATE")).upper() or "NR"
        ep.add_exporter_row(acc[code], row, cutoff)
        ep.add_exporter_row(acc["US"], row, cutoff)
        n += 1
    rows = []

    def meta(code):
        if code == "US":
            return {"kind": "national", "code": "US", "name": "United States (all ECHO Exporter facilities)"}
        if code == "NR":
            return {"kind": "unrecorded", "code": "NR", "name": "No facility state recorded"}
        return scope_meta("state:" + code)

    order = sorted(acc, key=lambda c: ({"national": 0, "state": 1, "territory": 2, "other": 3, "unrecorded": 4}[meta(c)["kind"]], c))
    for code in order:
        a = acc[code]
        m = meta(code)
        programs = {}
        for program, p in a["programs"].items():
            programs[program] = {
                "with_id": p["with_id"], "formal_action_facilities_5y": p["formal_5y"], "formal_actions_5y": p["formal_actions_5y"],
                "snc_or_hpv_now": p["snc_now"], "inspected_facilities_5y": p["inspected_5y"] if program != "SDWA" else None,
                "snc_share_of_with_id": round(p["snc_now"] / p["with_id"], 6) if p["with_id"] else None,
                "formal_share_of_with_id": round(p["formal_5y"] / p["with_id"], 6) if p["with_id"] else None,
                "status": dict(sorted(p["status"].items(), key=lambda kv: (-kv[1], kv[0]))),
            }
        item = {
            "scope": m, "facilities": a["facilities"], "active_flag": a["active_flag"], "programs": programs,
            "any_formal_action_5y": a["any_formal_5y"], "any_formal_action_date_older_than_5y": a["any_formal_date_older"],
            "federal_case_facilities_5y": a["fec_cases_5y"], "any_program_snc_or_hpv_now": a["any_snc_now"],
            "fac_snc_flag_y_as_recorded": a["fac_snc_flag_y"], "inspected_facilities_5y": a["inspected_5y"],
            "informal_action_facilities_5y": a["informal_5y"],
            "facility_compliance_status": dict(sorted(a["fac_status"].items(), key=lambda kv: (-kv[1], kv[0]))),
            "file_date": exporter_date, "five_year_cutoff": cutoff,
        }
        usps = m["code"] if m["kind"] == "state" else None
        links = ([{"label": f"{m['name']} place profile", "url": f"/places/{usps}"}] if usps else []) + [
            {"label": "ECHO Exporter download", "url": EXPORTER_URL}, {"label": "ECHO Exporter column dictionary", "url": EXPORTER_DICT_URL}]
        P = programs
        fact_pairs = [
            ("Source", "EPA ECHO Exporter (echo_exporter.zip, ECHO_EXPORTER.csv), one row per FRS facility"),
            ("File date", exporter_date), ("Retrieved", retrieved),
            ("Period", f"Program counts: the last five years per the ECHO Exporter dictionary (20 completed quarters plus the current quarter); SNC/HPV: status at extraction ({exporter_date})"),
            ("Units", "Facilities (FRS registry IDs); formal actions as counted by ECHO"),
            ("Attribution", "FAC_STATE as maintained by FRS"),
            ("Facilities in the Exporter", num(a["facilities"])),
            ("Facilities with an active ICIS-Air, ICIS-NPDES, RCRA or SDWA permit (FAC_ACTIVE_FLAG = Y)", num(a["active_flag"])),
            ("CAA facilities (AIR_FLAG = Y)", num(P["CAA"]["with_id"])),
            ("CWA facilities (NPDES_FLAG = Y; includes terminated permits, see status)", num(P["CWA"]["with_id"])),
            ("RCRA facilities (RCRA_FLAG = Y)", num(P["RCRA"]["with_id"])),
            ("SDWA systems (SDWIS_FLAG = Y; includes inactive, see status)", num(P["SDWA"]["with_id"])),
            ("Facilities with a formal action in 5 years: CAA / CWA / RCRA / SDWA (program-system actions; per the dictionary the CWA and RCRA counts exclude federal actions entered in ICIS, which are counted in the federal-case line below)",
             " / ".join(num(P[p]["formal_action_facilities_5y"]) for p in ("CAA", "CWA", "RCRA", "SDWA"))),
            ("Facilities with any formal action (FAC_FORMAL_ACTION_COUNT > 0; ICIS-Air, ICIS-NPDES, SDWIS and RCRAInfo actions; federal ICIS-FE&C cases are counted separately)", num(a["any_formal_5y"])),
            ("Facilities with a federal enforcement case in 5 years (FEC_NUMBER_OF_CASES > 0)", num(a["fec_cases_5y"])),
            ("Current significant violators: CAA HPV / CWA SNC / RCRA SNC / SDWA serious violator",
             " / ".join(num(P[p]["snc_or_hpv_now"]) for p in ("CAA", "CWA", "RCRA", "SDWA"))),
            ("Facilities flagged in at least one program (computed OR of the four program flags)", num(a["any_snc_now"])),
            ("FAC_SNC_FLG = Y (as recorded; 'N' on every row of this file)", num(a["fac_snc_flag_y"])),
        ]
        rows.append(writer.record(
            "epa_echo_state_programs", f"epa-echo-programs:{code}", f"{m['name']} — ECHO regulated facilities and significant violators",
            source_url=EXPORTER_URL, state=m["code"] if m["kind"] in ("state", "territory") else "",
            subtitle=f"{a['facilities']:,} facilities · {a['any_snc_now']:,} current significant violators · {a['any_formal_5y']:,} with formal actions (5 yr)",
            cells={"state": m["name"], "facilities": a["facilities"], "caa": P["CAA"]["with_id"], "cwa": P["CWA"]["with_id"],
                   "rcra": P["RCRA"]["with_id"], "sdwa": P["SDWA"]["with_id"], "formal_5y": a["any_formal_5y"],
                   "snc_now": a["any_snc_now"]},
            facts=facts(fact_pairs), text=" ".join([m["name"], m["code"]]), filters={"kind": [m["kind"]]},
            badges=[m["kind"].title()], links=links, extra={"programs": item},
        ))
    return rows, n, cutoff


# ---------------------------------------------------------------- main


def write_build(dataset, label, rows, listing_block, summary, inputs):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    payload = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
               "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "inputs": inputs}
    path = os.path.join(BUILD, f"{dataset}.json")
    with open(path, "w") as out:
        json.dump(payload, out, separators=(",", ":"), sort_keys=False)
    log(dataset, len(rows), "rows", os.path.getsize(path), "bytes")


def main(argv):
    os.makedirs(BUILD, exist_ok=True)
    entries = manifest()
    diag = {}
    case_dates = zip_dates(CASE_ZIP)
    file_date = case_dates["CASE_ENFORCEMENTS.csv"]
    retrieved = (entries.get(os.path.relpath(CASE_ZIP, ROOT)) or {}).get("retrieved_at", "")[:10]
    pop = population()
    profile_ids = set(json.load(open(os.path.join(LOOKUPS, "regulatory_epa_state_profiles_ids.json")))["ids"])
    title_rows = json.load(open(os.path.join(LOOKUPS, "company_sec_profiles_titles.json")))["rows"]
    case_inputs = [input_entry(entries, CASE_ZIP), input_entry(entries, CENSUS_CSV)]
    lookup_inputs = [{"url": "corpus:company_sec_profiles (read-only SELECT)", "path": os.path.relpath(os.path.join(LOOKUPS, "company_sec_profiles_titles.json"), ROOT), "sha256": sha256(os.path.join(LOOKUPS, "company_sec_profiles_titles.json"))},
                     {"url": "corpus:regulatory_epa_state_profiles ids (read-only SELECT)", "path": os.path.relpath(os.path.join(LOOKUPS, "regulatory_epa_state_profiles_ids.json"), ROOT), "sha256": sha256(os.path.join(LOOKUPS, "regulatory_epa_state_profiles_ids.json"))}]

    cases, program_names = load_cases(diag)
    twins, dupes, dupe_amounts, bundle_of = national_groups(cases)
    diag["national_case_groups"] = len(set(twins.values()))
    diag["lookalike_groups"] = len(dupes)
    facility_codes = collections.Counter(s for c in cases.values() for s in c["states"])
    diag["facility_state_codes_other"] = {k: v for k, v in sorted(facility_codes.items()) if k not in STATES and k not in TERRITORIES}
    log(json.dumps(diag, default=str)[:3000])

    common = {"source": CASE_ZIP_URL, "dictionary": FEC_DICT_URL, "downloads_page": DOWNLOADS_PAGE, "file_date": file_date,
              "retrieved": retrieved, "terms": "U.S. EPA public data (ECHO); see https://www.epa.gov/web-policies-and-procedures/epa-disclaimers"}

    series_rows, latest_complete = build_series(cases, program_names, bundle_of, pop, profile_ids, file_date, retrieved)
    national_all = next(r for r in series_rows if r["id"] == "epa-echo-series:US:all")["item"]["series"]
    statute_options = {code: f"{code}" for code in sorted(STATUTE_NAMES) if code != "NR"}
    statute_options["NR"] = "Not recorded"
    write_build(
        "epa_echo_case_series", "EPA enforcement case series by fiscal year (ECHO ICIS-FE&C, all years)", series_rows,
        writer.listing([("scope", "Scope"), ("fy", "Fiscal year"), ("opened", "Cases opened"), ("judicial", "Judicial opened"),
                        ("concluded", "Cases concluded"), ("fed_penalty", "Federal penalties ($)"), ("st_lcl_penalty", "State/local penalties ($)"),
                        ("sep", "SEP ($)"), ("compliance_cost", "Compliance action cost ($)"), ("cost_recovery", "Cost recovery ($)")],
                       [("kind", "Scope kind", {"national": "National", "region": "EPA region", "state": "State", "territory": "Territory", "other": "Other code", "unrecorded": "No state recorded"}),
                        ("fy_status", "Fiscal year status", {"complete": "Complete", "in_progress": "In progress", "all": "All years"})]),
        {**common,
         "grain": "one record per scope (national, case EPA region, facility state code) per fiscal year, plus one all-years record per scope",
         "scope_rules": "National: every case. Region: CASE_ENFORCEMENTS.REGION_CODE (01-10, HQ, EF, WF). State: every CASE_FACILITIES.STATE_CODE of the case (multi-state cases count in each state; state rows are not additive); cases with no facility state are in the 'NR' scope. CASE_ENFORCEMENTS.STATE_CODE is blank on every row of this file and is not used.",
         "time_basis": "Opened counts and case-level CASE_PENALTIES totals by CASE_ENFORCEMENTS.FISCAL_YEAR; concluded counts and settlement dollars by CASE_ENFORCEMENT_CONCLUSIONS.SETTLEMENT_FY (federal fiscal year of SETTLEMENT_ENTERED_DATE). Settlements without SETTLEMENT_FY appear only in all-years rows (series.unattributed).",
         "definitions": {
             "opened": "count of cases whose CASE_ENFORCEMENTS.FISCAL_YEAR is the FY",
             "concluded_cases": "count of distinct cases with at least one enforcement conclusion whose SETTLEMENT_FY is the FY (a case settled in two FYs counts in both)",
             "conclusions": "count of CASE_ENFORCEMENT_CONCLUSIONS records with SETTLEMENT_FY = FY",
             "fed_penalty / st_lcl_penalty / sep / compliance_cost / cost_recovery": "computed sums of recorded settlement-level FED_PENALTY_ASSESSED_AMT, STATE_LOCAL_PENALTY_AMT, SEP_AMT, COMPLIANCE_ACTION_COST, COST_RECOVERY_AWARDED_AMT",
             "penalty_collected": "computed sum of CASE_ENFORCEMENT_CONCLUSION_DOLLARS.PENALTY_COLLECTED_AMT (the dictionary notes it may not be submitted by all source systems)",
             "case_level": "computed sums of CASE_PENALTIES fields (case totals across all settlements, includes STATE_LOCAL_COST_RECOVERY_AMT) for cases opened in the FY",
             "dims": "compact arrays whose column order is given in dims_columns; breakdowns by case type (ACTIVITY_TYPE_CODE), primary statute (CASE_LAW_SECTIONS RANK_ORDER 1, first in file order), program (CASE_PROGRAMS.PROGRAM_CODE; a case counts under each of its programs, not additive) and case region",
             "yoy": "(value FY - value FY-1) / value FY-1 x 100; null when FY-1 is zero or absent",
             "top10_case_share": "sum of the 10 largest per-case settled federal penalties in the row / total settled federal penalties in the row; records of one multi-record national case are combined first (same rule as regulatory_epa_state_profiles)",
             "per_capita": f"settled federal penalties (facility-state attribution; a multi-state case's penalty is credited in full to each of its states, so state figures are not apportioned shares) / Census Vintage 2025 resident population for July 1, {POP_YEAR} ({CENSUS_URL}); FY{PER_CAPITA_FY} (single-year rows) and FY{PER_CAPITA_WINDOW[0]}–FY{PER_CAPITA_WINDOW[1]} (all-years rows, one population year over the whole window); national row: all settled penalties / population of the 50 states and DC; opened rate = cases opened FY{PER_CAPITA_WINDOW[0]}–FY{PER_CAPITA_WINDOW[1]} / population x 100,000. Read beside largest_case and top10_case_share: one large case can dominate a state.",
             "largest_case": "lead case number with the largest settled federal penalty in the row (records of a multi-record national case combined under the lead number), that penalty, and its share of the row's settled federal penalties; null when no positive penalty",
             "rankings": "all-years rows of the 50 states + DC only: standard competition rank (1 = highest) of FY2016–FY2025 settled federal penalties per resident, settled federal penalties total, cases opened per 100,000 residents and cases opened total, among the 51 jurisdictions",
             "analytics": f"all-years rows: peak FY (complete FYs), latest complete FY (FY{latest_complete}) vs median of the 10 prior FYs",
         },
         "dims_columns": ep.DIM_COLUMNS,
         "program_names": dict(sorted(program_names.items())), "statute_names": STATUTE_NAMES, "type_names": TYPE_NAMES,
         "latest_complete_fy": latest_complete,
         "national_totals": {k: national_all[k] for k in ("opened", "opened_judicial", "opened_administrative", "conclusions", "concluded_cases", "fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "cost_recovery", "penalty_collected", "top10_case_share")},
         "diagnostics": diag,
         "relationship": "Extends regulatory_epa_state_profiles (same source, same facility-state attribution and settlement-FY dollar basis) with region scopes, program/type/region breakdowns per FY, concluded-case counts, state/local cost recovery and penalty collected, year-over-year change and concentration.",
         },
        case_inputs + [lookup_inputs[1]],
    )

    national_case_total = national_all["case_level"]["fed_penalty"]
    defendant_rows, dstats = build_defendants(cases, twins, dupes, dupe_amounts, title_rows, file_date, retrieved, national_case_total)
    write_build(
        "epa_echo_defendants", "EPA enforcement defendants ranked by federal penalties (ECHO ICIS-FE&C, all years)", defendant_rows,
        writer.listing([("rank", "Rank (joint)"), ("rank_sole", "Rank (sole)"), ("name", "Defendant (exact recorded name)"), ("cases", "Cases"),
                        ("judicial", "Judicial"), ("fed_penalty", "Federal penalties in cases naming it ($)"), ("fed_penalty_sole", "Sole-defendant cases ($)"),
                        ("max_codefendants", "Most co-defendants"), ("fys", "FYs opened"), ("statutes", "Statutes"), ("states", "States")],
                       [("company_linked", "SEC company profile", {"yes": "Linked", "no": "Not linked"}),
                        ("codefendants", "Co-defendants", {"sole_only": "Always sole defendant", "mixed": "Sole and joint cases", "with_codefendants_only": "Only with co-defendants"}),
                        ("national_case", "Multi-record national case", {"yes": "Yes", "no": "No"}),
                        ("statute", "Statute", statute_options)]),
        {**common,
         "grain": "one record per exact recorded DEFENDANT_NAME (leading/trailing spaces trimmed only)",
         "selection": dstats["selection"],
         "ranking": "record order: rank (fed_penalty_named desc, then name), then rank_sole; rank_sole orders fed_penalty_sole desc, then name",
         "caution": "Joint credit gives every co-defendant the full case penalty: the 06-2011-4881 Deepwater Horizon record ($3,352,250,000 case total) puts dozens of co-defendants (insurers, affiliates) at the top of the joint ranking. Use rank_sole, max_codefendants_in_a_case and largest_case_share_of_named to read the joint ranking. The download records no per-defendant allocation of a penalty, so none is imputed.",
         "definitions": {
             "rank_sole": "rank by fed_penalty_sole (additive; cases naming only this defendant)",
             "max_codefendants_in_a_case": "largest number of other distinct defendant names on any one of its cases",
             "largest_case_share_of_named": "largest single case federal penalty / fed_penalty_named",
             "fed_penalty_named": "computed sum of CASE_PENALTIES.FED_PENALTY over distinct cases naming the defendant; every named defendant is credited with the full case penalty, so totals overlap across co-defendants and are not additive",
             "fed_penalty_sole": "same sum restricted to cases where it is the only distinct defendant name (additive across defendants)",
             "share_of_national_fed_penalty": "fed_penalty_named / national sum of CASE_PENALTIES.FED_PENALTY (all cases)",
             "exact_name_variants": "other recorded names equal to this one after case-folding and whitespace collapsing; listed, never merged",
             "national_case_leads": "lead case numbers of multi-record national cases (records splitting one penalty) among its cases; shares are summed",
             "possible_duplicate_extra_fed_penalty": "federal penalty counted more than once when the defendant is named on several records of a look-alike group (same penalty, settlement ledger and defendants, no lead marker); reported, not removed",
             "parent_names": "always null: the ICIS-FE&C download records no parent company",
             "company": "link to /companies/<CIK> only when the case-folded, whitespace-collapsed name equals exactly one company_sec_profiles title",
         },
         "stats": dstats,
         "concentration": {"top10_names_union_share": dstats["top10_names_union_share"],
                           "top10_sole_names_union_share": dstats["top10_sole_names_union_share"],
                           "top10_sole_penalty_share": dstats["top10_sole_penalty_share"],
                           "formula": "union shares: CASE_PENALTIES.FED_PENALTY of the union of cases naming any top-10 name (joint or sole ranking) / national total, each case counted once; top10_sole_penalty_share: sum of the 10 largest fed_penalty_sole / national total"},
         },
        case_inputs[:1] + [lookup_inputs[0]],
    )

    if "--skip-exporter" in argv:
        log("skipping exporter")
        return
    exporter_date = zip_dates(EXPORTER_ZIP)["ECHO_EXPORTER.csv"]
    exporter_retrieved = (entries.get(os.path.relpath(EXPORTER_ZIP, ROOT)) or {}).get("retrieved_at", "")[:10]
    program_rows, n, cutoff = build_state_programs(exporter_date, exporter_retrieved)
    write_build(
        "epa_echo_state_programs", "ECHO regulated facilities, formal actions and significant violators by state", program_rows,
        writer.listing([("state", "State"), ("facilities", "Facilities"), ("caa", "CAA"), ("cwa", "CWA (NPDES)"), ("rcra", "RCRA"),
                        ("sdwa", "SDWA"), ("formal_5y", "Formal action, 5 yr"), ("snc_now", "Significant violators now")],
                       [("kind", "Kind", {"national": "National", "state": "State", "territory": "Territory", "other": "Other code", "unrecorded": "No state recorded"})]),
        {"source": EXPORTER_URL, "dictionary": EXPORTER_DICT_URL, "downloads_page": DOWNLOADS_PAGE, "file_date": exporter_date,
         "retrieved": exporter_retrieved, "facility_rows": n, "five_year_cutoff_diagnostic": cutoff,
         "terms": "U.S. EPA public data (ECHO); see https://www.epa.gov/web-policies-and-procedures/epa-disclaimers",
         "grain": "one record per ECHO_EXPORTER.FAC_STATE value (blank -> NR) plus a national record",
         "definitions": {
             "with_id": "facilities whose program flag is Y (AIR_FLAG, NPDES_FLAG, RCRA_FLAG, SDWIS_FLAG): the facility has a program ID; includes terminated/inactive IDs, whose recorded statuses are listed under status",
             "formal_action_facilities_5y": "facilities with <PROGRAM>_FORMAL_ACTION_COUNT > 0 (the dictionary defines these counts over the last five years). Dictionary: CWA_FORMAL_ACTION_COUNT counts State actions entered in ICIS-NPDES only and RCRA_FORMAL_ACTION_COUNT excludes federal CAA, CWA and RCRA actions entered in ICIS, to avoid double counting with ICIS-FE&C; federal cases are in federal_case_facilities_5y (FEC_NUMBER_OF_CASES, last 5 years). These counts are therefore not totals of every formal action against a facility",
             "any_formal_action_5y": "facilities with FAC_FORMAL_ACTION_COUNT > 0 (dictionary: formal actions from ICIS-Air, ICIS-NPDES, SDWIS and RCRAInfo; federal ICIS-FE&C cases are not included); any_formal_action_date_older_than_5y counts those whose FAC_DATE_LAST_FORMAL_ACTION is before the cutoff (diagnostic)",
             "snc_or_hpv_now": "CAA_HPV_FLAG / CWA_SNC_FLAG / RCRA_SNC_FLAG / SDWA_SNC_FLAG = Y at extraction",
             "any_program_snc_or_hpv_now": "computed: at least one of the four program flags is Y. FAC_SNC_FLG is N on every row of this file and is reported as recorded, not used",
             "shares": "snc_share_of_with_id = snc_or_hpv_now / with_id; formal_share_of_with_id = formal_action_facilities_5y / with_id",
         }},
        [input_entry(entries, EXPORTER_ZIP)],
    )


if __name__ == "__main__":
    main(sys.argv[1:])
