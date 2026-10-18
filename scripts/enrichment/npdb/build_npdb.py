"""Build NPDB datasets from the National Practitioner Data Bank Public Use Data File (PUF) and the NPDB
State Licensing Board Compliance Results.

Inputs (unchanged raw bytes, see private/acq/npdb/_manifest.jsonl):
  puf/NpdbPublicUseDataCsv.zip                 PUF, June 30, 2026 version (NPDB2604.CSV), read as a stream
  pages/pufFormatSpecifications.jsp.raw        code labels (format specification)
  pages/analysistool.raw                       NPDB Data Analysis Tool "Practitioner Type" grouping
  pages/publicData.jsp.raw                     coverage statement and Data Use Agreement
  denominators/NST-EST2025-ALLDATA.csv, nst-est2020-alldata.csv   Census state population (per-capita rates)
  denominators/bls_cu.data.1.AllItems.txt      BLS CPI-U (CUUR0000SA0 annual averages) for 2025-dollar figures
  compliance/StateBoardDetails.csv, ComplianceReviewStatusbyState.csv   compliance map exports (as published)

Writes private/build/npdb/<dataset>.json for:
  npdb_malpractice_states   state-year and state summary records of medical malpractice payment reports (MMPRs)
  npdb_malpractice_national national yearly series, all-years summary and allegation-group records
  npdb_adverse_actions      state-year, state summary and national records of adverse action reports (AARs)
  npdb_state_board_compliance  state licensing board compliance results as published by NPDB

Disclosure control: every published count is 0 or >= 10 reports; breakdowns use complementary suppression
(npdb_lib.fold). No row-level PUF record is written anywhere.

Usage: python3 -I -B scripts/enrichment/npdb/build_npdb.py
"""
import collections
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import npdb_lib as lib  # noqa: E402
from npdb_lib import Agg, breakdown, stats  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "npdb")
OUT = os.path.join(ROOT, "private", "build", "npdb")

PUF_ZIP = os.path.join(ACQ, "puf", "NpdbPublicUseDataCsv.zip")
PUF_MEMBER = "NPDB2604.CSV"
PUF_PAGE = "https://www.npdb.hrsa.gov/resources/publicData.jsp"
PUF_ZIP_URL = "https://www.npdb.hrsa.gov/resources/NpdbPublicUseDataCsv.zip"
SPEC_URL = "https://www.npdb.hrsa.gov/resources/puf/pufFormatSpecifications.jsp"
BACKGROUND_URL = "https://www.npdb.hrsa.gov/resources/puf/pufFormatBackground.jsp"
STATEMENT_URL = "https://www.npdb.hrsa.gov/resources/publicDataStatement.jsp"
DAT_URL = "https://www.npdb.hrsa.gov/analysistool/"
MAP_URL = "https://www.npdb.hrsa.gov/resources/npdbstats/npdbMap.jsp"
BOARDS_CSV_URL = "https://tableau.hdw.hrsa.gov/t/BHW/views/NPDBComplianceResults/StateBoardDetails.csv"
STATUS_CSV_URL = "https://tableau.hdw.hrsa.gov/t/BHW/views/NPDBComplianceResults/ComplianceReviewStatusbyState.csv"
POP2025_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
POP2020_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2010-2020/state/totals/nst-est2020-alldata.csv"
CPI_URL = "https://download.bls.gov/pub/time.series/cu/cu.data.1.AllItems"
CPI_SERIES = "CUUR0000SA0"

FIRST_FULL, LATEST_FULL = 1991, 2025
PARTIAL_YEARS = {1990: "September 1-December 31, 1990 only", 2026: "January 1-June 30, 2026 only"}
WINDOWS = {"1991-1995": (1991, 1995), "2001-2005": (2001, 2005), "2005-2009": (2005, 2009),
           "2011-2015": (2011, 2015), "2021-2025": (2021, 2025)}
GROWTH_FROM, GROWTH_TO = "2001-2005", "2021-2025"
MIX_FROM, MIX_TO = "2005-2009", "2021-2025"
REAL_BASE = 2025
FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
        "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
        "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
        "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
        "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
        "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR"}
FUND = {"0": "Insurance company or self-insured entity payment", "1": "State fund payment (FUNDPYMT = 1)"}
LENGTH_TYPES = {"I": "Indefinite penalty length", "P": "Permanent penalty", "S": "Specified penalty length"}


# ------------------------------------------------------------------------------------------------ inputs

def manifest():
    entries = {}
    with open(os.path.join(ACQ, "_manifest.jsonl")) as handle:
        for line in handle:
            entry = json.loads(line)
            entries[entry["path"]] = entry  # latest fetch of each path wins
    return entries


def read_text(rel):
    with open(os.path.join(ACQ, rel), encoding="utf-8", errors="replace") as handle:
        return handle.read()


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def population():
    out = collections.defaultdict(dict)
    for name, years in (("nst-est2020-alldata.csv", range(2010, 2020)), ("NST-EST2025-ALLDATA.csv", range(2020, 2026))):
        with open(os.path.join(ACQ, "denominators", name), newline="", encoding="latin-1") as handle:
            for row in csv.DictReader(handle):
                code = FIPS.get(row["STATE"].zfill(2))
                if row["SUMLEV"] == "040" and code:
                    for y in years:
                        out[code][y] = int(row[f"POPESTIMATE{y}"])
    return out


def cpi():
    values = {}
    with open(os.path.join(ACQ, "denominators", "bls_cu.data.1.AllItems.txt"), encoding="latin-1") as handle:
        for line in handle:
            parts = [p.strip() for p in line.split("\t")]
            if len(parts) >= 4 and parts[0] == CPI_SERIES and parts[2] == "M13":
                values[int(parts[1])] = float(parts[3])
    return values


DAT_PRACTITIONERS_URL = "https://tableau.hdw.hrsa.gov/t/BHW/views/NPDBDataAnalysisTool/NPDBPractitioners.csv"


def dat_practitioners(entries):
    """Unique-practitioner counts by type exactly as the NPDB Data Analysis Tool publishes them (CSV export of its
    second tab). Published as received: they are NPDB-wide counts, not licensed-practitioner denominators."""
    rel = "dat/NPDBPractitioners.csv"
    entry = entries["private/acq/npdb/" + rel]
    rows = lib.parse_dat_practitioners(read_text(rel))
    return {"source": DAT_URL, "export_url": DAT_PRACTITIONERS_URL, "retrieved": entry["retrieved_at"], "sha256": entry["sha256"],
            "meaning": "Unique practitioners with at least one adverse action or medical malpractice payment report in the NPDB, by practitioner type; one practitioner can be counted under several types, so types do not sum to a unique total.",
            "rows": rows}


def release_info(entries):
    text = read_text("pages/publicData.jsp.raw")
    through = re.search(r"received from September 1, 1990 through ([A-Z][a-z]+ \d{1,2}, \d{4})", text)
    updated = re.search(r"Last Update: ([A-Z][a-z]+ \d{4})", text)
    with zipfile.ZipFile(PUF_ZIP) as archive:
        info = archive.getinfo(PUF_MEMBER)
        file_date = "%04d-%02d-%02d" % info.date_time[:3]
    zip_entry = entries["private/acq/npdb/puf/NpdbPublicUseDataCsv.zip"]
    data_through = through.group(1) if through else None
    return {
        "file": PUF_MEMBER,
        "zip": "NpdbPublicUseDataCsv.zip",
        "zip_sha256": zip_entry["sha256"],
        "file_date": file_date,
        "retrieved": zip_entry["retrieved_at"],
        "data_through": data_through,
        "last_update": updated.group(1) if updated else None,
        "version": f"{data_through} version" if data_through else None,
        "citation": (f"National Practitioner Data Bank (NPDB) Public Use Data File (PUF), {data_through} version "
                     f"(file {PUF_MEMBER}, dated {file_date}), U.S. Department of Health and Human Services, "
                     "Health Resources and Services Administration (HRSA)."),
    }


TERMS = {
    "agreement": "NPDB Public Use Data File Data Use Agreement (42 U.S.C. 11137(b)); accepted on the public download form",
    "conditions": [
        "Not use the dataset alone or in combination with other data to identify any individual or entity, or link it with another dataset in a manner that includes the identity of an individual or entity",
        "Upon HRSA's request, return, delete or otherwise permanently dispose of all copies of the data",
        "When reporting, disclosing or posting data from the dataset, not identify any individual or entity",
        "If reposting the dataset or a subset of it, require third-party users to adhere to the same conditions",
    ],
    "dat_condition": "Data Analysis Tool use agreement: the dataset can only be used in connection with statistical reporting or analysis; data are released under 45 CFR 60.13(a)(2)(ix) in a form that does not permit identification of any health care entity, physician, dentist or other practitioner.",
    "statement": "HRSA statement (November 9, 2011): the PUF can be used in statistical analysis and reporting if individuals are not identified; the data may not be reposted or further disclosed.",
    "how_this_build_complies": "Only aggregate counts and payment statistics are published; every published cell has 0 or at least 10 reports with complementary suppression; no row-level record, SEQNO or PRACTNUM is stored or published; no linkage to any other practitioner or entity dataset.",
    "credit": "Cite the PUF and its quarterly version (see citation).",
    "url": PUF_PAGE,
}


# ------------------------------------------------------------------------------------------------ scan

def windows_of(y):
    return [name for name, (a, b) in WINDOWS.items() if y is not None and a <= y <= b]


def scan(ptypes, cpi_values):
    mm = {"st_year": collections.defaultdict(Agg), "st_all": collections.defaultdict(Agg),
          "st_win": collections.defaultdict(Agg), "nat_year": collections.defaultdict(Agg), "nat_all": Agg(),
          "nat_win": collections.defaultdict(Agg), "nat_win_real": collections.defaultdict(collections.Counter),
          "alleg": collections.defaultdict(Agg), "alleg_win": collections.defaultdict(Agg),
          "basis": collections.Counter(), "unassigned_with_license_state": 0, "rows": 0}
    aa = {"st_year": collections.defaultdict(Agg), "st_all": collections.defaultdict(Agg),
          "st_win": collections.defaultdict(Agg), "st_type_year": collections.defaultdict(Agg),
          "nat_year": collections.defaultdict(Agg), "nat_all": Agg(), "nat_type_year": collections.defaultdict(Agg),
          "basis": collections.Counter(), "rows": 0}
    total_rows = 0
    with zipfile.ZipFile(PUF_ZIP) as archive, archive.open(PUF_MEMBER) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
        for row in reader:
            total_rows += 1
            rectype = row["RECTYPE"].strip()
            oy = lib.year(row["ORIGYEAR"])
            ptype = lib.practitioner_type(row["LICNFELD"], ptypes)
            if rectype in ("M", "P"):
                mm["rows"] += 1
                pay = lib.payment(row["PAYMENT"])
                delay = lib.delay_years(oy, lib.year(row["MALYEAR1"]))
                state, basis = lib.mmpr_state(row)
                mm["basis"][(state, basis)] += 1
                if state == lib.UNASSIGNED and row["LICNSTAT"].strip():
                    mm["unassigned_with_license_state"] += 1
                alleg = row["ALGNNATR"].strip() or lib.NOT_RECORDED
                outcome = row["OUTCOME"].strip() or (lib.LEGACY_OUTCOME if rectype == "M" else lib.NOT_RECORDED)
                severity = lib.severity_group(row["OUTCOME"], rectype)
                payer = lib.payer_group(row["PYRRLTNS"])
                judg = lib.judgment(row["PAYTYPE"])
                fund = FUND.get(row["FUNDPYMT"].strip(), lib.NOT_RECORDED)
                band = lib.band(pay)
                specific = row["ALEGATN1"].strip() or lib.NOT_RECORDED
                core = {"allegation": alleg, "severity": severity, "ptype": ptype, "payer": payer, "judgment": judg, "fund": fund,
                        "outcome_recorded": "yes" if row["OUTCOME"].strip() else "no"}
                mm["st_year"][(state, oy)].add(pay, delay, core)
                mm["st_all"][state].add(pay, delay, {**core, "year": oy, "outcome": outcome, "band": band})
                for w in windows_of(oy):
                    mm["st_win"][(state, w)].add(pay, delay, {"allegation": alleg, "severity": severity})
                    mm["nat_win"][w].add(pay, delay, {**core, "band": band})
                    if pay is not None and oy in cpi_values:
                        mm["nat_win_real"][w][round(pay * cpi_values[REAL_BASE] / cpi_values[oy], 2)] += 1
                    mm["alleg_win"][(alleg, w)].add(pay, delay, {"specific": specific})
                patient = {"ptsex": row["PTSEX"].strip() or lib.NOT_RECORDED, "ptage": row["PTAGE"].strip() or lib.NOT_RECORDED,
                           "pttype": row["PTTYPE"].strip() or lib.NOT_RECORDED}
                mm["nat_year"][oy].add(pay, delay, {**core, "outcome": outcome, "band": band, **patient})
                mm["nat_all"].add(pay, delay, {**core, "outcome": outcome, "band": band, "year": oy, "state": state, **patient})
                mm["alleg"][alleg].add(pay, delay, {"year": oy, "specific": specific, "severity": severity, "ptype": ptype,
                                                    "judgment": judg, "band": band, "state": state, "outcome_recorded": core["outcome_recorded"]})
            elif rectype in ("A", "C"):
                aa["rows"] += 1
                rep = row["REPTYPE"].strip()
                tgroup, subject = lib.aa_type(rep)
                state, basis = lib.aa_state(row)
                aa["basis"][(state, basis)] += 1
                ay = lib.year(row["AAYEAR"])
                action_year = ay if (ay is not None and oy is not None and 1950 <= ay <= oy) else lib.NOT_RECORDED
                cls = row["AACLASS1"].strip() or lib.NOT_RECORDED
                basis1 = row["BASISCD1"].strip() or lib.NOT_RECORDED
                length = LENGTH_TYPES.get(row["AALENTYP"].strip(), lib.NOT_RECORDED)
                core = {"type": tgroup, "subject": subject, "ptype": ptype}
                aa["st_year"][(state, oy)].add(dims=core)
                aa["st_all"][state].add(dims={**core, "year": oy, "action_year": action_year, "reptype": rep,
                                              "type_ptype": f"{tgroup}|{ptype}", "class": cls, "basis": basis1, "length": length})
                aa["st_type_year"][(state, tgroup)].add(dims={"year": oy})
                for w in windows_of(oy):
                    aa["st_win"][(state, w)].add(dims={"type": tgroup, "class": cls, "basis": basis1})
                aa["nat_year"][oy].add(dims={**core, "reptype": rep, "type_ptype": f"{tgroup}|{ptype}"})
                aa["nat_all"].add(dims={**core, "year": oy, "action_year": action_year, "reptype": rep, "state": state,
                                        "type_ptype": f"{tgroup}|{ptype}", "class": cls, "basis": basis1, "length": length})
                aa["nat_type_year"][tgroup].add(dims={"year": oy})
    return mm, aa, total_rows


# ------------------------------------------------------------------------------------------------ helpers

def share_of(rows, key):
    cell = next((r for r in rows if r.get("key") == key), None)
    return cell.get("share") if cell else None


def cell_n(rows, key):
    cell = next((r for r in rows if r.get("key") == key), None)
    return cell.get("n") if cell else None


def year_label(y):
    return f"{y} (partial: {PARTIAL_YEARS[y]})" if y in PARTIAL_YEARS else str(y)


def facts_for(pairs):
    return [[label, lib.NOT_RECORDED if value is None else str(value)] for label, value in pairs]


def record(*args, facts, **kwargs):
    return writer.record(*args, facts=facts_for(facts), **kwargs)


def pct(value):
    return None if value is None else f"{value * 100:.1f}%"


def per_million(n, pop):
    return round(n / pop * 1e6, 2) if (n is not None and pop) else None


def pooled(aggs):
    out = Agg()
    for agg in aggs:
        out.merge(agg)
    return out


def window_rate(year_cells, pops, a, b):
    """Reports per million residents over a window: sum of reports / sum of resident population x 1e6."""
    n = sum(year_cells.get(y, Agg()).n for y in range(a, b + 1))
    pop = sum(pops.get(y, 0) for y in range(a, b + 1))
    if n and 0 < n < lib.MIN_CELL:
        return None
    return round(n / pop * 1e6, 3) if pop and all(y in pops for y in range(a, b + 1)) else None


# ------------------------------------------------------------------------------------------------ malpractice

def mmpr_labels(book):
    return {
        "allegation": {**book["ALGNNATR"], lib.NOT_RECORDED: lib.NOT_RECORDED},
        "outcome": {**book["OUTCOME"]},
        "specific": {**book["ALEGATN1"]},
        "ptsex": {**book["PTSEX"]},
        "ptage": {**book["PTAGE"]},
        "pttype": {**book["PTTYPE"]},
    }


def mmpr_summary_block(agg, labels, money=True, extra_dims=()):
    s = stats(agg)
    out = {"totals": s}
    dims = ["allegation", "severity", "ptype", "payer", "judgment", "fund"] + list(extra_dims)
    for dim in dims:
        out[dim] = breakdown(agg, dim, labels.get(dim))
    return out


def build_malpractice_states(mm, labels, names, pops, release, common_facts):
    rows = []
    states = sorted({s for s, _ in mm["st_year"]} | set(mm["st_all"]))
    summaries = {}
    for code in states:
        allagg = mm["st_all"][code]
        name = names.get(code, code)
        kind = lib.area_kind(code)
        link = lib.place_link(code, name)
        year_cells = {y: mm["st_year"][(code, y)] for y in range(1990, 2027) if (code, y) in mm["st_year"]}
        state_pops = pops.get(code, {})
        # Complementary suppression across the year series (the shown all-years total is the sum of years).
        _, pool, folded = lib.fold(year_cells)
        hidden_years = set(folded)
        series = []
        for y in range(1990, 2027):
            agg = year_cells.get(y)
            if agg is None:
                series.append({"year": y, "n": 0})
            elif y in hidden_years:
                series.append({"year": y, "n": None, "suppressed": True})
            else:
                s = stats(agg)
                s["year"] = y
                if y in state_pops:
                    s["per_million"] = per_million(s["n"], state_pops[y])
                series.append(s)
        combined_years = None
        if pool is not None:
            combined_years = stats(pool) if pool.n >= lib.MIN_CELL else {"n": None, "suppressed": True}
            combined_years.update({"label": "Years with suppressed counts (combined)", "years": len(folded)})
        win = {w: mm["st_win"].get((code, w)) for w in WINDOWS}
        win_stats = {w: (stats(a) if a else {"n": 0}) for w, a in win.items()}
        g_from, g_to = win_stats[GROWTH_FROM], win_stats[GROWTH_TO]
        growth = {
            "median_cagr": lib.cagr(g_from.get("median"), g_to.get("median"), 20),
            "mean_cagr": lib.cagr(g_from.get("mean"), g_to.get("mean"), 20),
            "reports_pct_change": lib.pct_change(g_from.get("n"), g_to.get("n")),
            "from": GROWTH_FROM, "to": GROWTH_TO,
            "formula": "CAGR = (pooled median of 2021-2025 / pooled median of 2001-2005)^(1/20) - 1; reports change = (reports 2021-2025 - reports 2001-2005) / reports 2001-2005",
        }
        mix = []
        if win.get(MIX_FROM) and win.get(MIX_TO):
            a_rows = {r["key"]: r for r in breakdown(win[MIX_FROM], "allegation", labels["allegation"])}
            b_rows = {r["key"]: r for r in breakdown(win[MIX_TO], "allegation", labels["allegation"])}
            for key in sorted(set(a_rows) | set(b_rows), key=str):
                if key == lib.COMBINED_KEY:
                    continue
                sa, sb = (a_rows.get(key) or {}).get("share"), (b_rows.get(key) or {}).get("share")
                mix.append({"key": key, "label": labels["allegation"].get(key, key), "share_from": sa, "share_to": sb,
                            "change_pp": round((sb - sa) * 100, 2) if (sa is not None and sb is not None) else None})
        rate_recent = window_rate(year_cells, state_pops, 2021, 2025) if state_pops else None
        latest = next((s for s in series if s["year"] == LATEST_FULL), {"n": 0})
        block = mmpr_summary_block(allagg, labels, extra_dims=("outcome", "band"))
        summary = {
            "code": code, "name": name, "kind": kind,
            "totals": block["totals"],
            "years": series,
            "years_combined_suppressed": combined_years,
            "breakdowns": {k: v for k, v in block.items() if k != "totals"},
            "windows": {w: {**win_stats[w], "allegation": breakdown(win[w], "allegation", labels["allegation"]) if win[w] else [],
                            "severity": breakdown(win[w], "severity") if win[w] else []} for w in WINDOWS},
            "growth": growth,
            "allegation_mix_shift": {"from": MIX_FROM, "to": MIX_TO, "rows": mix,
                                     "formula": "change_pp = (share of reports 2021-2025 - share 2005-2009) x 100; shares within the state's reports in each window"},
            "per_million_2021_2025": rate_recent,
            "latest_full_year": {"year": LATEST_FULL, **{k: latest.get(k) for k in ("n", "total", "mean", "median", "suppressed") if k in latest}},
            "state_basis": {basis: n for (s, basis), n in mm["basis"].items() if s == code},
        }
        summaries[code] = summary
    # Rankings among the 50 states + DC.
    metrics = {
        "reports_2025": lambda s: s["latest_full_year"].get("n"),
        "reports_per_million_2021_2025": lambda s: s["per_million_2021_2025"],
        "median_payment_2021_2025": lambda s: s["windows"]["2021-2025"].get("median"),
        "mean_payment_2021_2025": lambda s: s["windows"]["2021-2025"].get("mean"),
        "total_paid_2021_2025": lambda s: s["windows"]["2021-2025"].get("total"),
        "median_payment_cagr_2003_2023": lambda s: s["growth"]["median_cagr"],
        "judgment_share_all_years": lambda s: share_of(s["breakdowns"]["judgment"], "Judgment"),
    }
    rank_tables = {}
    for metric, fn in metrics.items():
        values = {c: fn(s) for c, s in summaries.items() if c in lib.PLACE_CODES}
        ranked, of = lib.ranks(values)
        rank_tables[metric] = sorted(({"code": c, "name": summaries[c]["name"], "value": values[c], "rank": r} for c, r in ranked.items()),
                                     key=lambda d: (d["rank"], d["code"]))
        for c, s in summaries.items():
            s.setdefault("ranks", {})[metric] = {"value": values.get(c), "rank": ranked.get(c), "of": of} if c in lib.PLACE_CODES else None
    for code in states:
        s = summaries[code]
        name, kind, t = s["name"], s["kind"], s["totals"]
        link = lib.place_link(code, name)
        links = ([link] if link else []) + [
            {"label": "NPDB Public Use Data File (Data Use Agreement and download)", "url": PUF_PAGE},
            {"label": "PUF format specifications", "url": SPEC_URL},
            {"label": f"{name}: NPDB adverse action reports", "url": f"/records/npdb_adverse_actions/npdb-aa:{code}:all"},
            {"label": "National malpractice payment series", "url": "/records/npdb_malpractice_national/npdb-mmpr-us:all"},
        ]
        g = s["growth"]
        judgment_share = share_of(s["breakdowns"]["judgment"], "Judgment")
        rows.append(record(
            "npdb_malpractice_states", f"npdb-mmpr:{code}:all", f"{name} — medical malpractice payment reports (NPDB), 1990–2026",
            source_url=PUF_PAGE,
            subtitle=f"{lib.count_text(t)} reports · coded total {lib.money(t.get('total'))} · median {lib.money(t.get('median'))} · mean {lib.money(t.get('mean'))} (nominal)",
            state=code if kind in ("state", "territory") else "",
            cells={"state": name, "year": "All years", "reports": t.get("n"), "total_paid": t.get("total"), "mean_payment": t.get("mean"),
                   "median_payment": t.get("median"), "delay_median_years": t.get("delay_median"),
                   "judgment_share": judgment_share, "per_million": s["per_million_2021_2025"]},
            facts=common_facts + [
                ("Area", f"{name} ({code})"),
                ("Reports, all years", lib.count_text(t)),
                ("Coded total paid, all years (nominal $)", lib.money(t.get("total"))),
                ("Mean payment (nominal $)", lib.money(t.get("mean"))),
                ("Median payment (nominal $)", lib.money(t.get("median"))),
                ("Median years from act/omission to report", t.get("delay_median")),
                ("Judgments (share of reports)", lib.share_text(s["breakdowns"]["judgment"], "Judgment")),
                (f"Reports in {LATEST_FULL}", lib.count_text(s["latest_full_year"]) if (s["latest_full_year"].get("n") or s["latest_full_year"].get("suppressed")) else "0"),
                ("Reports per million residents per year, 2021–2025 (pooled)", s["per_million_2021_2025"]),
                ("Per-capita denominator", f"Census Vintage 2025 state population estimates 2021–2025 ({POP2025_URL})" if s["per_million_2021_2025"] is not None else "Not recorded (no Census state estimate for this area)"),
                ("Median payment growth (CAGR, 2001–2005 to 2021–2025)", pct(g["median_cagr"])),
                ("Reports change, 2001–2005 to 2021–2025", pct(g["reports_pct_change"])),
                ("State attribution", "; ".join(f"{b}: {n:,}" for b, n in sorted(s["state_basis"].items()))),
            ],
            text=f"{name} {code} medical malpractice payments NPDB",
            filters={"kind": [kind], "grain": ["summary"], "year": ["all"], "state": [code]},
            badges=["All years", kind.capitalize()],
            links=links,
            extra={"npdb": s},
        ))
        for item in s["years"]:
            y = item["year"]
            agg = mm["st_year"].get((code, y))
            if agg is None:
                continue
            st = stats(agg)
            suppressed = bool(st.get("suppressed")) or bool(item.get("suppressed"))
            detail = {"code": code, "name": name, "year": y, "partial_year": PARTIAL_YEARS.get(y)}
            if suppressed:
                detail.update({"suppressed": True, "reason": "Fewer than 10 reports in this state-year, or withheld so a suppressed year cannot be derived from the state total"})
                cells = {"state": name, "year": y, "reports": None, "total_paid": None, "mean_payment": None, "median_payment": None,
                         "delay_median_years": None, "judgment_share": None, "per_million": None}
                facts = common_facts + [("Area", f"{name} ({code})"), ("Year (ORIGYEAR)", year_label(y)), ("Reports", "Fewer than 10 reports or withheld (suppressed)")]
                subtitle = "Suppressed: fewer than 10 reports (or withheld for complementary suppression)"
            else:
                block = mmpr_summary_block(agg, labels)
                detail.update(block)
                pop = pops.get(code, {}).get(y)
                detail["per_million"] = per_million(st["n"], pop)
                detail["population"] = {"value": pop, "year": y, "source": POP2025_URL if y >= 2020 else POP2020_URL} if pop else None
                js = share_of(block["judgment"], "Judgment")
                cells = {"state": name, "year": y, "reports": st["n"], "total_paid": st["total"], "mean_payment": st["mean"],
                         "median_payment": st["median"], "delay_median_years": st["delay_median"], "judgment_share": js,
                         "per_million": detail["per_million"]}
                facts = common_facts + [
                    ("Area", f"{name} ({code})"),
                    ("Year (ORIGYEAR, year NPDB processed the report)", year_label(y)),
                    ("Reports", f"{st['n']:,}"),
                    ("Coded total paid (nominal $)", lib.money(st["total"])),
                    ("Mean payment (nominal $)", lib.money(st["mean"])),
                    ("Median payment (nominal $)", lib.money(st["median"])),
                    ("Median years from act/omission to report", st["delay_median"]),
                    ("Judgments (share of reports)", lib.share_text(block["judgment"], "Judgment")),
                    ("Reports per million residents", detail["per_million"]),
                    ("Per-capita denominator", f"Census POPESTIMATE{y} ({POP2025_URL if y >= 2020 else POP2020_URL})" if pop else "Not recorded (no Census estimate used for this year/area)"),
                ]
                subtitle = f"{st['n']:,} reports · coded total {lib.money(st['total'])} · median {lib.money(st['median'])} · mean {lib.money(st['mean'])} (nominal)"
            rows.append(record(
                "npdb_malpractice_states", f"npdb-mmpr:{code}:{y}", f"{name} — medical malpractice payment reports, {y}",
                source_url=PUF_PAGE, subtitle=subtitle, state=code if kind in ("state", "territory") else "",
                cells=cells, facts=facts,
                text=f"{name} {code} {y} medical malpractice payments NPDB",
                filters={"kind": [kind], "grain": ["year"], "year": [str(y)], "state": [code]},
                badges=[str(y)] + (["Partial year"] if y in PARTIAL_YEARS else []) + (["Suppressed"] if suppressed else []),
                links=([link] if link else []) + [{"label": f"{name}: all years", "url": f"/records/npdb_malpractice_states/npdb-mmpr:{code}:all"},
                                                   {"label": "NPDB Public Use Data File", "url": PUF_PAGE}],
                extra={"npdb": detail},
            ))
    return rows, summaries, rank_tables


def build_malpractice_national(mm, labels, summaries, rank_tables, cpi_values, release, common_facts):
    rows = []
    factor = {y: cpi_values[REAL_BASE] / cpi_values[y] for y in cpi_values if y <= REAL_BASE and REAL_BASE in cpi_values}
    year_rows = []
    for y in range(1990, 2027):
        agg = mm["nat_year"].get(y)
        if agg is None:
            continue
        s = stats(agg)
        f = factor.get(y)
        real = {"factor": round(f, 6) if f else None, "median": round(s["median"] * f, 2) if (f and s.get("median")) else None,
                "mean": round(s["mean"] * f, 2) if (f and s.get("mean")) else None,
                "total": round(s["total"] * f, 2) if (f and s.get("total")) else None,
                "cpi": cpi_values.get(y), "cpi_base": cpi_values.get(REAL_BASE)}
        block = mmpr_summary_block(agg, labels, extra_dims=("outcome", "band", "ptsex", "ptage", "pttype"))
        detail = {"year": y, "partial_year": PARTIAL_YEARS.get(y), **block, "real_2025_dollars": real}
        year_rows.append(detail)
        js = share_of(block["judgment"], "Judgment")
        death = lib.death_share(agg)
        rows.append(record(
            "npdb_malpractice_national", f"npdb-mmpr-us:{y}", f"United States — medical malpractice payment reports, {y}",
            source_url=PUF_PAGE,
            subtitle=f"{s['n']:,} reports · coded total {lib.money(s['total'])} · median {lib.money(s['median'])} · mean {lib.money(s['mean'])} (nominal)",
            cells={"label": f"National, {y}", "year": y, "reports": s["n"], "total_paid": s["total"], "mean_payment": s["mean"],
                   "median_payment": s["median"], "median_payment_2025usd": real["median"], "delay_median_years": s["delay_median"],
                   "judgment_share": js, "death_share": death},
            facts=common_facts + [
                ("Year (ORIGYEAR)", year_label(y)),
                ("Reports (all areas, incl. no state recorded)", f"{s['n']:,}"),
                ("Coded total paid (nominal $)", lib.money(s["total"])),
                ("Mean payment (nominal $)", lib.money(s["mean"])),
                ("Median payment (nominal $)", lib.money(s["median"])),
                (f"Median payment ({REAL_BASE} dollars, CPI-U)", lib.money(real["median"])),
                ("CPI-U deflator", f"BLS {CPI_SERIES} annual average {y} = {cpi_values.get(y)}, {REAL_BASE} = {cpi_values.get(REAL_BASE)} ({CPI_URL})" if f else "Not recorded (no CPI-U annual average for this year)"),
                ("Median years from act/omission to report", s["delay_median"]),
                ("Judgments (share of reports)", lib.share_text(block["judgment"], "Judgment")),
                ("Deaths (share of reports with a recorded severity)", pct(death) if death is not None else "Not recorded (severity exists only on reports from 1/31/2004, or fewer than 10 reports)"),
            ],
            text=f"United States {y} medical malpractice payments NPDB national",
            filters={"grain": ["year"], "year": [str(y)]},
            badges=[str(y)] + (["Partial year"] if y in PARTIAL_YEARS else []),
            links=[{"label": "All-years national summary", "url": "/records/npdb_malpractice_national/npdb-mmpr-us:all"},
                   {"label": "NPDB Public Use Data File", "url": PUF_PAGE}],
            extra={"npdb": detail},
        ))
    nat = mm["nat_all"]
    t = stats(nat)
    by_year = {d["year"]: d for d in year_rows}
    first, last = by_year[FIRST_FULL]["totals"], by_year[LATEST_FULL]["totals"]
    rf, rl = by_year[FIRST_FULL]["real_2025_dollars"], by_year[LATEST_FULL]["real_2025_dollars"]
    span = LATEST_FULL - FIRST_FULL
    peak = max((d for d in year_rows if d["year"] not in PARTIAL_YEARS), key=lambda d: d["totals"]["n"])
    windows = {}
    for w in WINDOWS:
        agg = mm["nat_win"].get(w)
        real_counter = mm["nat_win_real"].get(w)
        windows[w] = {**stats(agg), "real_2025_median": lib.median_from_counter(real_counter),
                      "band": breakdown(agg, "band", order=band_order), "allegation": breakdown(agg, "allegation", labels["allegation"]),
                      "severity": breakdown(agg, "severity"), "payer": breakdown(agg, "payer"), "judgment": breakdown(agg, "judgment"),
                      "annual_average_reports": round(agg.n / (WINDOWS[w][1] - WINDOWS[w][0] + 1), 1)}
    mix_shift = []
    a_rows = {r["key"]: r for r in windows[MIX_FROM]["allegation"]}
    b_rows = {r["key"]: r for r in windows[MIX_TO]["allegation"]}
    for key in sorted(set(a_rows) | set(b_rows), key=str):
        if key == lib.COMBINED_KEY:
            continue
        sa, sb = (a_rows.get(key) or {}).get("share"), (b_rows.get(key) or {}).get("share")
        mix_shift.append({"key": key, "label": labels["allegation"].get(key, key), "share_from": sa, "share_to": sb,
                          "change_pp": round((sb - sa) * 100, 2) if (sa is not None and sb is not None) else None})
    mix_series = [{"year": d["year"], "shares": {r["key"]: r["share"] for r in d["allegation"]}} for d in year_rows]
    analytics = {
        "trend": {
            "first_full_year": FIRST_FULL, "latest_full_year": LATEST_FULL,
            "reports_first": first["n"], "reports_latest": last["n"],
            "reports_pct_change": lib.pct_change(first["n"], last["n"]),
            "peak_year": peak["year"], "peak_reports": peak["totals"]["n"],
            "reports_pct_change_from_peak": lib.pct_change(peak["totals"]["n"], last["n"]),
            "formula": "pct change = (reports latest - reports first) / reports first",
        },
        "payment_growth": {
            "nominal_median_cagr": lib.cagr(first["median"], last["median"], span),
            "nominal_mean_cagr": lib.cagr(first["mean"], last["mean"], span),
            "real_median_cagr": lib.cagr(rf["median"], rl["median"], span),
            "real_mean_cagr": lib.cagr(rf["mean"], rl["mean"], span),
            "nominal_median_first": first["median"], "nominal_median_latest": last["median"],
            "real_median_first_2025usd": rf["median"], "real_median_latest_2025usd": rl["median"],
            "formula": f"CAGR = (value {LATEST_FULL} / value {FIRST_FULL})^(1/{span}) - 1; real values = nominal x CPI-U({REAL_BASE}) / CPI-U(year), BLS {CPI_SERIES} annual averages",
        },
        "allegation_mix_shift": {"from": MIX_FROM, "to": MIX_TO, "rows": mix_shift,
                                 "formula": "change_pp = (share of national reports 2021-2025 - share 2005-2009) x 100"},
        "allegation_share_series": mix_series,
        "state_rankings": rank_tables,
        "rankings_note": "Ranks among the 50 states and DC (1 = highest); competition ranking for ties; areas with suppressed values unranked.",
    }
    summary = {"totals": t, "breakdowns": {k: v for k, v in mmpr_summary_block(nat, labels, extra_dims=("outcome", "band", "ptsex", "ptage", "pttype")).items() if k != "totals"},
               "years": [{"year": d["year"], **{k: d["totals"].get(k) for k in ("n", "total", "mean", "median", "delay_median")},
                          "real_2025_median": d["real_2025_dollars"]["median"], "real_2025_mean": d["real_2025_dollars"]["mean"],
                          "partial_year": d["partial_year"]} for d in year_rows],
               "states": breakdown(nat, "state"),
               "windows": windows, "analytics": analytics,
               "unassigned": {"reports": sum(n for (s, _), n in mm["basis"].items() if s == lib.UNASSIGNED),
                              "with_license_state_only": mm["unassigned_with_license_state"]}}
    ag = analytics["payment_growth"]
    rows.append(record(
        "npdb_malpractice_national", "npdb-mmpr-us:all", "United States — medical malpractice payment reports (NPDB), all years",
        source_url=PUF_PAGE,
        subtitle=f"{t['n']:,} reports, Sept 1990–{release['data_through']} · coded total {lib.money(t['total'])} · median {lib.money(t['median'])} (nominal)",
        cells={"label": "National, all years", "year": "All years", "reports": t["n"], "total_paid": t["total"], "mean_payment": t["mean"],
               "median_payment": t["median"], "median_payment_2025usd": None, "delay_median_years": t["delay_median"],
               "judgment_share": share_of(summary["breakdowns"]["judgment"], "Judgment"),
               "death_share": lib.death_share(nat)},
        facts=common_facts + [
            ("Reports, all years", f"{t['n']:,}"),
            ("Coded total paid (nominal $)", lib.money(t["total"])),
            ("Mean / median payment (nominal $)", f"{lib.money(t['mean'])} / {lib.money(t['median'])}"),
            (f"Reports {FIRST_FULL} → {LATEST_FULL}", f"{first['n']:,} → {last['n']:,} ({pct(analytics['trend']['reports_pct_change'])})"),
            ("Peak full year", f"{peak['year']} ({peak['totals']['n']:,} reports)"),
            (f"Median payment {FIRST_FULL} → {LATEST_FULL} (nominal)", f"{lib.money(first['median'])} → {lib.money(last['median'])}; CAGR {pct(ag['nominal_median_cagr'])}"),
            (f"Median payment {FIRST_FULL} → {LATEST_FULL} ({REAL_BASE} $)", f"{lib.money(rf['median'])} → {lib.money(rl['median'])}; CAGR {pct(ag['real_median_cagr'])}"),
            ("Growth formula", ag["formula"]),
            ("Reports with no work or home state", f"{summary['unassigned']['reports']:,}"),
        ],
        text="United States national medical malpractice payments NPDB all years trend allegation mix rankings",
        filters={"grain": ["summary"], "year": ["all"]},
        badges=["All years", "National"],
        links=[{"label": "NPDB Public Use Data File", "url": PUF_PAGE}, {"label": "PUF format specifications", "url": SPEC_URL},
               {"label": "State analytics", "url": "/places/analytics"}],
        extra={"npdb": summary},
    ))
    for key, agg in sorted(mm["alleg"].items(), key=lambda kv: -kv[1].n):
        s = stats(agg)
        label = labels["allegation"].get(key, key)
        if s.get("suppressed"):
            continue
        published, pool, folded = lib.fold({y: a for y, a in agg.table("year").items()})
        series = []
        for y in range(1990, 2027):
            a = agg.table("year").get(y)
            if a is None:
                series.append({"year": y, "n": 0})
            elif y in folded:
                series.append({"year": y, "n": None, "suppressed": True})
            else:
                series.append({"year": y, **stats(a)})
        detail = {"key": key, "label": label, "totals": s, "years": series,
                  "specific_allegations": breakdown(agg, "specific", labels["specific"]),
                  "severity": breakdown(agg, "severity"), "ptype": breakdown(agg, "ptype"), "judgment": breakdown(agg, "judgment"),
                  "band": breakdown(agg, "band", order=band_order), "states": breakdown(agg, "state"),
                  "windows": {w: ({**stats(mm["alleg_win"][(key, w)]), "specific_allegations": breakdown(mm["alleg_win"][(key, w)], "specific", labels["specific"])}
                                  if (key, w) in mm["alleg_win"] else {"n": 0}) for w in WINDOWS}}
        rid = "NR" if key == lib.NOT_RECORDED else key
        top = [r for r in detail["specific_allegations"] if r["key"] != lib.COMBINED_KEY][:3]
        rows.append(record(
            "npdb_malpractice_national", f"npdb-mmpr-us:allegation:{rid}", f"Malpractice payments — {label} (allegation group)",
            source_url=PUF_PAGE,
            subtitle=f"{s['n']:,} reports · median {lib.money(s['median'])} · mean {lib.money(s['mean'])} (nominal, all years)",
            cells={"label": label, "year": "All years", "reports": s["n"], "total_paid": s["total"], "mean_payment": s["mean"],
                   "median_payment": s["median"], "median_payment_2025usd": None, "delay_median_years": s["delay_median"],
                   "judgment_share": share_of(detail["judgment"], "Judgment"), "death_share": lib.death_share(agg)},
            facts=common_facts + [
                ("Allegation group (ALGNNATR)", f"{label} ({key})"),
                ("Reports, all years", f"{s['n']:,}"),
                ("Coded total paid (nominal $)", lib.money(s["total"])),
                ("Mean / median payment (nominal $)", f"{lib.money(s['mean'])} / {lib.money(s['median'])}"),
                ("Most frequent specific allegations (ALEGATN1)", "; ".join(f"{r['label']} ({r['n']:,})" for r in top) or lib.NOT_RECORDED),
                ("Caution", "ALGNNATR is not a practitioner specialty (format specification); legacy RECTYPE M codes were translated by NPDB"),
            ],
            text=f"{label} allegation group malpractice payments national NPDB " + " ".join(r["label"] for r in top),
            filters={"grain": ["allegation"], "year": ["all"]},
            badges=["Allegation group", "All years"],
            links=[{"label": "All-years national summary", "url": "/records/npdb_malpractice_national/npdb-mmpr-us:all"},
                   {"label": "NPDB Public Use Data File", "url": PUF_PAGE}],
            extra={"npdb": detail},
        ))
    return rows, summary


def band_order(key):
    labels = [label for _, label in lib.BANDS]
    return labels.index(key) if key in labels else len(labels)


# ------------------------------------------------------------------------------------------------ adverse actions

def aa_block(agg, ptypes_labels=None):
    return {
        "totals": stats(agg, money=False),
        "type": breakdown(agg, "type", lib.AA_TYPE_LABELS, money=False),
        "subject": breakdown(agg, "subject", money=False),
        "ptype": breakdown(agg, "ptype", money=False),
    }


def type_ptype_label(key):
    tg, pt = key.split("|", 1)
    return f"{lib.AA_TYPE_LABELS.get(tg, tg)} — {pt}"


def physician_count(rows):
    md, do = cell_n(rows, "Physician (MD)"), cell_n(rows, "Physician (DO)")
    return None if (md is None or do is None) else md + do


def build_adverse_actions(aa, book, names, pops, release, common_facts, dat=None, compliance_codes=()):
    rows = []
    class_labels = {**book["AACLASS1"], lib.NOT_RECORDED: lib.NOT_RECORDED}
    basis_labels = {**book["BASISCD1"], lib.NOT_RECORDED: lib.NOT_RECORDED}
    rep_labels = book["REPTYPE"]
    areas = sorted({s for s, _ in aa["st_year"]})
    summaries = {}
    for code in areas + ["US"]:
        national = code == "US"
        allagg = aa["nat_all"] if national else aa["st_all"][code]
        name = "United States (all areas)" if national else names.get(code, code)
        kind = "national" if national else lib.area_kind(code)
        years_src = {y: aa["nat_year"][y] for y in aa["nat_year"]} if national else {y: aa["st_year"][(code, y)] for (s, y) in aa["st_year"] if s == code}
        _, _, folded = lib.fold(years_src)
        series = []
        for y in range(1990, 2027):
            a = years_src.get(y)
            if a is None:
                series.append({"year": y, "n": 0})
            elif y in folded:
                series.append({"year": y, "n": None, "suppressed": True})
            else:
                s = stats(a, money=False)
                s["year"] = y
                s["type"] = breakdown(a, "type", lib.AA_TYPE_LABELS, money=False)
                series.append(s)
        state_pops = {} if national else pops.get(code, {})
        for item in series:
            if item.get("n") and item["year"] in state_pops:
                item["per_million"] = per_million(item["n"], state_pops[item["year"]])
        type_rows = breakdown(allagg, "type", lib.AA_TYPE_LABELS, money=False)
        shown_types = [r["key"] for r in type_rows if r["key"] != lib.COMBINED_KEY]
        type_series = {}
        for tg in shown_types:
            src = aa["nat_type_year"][tg] if national else aa["st_type_year"][(code, tg)]
            ycells = src.table("year")
            _, _, tf = lib.fold(ycells)
            type_series[tg] = [{"year": y, "n": (0 if y not in ycells else (None if y in tf else ycells[y].n)), **({"suppressed": True} if y in tf else {})} for y in range(1990, 2027)]
        recent = None if national else aa["st_win"].get((code, "2021-2025"))
        summary = {
            "code": code, "name": name, "kind": kind,
            "totals": stats(allagg, money=False),
            "years": series,
            "years_by_action_year": [r for r in breakdown(allagg, "action_year", money=False, order=lib.mixed_key)],
            "type": type_rows,
            "type_year_series": type_series,
            "reptype": breakdown(allagg, "reptype", rep_labels, money=False),
            "subject": breakdown(allagg, "subject", money=False),
            "ptype": breakdown(allagg, "ptype", money=False),
            "type_by_ptype": breakdown(allagg, "type_ptype", type_ptype_label, money=False),
            "classification": breakdown(allagg, "class", class_labels, money=False),
            "basis": breakdown(allagg, "basis", basis_labels, money=False),
            "length_type": breakdown(allagg, "length", money=False),
            "recent_2021_2025": ({**stats(recent, money=False), "type": breakdown(recent, "type", lib.AA_TYPE_LABELS, money=False),
                                  "classification": breakdown(recent, "class", class_labels, money=False),
                                  "basis": breakdown(recent, "basis", basis_labels, money=False)} if recent else None),
            "per_million_2021_2025": window_rate(years_src, state_pops, 2021, 2025) if state_pops else None,
            "state_basis": {basis: n for (s, basis), n in aa["basis"].items() if s == code} if not national else None,
        }
        if national:
            summary["states"] = breakdown(allagg, "state", money=False)
            if dat:
                summary["dat_unique_practitioners"] = dat
        summaries[code] = summary
    metrics = {
        "reports_2025": lambda s: next((i.get("n") for i in s["years"] if i["year"] == LATEST_FULL), None),
        "reports_per_million_2021_2025": lambda s: s["per_million_2021_2025"],
        "licensure_reports_all_years": lambda s: cell_n(s["type"], "licensure"),
        "exclusion_hhs_oig_reports_all_years": lambda s: cell_n(s["type"], "exclusion_hhs_oig"),
        "clinical_privileges_reports_all_years": lambda s: cell_n(s["type"], "clinical_privileges"),
    }
    rank_tables = {}
    for metric, fn in metrics.items():
        values = {c: fn(s) for c, s in summaries.items() if c in lib.PLACE_CODES}
        ranked, of = lib.ranks(values)
        rank_tables[metric] = sorted(({"code": c, "name": summaries[c]["name"], "value": values[c], "rank": r} for c, r in ranked.items()), key=lambda d: (d["rank"], d["code"]))
        for c, s in summaries.items():
            s.setdefault("ranks", {})[metric] = {"value": values.get(c), "rank": ranked.get(c), "of": of} if c in lib.PLACE_CODES else None
    summaries["US"]["state_rankings"] = rank_tables
    for code in areas + ["US"]:
        s = summaries[code]
        national = code == "US"
        name, kind, t = s["name"], s["kind"], s["totals"]
        link = None if national else lib.place_link(code, name)
        type_cells = {tg: cell_n(s["type"], tg) for tg in ("licensure", "clinical_privileges", "exclusion_hhs_oig", "dea")}
        links = ([link] if link else []) + [{"label": "NPDB Public Use Data File", "url": PUF_PAGE}, {"label": "PUF format specifications", "url": SPEC_URL}]
        if not national:
            links.append({"label": f"{name}: malpractice payment reports", "url": f"/records/npdb_malpractice_states/npdb-mmpr:{code}:all"})
            if code in compliance_codes:  # link only to a compliance record that exists in the build
                links.append({"label": f"{name}: state licensing board compliance", "url": f"/records/npdb_state_board_compliance/npdb-compliance:{code}"})
        top_types = [r for r in s["type"] if r["key"] != lib.COMBINED_KEY][:4]
        rows.append(record(
            "npdb_adverse_actions", f"npdb-aa:{code}:all", f"{name} — NPDB adverse action reports, 1990–2026",
            source_url=PUF_PAGE,
            subtitle=f"{lib.count_text(t)} adverse action reports · " + " · ".join(f"{r['label']}: {lib.count_text(r)}" for r in top_types[:2]),
            state=code if kind in ("state", "territory") else "",
            cells={"state": name, "year": "All years", "reports": t.get("n"), **type_cells,
                   "physicians": physician_count(s["ptype"]), "per_million": s["per_million_2021_2025"]},
            facts=common_facts + [
                ("Area", f"{name} ({code})"),
                ("Adverse action reports, all years", lib.count_text(t)),
            ] + [(f"{r['label']}", lib.count_text(r)) for r in top_types] + ([
                ("Unique practitioners with any NPDB report, by type (Data Analysis Tool, as published)",
                 "; ".join(f"{d['type']}: {lib.NOT_RECORDED if d['practitioners'] is None else format(d['practitioners'], ',')}" for d in dat["rows"][:8]) + "; see the dataset summary for all types"),
                ("Data Analysis Tool note", "Counts unique practitioners with at least one adverse action or malpractice payment report; one practitioner can appear under several types. It is not a count of licensed practitioners and is not used as a rate denominator."),
            ] if (national and dat) else []) + [
                ("Reports per million residents per year, 2021–2025 (pooled)", s["per_million_2021_2025"]),
                ("Per-capita denominator", f"Census Vintage 2025 state population estimates 2021–2025 ({POP2025_URL})" if s["per_million_2021_2025"] is not None else "Not recorded (national row or no Census estimate)"),
                ("State attribution", "; ".join(f"{b}: {n:,}" for b, n in sorted((s["state_basis"] or {}).items())) or "All areas (national)"),
                ("Caution", "Clinical privileges and professional society reports for practitioners other than physicians and dentists are not required and are not recommended for analysis (format specification)"),
            ],
            text=f"{name} {code} adverse actions licensure exclusions clinical privileges DEA NPDB",
            filters={"kind": [kind], "grain": ["summary"], "year": ["all"], "state": [code]},
            badges=["All years", kind.capitalize()],
            links=links,
            extra={"npdb": s},
        ))
        years_src = {y: aa["nat_year"][y] for y in aa["nat_year"]} if national else {y: aa["st_year"][(code, y)] for (st, y) in aa["st_year"] if st == code}
        for item in s["years"]:
            y = item["year"]
            agg = years_src.get(y)
            if agg is None:
                continue
            suppressed = bool(item.get("suppressed"))
            detail = {"code": code, "name": name, "year": y, "partial_year": PARTIAL_YEARS.get(y)}
            if suppressed:
                detail.update({"suppressed": True, "reason": "Fewer than 10 reports in this area-year, or withheld so a suppressed year cannot be derived from the area total"})
                cells = {"state": name, "year": y, "reports": None, "licensure": None, "clinical_privileges": None, "exclusion_hhs_oig": None,
                         "dea": None, "physicians": None, "per_million": None}
                facts = common_facts + [("Area", f"{name} ({code})"), ("Year (ORIGYEAR)", year_label(y)), ("Reports", "Fewer than 10 reports or withheld (suppressed)")]
                subtitle = "Suppressed: fewer than 10 reports (or withheld for complementary suppression)"
            else:
                block = aa_block(agg)
                if national:
                    block["reptype"] = breakdown(agg, "reptype", rep_labels, money=False)
                    block["type_by_ptype"] = breakdown(agg, "type_ptype", type_ptype_label, money=False)
                detail.update(block)
                detail["per_million"] = item.get("per_million")
                tc = {tg: cell_n(block["type"], tg) for tg in ("licensure", "clinical_privileges", "exclusion_hhs_oig", "dea")}
                cells = {"state": name, "year": y, "reports": block["totals"]["n"], **tc, "physicians": physician_count(block["ptype"]),
                         "per_million": detail["per_million"]}
                facts = common_facts + [("Area", f"{name} ({code})"), ("Year (ORIGYEAR, year NPDB processed the report)", year_label(y)),
                                        ("Adverse action reports", f"{block['totals']['n']:,}")] + \
                    [(r["label"], lib.count_text(r)) for r in block["type"]] + \
                    [("Reports per million residents", detail["per_million"]),
                     ("Per-capita denominator", f"Census POPESTIMATE{y} ({POP2025_URL if y >= 2020 else POP2020_URL})" if detail["per_million"] is not None else "Not recorded")]
                subtitle = f"{block['totals']['n']:,} adverse action reports · " + " · ".join(f"{r['label']}: {lib.count_text(r)}" for r in block["type"][:2])
            rows.append(record(
                "npdb_adverse_actions", f"npdb-aa:{code}:{y}", f"{name} — NPDB adverse action reports, {y}",
                source_url=PUF_PAGE, subtitle=subtitle, state=code if kind in ("state", "territory") else "",
                cells=cells, facts=facts,
                text=f"{name} {code} {y} adverse actions NPDB",
                filters={"kind": [kind], "grain": ["year"], "year": [str(y)], "state": [code]},
                badges=[str(y)] + (["Partial year"] if y in PARTIAL_YEARS else []) + (["Suppressed"] if suppressed else []),
                links=([link] if link else []) + [{"label": f"{name}: all years", "url": f"/records/npdb_adverse_actions/npdb-aa:{code}:all"},
                                                   {"label": "NPDB Public Use Data File", "url": PUF_PAGE}],
                extra={"npdb": detail},
            ))
    return rows, summaries


# ------------------------------------------------------------------------------------------------ compliance

def build_compliance(names, entries):
    with open(os.path.join(ACQ, "compliance", "ComplianceReviewStatusbyState.csv"), encoding="utf-8-sig", newline="") as handle:
        status_rows = list(csv.reader(handle))
    header = status_rows[0]
    idx_state, idx_code, idx_status = header.index("State"), header.index("State Cd"), header.index("Status")
    name_to_code = {}
    overall = collections.defaultdict(set)
    for r in status_rows[1:]:
        name_to_code.setdefault(r[idx_state], set()).add(r[idx_code])
        overall[r[idx_code]].add(r[idx_status])
    table = {code: state for state, codes in name_to_code.items() for code in codes}
    with open(os.path.join(ACQ, "compliance", "StateBoardDetails.csv"), encoding="utf-8-sig", newline="") as handle:
        boards = list(csv.DictReader(handle))
    by_code = collections.defaultdict(list)
    unmatched = collections.Counter()
    for b in boards:
        code = lib.match_state_name(b["State"], table)
        if code is None:
            code = lib.match_state_name(b["State"], {k: v for k, v in names.items()})
        if code is None:
            unmatched[b["State"]] += 1
            continue
        by_code[code].append({
            "board": b["Board Name"], "profession": b["Profession"], "status": b["Status"],
            "posted": b["Posted Date"], "review": b["Review Period"], "period_reviewed": b["Reviewed Time Period"],
        })
    retrieved = entries["private/acq/npdb/compliance/StateBoardDetails.csv"]["retrieved_at"]
    definitions = {
        "Compliant": "The board submitted all reportable actions for the specified time frame; or provided an appropriate justification for any identified missing action; or certified there were no reportable actions and will continue to report within 30 days.",
        "Not Fully Compliant": "The board submitted at least 95%, but not all, of the reportable actions for the specified time frame.",
        "Non-Compliant": "The board has not responded to HRSA's written request to reconcile or report actions identified as missing; or has not responded to HRSA's request for data; or refused to provide appropriate justification or submit reportable actions.",
        "Previously Non-compliant": "The board was Non-compliant in a previous review but has since become Compliant for that time frame.",
        "No Current Review": "The board has not completed a Compliance Review for the selected profession(s), or may not license them.",
        "scope": "Compliance reviews include professions most often queried (physicians, dentists, nurses, physician assistants, social workers) plus randomly selected professions; boards are reviewed and attest every 2 years.",
    }
    rows = []
    for code in sorted(by_code):
        items = sorted(by_code[code], key=lambda d: (d["board"], d["profession"]))
        name = names.get(code, table.get(code, code))
        kind = lib.area_kind(code)
        link = lib.place_link(code, name)
        compliant = sum(1 for i in items if i["status"] == "Compliant")
        non = sum(1 for i in items if i["status"] == "Non-Compliant")
        statuses = collections.Counter(i["status"] for i in items)
        rows.append(record(
            "npdb_state_board_compliance", f"npdb-compliance:{code}", f"{name} — NPDB state licensing board compliance results",
            source_url=MAP_URL,
            subtitle=f"{len(items)} board-profession results · {compliant} compliant · {non} non-compliant (current compliance review)",
            state=code if kind in ("state", "territory") else "",
            cells={"state": name, "boards": len({i["board"] for i in items}), "results": len(items), "compliant": compliant,
                   "non_compliant": non, "latest_posted": max(i["posted"] for i in items), "map_statuses": ", ".join(sorted(overall.get(code, [])))},
            facts=[
                ["Source", "NPDB State Licensing Board Compliance Results (HRSA Tableau view 'State Board Details', CSV export)"],
                ["Retrieved", retrieved],
                ["Area", f"{name} ({code})"],
                ["Board-profession results", str(len(items))],
                ["Status counts", "; ".join(f"{k}: {v}" for k, v in sorted(statuses.items()))],
                ["Statuses shown on the map for this area", ", ".join(sorted(overall.get(code, []))) or lib.NOT_RECORDED],
                ["Review", "Current Compliance Review (as exported)"],
                ["Definitions", "See dataset summary; quoted from the NPDB compliance map page"],
            ] + [[f"{i['board']} — {i['profession']}", f"{i['status']} (period reviewed {i['period_reviewed']}; posted {i['posted']})"] for i in items[:40]],
            text=f"{name} {code} state licensing board NPDB compliance " + " ".join(sorted({i['board'] for i in items})),
            filters={"kind": [kind], "has_non_compliant": ["yes" if non else "no"], "state": [code]},
            badges=(["Non-compliant board result"] if non else ["All reviewed results compliant"]),
            links=([link] if link else []) + [{"label": "NPDB compliance map", "url": MAP_URL},
                                               {"label": f"{name}: NPDB adverse action reports", "url": f"/records/npdb_adverse_actions/npdb-aa:{code}:all"}],
            extra={"npdb": {"code": code, "name": name, "results": items, "map_statuses": sorted(overall.get(code, [])), "status_counts": dict(statuses)}},
        ))
    return rows, definitions, unmatched, len(boards)


# ------------------------------------------------------------------------------------------------ output

def write_dataset(dataset, label, listing_block, summary, rows, inputs):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{dataset}: duplicate ids")
    os.makedirs(OUT, exist_ok=True)
    payload = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
               "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "inputs": inputs}
    path = os.path.join(OUT, f"{dataset}.json")
    with open(path, "w") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "bytes": os.path.getsize(path)}), file=sys.stderr)
    return path


def audit(rows):
    """Disclosure audit: every published count is None (suppressed), 0, or >= MIN_CELL."""
    bad = []
    for row in rows:
        for cell in lib.published_cells(row["item"]):
            n = cell.get("n")
            if n is not None and 0 < n < lib.MIN_CELL:
                bad.append((row["id"], n))
        for key, value in row["item"]["cells"].items():
            if key in ("reports", "licensure", "clinical_privileges", "exclusion_hhs_oig", "dea", "physicians") and isinstance(value, int) and 0 < value < lib.MIN_CELL:
                bad.append((row["id"], key, value))
    return bad


def margin_exposure(area_year_rows, national_n):
    """Years in which subtracting the published area-year counts from the published national year total pins down
    suppressed area-year counts below the threshold exactly: one hidden cell, or hidden cells that must each be 1
    (hidden total equals hidden cell count). Returns [{year, hidden_cells, hidden_total}] for those years only."""
    shown = collections.defaultdict(int)
    hidden = collections.Counter()
    for row in area_year_rows:
        if row["filters"].get("grain") != ["year"]:
            continue
        year_ = int(row["filters"]["year"][0])
        n = row["item"]["cells"].get("reports")
        if n is None:
            hidden[year_] += 1
        else:
            shown[year_] += n
    out = []
    for year_ in sorted(hidden):
        if year_ not in national_n:
            continue
        total = national_n[year_] - shown[year_]
        if total < lib.MIN_CELL and (hidden[year_] == 1 or total == hidden[year_]):
            out.append({"year": year_, "hidden_cells": hidden[year_], "hidden_total": total})
    return out


def main():
    entries = manifest()
    book = lib.parse_codebook(read_text("pages/pufFormatSpecifications.jsp.raw"))
    ptypes = lib.parse_practitioner_types(read_text("pages/analysistool.raw"))
    names = {code: label for code, label in book["WORKSTAT"].items()}
    names[lib.UNASSIGNED] = "State not recorded"
    pops = population()
    cpi_values = cpi()
    release = release_info(entries)
    dat = dat_practitioners(entries)
    mm, aa, total_rows = scan(ptypes, cpi_values)
    print(json.dumps({"rows": total_rows, "mmpr": mm["rows"], "aar": aa["rows"]}), file=sys.stderr)
    labels = mmpr_labels(book)
    common_facts = [
        ("Source", f"NPDB Public Use Data File, {release['version']} ({release['file']} in {release['zip']}, dated {release['file_date']})"),
        ("Retrieved", release["retrieved"]),
        ("Citation", release["citation"]),
        ("Units", "Reports (one PUF record per report); dollars are nominal sums/means/medians of NPDB coded payment midpoints"),
        ("Disclosure rule", "Counts of 1–9 reports are suppressed, with complementary suppression in each breakdown"),
        ("Use restriction", "De-identified aggregates published under the NPDB Public Use Data File Data Use Agreement: do not use these figures, alone or combined with other data, to identify any practitioner, health care entity or patient"),
    ]
    aa_facts = [f for f in common_facts if f[0] != "Units"] + [("Units", "Adverse action reports (one PUF record per report)")]

    def inputs_for(paths):
        out = []
        for rel in paths:
            entry = entries[f"private/acq/npdb/{rel}"]
            out.append({"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]})
        return out

    base_inputs = ["puf/NpdbPublicUseDataCsv.zip", "pages/pufFormatSpecifications.jsp.raw", "pages/analysistool.raw", "pages/publicData.jsp.raw"]
    mm_rows, mm_summaries, rank_tables = build_malpractice_states(mm, labels, names, pops, release, common_facts)
    nat_rows, nat_summary = build_malpractice_national(mm, labels, mm_summaries, rank_tables, cpi_values, release, common_facts)
    comp_rows, definitions, unmatched, board_rows = build_compliance(names, entries)
    compliance_codes = {r["id"].split(":", 1)[1] for r in comp_rows}
    aa_rows, aa_summaries = build_adverse_actions(aa, book, names, pops, release, aa_facts, dat, compliance_codes)

    for rows in (mm_rows, nat_rows, aa_rows):
        bad = audit(rows)
        if bad:
            raise SystemExit(f"disclosure audit failed: {bad[:10]}")

    mm_exposure = margin_exposure(mm_rows, {y: a.n for y, a in mm["nat_year"].items()})
    aa_exposure = margin_exposure([r for r in aa_rows if not r["id"].startswith("npdb-aa:US:")], {y: a.n for y, a in aa["nat_year"].items()})

    common_summary = {
        "source": PUF_PAGE, "release": release, "terms": TERMS, "format_specification": SPEC_URL, "background": BACKGROUND_URL,
        "statement": STATEMENT_URL, "disclosure": {
            "rule": "Every published count is 0 or at least 10 reports. Cells with 1–9 reports are suppressed; within each breakdown that sums to a shown total, suppressed categories are pooled into one combined cell and, while that pool has fewer than 10 reports, the smallest published category is added to it (complementary suppression). Means and medians are published only for cells with at least 10 payment amounts.",
            "npdb_rule": "NPDB's format specification and FAQs publish no numeric small-cell rule; the 10-report threshold is this stream's rule.",
            "row_level": "No PUF record, SEQNO or PRACTNUM is stored or published.",
            "cross_table_note": "Every published cell is at least 10, but differences between separately published tables are not protected (a national year total minus the published area-years of that year, a window total minus its published years, a year's type breakdown against the type's own year series); the source PUF is itself a public de-identified file under the Data Use Agreement. cross_table_exposure lists the years in which the first of these pins a suppressed area-year count exactly."},
        "year_basis": "ORIGYEAR: year NPDB processed the report (format specification: a reasonable substitute for the year of payment because reports are due within 30 days). 1990 covers September 1–December 31 only; 2026 covers January 1–June 30 only.",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    mm_summary = {
        **common_summary,
        "disclosure": {**common_summary["disclosure"], "cross_table_exposure": mm_exposure},
        "grain": "One record per area (state, DC, territory, military mail code, or 'state not recorded') for all years, plus one record per area-year (ORIGYEAR) with at least one report.",
        "scope": "Medical malpractice payment reports (RECTYPE M and P; REPTYPE 101 and 102) for all practitioner types.",
        "state_basis": "Work state (WORKSTAT) if reported, else home state (HOMESTAT), as the format specification's note to users recommends for non-licensure reports; reports with neither are in area NR ('State not recorded').",
        "payments": "PAYMENT (this payment only), coded by NPDB as the midpoint of its range (e.g. $95,001–$100,000 coded $97,500); totals, means and medians are of coded values in nominal dollars, not inflation-adjusted. NPDB notes the coding slightly lowers apparent means and medians.",
        "delay": "Median of ORIGYEAR − MALYEAR1 (year of the first act or omission) in whole years; records with MALYEAR1 missing or outside 1900..ORIGYEAR are excluded.",
        "dimensions": {
            "allegation": "ALGNNATR allegation group (legacy RECTYPE M codes translated by NPDB); not a practitioner specialty.",
            "severity": "OUTCOME grouped: 1–2 emotional/insignificant; 3–4 temporary; 5–7 permanent; 8 quadriplegic/brain damage/lifelong care; 9 death; 10 cannot be determined. OUTCOME exists only on RECTYPE P reports (from 1/31/2004); legacy reports are 'Not recorded (legacy report format before 1/31/2004)'.",
            "ptype": "NPDB Data Analysis Tool practitioner types (LICNFELD grouping published on the DAT Definitions tab); other LICNFELD codes are labelled as outside the DAT types.",
            "payer": "PYRRLTNS grouped: insurance company primary (1, P); excess insurer (E); guaranty fund (2, G); self-insured organization (3, S); state malpractice fund (4, M, O).",
            "judgment": "PAYTYPE: J = judgment; all other values = settlement or other, as NPDB recommends.",
            "fund": "FUNDPYMT = 1 marks payments by a state patient compensation / excess fund; such payments usually add a second report for one incident (FL, IN, KS, LA, NE, NM, PA, SC, WI per the specification).",
            "band": "Payment bands on actual-payment limits; coded midpoints nest within band limits.",
        },
        "analytics": {
            "growth": "Median/mean CAGR = (pooled value 2021–2025 / pooled value 2001–2005)^(1/20) − 1.",
            "reports_change": "(reports 2021–2025 − reports 2001–2005) / reports 2001–2005.",
            "allegation_mix_shift": "Percentage-point change in an allegation group's share of the area's reports, 2005–2009 to 2021–2025.",
            "per_capita": f"Reports per million residents = reports / Census resident population × 1,000,000; years 2010–2019 use Vintage 2020 POPESTIMATE (nst-est2020-alldata.csv, {POP2020_URL}); 2020–2025 use Vintage 2025 (NST-EST2025-ALLDATA.csv, {POP2025_URL}); 2021–2025 window = sum of reports / sum of populations × 1e6. No per-physician rates are computed (no official physician-count denominator acquired).",
            "rankings": "Among the 50 states and DC; 1 = highest; competition ranking for ties.",
        },
        "caveats": [
            "The NPDB contains only payments made for the benefit of individual practitioners in settlement or satisfaction of a written claim or judgment; it is not a record of all lawsuits and excludes payments by or for hospitals and other entities (NPDB FAQs).",
            "Payments by state funds generally create a second report for one incident, raising counts and lowering means/medians in fund states.",
            "ORIGYEAR is the processing year, not the year of the act or of the judgment/settlement.",
        ],
        "counts": {"reports": mm["rows"], "areas": sum(1 for r in mm_rows if r["filters"]["grain"] == ["summary"]),
                   "area_year_records": sum(1 for r in mm_rows if r["filters"]["grain"] == ["year"]),
                   "unassigned_reports": nat_summary["unassigned"]},
    }
    mm_listing = writer.listing(
        [("state", "Area"), ("year", "Year"), ("reports", "Reports"), ("total_paid", "Coded total paid ($, nominal)"), ("mean_payment", "Mean ($)"),
         ("median_payment", "Median ($)"), ("delay_median_years", "Median years act→report"), ("judgment_share", "Judgment share"), ("per_million", "Reports per million residents")],
        [("grain", "Grain", {"summary": "All years (area profile)", "year": "Area-year"}),
         ("kind", "Kind", {"state": "State or DC", "territory": "Territory", "military": "Armed Forces mail code", "unrecorded": "State not recorded"}),
         ("year", "Year", {**{"all": "All years"}, **{str(y): year_label(y) for y in range(1990, 2027)}})])
    write_dataset("npdb_malpractice_states", "NPDB medical malpractice payment reports by state and year", mm_listing, mm_summary, mm_rows,
                  inputs_for(base_inputs + ["denominators/NST-EST2025-ALLDATA.csv", "denominators/nst-est2020-alldata.csv"]))

    nat_summary_block = {**common_summary, "disclosure": {**common_summary["disclosure"], "cross_table_exposure": mm_exposure},
                         **{k: mm_summary[k] for k in ("scope", "payments", "delay", "dimensions", "caveats")},
                         "grain": "One record per year (ORIGYEAR, all areas including reports without a state), one all-years summary with analytics and state rankings, and one record per allegation group (ALGNNATR).",
                         "real_dollars": f"Real values in {REAL_BASE} dollars = nominal × CPI-U {REAL_BASE} / CPI-U year (BLS {CPI_SERIES}, U.S. city average, all items, 1982–84=100, annual averages; NPDB's specification recommends CPI-U for inflation adjustment). 2026 has no annual average and is Not recorded.",
                         "cpi_source": CPI_URL, "bands": [label for _, label in lib.BANDS],
                         "analytics": {"trend": "(reports latest − reports first) / reports first", "growth": "CAGR = (value 2025 / value 1991)^(1/34) − 1, nominal and real",
                                       "allegation_mix_shift": "percentage-point change in national share, 2005–2009 to 2021–2025"}}
    nat_listing = writer.listing(
        [("label", "Series"), ("year", "Year"), ("reports", "Reports"), ("total_paid", "Coded total paid ($, nominal)"), ("mean_payment", "Mean ($)"),
         ("median_payment", "Median ($)"), ("median_payment_2025usd", "Median (2025 $)"), ("delay_median_years", "Median years act→report"),
         ("judgment_share", "Judgment share"), ("death_share", "Deaths (share with recorded severity)")],
        [("grain", "Grain", {"year": "National year", "summary": "All-years summary", "allegation": "Allegation group"})])
    write_dataset("npdb_malpractice_national", "NPDB medical malpractice payments: national series, bands and allegation groups", nat_listing, nat_summary_block, nat_rows,
                  inputs_for(base_inputs + ["denominators/bls_cu.data.1.AllItems.txt"]))

    aa_summary = {
        **common_summary,
        "disclosure": {**common_summary["disclosure"], "cross_table_exposure": aa_exposure},
        "grain": "One record per area for all years and per area-year (ORIGYEAR), plus national (all areas) records.",
        "scope": "Adverse action reports (RECTYPE A and C): state licensure/certification, clinical privileges/panel membership, health plan, professional society, DEA, government administrative, HHS-OIG exclusion, non-HHS exclusion/debarment, federal licensure and accreditation actions, for individuals and organizations. Judgment or Conviction Reports are not in the PUF.",
        "state_basis": "Licensure actions (REPTYPE 301, 302, 1302): license state (LICNSTAT, first listed) as the format specification suggests, else work state, else home state. Other actions: work state, else home state. Reports with none are area NR.",
        "type_groups": {k: v for k, v in lib.AA_TYPE_LABELS.items()},
        "reptype_to_group": {rep: {"group": g, "subject": s} for rep, (g, s) in lib.AA_TYPES.items()},
        "action_year": "years_by_action_year uses AAYEAR (year of adverse action) where 1950 <= AAYEAR <= ORIGYEAR; other values are Not recorded (the specification notes erroneous years are recorded as reported).",
        "caveats": [
            "Since March 10, 2010 (Section 1921), licensure actions are reported for all practitioner types; before that, adverse actions other than exclusions were required only for physicians and dentists, so long-run trends for other professions reflect reporting changes.",
            "Clinical privileges and professional society reports for practitioners other than physicians and dentists are not required and NPDB does not recommend analysing them.",
            "On May 6, 2013 HIPDB data were merged into the NPDB; Section 1128E reports (other than JOCRs) are in the PUF from the September 30, 2025 version.",
        ],
        "per_capita": mm_summary["analytics"]["per_capita"],
        "published_statistics": {"dat_unique_practitioners": dat,
                                 "note": "Published by NPDB as shown on the Data Analysis Tool's second tab; stored unchanged. The Data Analysis Tool is aggregated with variables not in the PUF and may not match PUF-derived counts (Data Analysis Tool methods page)."},
        "counts": {"reports": aa["rows"], "areas": len(aa_summaries) - 1},
    }
    aa_listing = writer.listing(
        [("state", "Area"), ("year", "Year"), ("reports", "Reports"), ("licensure", "Licensure"), ("clinical_privileges", "Clinical privileges"),
         ("exclusion_hhs_oig", "HHS-OIG exclusions"), ("dea", "DEA"), ("physicians", "Physicians (MD+DO)"), ("per_million", "Reports per million residents")],
        [("grain", "Grain", {"summary": "All years", "year": "Area-year"}),
         ("kind", "Kind", {"national": "National", "state": "State or DC", "territory": "Territory", "military": "Armed Forces mail code", "unrecorded": "State not recorded"}),
         ("year", "Year", {**{"all": "All years"}, **{str(y): year_label(y) for y in range(1990, 2027)}})])
    write_dataset("npdb_adverse_actions", "NPDB adverse action reports by state, year, type and practitioner type", aa_listing, aa_summary, aa_rows,
                  inputs_for(base_inputs + ["denominators/NST-EST2025-ALLDATA.csv", "denominators/nst-est2020-alldata.csv", "dat/NPDBPractitioners.csv"]))

    comp_summary = {
        "source": MAP_URL, "export_urls": [BOARDS_CSV_URL, STATUS_CSV_URL],
        "retrieval": "CSV export of the public Tableau views embedded on the NPDB compliance map page (same data as the page's 'Export CSV' button); stored as published.",
        "retrieved": entries["private/acq/npdb/compliance/StateBoardDetails.csv"]["retrieved_at"],
        "definitions": definitions, "grain": "One record per state/territory with every board-profession result in the export.",
        "rows_in_export": board_rows, "unmatched_state_names": dict(unmatched),
        "matching": "State names in the board export are matched to codes by unique exact (case/whitespace-normalised) match against the State/State Cd pairs in the map-status export.",
        "note": "Status of state licensing board reporting to the NPDB, not a measure of discipline or malpractice. No per-physician rates are published by this map.",
    }
    comp_listing = writer.listing(
        [("state", "Area"), ("boards", "Boards"), ("results", "Board-profession results"), ("compliant", "Compliant"), ("non_compliant", "Non-compliant"),
         ("latest_posted", "Latest posted"), ("map_statuses", "Map statuses")],
        [("kind", "Kind", {"state": "State or DC", "territory": "Territory"}), ("has_non_compliant", "Any non-compliant result", {"yes": "Yes", "no": "No"})])
    write_dataset("npdb_state_board_compliance", "NPDB state licensing board compliance results", comp_listing, comp_summary, comp_rows,
                  inputs_for(["compliance/StateBoardDetails.csv", "compliance/ComplianceReviewStatusbyState.csv", "pages/npdbMap.jsp.raw"]))


if __name__ == "__main__":
    main()
