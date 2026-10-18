"""Spot-check epa_echo build outputs against the raw source with an independent, deliberately simple code path.

Reads private/acq/epa_echo (zips, census CSV, ECHO case-report JSON saved by acquire.py) and private/build/epa_echo/*.json.
Writes private/build/epa_echo/spot_checks.json. No network.

Usage: python3 -I -B scripts/enrichment/epa_echo/spot_check.py [--skip-exporter]
"""
import csv
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
ACQ = os.path.join(ROOT, "private", "acq", "epa_echo")
BUILD = os.path.join(ROOT, "private", "build", "epa_echo")
# Picked deterministically from the raw files: Deepwater Horizon lead record; largest JDC federal penalty opened FY2019-2024;
# largest AFR federal penalty opened FY2025; largest SEP opened FY2015+; largest state/local penalty opened FY2022.
REPORT_CASES = ["06-2011-4881", "HQ-2020-0001", "08-2025-0119", "05-2016-5032", "03-2022-7013"]


def rows(archive, name):
    with archive.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""))


def amount(text):
    text = (text or "").replace(",", "").replace("$", "").strip()
    return float(text) if text else 0.0


def load(dataset):
    data = json.load(open(os.path.join(BUILD, dataset + ".json")))
    return {r["id"]: r for r in data["rows"]}


def main(argv):
    series = load("epa_echo_case_series")
    defendants = load("epa_echo_defendants")
    checks = []

    def check(figure, dataset, row_id, field, build_value, source_value, where):
        if isinstance(build_value, float) or isinstance(source_value, float):
            match = build_value is not None and abs(round(build_value, 2) - round(source_value, 2)) < 0.005
        else:
            match = build_value == source_value
        checks.append({"n": len(checks) + 1, "figure": figure, "dataset": dataset, "row_id": row_id, "field": field,
                       "build_value": build_value, "source_value": source_value, "source_location": where, "match": match})

    def s(row_id, *path):
        value = series[row_id]["item"]["series"]
        for part in path:
            value = value[part]
        return value

    archive = zipfile.ZipFile(os.path.join(ACQ, "case_downloads.zip"))
    # ---- independent scans of the raw case files
    case_fy, case_type, case_region, case_states, case_statute = {}, {}, {}, {}, {}
    for r in rows(archive, "CASE_ENFORCEMENTS.csv"):
        aid = r["ACTIVITY_ID"].strip()
        case_fy[aid] = r["FISCAL_YEAR"].strip()
        case_type[aid] = r["ACTIVITY_TYPE_CODE"].strip()
        case_region[aid] = r["REGION_CODE"].strip()
    for r in rows(archive, "CASE_FACILITIES.csv"):
        st = r["STATE_CODE"].strip().upper()
        if re.fullmatch(r"[A-Z]{2}", st):
            case_states.setdefault(r["ACTIVITY_ID"].strip(), set()).add(st)
    for r in rows(archive, "CASE_LAW_SECTIONS.csv"):
        aid = r["ACTIVITY_ID"].strip()
        if r["RANK_ORDER"].strip() == "1" and aid not in case_statute:
            case_statute[aid] = r["STATUTE_CODE"].strip()
    program_cases = {}
    for r in rows(archive, "CASE_PROGRAMS.csv"):
        program_cases.setdefault(r["PROGRAM_CODE"].strip(), set()).add(r["ACTIVITY_ID"].strip())
    conclusions = list(rows(archive, "CASE_ENFORCEMENT_CONCLUSIONS.csv"))
    collected = {r["ENF_CONCLUSION_ID"].strip(): amount(r["PENALTY_COLLECTED_AMT"]) for r in rows(archive, "CASE_ENFORCEMENT_CONCLUSION_DOLLARS.csv")}
    penalties = {r["ACTIVITY_ID"].strip(): r for r in rows(archive, "CASE_PENALTIES.csv")}
    by_number = {}
    for r in rows(archive, "CASE_ENFORCEMENTS.csv"):
        by_number[r["CASE_NUMBER"].strip()] = r["ACTIVITY_ID"].strip()

    loc_ce = "case_downloads.zip/CASE_ENFORCEMENTS.csv"
    loc_cc = "case_downloads.zip/CASE_ENFORCEMENT_CONCLUSIONS.csv"
    check("US cases opened FY2025", "epa_echo_case_series", "epa-echo-series:US:2025", "opened", s("epa-echo-series:US:2025", "opened"),
          sum(1 for fy in case_fy.values() if fy == "2025"), f"{loc_ce}: rows with FISCAL_YEAR=2025")
    check("US civil judicial cases opened FY2025", "epa_echo_case_series", "epa-echo-series:US:2025", "opened_judicial", s("epa-echo-series:US:2025", "opened_judicial"),
          sum(1 for a, fy in case_fy.items() if fy == "2025" and case_type[a] == "JDC"), f"{loc_ce}: FISCAL_YEAR=2025 and ACTIVITY_TYPE_CODE=JDC")
    check("US federal penalties settled FY2024", "epa_echo_case_series", "epa-echo-series:US:2024", "fed_penalty", s("epa-echo-series:US:2024", "fed_penalty"),
          round(sum(amount(r["FED_PENALTY_ASSESSED_AMT"]) for r in conclusions if r["SETTLEMENT_FY"].strip() == "2024"), 2), f"{loc_cc}: sum FED_PENALTY_ASSESSED_AMT, SETTLEMENT_FY=2024")
    check("US SEP amounts settled FY2024", "epa_echo_case_series", "epa-echo-series:US:2024", "sep", s("epa-echo-series:US:2024", "sep"),
          round(sum(amount(r["SEP_AMT"]) for r in conclusions if r["SETTLEMENT_FY"].strip() == "2024"), 2), f"{loc_cc}: sum SEP_AMT, SETTLEMENT_FY=2024")
    check("US cases concluded FY2023", "epa_echo_case_series", "epa-echo-series:US:2023", "concluded_cases", s("epa-echo-series:US:2023", "concluded_cases"),
          len({r["ACTIVITY_ID"].strip() for r in conclusions if r["SETTLEMENT_FY"].strip() == "2023"}), f"{loc_cc}: distinct ACTIVITY_ID with SETTLEMENT_FY=2023")
    check("US cost recovery, all years", "epa_echo_case_series", "epa-echo-series:US:all", "cost_recovery", s("epa-echo-series:US:all", "cost_recovery"),
          round(sum(amount(r["COST_RECOVERY_AWARDED_AMT"]) for r in conclusions), 2), f"{loc_cc}: sum COST_RECOVERY_AWARDED_AMT, all rows")
    check("US state/local penalties, all years", "epa_echo_case_series", "epa-echo-series:US:all", "st_lcl_penalty", s("epa-echo-series:US:all", "st_lcl_penalty"),
          round(sum(amount(r["STATE_LOCAL_PENALTY_AMT"]) for r in conclusions), 2), f"{loc_cc}: sum STATE_LOCAL_PENALTY_AMT, all rows")
    check("US penalty collected FY2026", "epa_echo_case_series", "epa-echo-series:US:2026", "penalty_collected", s("epa-echo-series:US:2026", "penalty_collected"),
          round(sum(collected.get(r["ENF_CONCLUSION_ID"].strip(), 0.0) for r in conclusions if r["SETTLEMENT_FY"].strip() == "2026"), 2),
          "case_downloads.zip/CASE_ENFORCEMENT_CONCLUSION_DOLLARS.csv: sum PENALTY_COLLECTED_AMT joined on ENF_CONCLUSION_ID, SETTLEMENT_FY=2026")
    check("Texas cases opened FY2020 (facility-state attribution)", "epa_echo_case_series", "epa-echo-series:state:TX:2020", "opened", s("epa-echo-series:state:TX:2020", "opened"),
          sum(1 for a, fy in case_fy.items() if fy == "2020" and "TX" in case_states.get(a, ())), f"{loc_ce} x CASE_FACILITIES.csv: FISCAL_YEAR=2020 and a facility STATE_CODE=TX")
    for st, fy in (("CA", "2019"), ("LA", "2016")):
        check(f"{st} federal penalties settled FY{fy}", "epa_echo_case_series", f"epa-echo-series:state:{st}:{fy}", "fed_penalty", s(f"epa-echo-series:state:{st}:{fy}", "fed_penalty"),
              round(sum(amount(r["FED_PENALTY_ASSESSED_AMT"]) for r in conclusions if r["SETTLEMENT_FY"].strip() == fy and st in case_states.get(r["ACTIVITY_ID"].strip(), ())), 2),
              f"{loc_cc} x CASE_FACILITIES.csv: SETTLEMENT_FY={fy}, case facility STATE_CODE={st}")
    check("EPA Region 5 cases opened FY2010", "epa_echo_case_series", "epa-echo-series:region:05:2010", "opened", s("epa-echo-series:region:05:2010", "opened"),
          sum(1 for a, fy in case_fy.items() if fy == "2010" and case_region[a] == "05"), f"{loc_ce}: FISCAL_YEAR=2010 and REGION_CODE=05")
    check("HQ-region federal penalties settled, all years", "epa_echo_case_series", "epa-echo-series:region:HQ:all", "fed_penalty", s("epa-echo-series:region:HQ:all", "fed_penalty"),
          round(sum(amount(r["FED_PENALTY_ASSESSED_AMT"]) for r in conclusions if case_region.get(r["ACTIVITY_ID"].strip()) == "HQ"), 2), f"{loc_cc}: case REGION_CODE=HQ, all settlements")
    statute_rows = {row[0]: row for row in s("epa-echo-series:US:2022", "dims", "statute")}
    check("US CAA-primary cases opened FY2022", "epa_echo_case_series", "epa-echo-series:US:2022", "dims.statute[CAA].opened", statute_rows["CAA"][1],
          sum(1 for a, fy in case_fy.items() if fy == "2022" and case_statute.get(a) == "CAA"), "CASE_LAW_SECTIONS.csv RANK_ORDER=1 STATUTE_CODE=CAA x CASE_ENFORCEMENTS FISCAL_YEAR=2022")
    program_rows = {row[0]: row for row in s("epa-echo-series:US:2021", "dims", "program")}
    check("US cases opened FY2021 with program CWAOTHR", "epa_echo_case_series", "epa-echo-series:US:2021", "dims.program[CWAOTHR].opened", program_rows["CWAOTHR"][1],
          sum(1 for a in program_cases.get("CWAOTHR", ()) if case_fy.get(a) == "2021"), "CASE_PROGRAMS.csv PROGRAM_CODE=CWAOTHR x CASE_ENFORCEMENTS FISCAL_YEAR=2021")
    check("US case-level state/local cost recovery, cases opened FY2015", "epa_echo_case_series", "epa-echo-series:US:2015", "case_level.st_cost_recovery", s("epa-echo-series:US:2015", "case_level", "st_cost_recovery"),
          round(sum(amount(r["STATE_LOCAL_COST_RECOVERY_AMT"]) for a, r in penalties.items() if case_fy.get(a) == "2015"), 2), "CASE_PENALTIES.csv STATE_LOCAL_COST_RECOVERY_AMT x CASE_ENFORCEMENTS FISCAL_YEAR=2015")

    # ---- defendants: independent scan of CASE_DEFENDANTS
    named = {}
    for r in rows(archive, "CASE_DEFENDANTS.csv"):
        name = r["DEFENDANT_NAME"].strip()
        if name:
            named.setdefault(name, set()).add(r["ACTIVITY_ID"].strip())
    ranked = sorted((r for r in defendants.values() if r["item"]["defendant"]["rank"]), key=lambda r: r["item"]["defendant"]["rank"])
    ranked_sole = sorted((r for r in defendants.values() if r["item"]["defendant"]["rank_sole"]), key=lambda r: r["item"]["defendant"]["rank_sole"])
    picks = [ranked[0], ranked[49], ranked_sole[0], ranked_sole[9]] + [r for r in ranked if r["item"]["defendant"]["company"]["status"] == "matched"][:1]
    for row in picks:
        d = row["item"]["defendant"]
        ids = named.get(d["name"], set())
        check(f"Defendant '{d['name']}' (rank {d['rank']}): cases naming it", "epa_echo_defendants", row["id"], "cases_named", d["cases_named"], len(ids),
              "case_downloads.zip/CASE_DEFENDANTS.csv: distinct ACTIVITY_ID where DEFENDANT_NAME (trimmed) equals the name")
        check(f"Defendant '{d['name']}' (rank {d['rank']}): federal penalties in cases naming it", "epa_echo_defendants", row["id"], "fed_penalty_named", d["fed_penalty_named"],
              round(sum(amount((penalties.get(a) or {}).get("FED_PENALTY")) for a in ids), 2), "CASE_PENALTIES.csv FED_PENALTY summed over those ACTIVITY_IDs")

    # ---- census denominator
    with open(os.path.join(ACQ, "census", "NST-EST2025-ALLDATA.csv"), newline="", encoding="latin-1") as handle:
        tx = next(r for r in csv.DictReader(handle) if r["SUMLEV"] == "040" and r["NAME"] == "Texas")
    check("Texas population denominator (July 1, 2025)", "epa_echo_case_series", "epa-echo-series:state:TX:all", "per_capita.population",
          s("epa-echo-series:state:TX:all", "per_capita", "population"), int(tx["POPESTIMATE2025"]), "census/NST-EST2025-ALLDATA.csv NAME=Texas POPESTIMATE2025")

    # ---- largest case, per-capita rates and state rankings (independent recomputation from raw files)
    by_case_fy2024, by_case_all_ca = {}, {}
    window_fed, window_opened = {}, {}
    for r in conclusions:
        aid = r["ACTIVITY_ID"].strip()
        fy = r["SETTLEMENT_FY"].strip()
        fed = amount(r["FED_PENALTY_ASSESSED_AMT"])
        if fy == "2024":
            by_case_fy2024[aid] = by_case_fy2024.get(aid, 0.0) + fed
        if "CA" in case_states.get(aid, ()):
            by_case_all_ca[aid] = by_case_all_ca.get(aid, 0.0) + fed
        if fy.isdigit() and 2016 <= int(fy) <= 2025:
            for st in case_states.get(aid, ()):
                window_fed[st] = window_fed.get(st, 0.0) + fed
    for aid, fy in case_fy.items():
        if fy.isdigit() and 2016 <= int(fy) <= 2025:
            for st in case_states.get(aid, ()):
                window_opened[st] = window_opened.get(st, 0) + 1
    number_of = {aid: number for number, aid in by_number.items()}
    top_aid = max(by_case_fy2024, key=lambda a: (by_case_fy2024[a], a))
    check("US largest case settled in FY2024: case number", "epa_echo_case_series", "epa-echo-series:US:2024", "largest_case.case_number",
          s("epa-echo-series:US:2024", "largest_case", "case_number"), number_of[top_aid], f"{loc_cc}: ACTIVITY_ID with the largest summed FED_PENALTY_ASSESSED_AMT, SETTLEMENT_FY=2024")
    check("US largest case settled in FY2024: share of FY penalties", "epa_echo_case_series", "epa-echo-series:US:2024", "largest_case.share_of_fed_penalty",
          s("epa-echo-series:US:2024", "largest_case", "share_of_fed_penalty"), round(by_case_fy2024[top_aid] / sum(by_case_fy2024.values()), 6),
          f"{loc_cc}: largest case sum / all FY2024 settled federal penalties")
    ca_aid = max(by_case_all_ca, key=lambda a: (by_case_all_ca[a], a))
    check("California largest case (all years): settled federal penalty", "epa_echo_case_series", "epa-echo-series:state:CA:all", "largest_case.fed_penalty",
          s("epa-echo-series:state:CA:all", "largest_case", "fed_penalty"), round(by_case_all_ca[ca_aid], 2), f"{loc_cc} x CASE_FACILITIES.csv (STATE_CODE=CA): largest summed FED_PENALTY_ASSESSED_AMT per ACTIVITY_ID")
    from build_epa_echo import STATES as STATE_TABLE  # constants only (FIPS -> USPS); every computation above and below is independent
    fips_to_usps = {fips: usps for usps, (fips, _) in STATE_TABLE.items()}
    population = {}
    with open(os.path.join(ACQ, "census", "NST-EST2025-ALLDATA.csv"), newline="", encoding="latin-1") as handle:
        for r in csv.DictReader(handle):
            if r["SUMLEV"] == "040" and r["STATE"].zfill(2) in fips_to_usps:
                population[fips_to_usps[r["STATE"].zfill(2)]] = int(r["POPESTIMATE2025"])

    def rank_of(values, key):
        return 1 + sum(1 for v in values.values() if v > values[key])

    per_resident = {st: window_fed.get(st, 0.0) / population[st] for st in population}
    per_100k = {st: window_opened.get(st, 0) / population[st] * 100000 for st in population}
    for st in ("IN", "TX", "NY"):
        check(f"{st} FY2016-2025 federal penalties per resident", "epa_echo_case_series", f"epa-echo-series:state:{st}:all", "per_capita.fy2016_2025_fed_penalty_per_resident",
              s(f"epa-echo-series:state:{st}:all", "per_capita", "fy2016_2025_fed_penalty_per_resident"), round(per_resident[st], 4),
              f"{loc_cc} x CASE_FACILITIES.csv, SETTLEMENT_FY 2016-2025, / census POPESTIMATE2025")
        check(f"{st} rank by FY2016-2025 federal penalties per resident (of 51)", "epa_echo_case_series", f"epa-echo-series:state:{st}:all", "rankings.fed_penalty_per_resident",
              s(f"epa-echo-series:state:{st}:all", "rankings", "fed_penalty_per_resident"), rank_of(per_resident, st), "independent ranking over the 50 states + DC")
    for st in ("DC", "AK"):
        check(f"{st} FY2016-2025 cases opened per 100,000 residents", "epa_echo_case_series", f"epa-echo-series:state:{st}:all", "per_capita.fy2016_2025_opened_per_100k_residents",
              s(f"epa-echo-series:state:{st}:all", "per_capita", "fy2016_2025_opened_per_100k_residents"), round(per_100k[st], 4),
              f"{loc_ce} x CASE_FACILITIES.csv, FISCAL_YEAR 2016-2025, / census POPESTIMATE2025 x 100000")
        check(f"{st} rank by cases opened per 100,000 (of 51)", "epa_echo_case_series", f"epa-echo-series:state:{st}:all", "rankings.opened_per_100k_residents",
              s(f"epa-echo-series:state:{st}:all", "rankings", "opened_per_100k_residents"), rank_of(per_100k, st), "independent ranking over the 50 states + DC")
    national_population = sum(population.values())
    check("National population denominator (50 states + DC)", "epa_echo_case_series", "epa-echo-series:US:all", "per_capita.population",
          s("epa-echo-series:US:all", "per_capita", "population"), national_population, "census/NST-EST2025-ALLDATA.csv: sum POPESTIMATE2025 over SUMLEV 040 rows for the 50 states and DC")

    # ---- ECHO case reports (official REST service, saved raw by acquire.py) vs CASE_PENALTIES as stored
    report_dir = os.path.join(ACQ, "case_reports")
    for number in REPORT_CASES:
        path = os.path.join(report_dir, number + ".json")
        if not os.path.exists(path):
            continue
        info = json.load(open(path))["Results"]["CaseInformation"]
        pen = penalties.get(by_number.get(number)) or {}
        for label, rest_key, column in (("federal penalty", "TotalFederalPenalty", "FED_PENALTY"), ("SEP cost", "TotalSEPCost", "TOTAL_SEP"),
                                        ("state/local penalty", "TotalStatePenalty", "ST_LCL_PENALTY")):
            check(f"Case {number} {label}: download vs ECHO case report", "case_downloads.zip (CASE_PENALTIES)", number, column,
                  round(amount(pen.get(column)), 2), round(amount(info.get(rest_key)), 2),
                  f"https://echodata.epa.gov/echo/case_rest_services.get_case_report?p_id={number} -> CaseInformation.{rest_key}")

    if "--skip-exporter" not in argv:
        programs = load("epa_echo_state_programs")
        tallies = {"TX_air": 0, "CA_cwa_snc": 0, "US_rcra_formal": 0, "NY_sdwis": 0, "OH_any_snc": 0}
        exporter = zipfile.ZipFile(os.path.join(ACQ, "echo_exporter.zip"))
        for r in rows(exporter, "ECHO_EXPORTER.csv"):
            st = (r["FAC_STATE"] or "").strip().upper()
            tallies["TX_air"] += st == "TX" and r["AIR_FLAG"] == "Y"
            tallies["CA_cwa_snc"] += st == "CA" and r["CWA_SNC_FLAG"] == "Y"
            tallies["US_rcra_formal"] += (r["RCRA_FORMAL_ACTION_COUNT"] or "0").strip() not in ("", "0")
            tallies["NY_sdwis"] += st == "NY" and r["SDWIS_FLAG"] == "Y"
            tallies["OH_any_snc"] += st == "OH" and "Y" in (r["CAA_HPV_FLAG"], r["CWA_SNC_FLAG"], r["RCRA_SNC_FLAG"], r["SDWA_SNC_FLAG"])

        def p(code, *path):
            value = programs[f"epa-echo-programs:{code}"]["item"]["programs"]
            for part in path:
                value = value[part]
            return value
        loc = "echo_exporter.zip/ECHO_EXPORTER.csv"
        check("Texas CAA facilities (AIR_FLAG=Y)", "epa_echo_state_programs", "epa-echo-programs:TX", "programs.CAA.with_id", p("TX", "programs", "CAA", "with_id"), tallies["TX_air"], f"{loc}: FAC_STATE=TX and AIR_FLAG=Y")
        check("California CWA facilities in SNC now", "epa_echo_state_programs", "epa-echo-programs:CA", "programs.CWA.snc_or_hpv_now", p("CA", "programs", "CWA", "snc_or_hpv_now"), tallies["CA_cwa_snc"], f"{loc}: FAC_STATE=CA and CWA_SNC_FLAG=Y")
        check("US RCRA facilities with a formal action in 5 years", "epa_echo_state_programs", "epa-echo-programs:US", "programs.RCRA.formal_action_facilities_5y", p("US", "programs", "RCRA", "formal_action_facilities_5y"), tallies["US_rcra_formal"], f"{loc}: RCRA_FORMAL_ACTION_COUNT > 0")
        check("New York SDWA systems (SDWIS_FLAG=Y)", "epa_echo_state_programs", "epa-echo-programs:NY", "programs.SDWA.with_id", p("NY", "programs", "SDWA", "with_id"), tallies["NY_sdwis"], f"{loc}: FAC_STATE=NY and SDWIS_FLAG=Y")
        check("Ohio facilities flagged SNC/HPV in any program", "epa_echo_state_programs", "epa-echo-programs:OH", "any_program_snc_or_hpv_now", p("OH", "any_program_snc_or_hpv_now"), tallies["OH_any_snc"], f"{loc}: FAC_STATE=OH and any of CAA_HPV_FLAG/CWA_SNC_FLAG/RCRA_SNC_FLAG/SDWA_SNC_FLAG = Y")

    out = {"checks": checks, "count": len(checks), "mismatches": sum(1 for c in checks if not c["match"])}
    with open(os.path.join(BUILD, "spot_checks.json"), "w") as handle:
        json.dump(out, handle, indent=1)
    for c in checks:
        print(("MATCH   " if c["match"] else "MISMATCH"), c["n"], c["figure"], "| build", c["build_value"], "| source", c["source_value"])
    print("checks", out["count"], "mismatches", out["mismatches"])


if __name__ == "__main__":
    main(sys.argv[1:])
