"""Independent spot-check of the NPDB build files against the raw Public Use Data File (second implementation).

This script deliberately shares no code with npdb_lib.py / build_npdb.py: it re-reads NpdbPublicUseDataCsv.zip,
re-derives state attribution, payments, delays, bands, per-capita rates, rankings and growth with its own plain
logic (statistics.median over explicit value lists), re-reads the Census, BLS and compliance CSVs, and compares
the figures displayed in private/build/npdb/*.json (row item.cells and the item.npdb detail).

Output: a JSON list of checks (id, figure, build value, recomputed value, source location, match) written to
private/build/npdb/spot_checks.json, a printed summary, and exit status 1 on any mismatch.

Usage: python3 -I -B scripts/enrichment/npdb/verify_npdb.py
"""
import collections
import csv
import io
import json
import os
import random
import statistics
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "npdb")
BUILD = os.path.join(ROOT, "private", "build", "npdb")
ZIP = os.path.join(ACQ, "puf", "NpdbPublicUseDataCsv.zip")
MEMBER = "NPDB2604.CSV"

LICENSURE = {"301", "302", "1302"}
PRIVILEGES = {"401", "402"}
OIG = {"702", "1702"}
DEA = {"601", "602", "1602"}
PHYSICIAN_FIELDS = {10, 15, 20, 25}
FIPS_PA, FIPS_WA, FIPS_FL, FIPS_TX = "42", "53", "12", "48"


def load_build(name):
    with open(os.path.join(BUILD, name + ".json")) as handle:
        return json.load(handle)


def to_year(text):
    text = text.strip()
    return int(text) if len(text) == 4 and text.isdigit() else None


def to_pay(text):
    text = text.strip().replace("$", "").replace(",", "")
    return float(text) if text else None


class Slice:
    def __init__(self):
        self.reports = 0
        self.pays = []
        self.delays = []
        self.judgments = 0

    def add(self, pay, delay, judgment):
        self.reports += 1
        if pay is not None:
            self.pays.append(pay)
        if delay is not None:
            self.delays.append(delay)
        self.judgments += 1 if judgment else 0

    def merged(parts):
        out = Slice()
        for part in parts:
            out.reports += part.reports
            out.pays += part.pays
            out.delays += part.delays
            out.judgments += part.judgments
        return out

    def total(self):
        return sum(self.pays)

    def mean(self):
        return sum(self.pays) / len(self.pays)

    def median(self):
        return statistics.median(self.pays)

    def delay_median(self):
        return statistics.median(self.delays)


def scan():
    mm = collections.defaultdict(Slice)  # (state, year) -> Slice
    mm_alleg = collections.defaultdict(Slice)  # ALGNNATR -> Slice
    mm_window_bands = collections.defaultdict(collections.Counter)  # (window start,end) -> band label counts
    mm_window_alleg = collections.defaultdict(collections.Counter)
    mm_window_n = collections.Counter()
    mm_death = collections.defaultdict(lambda: [0, 0])  # year -> [recorded severity, deaths]
    aa_total = collections.Counter()  # (state, year)
    aa_group = collections.Counter()  # (state, year, group)
    aa_phys = collections.Counter()  # (state, year)
    with zipfile.ZipFile(ZIP) as archive, archive.open(MEMBER) as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
        head = next(reader)
        col = {name: i for i, name in enumerate(head)}
        g = lambda row, name: row[col[name]].strip()  # noqa: E731
        for row in reader:
            kind = g(row, "RECTYPE")
            year = to_year(g(row, "ORIGYEAR"))
            if kind in ("M", "P"):
                state = g(row, "WORKSTAT") or g(row, "HOMESTAT") or "NR"
                pay = to_pay(g(row, "PAYMENT"))
                act = to_year(g(row, "MALYEAR1"))
                delay = (year - act) if (act is not None and 1900 <= act <= year) else None
                mm[(state, year)].add(pay, delay, g(row, "PAYTYPE") == "J")
                alleg = g(row, "ALGNNATR") or "Not recorded"
                mm_alleg[alleg].add(pay, delay, g(row, "PAYTYPE") == "J")
                for window in ((2005, 2009), (2021, 2025)):
                    if window[0] <= year <= window[1]:
                        mm_window_n[window] += 1
                        mm_window_alleg[window][alleg] += 1
                        if pay is None:
                            label = "none"
                        elif pay < 10000:
                            label = "<=10k"
                        elif pay < 50000:
                            label = "10-50k"
                        elif pay < 100000:
                            label = "50-100k"
                        elif pay < 250000:
                            label = "100-250k"
                        elif pay < 500000:
                            label = "250-500k"
                        elif pay < 1000000:
                            label = "500k-1m"
                        elif pay < 5000000:
                            label = "1m-5m"
                        else:
                            label = ">5m"
                        mm_window_bands[window][label] += 1
                if g(row, "OUTCOME"):
                    mm_death[year][0] += 1
                    mm_death[year][1] += 1 if g(row, "OUTCOME") == "9" else 0
            elif kind in ("A", "C"):
                rep = g(row, "REPTYPE")
                if rep in LICENSURE and g(row, "LICNSTAT"):
                    state = g(row, "LICNSTAT")
                else:
                    state = g(row, "WORKSTAT") or g(row, "HOMESTAT") or "NR"
                aa_total[(state, year)] += 1
                if rep in LICENSURE:
                    aa_group[(state, year, "licensure")] += 1
                elif rep in PRIVILEGES:
                    aa_group[(state, year, "privileges")] += 1
                elif rep in OIG:
                    aa_group[(state, year, "oig")] += 1
                elif rep in DEA:
                    aa_group[(state, year, "dea")] += 1
                lic = g(row, "LICNFELD")
                if lic.isdigit() and int(lic) in PHYSICIAN_FIELDS:
                    aa_phys[(state, year)] += 1
    return mm, mm_alleg, mm_window_bands, mm_window_alleg, mm_window_n, mm_death, aa_total, aa_group, aa_phys


def census(name, years, fips):
    out = {}
    with open(os.path.join(ACQ, "denominators", name), newline="", encoding="latin-1") as handle:
        for row in csv.DictReader(handle):
            if row["SUMLEV"] == "040" and row["STATE"].zfill(2) == fips:
                for y in years:
                    out[y] = int(row["POPESTIMATE%d" % y])
    return out


def cpi_annual():
    out = {}
    with open(os.path.join(ACQ, "denominators", "bls_cu.data.1.AllItems.txt"), encoding="latin-1") as handle:
        for line in handle:
            parts = [p.strip() for p in line.split("\t")]
            if len(parts) >= 4 and parts[0] == "CUUR0000SA0" and parts[2] == "M13":
                out[int(parts[1])] = float(parts[3])
    return out


CHECKS = []


def check(dataset, rid, figure, built, expected, location, digits=None):
    if digits is not None and expected is not None:
        expected = round(expected, digits)
    ok = built == expected or (isinstance(built, float) and isinstance(expected, float) and abs(built - expected) < 1e-9)
    CHECKS.append({"dataset": dataset, "id": rid, "figure": figure, "built": built, "recomputed": expected, "source": location, "match": bool(ok)})


def main():
    states = load_build("npdb_malpractice_states")
    national = load_build("npdb_malpractice_national")
    adverse = load_build("npdb_adverse_actions")
    compliance = load_build("npdb_state_board_compliance")
    by_id = {name: {r["id"]: r for r in build["rows"]} for name, build in (
        ("npdb_malpractice_states", states), ("npdb_malpractice_national", national),
        ("npdb_adverse_actions", adverse), ("npdb_state_board_compliance", compliance))}
    mm, mm_alleg, bands, window_alleg, window_n, death, aa_total, aa_group, aa_phys = scan()
    loc_mm = "PUF NPDB2604.CSV, RECTYPE M/P rows; WORKSTAT else HOMESTAT; PAYMENT; ORIGYEAR; MALYEAR1; PAYTYPE"
    loc_aa = "PUF NPDB2604.CSV, RECTYPE A/C rows; REPTYPE; LICNSTAT/WORKSTAT/HOMESTAT; ORIGYEAR; LICNFELD"

    def state_all(code):
        return Slice.merged([s for (st, y), s in mm.items() if st == code])

    def state_window(code, a, b):
        return Slice.merged([s for (st, y), s in mm.items() if st == code and a <= y <= b])

    # 1. State all-years records: reports, total, mean, median, delay median, judgment share.
    for code in ("NJ", "CA", "TX", "NY", "PA", "FL"):
        s = state_all(code)
        cells = by_id["npdb_malpractice_states"]["npdb-mmpr:%s:all" % code]["item"]["cells"]
        rid = "npdb-mmpr:%s:all" % code
        check("npdb_malpractice_states", rid, "reports", cells["reports"], s.reports, loc_mm)
        check("npdb_malpractice_states", rid, "coded total paid", cells["total_paid"], round(s.total(), 2), loc_mm)
        check("npdb_malpractice_states", rid, "mean payment", cells["mean_payment"], s.mean(), loc_mm, 2)
        check("npdb_malpractice_states", rid, "median payment", cells["median_payment"], s.median(), loc_mm)
        check("npdb_malpractice_states", rid, "median delay (years)", cells["delay_median_years"], s.delay_median(), loc_mm)
        check("npdb_malpractice_states", rid, "judgment share", cells["judgment_share"], s.judgments / s.reports, loc_mm, 4)

    # 2. State-year records (hand-picked plus a seeded random sample of unsuppressed ones).
    picked = [("NJ", 2020), ("CA", 2010), ("FL", 2005), ("TX", 2024), ("NY", 1995), ("OH", 2000), ("IL", 2015), ("MA", 2023)]
    rng = random.Random(20261018)
    pool = sorted(k for k, s in mm.items() if k[0] in {"AL", "AZ", "CO", "GA", "MI", "MN", "MO", "NC", "OR", "TN", "VA", "WA", "WI"} and s.reports >= 40 and 1991 <= k[1] <= 2025)
    picked += rng.sample(pool, 12)
    for code, year in picked:
        s = mm[(code, year)]
        rid = "npdb-mmpr:%s:%d" % (code, year)
        cells = by_id["npdb_malpractice_states"][rid]["item"]["cells"]
        check("npdb_malpractice_states", rid, "reports", cells["reports"], s.reports, loc_mm)
        check("npdb_malpractice_states", rid, "coded total paid", cells["total_paid"], round(s.total(), 2), loc_mm)
        check("npdb_malpractice_states", rid, "median payment", cells["median_payment"], s.median(), loc_mm)
        check("npdb_malpractice_states", rid, "mean payment", cells["mean_payment"], s.mean(), loc_mm, 2)

    # 3. Per-capita rates against the Census files read independently.
    pa = census("nst-est2020-alldata.csv", [2015], FIPS_PA)
    wa = census("NST-EST2025-ALLDATA.csv", range(2021, 2026), FIPS_WA)
    check("npdb_malpractice_states", "npdb-mmpr:PA:2015", "reports per million residents, 2015",
          by_id["npdb_malpractice_states"]["npdb-mmpr:PA:2015"]["item"]["cells"]["per_million"],
          mm[("PA", 2015)].reports / pa[2015] * 1e6, "PUF + Census nst-est2020-alldata.csv POPESTIMATE2015 (STATE 42)", 2)
    wa_reports = sum(mm[("WA", y)].reports for y in range(2021, 2026))
    check("npdb_malpractice_states", "npdb-mmpr:WA:all", "reports per million residents per year, 2021-2025 pooled",
          by_id["npdb_malpractice_states"]["npdb-mmpr:WA:all"]["item"]["cells"]["per_million"],
          wa_reports / sum(wa.values()) * 1e6, "PUF + Census NST-EST2025-ALLDATA.csv POPESTIMATE2021-2025 (STATE 53)", 3)

    # 4. Median payment growth (CAGR of pooled window medians, 2001-2005 -> 2021-2025).
    for code in ("CA", "OH"):
        a, b = state_window(code, 2001, 2005).median(), state_window(code, 2021, 2025).median()
        growth = by_id["npdb_malpractice_states"]["npdb-mmpr:%s:all" % code]["item"]["npdb"]["growth"]
        check("npdb_malpractice_states", "npdb-mmpr:%s:all" % code, "median payment CAGR 2001-2005 to 2021-2025 (pooled medians %.0f -> %.0f)" % (a, b),
              growth["median_cagr"], (b / a) ** (1 / 20) - 1, "PUF payments in ORIGYEAR windows", 5)

    # 5. National series and real dollars.
    cpi = cpi_annual()
    for year in (1991, 2001, 2025):
        s = Slice.merged([v for (st, y), v in mm.items() if y == year])
        rid = "npdb-mmpr-us:%d" % year
        cells = by_id["npdb_malpractice_national"][rid]["item"]["cells"]
        check("npdb_malpractice_national", rid, "reports", cells["reports"], s.reports, loc_mm)
        check("npdb_malpractice_national", rid, "coded total paid", cells["total_paid"], round(s.total(), 2), loc_mm)
        check("npdb_malpractice_national", rid, "median payment", cells["median_payment"], s.median(), loc_mm)
        check("npdb_malpractice_national", rid, "median payment (2025 dollars)", cells["median_payment_2025usd"],
              s.median() * cpi[2025] / cpi[year], "PUF median x BLS CUUR0000SA0 annual average 2025 / %d" % year, 2)
    allm = Slice.merged(list(mm.values()))
    cells = by_id["npdb_malpractice_national"]["npdb-mmpr-us:all"]["item"]["cells"]
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "reports, all years", cells["reports"], allm.reports, loc_mm)
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "mean payment, all years", cells["mean_payment"], allm.mean(), loc_mm, 2)
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "median payment, all years", cells["median_payment"], allm.median(), loc_mm)
    recorded, deaths = sum(v[0] for v in death.values()), sum(v[1] for v in death.values())
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "deaths as share of reports with a recorded OUTCOME", cells["death_share"],
          deaths / recorded, "PUF OUTCOME (blank on RECTYPE M and on unrecorded P reports)", 4)

    # 6. Allegation group record and payment bands / allegation mix shift.
    for key in ("60", "20"):
        s = mm_alleg[key]
        rid = "npdb-mmpr-us:allegation:%s" % key
        cells = by_id["npdb_malpractice_national"][rid]["item"]["cells"]
        check("npdb_malpractice_national", rid, "reports", cells["reports"], s.reports, "PUF ALGNNATR = %s" % key)
        check("npdb_malpractice_national", rid, "median payment", cells["median_payment"], s.median(), "PUF ALGNNATR = %s" % key)
    window = (2021, 2025)
    detail = by_id["npdb_malpractice_national"]["npdb-mmpr-us:all"]["item"]["npdb"]["windows"]["2021-2025"]
    band_row = next(r for r in detail["band"] if r["key"] == "$100,001-$250,000")
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "2021-2025 reports with coded payment $100,000-$250,000", band_row["n"], bands[window]["100-250k"], "PUF PAYMENT bands, ORIGYEAR 2021-2025")
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "2021-2025 share of reports in that band", band_row["share"], bands[window]["100-250k"] / window_n[window], "same", 4)
    mix = next(r for r in by_id["npdb_malpractice_national"]["npdb-mmpr-us:all"]["item"]["npdb"]["analytics"]["allegation_mix_shift"]["rows"] if r["key"] == "1")
    sa = window_alleg[(2005, 2009)]["1"] / window_n[(2005, 2009)]
    sb = window_alleg[(2021, 2025)]["1"] / window_n[(2021, 2025)]
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "allegation group 1 share 2005-2009", mix["share_from"], sa, "PUF ALGNNATR by ORIGYEAR window", 4)
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "allegation group 1 share 2021-2025", mix["share_to"], sb, "same", 4)
    check("npdb_malpractice_national", "npdb-mmpr-us:all", "allegation group 1 change (percentage points)", mix["change_pp"], (round(sb, 4) - round(sa, 4)) * 100, "same", 2)

    # 7. State ranking by 2025 reports among the 50 states + DC (competition ranking).
    fifty_one = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"}
    counts = {c: mm[(c, 2025)].reports for c in fifty_one if (c, 2025) in mm}
    table = by_id["npdb_malpractice_national"]["npdb-mmpr-us:all"]["item"]["npdb"]["analytics"]["state_rankings"]["reports_2025"]
    built_ranks = {r["code"]: (r["rank"], r["value"]) for r in table}
    for code in ("CA", "NY", "TX", "WY"):
        if counts.get(code, 0) < 10:
            check("npdb_malpractice_national", "npdb-mmpr-us:all", "rank by 2025 reports: %s has %d reports (<10) so it must be unranked" % (code, counts.get(code, 0)),
                  code in built_ranks, False, "PUF reports with ORIGYEAR 2025 per work/home state")
            continue
        rank = 1 + sum(1 for v in counts.values() if v > counts[code])
        check("npdb_malpractice_national", "npdb-mmpr-us:all", "rank by 2025 reports: %s (value %d)" % (code, counts[code]), built_ranks[code], (rank, counts[code]), "PUF reports with ORIGYEAR 2025 per work/home state")

    # 8. Adverse actions.
    def aa_sum(code, year=None, group=None, phys=False):
        total = 0
        source = aa_phys if phys else (aa_group if group else aa_total)
        for key, n in source.items():
            if key[0] != code or (year is not None and key[1] != year):
                continue
            if group and not phys and key[2] != group:
                continue
            total += n
        return total

    for code, year in (("NJ", None), ("TX", 2018), ("CA", 2010)):
        rid = "npdb-aa:%s:%s" % (code, "all" if year is None else year)
        cells = by_id["npdb_adverse_actions"][rid]["item"]["cells"]
        check("npdb_adverse_actions", rid, "adverse action reports", cells["reports"], aa_sum(code, year), loc_aa)
        check("npdb_adverse_actions", rid, "state licensure actions", cells["licensure"], aa_sum(code, year, "licensure"), loc_aa)
        check("npdb_adverse_actions", rid, "clinical privileges actions", cells["clinical_privileges"], aa_sum(code, year, "privileges"), loc_aa)
        check("npdb_adverse_actions", rid, "physician (MD+DO, incl. residents) reports", cells["physicians"], aa_sum(code, year, phys=True), loc_aa)
    us = by_id["npdb_adverse_actions"]["npdb-aa:US:all"]["item"]["cells"]
    check("npdb_adverse_actions", "npdb-aa:US:all", "national adverse action reports", us["reports"], sum(aa_total.values()), loc_aa)
    check("npdb_adverse_actions", "npdb-aa:US:all", "HHS-OIG exclusion reports", us["exclusion_hhs_oig"], sum(n for k, n in aa_group.items() if k[2] == "oig"), loc_aa)
    check("npdb_adverse_actions", "npdb-aa:US:all", "DEA action reports", us["dea"], sum(n for k, n in aa_group.items() if k[2] == "dea"), loc_aa)
    fl25 = census("NST-EST2025-ALLDATA.csv", range(2021, 2026), FIPS_FL)
    fl_n = sum(aa_total[("FL", y)] for y in range(2021, 2026))
    check("npdb_adverse_actions", "npdb-aa:FL:all", "adverse action reports per million residents per year, 2021-2025 pooled",
          by_id["npdb_adverse_actions"]["npdb-aa:FL:all"]["item"]["cells"]["per_million"], fl_n / sum(fl25.values()) * 1e6,
          "PUF + Census NST-EST2025-ALLDATA.csv POPESTIMATE2021-2025 (STATE 12)", 3)

    # 9. Compliance map export, recomputed from the two CSV exports.
    boards = collections.defaultdict(list)
    with open(os.path.join(ACQ, "compliance", "StateBoardDetails.csv"), encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            boards[row["State"]].append(row)
    for code, name in (("NJ", "New Jersey"), ("CA", "California")):
        rows = boards[name]
        cells = by_id["npdb_state_board_compliance"]["npdb-compliance:%s" % code]["item"]["cells"]
        rid = "npdb-compliance:%s" % code
        loc = "StateBoardDetails.csv rows with State = %s" % name
        check("npdb_state_board_compliance", rid, "board-profession results", cells["results"], len(rows), loc)
        check("npdb_state_board_compliance", rid, "compliant results", cells["compliant"], sum(1 for r in rows if r["Status"] == "Compliant"), loc)
        check("npdb_state_board_compliance", rid, "non-compliant results", cells["non_compliant"], sum(1 for r in rows if r["Status"] == "Non-Compliant"), loc)
        check("npdb_state_board_compliance", rid, "distinct boards", cells["boards"], len({r["Board Name"] for r in rows}), loc)

    # 10. Disclosure audit over every published row: no count 1..9, no row-level identifiers.
    bad = []
    identifiers = []

    def walk(rid, obj):
        if isinstance(obj, dict):
            if isinstance(obj.get("n"), int) and 0 < obj["n"] < 10:
                bad.append(rid)
            for key, value in obj.items():
                if key in ("SEQNO", "PRACTNUM", "seqno", "practnum"):
                    identifiers.append(rid)
                walk(rid, value)
        elif isinstance(obj, list):
            for value in obj:
                walk(rid, value)

    rows_audited = 0
    for build in (states, national, adverse):
        for row in build["rows"]:
            rows_audited += 1
            walk(row["id"], row["item"])
            for key in ("reports", "licensure", "clinical_privileges", "exclusion_hhs_oig", "dea", "physicians"):
                value = row["item"]["cells"].get(key)
                if isinstance(value, int) and 0 < value < 10:
                    bad.append(row["id"] + ":" + key)
    check("all", "disclosure audit", "published counts of 1-9 across %d rows (cells and detail)" % rows_audited, len(bad), 0, "every item.cells and item.npdb count")
    check("all", "disclosure audit", "row-level identifier keys (SEQNO/PRACTNUM) in any row", len(identifiers), 0, "every item")

    mismatches = [c for c in CHECKS if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks.json"), "w") as handle:
        json.dump({"checks": CHECKS, "total": len(CHECKS), "mismatches": len(mismatches)}, handle, indent=1)
    print(json.dumps({"checks": len(CHECKS), "mismatches": len(mismatches)}))
    for c in mismatches:
        print("MISMATCH", json.dumps(c))
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
