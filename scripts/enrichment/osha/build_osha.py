"""Build OSHA enforcement datasets from the official DOL Open Data Portal bulk files.

Inputs (unchanged raw bytes under private/acq/osha/, see _manifest.jsonl):
  dol/inspection/<date>_chunk_N.csv.gz   members of https://data.dol.gov/data-catalog/OSHA/inspection/OSHA_inspection.zip
  dol/violation/<date>_chunk_N.csv.gz    members of https://data.dol.gov/data-catalog/OSHA/violation/OSHA_violation.zip
  census/2-6_digit_2022_Codes.xlsx       Census NAICS 2022 titles (sector labels)
  bls/qcew_2025_annual_industry_10.csv   BLS QCEW 2025 annual averages, total covered employment (rate denominator)
  private/build/osha/lookups/company_sec_profiles_titles.json   read-only corpus lookup (exact-name company links)
  _pages/sir_published_tables_2026-10-18.md   OSHA Severe Injury Report aggregates OSHA published (the record-level SIR file is bot-walled)

Writes private/build/osha/<dataset>.json for:
  osha_inspections_states    one record per site state/territory (+ one record for other/unrecorded codes)
  osha_inspections_national  one record per fiscal year + one summary record
  osha_employers             top establishment names (exact as recorded) by current penalty, FY2017-FY2026
  osha_severe_injuries       OSHA-published SIR aggregates: national by year, federal-OSHA states 2015-2021, sectors 2024 (partial: see summary)

Usage: python3 -I -B scripts/enrichment/osha/build_osha.py [--only osha_severe_injuries]
"""
import array
import collections
import csv
import glob
import gzip
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import osha_parsing as P  # noqa: E402
import sir_published as SIR  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "osha")
OUT = os.path.join(ROOT, "private", "build", "osha")
LOOKUPS = os.path.join(OUT, "lookups")

INSPECTION_ZIP = "https://data.dol.gov/data-catalog/OSHA/inspection/OSHA_inspection.zip"
VIOLATION_ZIP = "https://data.dol.gov/data-catalog/OSHA/violation/OSHA_violation.zip"
INSPECTION_PAGE = "https://dataportal.dol.gov/datasets/10334"
VIOLATION_PAGE = "https://dataportal.dol.gov/datasets/10338"
DETAIL_URL = "https://www.osha.gov/ords/imis/establishment.inspection_detail?id={}"
SIR_FILE = os.path.join(ACQ, "_pages", "sir_published_tables_2026-10-18.md")
SIR_PAGE = "https://www.osha.gov/severeinjury"
SIR_DASHBOARD = "https://www.osha.gov/severe-injury-reports"
SIR_ZIP = "https://www.osha.gov/sites/default/files/January2015toNovember2025.zip"
SIR_2024 = "https://www.osha.gov/sites/default/files/2024_Annual_Report_of_Fed_OSHA_SIRs.pdf"
SIR_LOOKBACK = "https://www.osha.gov/sites/default/files/severe-injury-report-2015to2021.pdf"
MIN_FY = 1972  # IMIS holds inspections from FY1972; the few earlier open dates are data-entry errors and are excluded (counted in build_stats)
STATE_PLANS_URL = "https://www.osha.gov/stateplans"
FOM_URL = "https://www.osha.gov/fom/chapter-2"
HELP_URL = "https://www.osha.gov/help/inspection-search-help"
NAICS_URL = "https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.xlsx"
QCEW_URL = "https://data.bls.gov/cew/data/api/2025/a/industry/10.csv"
QCEW_YEAR = 2025
RATE_FY = 2025
EMPLOYER_FY = (2017, 2026)
EMPLOYER_LIMIT = 1000
TEN_FY = (2016, 2025)
LATEST_COMPLETE_FY = 2025
CURRENT_FY = 2026

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
TERRITORIES = {"PR": ("72", "Puerto Rico"), "VI": ("78", "U.S. Virgin Islands"), "GU": ("66", "Guam"),
               "AS": ("60", "American Samoa"), "MP": ("69", "Northern Mariana Islands")}
OTHER = "OTHER"
# osha.gov/stateplans (read 2026-10-18): 22 plans cover private and state/local government workplaces, 7 cover state and
# local government workers only; every other jurisdiction is under federal OSHA. Status is current, not historical.
STATE_PLAN_FULL = frozenset("AK AZ CA HI IN IA KY MD MI MN NV NM NC OR PR SC TN UT VT VA WA WY".split())
STATE_PLAN_PUBLIC = frozenset("CT IL ME MA NJ NY VI".split())
GENERAL_DUTY = {"5A0001": "OSH Act §5(a)(1) general duty clause"}


def plan_status(code):
    if code in STATE_PLAN_FULL:
        return "State Plan (private and state/local government)"
    if code in STATE_PLAN_PUBLIC:
        return "State Plan (state/local government only); private sector under federal OSHA"
    if code in STATES or code in TERRITORIES:
        return "Federal OSHA (no State Plan)"
    return "Not applicable"


def facts(pairs):
    """Entity view reads [label, value] pairs; None becomes 'Not recorded'."""
    return [[label, "Not recorded" if value is None else str(value)] for label, value in pairs]


def gz_rows(folder):
    for path in sorted(glob.glob(os.path.join(ACQ, "dol", folder, "*.csv.gz")), key=chunk_order):
        with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace", newline="") as handle:
            yield from csv.DictReader(handle)


def chunk_order(path):
    name = os.path.basename(path)
    try:
        return int(name.split("_chunk_")[1].split(".")[0])
    except (IndexError, ValueError):
        return 10 ** 6


ENFORCEMENT_PAGES = ("_pages/firecrawl_captures_2026-10-18.md",)
SIR_PAGES = ("_pages/sir_published_tables_2026-10-18.md",)


def manifest_inputs(kind="enforcement"):
    """Raw inputs the dataset's figures come from, with the sha256 recorded when each file was acquired (last manifest line per
    path wins). 'enforcement' = DOL bulk inspection/violation files + NAICS/QCEW references + capture of definitions + corpus
    lookup; 'sir' = the saved OSHA Severe Injury Report aggregates."""
    entries = {}
    with open(os.path.join(ACQ, "_manifest.jsonl")) as handle:
        for line in handle:
            entry = json.loads(line)
            entries[entry["path"]] = entry
    out = []
    for path in sorted(entries):
        rel = os.path.relpath(os.path.join(ROOT, path), ACQ)
        if kind == "sir":
            wanted = rel in SIR_PAGES
        else:
            wanted = rel in ENFORCEMENT_PAGES or rel.startswith(("dol/inspection/", "dol/violation/", "census/", "bls/"))
        if not wanted or not os.path.exists(os.path.join(ROOT, path)):
            continue
        entry = entries[path]
        full = os.path.join(ROOT, path)
        # DOL members are stored gzip-compressed on disk: their manifest line carries the member's sha256 and the gz file's gz_sha256
        if os.path.getsize(full) < 50 << 20 and sha256_file(full) != (entry.get("gz_sha256") or entry["sha256"]):
            raise SystemExit(f"{path} changed since its manifest line was written (re-record it with record_capture.py)")
        # one input per source URL (a saved page may combine several documents)
        for url in entry["url"].split():
            item = {"url": url, "path": path, "sha256": entry["sha256"]}
            for key in ("member", "member_crc32", "gz_sha256", "archive_last_modified", "last_modified", "retrieved_at", "method"):
                if entry.get(key):
                    item[key] = entry[key]
            out.append(item)
    if kind != "sir":
        lookup = os.path.join(LOOKUPS, "company_sec_profiles_titles.json")
        out.append({"url": "corpus:company_sec_profiles (read-only SELECT)", "path": os.path.relpath(lookup, ROOT), "sha256": sha256_file(lookup)})
    return out


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_date():
    names = [os.path.basename(p) for p in glob.glob(os.path.join(ACQ, "dol", "inspection", "*.csv.gz"))]
    dates = sorted({n.split("_chunk_")[0] for n in names})
    return dates[-1] if dates else None


# ----------------------------------------------------------------------------------------------- reference tables
def naics_titles():
    import openpyxl  # installed; read-only use

    titles = {}
    book = openpyxl.load_workbook(os.path.join(ACQ, "census", "2-6_digit_2022_Codes.xlsx"), read_only=True)
    for row in book.worksheets[0].iter_rows(values_only=True):
        code = row[1]
        if code is None:
            continue
        code = str(code).strip()
        if len(code) == 2 or "-" in code:
            titles[code] = str(row[2]).strip()
    return titles


def qcew_employment():
    by_fips = {fips: usps for usps, (fips, _) in {**STATES, **TERRITORIES}.items()}
    out = {}
    with open(os.path.join(ACQ, "bls", "qcew_2025_annual_industry_10.csv"), newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            fips = row["area_fips"]
            if row["own_code"] == "0" and row["agglvl_code"] == "50" and fips.endswith("000") and fips[:2] in by_fips:
                out[by_fips[fips[:2]]] = int(row["annual_avg_emplvl"])
    return out


def company_index():
    with open(os.path.join(LOOKUPS, "company_sec_profiles_titles.json")) as handle:
        return P.build_title_index(json.load(handle)["rows"])


# ----------------------------------------------------------------------------------------------- violations
class ViolationTable:
    """Per-inspection violation aggregates in compact arrays (activity_nr -> slot).

    Two counts are kept. Records: every non-deleted row of the violation file (CITATION_ID such as 01001A and 01001B are two
    records). Items: records with lettered item groups counted once per citation item (CITATION_ID[:5], the DOL field
    description: 'citation number, item number and item group'); a lettered record whose item was already seen in the
    inspection adds nothing, a record without a letter always counts. The item type is the type of the first record seen."""

    def __init__(self):
        self.slot = {}
        self.counts = {key: array.array("l") for key in P.VIOL_KEYS}
        self.grouped = {key: array.array("l") for key in P.VIOL_KEYS}
        self.group_seen = set()
        self.items = array.array("l")
        self.initial = array.array("d")
        self.current = array.array("d")
        self.stats = collections.Counter()
        self.type_codes = collections.Counter()

    def add(self, row):
        self.stats["rows"] += 1
        aid = P.int_or_none(row.get("ACTIVITY_NR"))
        if aid is None:
            self.stats["no_activity_nr"] += 1
            return None
        if P.clean(row.get("DELETE_FLAG")).upper() == "X":
            self.stats["deleted"] += 1
            return None
        index = self.slot.get(aid)
        if index is None:
            index = len(self.items)
            self.slot[aid] = index
            for key in P.VIOL_KEYS:
                self.counts[key].append(0)
                self.grouped[key].append(0)
            self.items.append(0)
            self.initial.append(0.0)
            self.current.append(0.0)
        code = P.clean(row.get("VIOL_TYPE")).upper()
        self.type_codes[code or "(blank)"] += 1
        self.counts[P.viol_key(code)][index] += 1
        self.items[index] += 1
        citation = P.clean(row.get("CITATION_ID"))
        new_item = True
        if len(citation) > 5:
            group_key = (aid, citation[:5])
            if group_key in self.group_seen:
                new_item = False
                self.stats["lettered_group_records_not_counted_as_items"] += 1
            else:
                self.group_seen.add(group_key)
        if new_item:
            self.grouped[P.viol_key(code)][index] += 1
        init, curr = P.money(row.get("INITIAL_PENALTY")), P.money(row.get("CURRENT_PENALTY"))
        if init is None:
            self.stats["initial_blank"] += 1
        if curr is None:
            self.stats["current_blank"] += 1
        self.initial[index] += init or 0.0
        self.current[index] += curr or 0.0
        self.stats["kept"] += 1
        return aid

    def get(self, aid):
        index = self.slot.get(aid)
        if index is None:
            return None
        grouped = {key: self.grouped[key][index] for key in P.VIOL_KEYS}
        return {"violations": {key: self.counts[key][index] for key in P.VIOL_KEYS}, "items": self.items[index],
                "grouped": grouped, "grouped_total": sum(grouped.values()),
                "initial": self.initial[index], "current": self.current[index]}


def inspection_number(activity_nr):
    """osha.gov inspection number for a DOL ACTIVITY_NR. Nine-digit numbers starting 34 (IMIS numbers issued from late 2014 onward)
    are shown on osha.gov as 1 + digits 3-8 + '.015' (observed on 5 of 5 establishment pages read, e.g. ACTIVITY_NR 343371712 =
    Inspection 1337171.015, Golden Spike Roofing); older numbers are shown unchanged (310463336)."""
    text = str(activity_nr)
    if len(text) == 9 and text.startswith("34"):
        return f"1{text[2:8]}.015"
    return text


def standard_section(code):
    """'19260501 B13' -> '1926.501'; '5A0001' -> '5A0001'; blank -> None."""
    text = P.clean(code)
    if not text:
        return None
    head = text.split()[0]
    if len(head) >= 8 and head[:8].isdigit():
        return f"{head[:4]}.{int(head[4:8])}"
    return head


def load_violations(recent):
    """Aggregate non-deleted violation items per inspection; count cited sections for recent inspections."""
    table = ViolationTable()
    sections_state = collections.defaultdict(collections.Counter)   # state -> section -> items (FY2017-FY2026)
    sections_fy = collections.defaultdict(collections.Counter)      # fy -> section -> items (FY2017-FY2026, national)
    for row in gz_rows("violation"):
        aid = table.add(row)
        if aid is None:
            continue
        where = recent.get(aid)
        if where:
            section = standard_section(row.get("STANDARD"))
            if section:
                sections_state[where[0]][section] += 1
                sections_fy[where[1]][section] += 1
    return table, sections_state, sections_fy


# ----------------------------------------------------------------------------------------------- inspections
def site_code(row):
    code = P.clean(row.get("SITE_STATE")).upper()
    return code if code in STATES or code in TERRITORIES else OTHER


def recent_map():
    """activity_nr -> (site code, FY) for inspections opened FY2017-FY2026 (used to count cited sections)."""
    out = {}
    for row in gz_rows("inspection"):
        fy = P.fiscal_year(P.parse_date(row.get("OPEN_DATE")))
        if fy is not None and EMPLOYER_FY[0] <= fy <= EMPLOYER_FY[1]:
            aid = P.int_or_none(row.get("ACTIVITY_NR"))
            if aid is not None:
                out[aid] = (site_code(row), fy)
    return out


def blank_year():
    return {
        "inspections": 0, "programmed": 0, "unprogrammed": 0, "other_type": 0,
        "by_type": collections.Counter(), "fat_cat": 0, "accident": 0, "complaint": 0, "referral": 0, "follow_up": 0,
        "federal": 0, "state_plan": 0, "jurisdiction_not_recorded": 0,
        "safety": 0, "health": 0, "no_inspection_scope": 0,
        "with_violations": 0, "violation_records": 0, "violation_items": 0, "violations": P.blank_violations(), "items_by_type": P.blank_violations(),
        "initial_penalty": 0.0, "current_penalty": 0.0,
        "open_cases": 0, "naics": collections.Counter(), "naics_not_recorded": 0,
        "penalties": array.array("d"), "close_days": array.array("l"),
    }


def add_inspection(bucket, row, cls, jur, sector, viol, days):
    code = P.clean(row.get("INSP_TYPE")).upper()
    bucket["inspections"] += 1
    bucket["programmed" if cls == "programmed" else "unprogrammed" if cls == "unprogrammed" else "other_type"] += 1
    bucket["by_type"][code or "(blank)"] += 1
    bucket["fat_cat"] += code == "M"
    bucket["accident"] += code == "A"
    bucket["complaint"] += code == "B"
    bucket["referral"] += code == "C"
    bucket["follow_up"] += code == "F"
    if jur == "federal":
        bucket["federal"] += 1
    elif jur == "state_plan":
        bucket["state_plan"] += 1
    else:
        bucket["jurisdiction_not_recorded"] += 1
    sh = P.clean(row.get("SAFETY_HLTH")).upper()
    bucket["safety"] += sh == "S"
    bucket["health"] += sh == "H"
    bucket["no_inspection_scope"] += P.clean(row.get("INSP_SCOPE")).upper() == "D"
    if sector:
        bucket["naics"][sector] += 1
    else:
        bucket["naics_not_recorded"] += 1
    if days is None:
        bucket["open_cases"] += 1 if P.parse_date(row.get("CLOSE_CASE_DATE")) is None else 0
    else:
        bucket["close_days"].append(days)
    if viol:
        bucket["with_violations"] += 1
        bucket["violation_records"] += viol["items"]
        bucket["violation_items"] += viol["grouped_total"]
        for key, value in viol["violations"].items():
            bucket["violations"][key] += value
        for key, value in viol["grouped"].items():
            bucket["items_by_type"][key] += value
        bucket["initial_penalty"] += viol["initial"]
        bucket["current_penalty"] += viol["current"]
        if viol["current"] > 0:
            bucket["penalties"].append(viol["current"])


def close_days(row):
    opened, closed = P.parse_date(row.get("OPEN_DATE")), P.parse_date(row.get("CLOSE_CASE_DATE"))
    if opened is None or closed is None or closed.year < 1970:
        return None
    days = (closed - opened).days
    return days if days >= 0 else None


class EmployerAgg:
    __slots__ = ("inspections", "penalized", "initial", "current", "violations", "items", "grouped", "grouped_total", "states", "sectors",
                 "jur", "first", "last", "top", "fys")

    def __init__(self):
        self.inspections = 0
        self.penalized = 0
        self.initial = 0.0
        self.current = 0.0
        self.violations = P.blank_violations()
        self.items = 0
        self.grouped = P.blank_violations()
        self.grouped_total = 0
        self.states = collections.Counter()
        self.sectors = collections.Counter()
        self.jur = collections.Counter()
        self.first = None
        self.last = None
        self.top = []
        self.fys = collections.Counter()


def scan_inspections(viol):
    years = collections.defaultdict(lambda: collections.defaultdict(blank_year))  # code -> fy -> bucket
    national = collections.defaultdict(blank_year)
    other_codes = collections.Counter()
    employers = {}
    stats = collections.Counter()
    seen_viol = 0
    for row in gz_rows("inspection"):
        stats["rows"] += 1
        aid = P.int_or_none(row.get("ACTIVITY_NR"))
        opened = P.parse_date(row.get("OPEN_DATE"))
        fy = P.fiscal_year(opened)
        code = site_code(row)
        if code == OTHER:
            other_codes[P.clean(row.get("SITE_STATE")).upper() or "(blank)"] += 1
        if aid is None or fy is None:
            stats["no_id_or_open_date"] += 1
            continue
        if fy < MIN_FY:
            stats["before_fy1972_excluded"] += 1
            continue
        cls = P.inspection_class(row.get("INSP_TYPE"))
        jur = P.jurisdiction(row.get("REPORTING_ID"))
        sector = P.naics_sector(row.get("NAICS_CODE"))
        v = viol.get(aid)
        if v:
            seen_viol += 1
        days = close_days(row)
        add_inspection(years[code][fy], row, cls, jur, sector, v, days)
        add_inspection(national[fy], row, cls, jur, sector, v, days)
        if EMPLOYER_FY[0] <= fy <= EMPLOYER_FY[1]:
            name = (row.get("ESTAB_NAME") or "").strip()
            if not name:
                stats["recent_no_name"] += 1
                continue
            agg = employers.get(name)
            if agg is None:
                agg = employers[name] = EmployerAgg()
            agg.inspections += 1
            agg.states[code if code != OTHER else (P.clean(row.get("SITE_STATE")).upper() or "(blank)")] += 1
            agg.fys[fy] += 1
            if sector:
                agg.sectors[sector] += 1
            agg.jur[jur or "not recorded"] += 1
            day = opened.isoformat()
            agg.first = day if agg.first is None or day < agg.first else agg.first
            agg.last = day if agg.last is None or day > agg.last else agg.last
            if v:
                agg.items += v["items"]
                agg.grouped_total += v["grouped_total"]
                for key, value in v["grouped"].items():
                    agg.grouped[key] += value
                agg.initial += v["initial"]
                agg.current += v["current"]
                for key, value in v["violations"].items():
                    agg.violations[key] += value
                if v["current"] > 0:
                    agg.penalized += 1
                    agg.top.append((v["current"], aid, day, code, P.clean(row.get("SITE_CITY")), v["initial"], P.clean(row.get("INSP_TYPE")).upper(), jur))
                    if len(agg.top) > 12:
                        agg.top.sort(key=lambda t: (-t[0], t[1]))
                        del agg.top[5:]
    stats["inspections_with_violations"] = seen_viol
    return years, national, other_codes, employers, stats


# ----------------------------------------------------------------------------------------------- shaping
def finish_year(fy, bucket, titles, top_n=5):
    penalties = sorted(bucket["penalties"])
    days = sorted(bucket["close_days"])
    sectors = [{"sector": s, "title": titles.get(s, "Not recorded"), "inspections": n}
               for s, n in sorted(bucket["naics"].items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]]
    closed = len(days)
    return {
        "fy": fy,
        "inspections": bucket["inspections"],
        "programmed": bucket["programmed"],
        "unprogrammed": bucket["unprogrammed"],
        "other_type": bucket["other_type"],
        "fat_cat": bucket["fat_cat"],
        "accident": bucket["accident"],
        "complaint": bucket["complaint"],
        "referral": bucket["referral"],
        "follow_up": bucket["follow_up"],
        "by_type": dict(sorted(bucket["by_type"].items())),
        "federal": bucket["federal"],
        "state_plan": bucket["state_plan"],
        "jurisdiction_not_recorded": bucket["jurisdiction_not_recorded"],
        "safety": bucket["safety"],
        "health": bucket["health"],
        "no_inspection_scope": bucket["no_inspection_scope"],
        "with_violations": bucket["with_violations"],
        "violation_records": bucket["violation_records"],
        "violations": dict(bucket["violations"]),
        "violation_items": bucket["violation_items"],
        "items_by_type": dict(bucket["items_by_type"]),
        "initial_penalty": round(bucket["initial_penalty"], 2),
        "current_penalty": round(bucket["current_penalty"], 2),
        "current_to_initial_pct": round(bucket["current_penalty"] / bucket["initial_penalty"] * 100, 2) if bucket["initial_penalty"] > 0 else None,
        "penalized_inspections": len(penalties),
        "median_current_penalty": P.median(penalties),
        "closed_cases": closed,
        "open_cases": bucket["open_cases"],
        "median_days_to_close": P.median(days),
        "top_naics": sectors,
        "naics_not_recorded": bucket["naics_not_recorded"],
    }


def national_extras(entry, bucket):
    penalties = sorted(bucket["penalties"])
    distribution = collections.Counter()
    distribution["0"] = bucket["inspections"] - len(penalties)
    for value in penalties:
        distribution[P.penalty_bucket(value)] += 1
    desc = penalties[::-1]
    entry.update({
        "penalty_distribution": {label: distribution.get(label, 0) for label, _, _ in P.PENALTY_BUCKETS},
        "p90_current_penalty": P.nearest_rank(penalties, 90),
        "p99_current_penalty": P.nearest_rank(penalties, 99),
        "mean_current_penalty": round(sum(penalties) / len(penalties), 2) if penalties else None,
        "max_current_penalty": penalties[-1] if penalties else None,
        "top1pct_share_current_penalty": round(P.top_share(desc, 0.01) * 100, 2) if P.top_share(desc, 0.01) is not None else None,
        "p90_days_to_close": P.nearest_rank(sorted(bucket["close_days"]), 90),
    })
    return entry


def sum_years(entries, first, last):
    keys = ("inspections", "programmed", "unprogrammed", "other_type", "fat_cat", "accident", "complaint", "referral",
            "follow_up", "federal", "state_plan", "jurisdiction_not_recorded", "with_violations", "violation_records", "violation_items",
            "open_cases")
    out = {key: 0 for key in keys}
    out.update({"initial_penalty": 0.0, "current_penalty": 0.0, "violations": P.blank_violations(), "items_by_type": P.blank_violations()})
    for e in entries:
        if first <= e["fy"] <= last:
            for key in keys:
                out[key] += e[key]
            out["initial_penalty"] += e["initial_penalty"]
            out["current_penalty"] += e["current_penalty"]
            for key in P.VIOL_KEYS:
                out["violations"][key] += e["violations"][key]
                out["items_by_type"][key] += e["items_by_type"][key]
    out["initial_penalty"] = round(out["initial_penalty"], 2)
    out["current_penalty"] = round(out["current_penalty"], 2)
    out["fy_range"] = [first, last]
    return out


def window_sectors(years_map, titles, first, last, n=8):
    counter = collections.Counter()
    for fy, bucket in years_map.items():
        if first <= fy <= last:
            counter.update(bucket["naics"])
    return [{"sector": s, "title": titles.get(s, "Not recorded"), "inspections": c} for s, c in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def top_sections(counter, n=10):
    return [{"section": s, "label": GENERAL_DUTY.get(s), "records": c} for s, c in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def coverage_note(code):
    status = plan_status(code)
    base = ("Covers inspections recorded in OSHA's enforcement database (federal OSHA and State Plan offices; State Plan "
            "records identified by a reporting ID whose third digit is 5). Severe injury reports, BLS injury rates and "
            "workplaces never inspected are not included. Violations and penalties attach to the fiscal year the "
            "inspection opened; recent years are incomplete while cases remain open.")
    if code in STATE_PLAN_FULL:
        return base + f" {status}: most private-sector inspections here are State Plan inspections; federal OSHA keeps limited jurisdiction (e.g. federal agencies, some maritime work)."
    if code in STATE_PLAN_PUBLIC:
        return base + f" {status}: State Plan records cover public employers only."
    return base + f" {status}."


# ----------------------------------------------------------------------------------------------- severe injury reports (published aggregates)
def load_sir():
    """Parse and cross-check the OSHA-published SIR aggregates saved under private/acq/osha/_pages (see sir_published.py)."""
    with open(SIR_FILE, encoding="utf-8") as handle:
        sections = SIR.load_sections(handle.read())
    names = {name: code for code, (_, name) in {**STATES, **TERRITORIES}.items()}
    return SIR.validate(sections, names)


def sir_state_records(sir):
    """Jurisdictions with a recorded 2015-2021 figure: the 23 table rows, MP/PR/VI totals and the ND rate printed in the report text."""
    out = {}
    for s in sir["states"]:
        out[s["code"]] = {"code": s["code"], "name": s["name"], "by_year": s["by_year"], "total": s["total"], "rate": s["rate"], "origin": "Table 2"}
    facts_text = sir["lookback"]
    for label, code in (("Northern Mariana Islands 2015-2021", "MP"), ("Puerto Rico 2015-2021", "PR"), ("U.S. Virgin Islands 2015-2021", "VI")):
        if code in out:
            raise ValueError(f"{code} appears in both the table and the text")
        out[code] = {"code": code, "name": (STATES.get(code) or TERRITORIES[code])[1], "by_year": None, "total": facts_text[label], "rate": None, "origin": "report text (territory totals)"}
    out["ND"] = {"code": "ND", "name": "North Dakota", "by_year": None, "total": None,
                 "rate": facts_text["North Dakota average annual rate per 100,000 FTE workers"], "origin": "report text (highest state rate)"}
    return out


SIR_NOT_RECORDED = (
    "Any state count for calendar years after 2021; any 2015-2021 count for ND, OH, OK, PA, RI, SD, TX, WV and WI (the Table 2 rows after New York are not in the PDF text layer); by-year counts for MP, PR and VI (totals only)",
    "Hospitalizations, amputations and eye losses by state",
    "Nature of injury (OIICS) at any grain, and body part by state or year (body part is published only by industry sector for 2015-2021)",
    "Establishment-level reports, narratives and OIICS event/source codes",
)


def sir_coverage():
    return ("Federal OSHA jurisdiction only: SIRs from private-sector and state/local government employers in the 22 full State Plan states "
            "(and public-sector employers in the 7 public-sector plans) are excluded; employers in State Plan states that federal OSHA covers "
            "(e.g. USPS) are included. Fatalities are not in the SIR data. SIRs are likely under-reported and are not statistically representative "
            "(OSHA's own limitations, 2024 annual report p. 9).")


def sir_common_facts(period, origin_label, origin_url):
    return [
        ("Source", f"OSHA Severe Injury Reports: {origin_label}"),
        ("Source page", origin_url),
        ("Period", period),
        # published wording names no third-party service (owner rule); the reads were made through Firecrawl
        ("Retrieval", "Read 2026-10-18 through an external page-fetching service (osha.gov blocks direct requests from the collection server) from the public osha.gov document and copied into private/acq/osha/_pages/sir_published_tables_2026-10-18.md; "
                      "the record-level SIR file (osha.gov/sites/default/files/January2015toNovember2025.zip) answers HTTP 403 to this environment and was not acquired"),
        ("Coverage", sir_coverage()),
    ]


def build_sir():
    sir = load_sir()
    national = sir["national"]
    by_year = {r["year"]: r for r in national}
    states = sir_state_records(sir)
    rows = []

    # ---- national years
    for r in national:
        year = r["year"]
        partial = year == 2025
        prev = by_year.get(year - 1)
        yoy = None if partial or not prev else P.pct_change(r["reports"], prev["reports"])
        entry = {**r, "yoy_reports_pct": yoy, "partial_year": partial}
        period = f"{year} (through November: OSHA's dashboard footnote reads 'As of November 2025')" if partial else str(year)
        rows.append(writer.record(
            "osha_severe_injuries", f"osha-sir:year:{year}", f"United States — OSHA severe injury reports {year}",
            source_url=SIR_DASHBOARD,
            subtitle=f"{r['reports']:,} reports · {r['hospitalized']:,} workers hospitalized · {r['amputations']:,} amputations · {r['eye_losses']:,} loss of an eye · federal OSHA jurisdiction only" + (" · partial year" if partial else ""),
            cells={"scope": "United States (federal OSHA)", "period": str(year), "reports": r["reports"], "hospitalized": r["hospitalized"],
                   "amputations": r["amputations"], "eye_losses": r["eye_losses"], "rate": None},
            facts=facts(sir_common_facts(period, "Severe Injury Dashboard chart text (totals by year)", SIR_DASHBOARD) + [
                ("Severe injury reports", f"{r['reports']:,}"),
                ("Workers hospitalized (dashboard 'Total Hospitalized')", f"{r['hospitalized']:,}"),
                ("Workers with amputations", f"{r['amputations']:,}"),
                ("Workers with loss of an eye", f"{r['eye_losses']:,}"),
                ("Change in reports vs previous year", f"{yoy}%" if yoy is not None else None),
                ("By state, nature of injury, body part", None),
                ("Definitions", "29 CFR 1904.39: a severe injury is an amputation, in-patient hospitalization or loss of an eye. A report can involve several workers, so the three worker counts do not add up to the report count."),
                ("Eye losses", "OSHA's 2024 annual report says eye-loss reports since 2016 were added to the dataset in 2024 after a comprehensive review; its 2022-2023 report, written before that review, states none were reported in 2022 or 2023."),
                ("Year basis", "Calendar year as charted by OSHA's dashboard; OSHA's reports define annual figures by the year of the event."),
            ]),
            text=f"OSHA severe injury reports {year} amputation hospitalization loss of eye federal OSHA",
            filters={"kind": ["year"]},
            links=[{"label": "OSHA Severe Injury Dashboard", "url": SIR_DASHBOARD}, {"label": "OSHA Severe Injury Reports", "url": SIR_PAGE}],
            extra={"year": entry},
        ))

    # ---- states and territories
    for code in sorted(states):
        s = states[code]
        label = s["name"]
        is_state = code in STATES
        total = s["total"]
        by = s["by_year"]
        first, last = (SIR.STATE_YEARS[0], SIR.STATE_YEARS[-1])
        if total is not None:
            subtitle = f"{total:,} reports {first}–{last} (federal OSHA jurisdiction only)" + (f" · published average {s['rate']} per 100,000 FTE workers per year" if s["rate"] is not None else "")
        else:
            subtitle = f"Counts by year not recorded · published average {s['rate']} per 100,000 FTE workers per year, the highest of the federal-OSHA states (federal OSHA jurisdiction only)"
        profile = {"code": code, "name": label, "period": [first, last], "total": total, "by_year": ({str(y): n for y, n in by.items()} if by else None),
                   "rate_per_100k_fte_per_year": s["rate"], "origin": s["origin"],
                   "peak_year": (max(by.items(), key=lambda kv: (kv[1], -kv[0]))[0] if by else None),
                   "change_2021_vs_2015_pct": (P.pct_change(by[2021], by[2015]) if by else None)}
        rows.append(writer.record(
            "osha_severe_injuries", f"osha-sir:state:{code}", f"{label} — OSHA severe injury reports {first}–{last}",
            source_url=SIR_LOOKBACK,
            subtitle=subtitle,
            state=code if is_state or code in TERRITORIES else "",
            cells={"scope": label, "period": f"{first}–{last}", "reports": total, "hospitalized": None, "amputations": None, "eye_losses": None, "rate": s["rate"]},
            facts=facts(sir_common_facts(f"Calendar years {first}–{last}", "A Seven-Year Lookback (2015–2021), Table 2 and report text", SIR_LOOKBACK) + [
                ("Severe injury reports 2015–2021", f"{total:,}" if total is not None else None),
                ("By year", ", ".join(f"{y}: {n:,}" for y, n in by.items()) if by else None),
                ("Published average rate, reports per year per 100,000 FTE workers", f"{s['rate']} (OSHA's figure, not recomputed; denominator: FTE workers from the American Community Survey PUMS 2015–2019 as stated in the report, {SIR_LOOKBACK})" if s["rate"] is not None else None),
                ("Hospitalizations / amputations / eye losses", None),
                ("Nature of injury and body part", None),
                ("Years after 2021", None),
                ("Table origin", s["origin"]),
                ("Jurisdiction", plan_status(code)),
            ]),
            text=f"{label} {code} OSHA severe injury reports 2015 2021 federal OSHA",
            filters={"kind": ["state"], "plan": ["full" if code in STATE_PLAN_FULL else "public" if code in STATE_PLAN_PUBLIC else "federal"]},
            links=([{"label": f"{label} place profile", "url": f"/places/{code}"}] if is_state else []) + [
                {"label": "OSHA Severe Injury Reports", "url": SIR_PAGE}, {"label": "Seven-Year Lookback (PDF)", "url": SIR_LOOKBACK}],
            extra={"state": profile},
        ))

    # ---- industry sectors
    counts, rates, parts = sir["sector_counts"], sir["sector_rates"], sir["body_parts"]
    for code in sorted(counts, key=lambda c: (int(c[:2]), c)):
        c, r, bp = counts[code], rates[code], parts[code]
        shares = {k: round(v / bp["total"] * 100, 1) for k, v in bp["parts"].items()}
        change = P.pct_change(r["rate_2024"], r["rate_avg_2015_2023"]) if isinstance(r["rate_2024"], (int, float)) and isinstance(r["rate_avg_2015_2023"], (int, float)) else None
        sector = {"sector": code, "title": c["title"], "hospitalizations_2024": c["hosp_2024"], "amputations_2024": c["amp_2024"],
                  "incidents_2024": r["incidents_2024"], "rate_2024": r["rate_2024"], "hospitalizations_avg_2015_2023": c["hosp_avg_2015_2023"],
                  "amputations_avg_2015_2023": c["amp_avg_2015_2023"], "incidents_avg_2015_2023": r["incidents_avg_2015_2023"],
                  "rate_avg_2015_2023": r["rate_avg_2015_2023"], "rate_change_pct": change,
                  "reports_2015_2021": bp["total"], "body_parts_2015_2021": bp["parts"], "body_part_share_pct_computed": shares}
        rows.append(writer.record(
            "osha_severe_injuries", f"osha-sir:sector:{code}", f"Sector {code} {c['title']} — OSHA severe injury reports 2024",
            source_url=SIR_2024,
            subtitle=f"2024: {c['hosp_2024']:,} hospitalizations · {c['amp_2024']:,} amputations · " + (f"{r['rate_2024']} per 100,000 FTE workers" if r["rate_2024"] is not None else "rate not recorded") + " · federal OSHA jurisdiction only",
            cells={"scope": f"{code} {c['title']}", "period": "2024", "reports": None, "hospitalized": c["hosp_2024"], "amputations": c["amp_2024"], "eye_losses": None, "rate": r["rate_2024"]},
            facts=facts(sir_common_facts("2024 (annual report tables) and 2015–2021 (lookback body-part table)", "2024 Annual Report, industry sector tables", SIR_2024) + [
                ("Inpatient hospitalizations 2024 (2015–2023 annual average)", f"{c['hosp_2024']:,} ({c['hosp_avg_2015_2023']:,})"),
                ("Amputations 2024 (2015–2023 annual average)", f"{c['amp_2024']:,} ({c['amp_avg_2015_2023']:,})"),
                ("Rate per 100,000 FTE workers 2024 (2015–2023 average)", f"{r['rate_2024'] if r['rate_2024'] is not None else 'Not recorded'} ({r['rate_avg_2015_2023'] if r['rate_avg_2015_2023'] is not None else 'Not recorded'}); denominator: U.S. BEA full-time-equivalent employees by industry as cited by OSHA ({SIR_2024}), not recomputed"),
                ("Change in rate vs 2015–2023 average", f"{change}% (computed)" if change is not None else None),
                ("Body parts injured 2015–2021 (OIICS groups, reports)", "; ".join(f"{k} {v:,} ({shares[k]}%)" for k, v in bp["parts"].items())),
                ("Body-part source", f"Table 3 of the Seven-Year Lookback ({SIR_LOOKBACK}); shares are computed from the published counts"),
                ("Nature of injury", None),
            ] + ([("Mining note", "Mining, quarrying and oil and gas operations are also subject to MSHA reporting; OSHA warns the sector's figures may not be comparable with other sectors.")] if code == "21" else [])),
            text=f"{c['title']} sector {code} OSHA severe injury reports 2024 body parts",
            filters={"kind": ["sector"]},
            links=[{"label": "2024 Annual Report (PDF)", "url": SIR_2024}, {"label": "Seven-Year Lookback (PDF)", "url": SIR_LOOKBACK}, {"label": "OSHA Severe Injury Reports", "url": SIR_PAGE}],
            extra={"sector": sector},
        ))

    # ---- summary
    body_totals = {k: sum(p["parts"][k] for p in parts.values()) for k in SIR.BODY_PARTS}
    grand = sir["body_part_grand_total"]
    summary_profile = {
        "series": [{"year": r["year"], "reports": r["reports"], "hospitalized": r["hospitalized"], "amputations": r["amputations"], "eye_losses": r["eye_losses"],
                    "yoy_reports_pct": (None if r["year"] == 2025 or r["year"] - 1 not in by_year else P.pct_change(r["reports"], by_year[r["year"] - 1]["reports"]))} for r in national],
        "series_note": "2025 is partial (OSHA footnote: as of November 2025); worker counts per type do not add up to reports because a report can involve several workers and types",
        "body_part_totals_2015_2021": {"counts": body_totals, "reports": grand,
                                       "share_pct_computed": {k: round(v / grand * 100, 1) for k, v in body_totals.items()},
                                       "note": "column sums of Table 3 (21 sectors); the grand total equals 56,696 hospitalization + 18,559 amputation SIRs - 5,049 counted in both"},
        "sector_totals_2024": {"hospitalizations": sir["sector_count_total"]["hosp_2024"], "amputations": sir["sector_count_total"]["amp_2024"],
                               "incidents_printed_total": sir["sector_rate_total"]["incidents_2024"], "rate_printed_total": sir["sector_rate_total"]["rate_2024"],
                               "note": "sector rows add to 9,753; the printed total 9,755 equals 7,327 hospitalizations + 2,426 amputations + the 2 eye losses"},
        "state_jurisdictions_recorded": sorted(states),
        "not_recorded": list(SIR_NOT_RECORDED),
    }
    rows.append(writer.record(
        "osha_severe_injuries", "osha-sir:summary", "United States — OSHA severe injury reports, series and coverage",
        source_url=SIR_PAGE,
        subtitle=f"{sum(r['reports'] for r in national if r['year'] <= 2024):,} reports 2015–2024 · published aggregates only (record-level file not obtained) · federal OSHA jurisdiction only",
        cells={"scope": "United States (federal OSHA)", "period": "2015–2024", "reports": sum(r["reports"] for r in national if r["year"] <= 2024),
               "hospitalized": sum(r["hospitalized"] for r in national if r["year"] <= 2024), "amputations": sum(r["amputations"] for r in national if r["year"] <= 2024),
               "eye_losses": sum(r["eye_losses"] for r in national if r["year"] <= 2024), "rate": None},
        facts=facts(sir_common_facts("2015–2025 (2025 through November)", "Severe Injury Reports landing page, dashboard and annual reports", SIR_PAGE) + [
            ("Totals 2015–2024 (computed sums of the yearly dashboard figures)", f"{sum(r['reports'] for r in national if r['year'] <= 2024):,} reports; {sum(r['hospitalized'] for r in national if r['year'] <= 2024):,} workers hospitalized; {sum(r['amputations'] for r in national if r['year'] <= 2024):,} amputations; {sum(r['eye_losses'] for r in national if r['year'] <= 2024):,} loss of an eye"),
            ("Not recorded in this dataset", "; ".join(SIR_NOT_RECORDED)),
            ("Publication vintages", f"The Seven-Year Lookback counts {grand:,} reports for 2015–2021 (56,696 hospitalization + 18,559 amputation SIRs - 5,049 in both); the yearly dashboard figures for 2015–2021 add to {sum(r['reports'] for r in national if r['year'] <= 2021):,}. OSHA states its numbers change as the dataset is corrected."),
        ]),
        text="OSHA severe injury reports summary national series body parts coverage limits",
        filters={"kind": ["summary"]},
        links=[{"label": "OSHA Severe Injury Reports", "url": SIR_PAGE}, {"label": "OSHA Severe Injury Dashboard", "url": SIR_DASHBOARD}, {"label": "2024 Annual Report (PDF)", "url": SIR_2024}, {"label": "Seven-Year Lookback (PDF)", "url": SIR_LOOKBACK}],
        extra={"profile": summary_profile},
    ))

    listing_block = writer.listing(
        [("scope", "Scope"), ("period", "Period"), ("reports", "Reports"), ("hospitalized", "Workers hospitalized"), ("amputations", "Workers with amputations"),
         ("eye_losses", "Loss of an eye"), ("rate", "Published rate per 100,000 FTE workers")],
        [("kind", "Kind", {"year": "United States by year", "state": "State / territory 2015–2021", "sector": "Industry sector 2024", "summary": "Summary"})])
    summary = {
        "status": "PARTIAL: published aggregates only. The record-level SIR file (state x year x hospitalization/amputation/eye loss, nature of injury and body part) was NOT acquired.",
        "grain": "one record per calendar year 2015-2025 (national), per jurisdiction with a published 2015-2021 figure, per industry sector (21), plus a summary record",
        "sources": [SIR_DASHBOARD, SIR_2024, SIR_LOOKBACK, SIR_PAGE],
        "blocked": {"file": SIR_ZIP, "label": "Download the full SIR data set (Data from 1/1/2015 through 11/30/2025)", "result": "HTTP 403 (osha.gov bot wall) from this environment on 2026-10-18; Internet Archive unreachable through the egress proxy; not in the DOL data portal catalog (45 datasets checked)"},
        "retrieved": "2026-10-18",
        "method": "Public osha.gov documents read through an external page-fetching service (no login, no access control bypassed) and the tables copied by hand into private/acq/osha/_pages/sir_published_tables_2026-10-18.md; every transcribed table is cross-checked against its own printed totals by the builder (state years sum to the printed total; sector columns add to the printed totals; body-part rows add to their totals and the grand total 70,206 equals 56,696 + 18,559 - 5,049; the 2024 dashboard figures equal the 2024 annual report text).",
        "year_series": "Dashboard chart text for 2015-2025 as returned by an external web search service's index of osha.gov/severe-injury-reports (the live page renders its charts with script and shows no numbers to a page read); 2024 agrees with the 2024 annual report.",
        "workers_vs_reports": "Hospitalized / amputations / loss of an eye are worker counts (dashboard headings 'Total Workers ...'); reports is the number of SIRs. One report can involve several workers and types.",
        "rates": "Published by OSHA and not recomputed: state rates = average annual SIRs per 100,000 FTE workers 2015-2021 using American Community Survey PUMS 2015-2019 denominators (Seven-Year Lookback, Table 2); sector rates per 100,000 FTE workers using BEA full-time-equivalent employees by industry (2024 Annual Report p. 4, accessed Nov 17 2025). The denominator values themselves are not published in the reports.",
        "computed": "yoy_reports_pct = (reports - previous year's reports) / previous year's reports x 100 (not computed for partial 2025); rate_change_pct = (2024 rate - 2015-2023 average rate) / 2015-2023 average rate x 100; body_part_share_pct_computed = body-part count / sector (or all-sector) reports x 100; change_2021_vs_2015_pct likewise.",
        "coverage": sir_coverage(),
        "not_recorded": list(SIR_NOT_RECORDED),
        "terms": "U.S. Department of Labor public information (osha.gov); read through an external page-fetching service because osha.gov blocks direct requests from the collection server.",
        "state_plan_note": "State Plan states do not appear in the public SIR dataset except for employers federal OSHA covers; absence of a state record here means 'not recorded', not zero.",
    }
    return ("osha_severe_injuries", "OSHA severe injury reports: published aggregates (national, state 2015–2021, sector)", rows, listing_block, summary)


# ----------------------------------------------------------------------------------------------- build
def write_dataset(dataset, label, rows, listing_block, summary, inputs, built):
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), dataset
    with open(os.path.join(OUT, f"{dataset}.json"), "w") as handle:
        json.dump({"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
                   "built_at": built, "inputs": inputs}, handle, ensure_ascii=False, default=float)
    print(dataset, len(rows), file=sys.stderr)


def now_utc():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    if only == "osha_severe_injuries":
        write_dataset(*build_sir(), manifest_inputs("sir"), now_utc())
        return
    if only:
        raise SystemExit(f"--only supports osha_severe_injuries, not {only!r}")
    started = time.time()
    manifest_inputs()  # fail fast if a small input changed since its manifest line was written
    manifest_inputs("sir")
    sir_states = sir_state_records(load_sir())
    titles = naics_titles()
    employment = qcew_employment()
    index = company_index()
    snap = snapshot_date()
    print("naics sectors", len(titles), "qcew states", len(employment), "sec titles", len(index), "snapshot", snap, file=sys.stderr)

    recent = recent_map()
    print("recent inspections", len(recent), round(time.time() - started), "s", file=sys.stderr)
    viol, sections_state, sections_fy = load_violations(recent)
    del recent
    print("violation rows", dict(viol.stats), "inspections with violations", len(viol.slot), round(time.time() - started), "s", file=sys.stderr)
    years, national, other_codes, employers, stats = scan_inspections(viol)
    stats["violation_inspections_not_in_inspection_file"] = len(viol.slot) - stats["inspections_with_violations"]
    print("inspections", dict(stats), "other codes", dict(other_codes), round(time.time() - started), "s", file=sys.stderr)

    retrieved = "2026-10-18"
    common = {
        "source": INSPECTION_ZIP, "violation_source": VIOLATION_ZIP, "dataset_pages": [INSPECTION_PAGE, VIOLATION_PAGE],
        "snapshot": snap, "retrieved": retrieved,
        "fiscal_year": "Federal fiscal year of the inspection open date (FY N = 1 Oct N-1 to 30 Sep N).",
        "inspection_classes": {"programmed": "insp_type H (Planned), I (Programmed related), K (Programmed other)",
                               "unprogrammed": "insp_type A (Accident), B (Complaint), C (Referral), D (Monitoring), F (Follow-up), G (Unprogrammed related), J (Unprogrammed other), M (Fatality/catastrophe), N (Unprogrammed emphasis)",
                               "other": "insp_type E (Variance), L (Other-L) or blank",
                               "basis": FOM_URL},
        "fatality_catastrophe": "fat_cat counts insp_type M (Fat/Cat), a code first recorded in FY2011 (93 inspections; FY2010 and earlier show 0 because those investigations were coded A); accident counts insp_type A (Accident), the IMIS-era code for fatality/catastrophe investigations by federal offices and accident investigations by State Plans. Neither is a count of deaths.",
        "jurisdiction": "state_plan when REPORTING_ID's third digit is 5, else federal (derived rule; the file's STATE_FLAG column is blank in every row). Checked against current State Plan status on FY2025 inspections: 82-100% of inspections in the 21 full State Plan states and PR carry digit 5 (AK 82%, AZ 90%, every other plan 95% or more; the rest are federal agencies, maritime work and similar federal jurisdiction), and a handful in federal-jurisdiction states do too (FY2025: TX 5, GA 4, OH 1); those are counted as recorded, not reclassified. Public-sector-only plans (CT, IL, ME, MA, NJ, NY, VI) show a mix by design.",
        "violations": "Two counts of the non-deleted violation rows (DELETE_FLAG not X) of each inspection, by VIOL_TYPE (S serious, W willful, R repeat, O other-than-serious, U unclassified; other codes kept as other_codes). violation_records / violations (by type) count every row of OSHA_violation.zip, so CITATION_ID 01001A and 01001B are two records. violation_items / items_by_type count a citation item once: DOL describes citation_id as the 'citation number, item number and item group', and a lettered record whose citation+item (CITATION_ID[:5]) already appeared in the inspection is not counted again (about 21% of records are lettered; counting items instead of records lowers the national total by about 12.7%, from 12,826,840 records to about 11.2 million items, and serious records by about 23%). The displayed cells and headline figures use records; osha.gov's inspection pages appear to count items (inspection 1868672.015 shows 3 violations, 2 serious and 1 repeat, where the file holds 4 records, 3 serious and 1 repeat). The item rule differs from full grouping by 379 of 12.8 million rows (a plain record repeating a lettered item).",
        "penalties": "initial_penalty and current_penalty are computed sums of the INITIAL_PENALTY and CURRENT_PENALTY amounts recorded on non-deleted violation items; blank amounts are not imputed and add nothing (items issued FY1991-2010: about 31% of serious and 79-87% of other-than-serious items have a blank current penalty; from FY2017 blanks are absent and zero amounts appear instead, so legacy blanks plausibly mean no penalty, but none is assumed); not official OSHA totals; failure-to-abate (FTA) amounts excluded.",
        "naics": "Two-digit NAICS sector of the inspection's NAICS_CODE (31-33, 44-45, 48-49 grouped) with Census NAICS 2022 titles; inspections with no NAICS (most before ~2002 carry only SIC) counted as naics_not_recorded.",
        "accident_files": "OSHA's accident investigation summary and injury files (OSHA_accident*.zip) were acquired and profiled but are not used: injury lines by event year are not stable enough to publish (degree-1 lines: ~1,900 in FY2019, 3,129 in FY2020, 661 in FY2025, 0 in FY2026) and are not a census of workplace deaths. Fatality/catastrophe activity is shown through inspection type M and A counts.",
        "coverage": "Federal OSHA and State Plan inspections both appear. State Plan citation data may post up to 30 days after the employer receives it (osha.gov inspection search help). 22 State Plans cover private and public employers, 7 public employers only (osha.gov/stateplans, read 2026-10-18; status is current, not historical).",
        "terms": "U.S. Department of Labor public data (DOL Open Data Portal bulk download, no API key).",
    }

    # ---------------- states
    state_rows = []
    state_entries = {}
    for code in sorted(years, key=lambda c: (c == OTHER, c)):
        fys = years[code]
        entries = [finish_year(fy, fys[fy], titles) for fy in sorted(fys)]
        state_entries[code] = entries
    ten = {code: sum_years(entries, *TEN_FY) for code, entries in state_entries.items()}
    latest = {code: next((e for e in entries if e["fy"] == LATEST_COMPLETE_FY), None) for code, entries in state_entries.items()}
    rank_insp = sorted((c for c in latest if c in STATES and latest[c]), key=lambda c: (-latest[c]["inspections"], c))
    rank_pen = sorted((c for c in latest if c in STATES and latest[c]), key=lambda c: (-latest[c]["current_penalty"], c))
    for code, entries in state_entries.items():
        name = (STATES.get(code) or TERRITORIES.get(code) or (None, "Other or unrecorded site state codes"))[1]
        kind = "state" if code in STATES else "territory" if code in TERRITORIES else "other"
        lat = latest[code]
        emp = employment.get(code)
        rate = round(lat["inspections"] / emp * 100000, 2) if (lat and emp) else None
        t10 = ten[code]
        share_unprog = round(t10["unprogrammed"] / t10["inspections"] * 100, 1) if t10["inspections"] else None
        share_sp = round(t10["state_plan"] / t10["inspections"] * 100, 1) if t10["inspections"] else None
        profile = {
            "code": code, "name": name, "kind": kind, "plan_status": plan_status(code),
            "years": entries,
            "first_fy": entries[0]["fy"] if entries else None, "last_fy": entries[-1]["fy"] if entries else None,
            "ten_fy": t10, "ten_fy_top_naics": window_sectors(years[code], titles, *TEN_FY),
            "recent_top_sections": top_sections(sections_state.get(code, collections.Counter())),
            "recent_sections_window": list(EMPLOYER_FY),
            "latest_complete_fy": LATEST_COMPLETE_FY,
            "rank_inspections_latest_fy": rank_insp.index(code) + 1 if code in rank_insp else None,
            "rank_current_penalty_latest_fy": rank_pen.index(code) + 1 if code in rank_pen else None,
            "rate": {"inspections_per_100k_covered_jobs": rate, "fy": LATEST_COMPLETE_FY, "denominator": "BLS QCEW total covered employment, all ownerships, annual average",
                     "denominator_year": QCEW_YEAR, "denominator_value": emp, "denominator_source": QCEW_URL} if emp else None,
            "other_codes": dict(sorted(other_codes.items())) if code == OTHER else None,
            "coverage": coverage_note(code),
        }
        links = [{"label": "DOL OSHA inspection data (bulk)", "url": INSPECTION_ZIP}, {"label": "DOL OSHA violation data (bulk)", "url": VIOLATION_ZIP},
                 {"label": "OSHA State Plans", "url": STATE_PLANS_URL}]
        if code in STATES:
            links.insert(0, {"label": f"{name} place profile", "url": f"/places/{code}"})
        if code in sir_states:
            links.append({"label": "Severe injury reports 2015–2021 (federal OSHA, published aggregates)", "url": f"/records/osha_severe_injuries/osha-sir:state:{code}"})
        cur = lat or {}
        state_rows.append(writer.record(
            "osha_inspections_states", f"osha-state:{code}", f"{name} — OSHA inspections and citations",
            source_url=INSPECTION_ZIP,
            subtitle=(f"FY{LATEST_COMPLETE_FY}: {cur.get('inspections', 0):,} inspections · {sum(cur.get('violations', {}).values()):,} violation records · "
                      f"current penalties {P.money_label(cur.get('current_penalty'))} (computed) · {plan_status(code)}"),
            state=code if kind in ("state", "territory") else "",
            cells={"state": name, "fy": LATEST_COMPLETE_FY, "inspections": cur.get("inspections", 0), "unprogrammed": cur.get("unprogrammed", 0),
                   "fat_cat": cur.get("fat_cat", 0), "accident": cur.get("accident", 0), "serious": cur.get("violations", {}).get("serious", 0),
                   "willful_repeat": cur.get("violations", {}).get("willful", 0) + cur.get("violations", {}).get("repeat", 0),
                   "current_penalty": cur.get("current_penalty", 0.0), "ten_fy_inspections": t10["inspections"],
                   "state_plan_share": share_sp, "plan": plan_status(code)},
            facts=facts([
                ("Source", "DOL Open Data Portal bulk files OSHA_inspection.zip and OSHA_violation.zip"),
                ("Snapshot", f"{snap} (archive date), retrieved {retrieved}"),
                ("Period", f"FY{profile['first_fy']}–FY{profile['last_fy']} by inspection open date; FY{CURRENT_FY} runs to the {snap} snapshot and many of its cases are still open"),
                ("Jurisdiction status", plan_status(code)),
                (f"Inspections FY{LATEST_COMPLETE_FY}", f"{cur.get('inspections', 0):,}"),
                (f"Programmed / unprogrammed FY{LATEST_COMPLETE_FY}", f"{cur.get('programmed', 0):,} / {cur.get('unprogrammed', 0):,}"),
                (f"Fatality/catastrophe (type M) / accident (type A) inspections FY{LATEST_COMPLETE_FY}", f"{cur.get('fat_cat', 0):,} / {cur.get('accident', 0):,} (State Plans often code these investigations A)"),
                (f"Violation records FY{LATEST_COMPLETE_FY} (serious / willful / repeat / other)",
                 "{:,} / {:,} / {:,} / {:,}".format(*(cur.get("violations", P.blank_violations())[k] for k in ("serious", "willful", "repeat", "other")))),
                (f"Violation items FY{LATEST_COMPLETE_FY}, lettered groups counted once (serious / willful / repeat / other)",
                 "{:,} / {:,} / {:,} / {:,}".format(*(cur.get("items_by_type", P.blank_violations())[k] for k in ("serious", "willful", "repeat", "other")))),
                (f"Initial penalties FY{LATEST_COMPLETE_FY} (computed sum)", P.money_label(cur.get("initial_penalty"))),
                (f"Current penalties FY{LATEST_COMPLETE_FY} (computed sum)", P.money_label(cur.get("current_penalty"))),
                (f"Inspections FY{TEN_FY[0]}–FY{TEN_FY[1]}", f"{t10['inspections']:,}"),
                (f"Current penalties FY{TEN_FY[0]}–FY{TEN_FY[1]} (computed sum)", P.money_label(t10["current_penalty"])),
                ("Unprogrammed share, 10 FYs", f"{share_unprog}%" if share_unprog is not None else None),
                ("State Plan share of inspections, 10 FYs", f"{share_sp}%" if share_sp is not None else None),
                (f"Inspections per 100,000 covered jobs FY{LATEST_COMPLETE_FY}", f"{rate} (denominator BLS QCEW {QCEW_YEAR} annual average covered employment, {QCEW_URL})" if rate is not None else None),
                ("Coverage", profile["coverage"]),
            ]),
            text=" ".join([name, code, plan_status(code)] + [s["title"] for s in profile["ten_fy_top_naics"]]),
            filters={"kind": [kind], "plan": ["full" if code in STATE_PLAN_FULL else "public" if code in STATE_PLAN_PUBLIC else "federal" if kind != "other" else "na"]},
            links=links,
            extra={"profile": profile},
        ))

    # ---------------- national
    nat_entries = []
    for fy in sorted(national):
        entry = national_extras(finish_year(fy, national[fy], titles), national[fy])
        nat_entries.append(entry)
    for i, entry in enumerate(nat_entries):
        prev = nat_entries[i - 1] if i else None
        entry["yoy_inspections_pct"] = P.pct_change(entry["inspections"], prev["inspections"]) if prev and prev["fy"] == entry["fy"] - 1 else None
        entry["yoy_current_penalty_pct"] = P.pct_change(entry["current_penalty"], prev["current_penalty"]) if prev and prev["fy"] == entry["fy"] - 1 else None
        entry["top_sections"] = top_sections(sections_fy[entry["fy"]]) if entry["fy"] in sections_fy else None
        by_state = sorted(((code, next((e for e in es if e["fy"] == entry["fy"]), None)) for code, es in state_entries.items() if code in STATES or code in TERRITORIES), key=lambda kv: kv[0])
        entry["states_by_inspections"] = [{"code": c, "inspections": e["inspections"], "current_penalty": e["current_penalty"]} for c, e in sorted(((c, e) for c, e in by_state if e), key=lambda kv: (-kv[1]["inspections"], kv[0]))[:10]]
    nat_rows = []
    for entry in nat_entries:
        fy = entry["fy"]
        partial = fy >= CURRENT_FY
        status = "partial year (17 days)" if fy == CURRENT_FY + 1 else "cases partly open" if fy == CURRENT_FY else "closed fiscal year"
        nat_rows.append(writer.record(
            "osha_inspections_national", f"osha-national:FY{fy}", f"United States — OSHA inspections FY{fy}",
            source_url=INSPECTION_ZIP,
            subtitle=f"{entry['inspections']:,} inspections · {entry['violation_records']:,} violation records · current penalties {P.money_label(entry['current_penalty'])} (computed) · {status}",
            cells={"fy": fy, "inspections": entry["inspections"], "programmed": entry["programmed"], "unprogrammed": entry["unprogrammed"],
                   "fat_cat": entry["fat_cat"], "accident": entry["accident"], "state_plan": entry["state_plan"], "violations": entry["violation_records"],
                   "initial_penalty": entry["initial_penalty"], "current_penalty": entry["current_penalty"],
                   "median_current_penalty": entry["median_current_penalty"], "median_days_to_close": entry["median_days_to_close"]},
            facts=facts([
                ("Source", "DOL Open Data Portal bulk files OSHA_inspection.zip and OSHA_violation.zip"),
                ("Snapshot", f"{snap} (archive date), retrieved {retrieved}"),
                ("Fiscal year", f"FY{fy} (inspections opened 1 Oct {fy - 1} – 30 Sep {fy}); {status}"),
                ("Inspections (federal / State Plan)", f"{entry['inspections']:,} ({entry['federal']:,} / {entry['state_plan']:,})"),
                ("Programmed / unprogrammed / other", f"{entry['programmed']:,} / {entry['unprogrammed']:,} / {entry['other_type']:,}"),
                ("Fatality/catastrophe (M) / accident (A) inspections", f"{entry['fat_cat']:,} / {entry['accident']:,}"),
                ("Violation records serious / willful / repeat / other / unclassified",
                 "{:,} / {:,} / {:,} / {:,} / {:,}".format(*(entry["violations"][k] for k in ("serious", "willful", "repeat", "other", "unclassified")))),
                ("Violation items, lettered groups counted once (serious / willful / repeat / other / unclassified)",
                 "{:,} / {:,} / {:,} / {:,} / {:,}".format(*(entry["items_by_type"][k] for k in ("serious", "willful", "repeat", "other", "unclassified")))),
                ("Initial penalties (computed sum)", P.money_label(entry["initial_penalty"])),
                ("Current penalties (computed sum)", P.money_label(entry["current_penalty"])),
                ("Current as % of initial", f"{entry['current_to_initial_pct']}%" if entry["current_to_initial_pct"] is not None else None),
                ("Median current penalty per penalized inspection", P.money_label(entry["median_current_penalty"])),
                ("Median days open to close (closed cases)", entry["median_days_to_close"]),
                ("Closed / still open", f"{entry['closed_cases']:,} / {entry['open_cases']:,}"),
                ("Coverage", "Federal OSHA and State Plan inspections recorded in OSHA's enforcement database; State Plan citation data may post up to 30 days late; recent fiscal years incomplete while cases remain open."),
            ]),
            text=f"FY{fy} OSHA inspections national",
            filters={"kind": ["year"], "status": ["partial" if partial else "closed"]},
            links=[{"label": "DOL OSHA inspection data (bulk)", "url": INSPECTION_ZIP}, {"label": "DOL OSHA violation data (bulk)", "url": VIOLATION_ZIP}],
            extra={"year": entry},
        ))
    ten_nat = sum_years(nat_entries, *TEN_FY)
    federal_10 = sum(e["federal"] for e in nat_entries if TEN_FY[0] <= e["fy"] <= TEN_FY[1])
    summary_profile = {
        "series": [{k: e[k] for k in ("fy", "inspections", "programmed", "unprogrammed", "fat_cat", "accident", "federal", "state_plan",
                                       "violation_records", "violation_items", "initial_penalty", "current_penalty", "median_current_penalty",
                                       "median_days_to_close", "open_cases", "yoy_inspections_pct", "yoy_current_penalty_pct")} for e in nat_entries],
        "ten_fy": ten_nat,
        "ten_fy_top_naics": window_sectors(national, titles, *TEN_FY),
        "state_rates_latest_fy": sorted(
            [{"code": c, "inspections": latest[c]["inspections"], "covered_jobs": employment.get(c),
              "per_100k_covered_jobs": round(latest[c]["inspections"] / employment[c] * 100000, 2)}
             for c in latest if latest[c] and c in employment], key=lambda r: (-r["per_100k_covered_jobs"], r["code"])),
        "rate_fy": LATEST_COMPLETE_FY, "rate_denominator": {"source": QCEW_URL, "year": QCEW_YEAR, "measure": "total covered employment, all ownerships, annual average"},
    }
    nat_rows.append(writer.record(
        "osha_inspections_national", "osha-national:summary", "United States — OSHA inspection series and distribution",
        source_url=INSPECTION_ZIP,
        subtitle=f"FY{nat_entries[0]['fy']}–FY{nat_entries[-1]['fy']} · FY{TEN_FY[0]}–FY{TEN_FY[1]}: {ten_nat['inspections']:,} inspections, current penalties {P.money_label(ten_nat['current_penalty'])} (computed)",
        cells={"fy": f"FY{TEN_FY[0]}–FY{TEN_FY[1]}", "inspections": ten_nat["inspections"], "programmed": ten_nat["programmed"], "unprogrammed": ten_nat["unprogrammed"],
               "fat_cat": ten_nat["fat_cat"], "accident": ten_nat["accident"], "state_plan": ten_nat["state_plan"], "violations": ten_nat["violation_records"],
               "initial_penalty": ten_nat["initial_penalty"], "current_penalty": ten_nat["current_penalty"], "median_current_penalty": None, "median_days_to_close": None},
        facts=facts([
            ("Source", "DOL Open Data Portal bulk files OSHA_inspection.zip and OSHA_violation.zip"),
            ("Snapshot", f"{snap} (archive date), retrieved {retrieved}"),
            ("Series", f"FY{nat_entries[0]['fy']}–FY{nat_entries[-1]['fy']} by inspection open date"),
            (f"Inspections FY{TEN_FY[0]}–FY{TEN_FY[1]}", f"{ten_nat['inspections']:,} ({federal_10:,} federal, {ten_nat['state_plan']:,} State Plan)"),
            (f"Current penalties FY{TEN_FY[0]}–FY{TEN_FY[1]} (computed sum)", P.money_label(ten_nat["current_penalty"])),
            ("Rate denominator", f"BLS QCEW {QCEW_YEAR} annual average total covered employment ({QCEW_URL})"),
            ("Coverage", common["coverage"]),
        ]),
        text="OSHA national inspection series penalty distribution",
        filters={"kind": ["summary"], "status": ["closed"]},
        links=[{"label": "DOL OSHA inspection data (bulk)", "url": INSPECTION_ZIP}, {"label": "DOL OSHA violation data (bulk)", "url": VIOLATION_ZIP}],
        extra={"profile": summary_profile},
    ))

    # ---------------- employers
    ranked = sorted(((name, agg) for name, agg in employers.items() if agg.current > 0), key=lambda kv: (-kv[1].current, kv[0]))
    window_total = sum(agg.current for agg in employers.values())
    match_counts = collections.Counter()
    emp_rows = []
    for rank, (name, agg) in enumerate(ranked[:EMPLOYER_LIMIT], 1):
        status, cik = P.match_company(name, index)
        match_counts[status] += 1
        agg.top.sort(key=lambda t: (-t[0], t[1]))
        top = [{"activity_nr": str(aid), "osha_inspection_nr": inspection_number(aid), "opened": day, "state": code, "city": city or None,
                "current_penalty": round(curr, 2), "initial_penalty": round(init, 2), "insp_type": itype or None, "jurisdiction": jur,
                "url": DETAIL_URL.format(inspection_number(aid))}
               for curr, aid, day, code, city, init, itype, jur in agg.top[:5]]
        states = [{"code": c, "inspections": n} for c, n in sorted(agg.states.items(), key=lambda kv: (-kv[1], kv[0]))]
        sectors = [{"sector": s, "title": titles.get(s, "Not recorded"), "inspections": n} for s, n in sorted(agg.sectors.items(), key=lambda kv: (-kv[1], kv[0]))[:3]]
        rid = "osha-employer:" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:16]
        links = [{"label": f"OSHA inspection {t['osha_inspection_nr']}", "url": t["url"]} for t in top[:3]]
        links += [{"label": f"{STATES[s['code']][1]} place profile", "url": f"/places/{s['code']}"} for s in states[:3] if s["code"] in STATES]
        if cik:
            links.insert(0, {"label": "SEC company profile (exact name match)", "url": f"/companies/{cik}"})
        employer = {
            "name": name, "rank": rank, "fy_window": list(EMPLOYER_FY), "inspections": agg.inspections, "penalized_inspections": agg.penalized,
            "violation_records": agg.items, "violations": dict(agg.violations), "violation_items": agg.grouped_total, "items_by_type": dict(agg.grouped), "initial_penalty": round(agg.initial, 2),
            "current_penalty": round(agg.current, 2), "share_of_window_current_penalty_pct": round(agg.current / window_total * 100, 4) if window_total else None,
            "states": states, "top_naics": sectors, "jurisdiction": dict(agg.jur), "first_opened": agg.first, "last_opened": agg.last,
            "by_fy": dict(sorted(agg.fys.items())), "top_inspections": top,
            "company_match": {"status": status, "cik": cik, "method": "upper case + whitespace collapse, exact equality with company_sec_profiles title, unique CIK only"},
        }
        emp_rows.append(writer.record(
            "osha_employers", rid, name,
            source_url=VIOLATION_ZIP,
            subtitle=f"#{rank} · {agg.inspections:,} inspections FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]} · current penalties {P.money_label(agg.current)} (computed) · {', '.join(s['code'] for s in states[:4])}",
            state=states[0]["code"] if len(states) == 1 and states[0]["code"] in STATES else "",
            cells={"rank": rank, "name": name, "inspections": agg.inspections, "states": ", ".join(s["code"] for s in states[:4]) + (" …" if len(states) > 4 else ""),
                   "serious": agg.violations["serious"], "willful": agg.violations["willful"], "repeat": agg.violations["repeat"],
                   "initial_penalty": round(agg.initial, 2), "current_penalty": round(agg.current, 2), "company": f"/companies/{cik}" if cik else None},
            facts=facts([
                ("Establishment name", f"{name} (exactly as recorded in ESTAB_NAME; variants are separate records)"),
                ("Source", "DOL Open Data Portal bulk files OSHA_inspection.zip and OSHA_violation.zip"),
                ("Snapshot", f"{snap} (archive date), retrieved {retrieved}"),
                ("Window", f"Inspections opened FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]} (1 Oct {EMPLOYER_FY[0] - 1} – {snap} snapshot; FY{EMPLOYER_FY[1]} is not over and many of its cases are open)"),
                ("Rank by current penalties", f"{rank} of {len(ranked):,} penalized names"),
                ("Inspections (with a current penalty)", f"{agg.inspections:,} ({agg.penalized:,})"),
                ("Violation records serious / willful / repeat / other", "{:,} / {:,} / {:,} / {:,}".format(*(agg.violations[k] for k in ("serious", "willful", "repeat", "other")))),
                ("Violation items, lettered groups counted once (serious / willful / repeat / other)", "{:,} / {:,} / {:,} / {:,}".format(*(agg.grouped[k] for k in ("serious", "willful", "repeat", "other")))),
                ("Initial penalties (computed sum)", P.money_label(agg.initial)),
                ("Current penalties (computed sum)", P.money_label(agg.current)),
                ("States", ", ".join(f"{s['code']} ({s['inspections']})" for s in states[:10])),
                ("First / last inspection opened", f"{agg.first} / {agg.last}"),
                ("Company profile link", f"/companies/{cik} (exact unique name match)" if cik else ("Not linked: several CIKs share this title" if status == "ambiguous" else "Not linked: no exact SEC title match")),
                ("Coverage", "Federal OSHA and State Plan inspections; names are not merged across spelling variants, subsidiaries or parents, so an employer's total may be split across several records."),
            ]),
            text=" ".join([name] + [s["code"] for s in states[:10]] + [t["activity_nr"] + " " + t["osha_inspection_nr"] for t in top]),
            filters={"state": [s["code"] for s in states[:10]], "linked": ["yes" if cik else "no"]},
            badges=[f"#{rank}"] + (["SEC profile"] if cik else []),
            links=links,
            extra={"employer": employer},
        ))
    print("employers ranked", len(ranked), "match", dict(match_counts), file=sys.stderr)

    # ---------------- write
    inputs = manifest_inputs()
    built = now_utc()
    plan_options = {"full": "State Plan (private + public)", "public": "State Plan (public only)", "federal": "Federal OSHA", "na": "Not applicable"}
    outputs = [
        ("osha_inspections_states", "OSHA inspections, violations and penalties by state and fiscal year", state_rows,
         writer.listing([("state", "State"), ("fy", "FY"), ("inspections", "Inspections"), ("unprogrammed", "Unprogrammed"), ("fat_cat", "Fat/cat (type M)"), ("accident", "Accident (type A)"),
                         ("serious", "Serious (records)"), ("willful_repeat", "Willful + repeat (records)"), ("current_penalty", "Current penalties ($, computed)"),
                         ("ten_fy_inspections", f"Inspections FY{TEN_FY[0]}–{TEN_FY[1]}"), ("state_plan_share", "State Plan share (%)"), ("plan", "Jurisdiction")],
                        [("kind", "Kind", {"state": "State", "territory": "Territory", "other": "Other / unrecorded"}), ("plan", "Jurisdiction", plan_options)]),
         {**common, "grain": "one record per site state/territory code (50 states, DC, PR, VI, GU, AS, MP) plus one record for other or unrecorded site codes; item.profile.years holds the fiscal-year series",
          "cells_fy": LATEST_COMPLETE_FY, "ten_fy": list(TEN_FY),
          "rate": f"inspections per 100,000 covered jobs = FY{RATE_FY} inspections / BLS QCEW {QCEW_YEAR} annual average total covered employment (all ownerships) x 100,000; denominator {QCEW_URL}",
          "median_days_to_close": "median of (CLOSE_CASE_DATE - OPEN_DATE) in days over closed inspections opened in the FY; open cases excluded (recent years biased low)",
          "median_current_penalty": "median inspection-level current penalty (sum over its violation items) among inspections with a current penalty > 0",
          "top_sections": f"cited standards grouped to part.section (e.g. 19260501 B13 -> 1926.501) for inspections opened FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]}"}),
        ("osha_inspections_national", "OSHA inspections, violations and penalties — national series", nat_rows,
         writer.listing([("fy", "FY"), ("inspections", "Inspections"), ("programmed", "Programmed"), ("unprogrammed", "Unprogrammed"), ("fat_cat", "Fat/cat (type M)"),
                         ("accident", "Accident (type A)"), ("state_plan", "State Plan"), ("violations", "Violation records"), ("initial_penalty", "Initial penalties ($, computed)"),
                         ("current_penalty", "Current penalties ($, computed)"), ("median_current_penalty", "Median penalty ($)"), ("median_days_to_close", "Median days to close")],
                        [("kind", "Kind", {"year": "Fiscal year", "summary": "Summary"}), ("status", "Status", {"closed": "Closed year", "partial": "Partial / open cases"})]),
         {**common, "grain": "one record per fiscal year (item.year) plus a summary record (item.profile.series)",
          "penalty_distribution": "inspections by inspection-level current penalty (sum over its violation items): 0 (no violation or no current penalty), 1-999, 1000-4999, 5000-9999, 10000-49999, 50000-99999, 100000-499999, 500000+",
          "percentiles": "median (mean of two middle values when even), p90/p99 by nearest rank, over inspections with current penalty > 0",
          "top1pct_share": "share of the FY's current penalties held by the top 1% (ceil) of penalized inspections",
          "median_days_to_close": "median of (CLOSE_CASE_DATE - OPEN_DATE) in days over closed inspections opened in the FY; open cases excluded",
          "yoy": "(this FY - previous FY) / previous FY x 100",
          "top_sections": f"national cited standards by part.section for FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]}"}),
        ("osha_employers", f"OSHA establishments with the highest current penalties, FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]}", emp_rows,
         writer.listing([("rank", "Rank"), ("name", "Establishment (as recorded)"), ("inspections", "Inspections"), ("states", "States"), ("serious", "Serious"),
                         ("willful", "Willful"), ("repeat", "Repeat"), ("initial_penalty", "Initial ($, computed)"), ("current_penalty", "Current ($, computed)"), ("company", "SEC profile")],
                        [("linked", "SEC profile link", {"yes": "Linked", "no": "Not linked"})]),
         {**common, "grain": f"one record per exact establishment name (ESTAB_NAME trimmed of outer whitespace only) for the top {EMPLOYER_LIMIT} by summed current penalty over inspections opened FY{EMPLOYER_FY[0]}–FY{EMPLOYER_FY[1]}",
          "no_merging": "Spelling variants, store numbers, subsidiaries and parents are not merged; one employer may appear under several names.",
          "window_total_current_penalty": round(window_total, 2), "penalized_names": len(ranked), "names_in_window": len(employers),
          "company_links": {"method": "name upper-cased and whitespace-collapsed, exact equality with company_sec_profiles titles, link only when the title maps to one CIK",
                            "matched": match_counts.get("matched", 0), "ambiguous": match_counts.get("ambiguous", 0), "unmatched": match_counts.get("no_match", 0)}}),
    ]
    for dataset, label, rows, listing_block, summary in outputs:
        write_dataset(dataset, label, rows, listing_block, summary, inputs, built)
    write_dataset(*build_sir(), manifest_inputs("sir"), built)
    with open(os.path.join(OUT, "build_stats.json"), "w") as handle:
        json.dump({"violations": dict(viol.stats), "viol_type_codes": dict(viol.type_codes), "inspections": dict(stats),
                   "other_codes": dict(other_codes), "company_match": dict(match_counts),
                   "seconds": round(time.time() - started)}, handle, indent=1)


if __name__ == "__main__":
    main()
