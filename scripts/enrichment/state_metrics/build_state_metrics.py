"""Build and publish the state-metrics datasets from official files in private/acq/state-metrics.

Datasets
  state_metrics_profiles  one record per state + DC: every series by year, per-capita rates, latest-year
                          rank / z-score / 5-year change (item.profile)
  state_metrics_national  one record per metric: definition, source, national series and the per-year
                          distribution across the 51 jurisdictions (item.metric)

Sources (downloaded unchanged by fetch_sources.py; FDA counts come from the published openFDA corpus datasets):
  Census NST-EST2025-ALLDATA (2020-2025) and nst-est2020-alldata (2010-2019) population estimates
  BEA SAGDP1 (GDP) and SAINC1 (personal income) regional bulk tables
  BLS LAUS statewide annual averages (la.data.2.AllStatesU, period M13)
  CDC NCHS Leading Causes of Death bi63-dtpu (1999-2017) and VSRR provisional overdose counts xkb8-kh2a
  NHTSA FARS accident.csv 2014-2024 and ODI COMPLAINTS_RECEIVED 2020-2026 flat files
  corpus agency_safety_openfda_{drug,device,food}_enforcement (openFDA enforcement reports)

Usage: python3 build_state_metrics.py [--dry-run]
"""
import datetime as dt
import io
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import parsers as p  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "state-metrics"
PROFILES, NATIONAL = "state_metrics_profiles", "state_metrics_national"
FDA_DATASETS = {
    "drug": "agency_safety_openfda_drug_enforcement",
    "device": "agency_safety_openfda_device_enforcement",
    "food": "agency_safety_openfda_food_enforcement",
}
MIN_STATES_FOR_RANK = 45  # a year is rankable only when at least this many jurisdictions report a value

SRC = {
    "census2025": {"publisher": "U.S. Census Bureau", "name": "Vintage 2025 state population estimates (NST-EST2025-ALLDATA)",
                   "url": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
                   "page": "https://www.census.gov/programs-surveys/popest.html", "file": "census_nst_est2025_alldata.csv"},
    "census2020": {"publisher": "U.S. Census Bureau", "name": "Vintage 2020 state population estimates (nst-est2020-alldata)",
                   "url": "https://www2.census.gov/programs-surveys/popest/datasets/2010-2020/state/totals/nst-est2020-alldata.csv",
                   "page": "https://www.census.gov/programs-surveys/popest.html", "file": "census_nst_est2020_alldata.csv"},
    "sagdp": {"publisher": "U.S. Bureau of Economic Analysis", "name": "SAGDP1 state annual GDP summary",
              "url": "https://apps.bea.gov/regional/zip/SAGDP.zip", "page": "https://apps.bea.gov/regional/downloadzip.htm", "file": "bea_SAGDP.zip"},
    "sainc": {"publisher": "U.S. Bureau of Economic Analysis", "name": "SAINC1 state annual personal income summary",
              "url": "https://apps.bea.gov/regional/zip/SAINC.zip", "page": "https://apps.bea.gov/regional/downloadzip.htm", "file": "bea_SAINC.zip"},
    "laus": {"publisher": "U.S. Bureau of Labor Statistics", "name": "Local Area Unemployment Statistics, statewide annual averages",
             "url": "https://download.bls.gov/pub/time.series/la/la.data.2.AllStatesU", "page": "https://www.bls.gov/lau/", "file": "bls_la.data.2.AllStatesU.txt"},
    "causes": {"publisher": "CDC National Center for Health Statistics", "name": "NCHS – Leading Causes of Death: United States (bi63-dtpu)",
               "url": "https://data.cdc.gov/api/views/bi63-dtpu/rows.csv?accessType=DOWNLOAD",
               "page": "https://data.cdc.gov/d/bi63-dtpu", "file": "cdc_bi63-dtpu_leading_causes.csv"},
    "vsrr": {"publisher": "CDC National Center for Health Statistics", "name": "VSRR Provisional Drug Overdose Death Counts (xkb8-kh2a)",
             "url": "https://data.cdc.gov/api/views/xkb8-kh2a/rows.csv?accessType=DOWNLOAD",
             "page": "https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm", "file": "cdc_xkb8-kh2a_vsrr_overdose.csv"},
    "fars": {"publisher": "NHTSA National Center for Statistics and Analysis", "name": "Fatality Analysis Reporting System (FARS) national CSV files, accident.csv",
             # url: NHTSA's index of the FARS folder (the bucket folder itself is not listable); exact per-year
             # archive URLs are stored in the metric's sources[0].files.
             "url": p.FARS_LISTING, "page": "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars",
             "file": "fars_<year>_national_csv.zip"},
    "nhtsa": {"publisher": "NHTSA Office of Defects Investigation", "name": "Vehicle safety complaints flat files (COMPLAINTS_RECEIVED_2020-2024, 2025-2026)",
              "url": "https://static.nhtsa.gov/odi/ffdd/cmpl/COMPLAINTS_RECEIVED_2025-2026.zip", "page": "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
              "file": "nhtsa_COMPLAINTS_RECEIVED_2020-2024.zip; nhtsa_COMPLAINTS_RECEIVED_2025-2026.zip"},
    "fda": {"publisher": "U.S. Food and Drug Administration (openFDA)", "name": "Enforcement reports: drug, device and food (corpus mirrors of openFDA)",
            "url": "https://open.fda.gov/apis/drug/enforcement/", "page": "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports",
            "file": "corpus datasets agency_safety_openfda_{drug,device,food}_enforcement"},
}

GROUP_ECON, GROUP_HEALTH, GROUP_SAFETY, GROUP_CAUSES = "Population & economy", "Health & injury", "Product & vehicle safety", "Leading causes of death (1999–2017)"


def metric(key, label, unit, fmt, group, src, method, *, short=None, denominator=None, per=None, higher="neutral",
           selectable=True, caveats=()):
    return {"key": key, "label": label, "short": short or label, "unit": unit, "format": fmt, "group": group, "source": src,
            "method": method, "denominator": denominator, "per": per, "higher": higher, "selectable": selectable,
            "caveats": list(caveats)}


METRICS = [
    metric("population", "Resident population (July 1)", "persons", "int", GROUP_ECON, ["census2020", "census2025"],
           "Census Bureau July 1 resident population estimate. 2010–2019 from Vintage 2020, 2020–2025 from Vintage 2025.",
           short="Population", caveats=["Two estimate vintages are joined at 2020; the 2010s are not the intercensal revision."]),
    metric("gdp", "GDP, current dollars", "$ millions", "money_m", GROUP_ECON, ["sagdp"],
           "BEA SAGDP1 line 3, current-dollar GDP (millions of current dollars).", short="GDP"),
    metric("real_gdp", "Real GDP, chained 2017 dollars", "$ millions (2017)", "money_m", GROUP_ECON, ["sagdp"],
           "BEA SAGDP1 line 1, real GDP (millions of chained 2017 dollars).", short="Real GDP"),
    metric("gdp_per_capita", "GDP per resident", "$ per resident", "dollars", GROUP_ECON, ["sagdp", "census2020", "census2025"],
           "Computed: BEA current-dollar GDP ÷ Census same-year July 1 population.", short="GDP / resident",
           denominator="population", per=1, higher="better"),
    metric("personal_income", "Personal income", "$ millions", "money_m", GROUP_ECON, ["sainc"],
           "BEA SAINC1 line 1, personal income (millions of dollars).", short="Personal income"),
    metric("per_capita_income", "Per capita personal income", "$", "dollars", GROUP_ECON, ["sainc"],
           "BEA SAINC1 line 3, per capita personal income as published by BEA (BEA's own midyear population).",
           short="Income / capita", higher="better"),
    metric("unemployment_rate", "Unemployment rate (annual average)", "%", "pct", GROUP_ECON, ["laus"],
           "BLS LAUS statewide series LAUST<SS>0000000000003, not seasonally adjusted, annual average (M13).",
           short="Unemployment", higher="worse"),
    metric("labor_force", "Civilian labor force (annual average)", "persons", "int", GROUP_ECON, ["laus"],
           "BLS LAUS statewide series LAUST<SS>0000000000006, annual average (M13).", short="Labor force", selectable=False),
    metric("overdose_deaths", "Drug overdose deaths", "deaths", "int", GROUP_HEALTH, ["vsrr"],
           "CDC VSRR reported 12-month-ending count for the December period (= calendar year), by jurisdiction of occurrence. "
           "New York State = CDC's New York (excl. NYC) + New York City rows.", short="Overdose deaths", higher="worse",
           caveats=["Provisional counts; CDC notes they may differ from final data.", "Reported (not predicted) values are used."]),
    metric("overdose_rate", "Drug overdose deaths per 100,000", "per 100k", "rate", GROUP_HEALTH, ["vsrr", "census2020", "census2025"],
           "Computed crude rate: CDC VSRR calendar-year count ÷ Census same-year population × 100,000 (not age-adjusted).",
           short="Overdose / 100k", denominator="population", per=100000, higher="worse"),
    metric("opioid_deaths", "Opioid overdose deaths (T40.0–T40.4, T40.6)", "deaths", "int", GROUP_HEALTH, ["vsrr"],
           "CDC VSRR indicator 'Opioids (T40.0-T40.4,T40.6)', December 12-month-ending reported count.", short="Opioid deaths",
           higher="worse", caveats=["Suppressed by CDC where the share of records with drugs specified is too low."]),
    metric("opioid_rate", "Opioid overdose deaths per 100,000", "per 100k", "rate", GROUP_HEALTH, ["vsrr", "census2020", "census2025"],
           "Computed crude rate from the opioid count and Census same-year population.", short="Opioid / 100k",
           denominator="population", per=100000, higher="worse"),
    metric("synthetic_opioid_deaths", "Synthetic opioid deaths excl. methadone (T40.4, mainly fentanyl)", "deaths", "int", GROUP_HEALTH, ["vsrr"],
           "CDC VSRR indicator 'Synthetic opioids, excl. methadone (T40.4)', December 12-month-ending reported count.",
           short="Synthetic opioid deaths", higher="worse"),
    metric("synthetic_opioid_rate", "Synthetic opioid deaths per 100,000", "per 100k", "rate", GROUP_HEALTH, ["vsrr", "census2020", "census2025"],
           "Computed crude rate from the T40.4 count and Census same-year population.", short="Synthetic opioid / 100k",
           denominator="population", per=100000, higher="worse"),
    metric("psychostimulant_deaths", "Psychostimulant deaths (T43.6, mainly methamphetamine)", "deaths", "int", GROUP_HEALTH, ["vsrr"],
           "CDC VSRR indicator 'Psychostimulants with abuse potential (T43.6)', December 12-month-ending reported count.",
           short="Psychostimulant deaths", higher="worse", selectable=False),
    metric("psychostimulant_rate", "Psychostimulant deaths per 100,000", "per 100k", "rate", GROUP_HEALTH, ["vsrr", "census2020", "census2025"],
           "Computed crude rate from the T43.6 count and Census same-year population.", short="Psychostimulant / 100k",
           denominator="population", per=100000, higher="worse"),
    metric("fars_fatalities", "Motor-vehicle traffic fatalities", "deaths", "int", GROUP_HEALTH, ["fars"],
           "Sum of FATALS in FARS accident.csv by crash STATE. 2014–2023 final files; 2024 is the Annual Report File (ARF).",
           short="Traffic deaths", higher="worse", caveats=["2024 counts may be revised when the FARS 2024 final file is released."]),
    metric("fars_rate", "Traffic fatalities per 100,000", "per 100k", "rate", GROUP_HEALTH, ["fars", "census2020", "census2025"],
           "Computed: FARS fatalities ÷ Census same-year population × 100,000.", short="Traffic deaths / 100k",
           denominator="population", per=100000, higher="worse"),
    metric("nhtsa_complaints", "NHTSA vehicle safety complaints", "complaints", "int", GROUP_SAFETY, ["nhtsa"],
           "Unique ODI complaint numbers (ODINO) by the consumer's STATE field and year received by NHTSA (LDATE).",
           short="Vehicle complaints", higher="neutral",
           caveats=["Consumer state of residence as entered, not necessarily where the incident occurred.", "Latest year is partial."]),
    metric("nhtsa_complaint_rate", "NHTSA vehicle complaints per 100,000", "per 100k", "rate", GROUP_SAFETY, ["nhtsa", "census2020", "census2025"],
           "Computed: unique complaints ÷ Census same-year population × 100,000.", short="Vehicle complaints / 100k",
           denominator="population", per=100000),
    metric("nhtsa_crash_complaints", "NHTSA complaints reporting a crash", "complaints", "int", GROUP_SAFETY, ["nhtsa"],
           "Unique complaints with CRASH = 'Y', by consumer STATE and year received.", short="Crash complaints", selectable=False),
    metric("fda_recalls", "FDA enforcement-report entries (drug + device + food)", "entries", "int", GROUP_SAFETY, ["fda"],
           "Count of openFDA enforcement-report product entries by the recalling firm's state and report_date year.",
           short="FDA recall entries",
           caveats=["Recalling-firm headquarters state — not where products were distributed or consumers were exposed.",
                    "Each product (recall number) is one entry; one recall event can list many products.", "Latest year is partial."]),
    metric("fda_recall_rate", "FDA enforcement entries per 1 million residents", "per 1M", "rate", GROUP_SAFETY, ["fda", "census2020", "census2025"],
           "Computed: enforcement entries ÷ Census same-year population × 1,000,000.", short="FDA entries / 1M",
           denominator="population", per=1000000),
    metric("fda_drug_recalls", "FDA drug enforcement entries", "entries", "int", GROUP_SAFETY, ["fda"],
           "openFDA drug enforcement entries by recalling-firm state and report_date year.", short="Drug recall entries"),
    metric("fda_device_recalls", "FDA device enforcement entries", "entries", "int", GROUP_SAFETY, ["fda"],
           "openFDA device enforcement entries by recalling-firm state and report_date year.", short="Device recall entries"),
    metric("fda_food_recalls", "FDA food enforcement entries", "entries", "int", GROUP_SAFETY, ["fda"],
           "openFDA food enforcement entries by recalling-firm state and report_date year.", short="Food recall entries"),
    metric("fda_class1_recalls", "FDA Class I enforcement entries (all product types)", "entries", "int", GROUP_SAFETY, ["fda"],
           "Entries classified Class I (reasonable probability of serious adverse health consequences or death).",
           short="Class I entries"),
]
CAUSE_ORDER = ["all_causes", "heart_disease", "cancer", "unintentional_injuries", "clrd", "stroke", "alzheimers_disease",
               "diabetes", "influenza_and_pneumonia", "kidney_disease", "suicide"]


def read(name):
    return (ACQ / name).read_bytes()


def manifest():
    return json.loads((ACQ / "manifest.json").read_text())


def merge(*dicts):
    out = {}
    for d in dicts:
        for key, years in d.items():
            out.setdefault(key, {}).update(years)
    return out


def fda_rows():
    """Snapshot the three openFDA enforcement corpus datasets (state, report_date, class, country only)."""
    snapshot = ACQ / "fda_enforcement_corpus_snapshot.json"
    if snapshot.exists() and "--refresh-fda" not in sys.argv:
        return json.loads(snapshot.read_text())
    out = {"retrieved": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "datasets": {}}
    for kind, dataset in FDA_DATASETS.items():
        rows = cw.fetch_all(dataset, select="id,state,report_date:item->dates->>report_date,classification:item->>classification,country:item->>country")
        out["datasets"][kind] = {"dataset": dataset, "count": len(rows), "rows": rows}
        print(f"fda {kind}: {len(rows)} rows")
    snapshot.write_text(json.dumps(out))
    return out


def complaints():
    counts, crash, max_date = {}, {}, ""
    for name in ("nhtsa_COMPLAINTS_RECEIVED_2020-2024.zip", "nhtsa_COMPLAINTS_RECEIVED_2025-2026.zip"):
        with zipfile.ZipFile(ACQ / name) as archive:
            inner = next(n for n in archive.namelist() if n.lower().endswith(".txt"))
            with archive.open(inner) as handle:
                c, k, m = p.nhtsa_complaints(io.TextIOWrapper(handle, encoding="latin-1", newline=""))
        counts, crash, max_date = merge(counts, c), merge(crash, k), max(max_date, m)
    return counts, crash, max_date


def load():
    """Parse every source into {metric: {key: {year: value}}} plus notes and metadata."""
    data, notes, meta = {}, {}, {}
    pop_a = p.census_population(read("census_nst_est2020_alldata.csv").decode("latin-1"), 2010, 2019)
    pop_b = p.census_population(read("census_nst_est2025_alldata.csv").decode("latin-1"), 2020, 2025)
    data["population"] = merge(pop_a, pop_b)
    sagdp, sainc = read("bea_SAGDP.zip"), read("bea_SAINC.zip")
    data["gdp"], meta["gdp"] = p.bea_table(sagdp, "SAGDP1", 3)
    data["real_gdp"], meta["real_gdp"] = p.bea_table(sagdp, "SAGDP1", 1)
    data["personal_income"], meta["personal_income"] = p.bea_table(sainc, "SAINC1", 1)
    data["per_capita_income"], meta["per_capita_income"] = p.bea_table(sainc, "SAINC1", 3)
    laus = read("bls_la.data.2.AllStatesU.txt").decode("latin-1")
    data["unemployment_rate"] = p.laus_annual(laus, "03")
    data["labor_force"] = p.laus_annual(laus, "06")
    vsrr = read("cdc_xkb8-kh2a_vsrr_overdose.csv").decode("utf-8")
    latest12 = {}
    for key, indicator in [("overdose_deaths", "Number of Drug Overdose Deaths"), ("opioid_deaths", "Opioids (T40.0-T40.4,T40.6)"),
                           ("synthetic_opioid_deaths", "Synthetic opioids, excl. methadone (T40.4)"),
                           ("psychostimulant_deaths", "Psychostimulants with abuse potential (T43.6)")]:
        data[key], notes[key], latest12[key] = p.vsrr(vsrr, indicator)
    fars, fars_files = {}, {}
    for year in range(2014, 2025):
        totals, _, inner = p.fars_fatalities(read(f"fars_{year}_national_csv.zip"))
        fars_files[year] = inner
        for key, value in totals.items():
            fars.setdefault(key, {})[year] = value
    fars[p.US] = {y: sum(fars[k].get(y, 0) for k in p.BY_USPS if k in fars) for y in range(2014, 2025)}
    data["fars_fatalities"], meta["fars_files"] = fars, fars_files
    counts, crash, max_date = complaints()
    for d in (counts, crash):
        d[p.US] = {}
        for key in p.BY_USPS:
            for year, value in d.get(key, {}).items():
                d[p.US][year] = d[p.US].get(year, 0) + value
    data["nhtsa_complaints"], data["nhtsa_crash_complaints"], meta["nhtsa_max_date"] = counts, crash, max_date
    fda = fda_rows()
    totals, class1 = {}, {}
    max_report = ""
    for kind, block in fda["datasets"].items():
        total, c1 = p.fda_enforcement(block["rows"])
        data[f"fda_{kind}_recalls"] = total
        totals, class1 = merge_add(totals, total), merge_add(class1, c1)
        max_report = max([max_report] + [r.get("report_date") or "" for r in block["rows"]])
    data["fda_recalls"], data["fda_class1_recalls"] = totals, class1
    meta["fda"] = {"retrieved": fda["retrieved"], "max_report_date": max_report,
                   "counts": {k: v["count"] for k, v in fda["datasets"].items()}}
    # The corpus mirrors the complete openFDA enforcement files (2012 onward), so a state with no entries in a
    # covered year has a true count of 0; years outside coverage stay absent.
    fda_years = range(2012, int(max_report[:4]) + 1)
    for key in ("fda_recalls", "fda_class1_recalls", "fda_drug_recalls", "fda_device_recalls", "fda_food_recalls"):
        data[key] = {k: {y: v for y, v in years.items() if y >= 2012} for k, years in data[key].items()}
        zero_fill(data[key], fda_years)
        data[key][p.US] = sum_states(data[key])
    # Complaint files cover every complaint received 2020 onward: absent state-years are true zeros.
    nhtsa_years = range(2020, int(max_date[:4]) + 1)
    for key in ("nhtsa_complaints", "nhtsa_crash_complaints"):
        zero_fill(data[key], nhtsa_years)
        data[key][p.US] = sum_states(data[key])
    causes = p.leading_causes(read("cdc_bi63-dtpu_leading_causes.csv").decode("utf-8"))
    return data, notes, meta, latest12, causes


def zero_fill(d, years):
    for key in p.BY_USPS:
        series = d.setdefault(key, {})
        for year in years:
            series.setdefault(year, 0)


def merge_add(a, b):
    out = {k: dict(v) for k, v in a.items()}
    for key, years in b.items():
        for year, value in years.items():
            out.setdefault(key, {})[year] = out.get(key, {}).get(year, 0) + value
    return out


def sum_states(d):
    out = {}
    for key in p.BY_USPS:
        for year, value in d.get(key, {}).items():
            out[year] = out.get(year, 0) + value
    return out


def derive(data):
    pop = data["population"]
    keys = list(p.BY_USPS) + [p.US]
    pairs = [("gdp_per_capita", "gdp", 1_000_000), ("overdose_rate", "overdose_deaths", 100_000),
             ("opioid_rate", "opioid_deaths", 100_000), ("synthetic_opioid_rate", "synthetic_opioid_deaths", 100_000),
             ("psychostimulant_rate", "psychostimulant_deaths", 100_000), ("fars_rate", "fars_fatalities", 100_000),
             ("nhtsa_complaint_rate", "nhtsa_complaints", 100_000), ("fda_recall_rate", "fda_recalls", 1_000_000)]
    for target, source, per in pairs:
        # GDP is in millions of dollars: value * 1e6 / pop = dollars per resident, rounded once to whole dollars.
        digits = 0 if target == "gdp_per_capita" else 2
        data[target] = {k: p.per_capita(data[source].get(k, {}), pop.get(k, {}), per, digits) for k in keys}


# Derived rate -> the count it is computed from; the rate inherits the count's caveats, footnotes and flags.
NUMERATOR = {"overdose_rate": "overdose_deaths", "opioid_rate": "opioid_deaths",
             "synthetic_opioid_rate": "synthetic_opioid_deaths", "psychostimulant_rate": "psychostimulant_deaths",
             "fars_rate": "fars_fatalities", "nhtsa_complaint_rate": "nhtsa_complaints", "fda_recall_rate": "fda_recalls",
             "gdp_per_capita": "gdp"}
VSRR_COUNTS = ("overdose_deaths", "opioid_deaths", "synthetic_opioid_deaths", "psychostimulant_deaths")
RATE_CAVEATS = {
    "vsrr": "Occurrence-based provisional death counts ÷ resident population: this differs from CDC's residence-based, "
            "age-adjusted rates, most of all in the District of Columbia, where many deaths of non-residents occur.",
    "fars_rate": "Fatalities are counted where the crash occurred (any residence) ÷ resident population.",
}


def add_causes(causes):
    """Register leading-cause metrics (age-adjusted rate + deaths) and return their data."""
    data = {}
    for slug in CAUSE_ORDER + sorted(set(causes) - set(CAUSE_ORDER)):
        if slug not in causes:
            continue
        cause = causes[slug]
        label = cause["name"]
        METRICS.append(metric(f"cause_{slug}_rate", f"{label}: age-adjusted death rate", "per 100k (age-adjusted)", "rate",
                              GROUP_CAUSES, ["causes"], f"NCHS age-adjusted death rate per 100,000, cause '{cause['code']}'.",
                              short=f"{label} (age-adj.)", higher="worse"))
        METRICS.append(metric(f"cause_{slug}_deaths", f"{label}: deaths", "deaths", "int", GROUP_CAUSES, ["causes"],
                              f"NCHS number of deaths, cause '{cause['code']}'.", short=f"{label} deaths", selectable=False))
        data[f"cause_{slug}_rate"], data[f"cause_{slug}_deaths"] = cause["rate"], cause["deaths"]
    return data


def years_of(series_by_key):
    return sorted({y for k, s in series_by_key.items() if k != p.US for y in s})


def rankable_years(series_by_key):
    counts = {}
    for key, s in series_by_key.items():
        if key == p.US:
            continue
        for year in s:
            counts[year] = counts.get(year, 0) + 1
    return sorted(y for y, n in counts.items() if n >= MIN_STATES_FOR_RANK)


def distribution(series_by_key, year):
    vals = [(k, s[year]) for k, s in series_by_key.items() if k != p.US and s.get(year) is not None]
    if not vals:
        return None
    numbers = [v for _, v in vals]
    lo, hi = min(vals, key=lambda kv: kv[1]), max(vals, key=lambda kv: kv[1])
    r = lambda x: round(x, 2) if isinstance(x, float) else x  # noqa: E731
    return {"n": len(vals), "mean": r(sum(numbers) / len(numbers)), "median": r(p.median(numbers)),
            "p25": r(p.quantile(numbers, 0.25)), "p75": r(p.quantile(numbers, 0.75)),
            "min": {"state": lo[0], "value": lo[1]}, "max": {"state": hi[0], "value": hi[1]}}


def fmt(value, kind):
    if value is None:
        return "Not recorded"
    if kind == "money_m":
        return f"${value:,.0f}M"
    if kind == "dollars":
        return f"${value:,.0f}"
    if kind == "pct":
        return f"{value:.1f}%"
    if kind == "rate":
        return f"{value:,.1f}"
    return f"{value:,.0f}"


def main():
    dry = "--dry-run" in sys.argv
    data, notes, meta, latest12, causes = load()
    derive(data)
    data.update(add_causes(causes))
    files = manifest()
    today = dt.date.today().isoformat()
    defs = {m["key"]: m for m in METRICS}
    partial = {"nhtsa_complaints": {2026: f"Received through {meta['nhtsa_max_date'][:4]}-{meta['nhtsa_max_date'][4:6]}-{meta['nhtsa_max_date'][6:]}"},
               "nhtsa_crash_complaints": {2026: "Partial year"},
               "fda_recalls": {int(meta['fda']['max_report_date'][:4]): f"Reports through {meta['fda']['max_report_date']}"}}
    for key in ("fda_drug_recalls", "fda_device_recalls", "fda_food_recalls", "fda_class1_recalls"):
        partial[key] = partial["fda_recalls"]
    provisional = {key: "CDC provisional counts (VSRR)" for key in VSRR_COUNTS}
    provisional["fars_fatalities"] = {2024: "FARS 2024 Annual Report File"}
    for rate, count in NUMERATOR.items():
        if count in provisional:
            provisional[rate] = provisional[count]
    vsrr_caveats = ["Provisional counts; CDC notes they may differ from final data.", "Reported (not predicted) values are used.",
                    "Suppressed by CDC where the share of records with drugs specified is too low."]
    for key in VSRR_COUNTS:
        defs[key]["caveats"] = vsrr_caveats + [c for c in defs[key]["caveats"] if c not in vsrr_caveats]
    if "overdose_deaths" in defs:  # the all-drug total is not subject to the drug-specified suppression
        defs["overdose_deaths"]["caveats"] = [c for c in defs["overdose_deaths"]["caveats"] if not c.startswith("Suppressed")]
    # Rates inherit their numerator's caveats (except partial-year notes: rates stop at the last population year).
    for m in METRICS:
        count = NUMERATOR.get(m["key"])
        if count:
            inherited = [c for c in defs[count]["caveats"] if "partial" not in c.lower() and c not in m["caveats"]]
            m["caveats"] = inherited + m["caveats"]
        if m["key"] in ("overdose_rate", "opioid_rate", "synthetic_opioid_rate", "psychostimulant_rate"):
            m["caveats"].append(RATE_CAVEATS["vsrr"])
        if m["key"] == "fars_rate":
            m["caveats"].append(RATE_CAVEATS["fars_rate"])
    # CDC cell footnotes on a count apply equally to the rate computed from it.
    for rate, count in NUMERATOR.items():
        if count in notes:
            notes[rate] = notes[count]

    for m in METRICS:
        series = data[m["key"]]
        all_years = years_of(series)
        rankable = [y for y in rankable_years(series) if y not in partial.get(m["key"], {})]
        m["years"] = [all_years[0], all_years[-1]] if all_years else None
        m["rank_years"] = rankable
        m["latest_year"] = rankable[-1] if rankable else None
        m["partial_years"] = {str(y): note for y, note in partial.get(m["key"], {}).items()}
        if m["key"].startswith("fda_"):
            m["caveats"].append(f"Counted from the corpus snapshot of {meta['fda']['retrieved'][:10]} (enforcement reports through "
                                f"{meta['fda']['max_report_date']}); 2012–2025 state-year counts match the openFDA API on spot checks.")
        if m["key"].startswith("nhtsa_"):
            m["caveats"].append(f"Flat files retrieved {files['nhtsa_COMPLAINTS_RECEIVED_2025-2026.zip']['retrieved'][:10]}; "
                                f"complaints received through {partial['nhtsa_complaints'][2026][-10:]}.")

    # ---------------------------------------------------------------- profiles
    profile_rows = []
    latest_rank = {}
    for m in METRICS:
        year = m["latest_year"]
        if year is None:
            continue
        values = {k: data[m["key"]].get(k, {}).get(year) for k in p.BY_USPS}
        latest_rank[m["key"]] = (year, p.ranks_and_z(values), sum(v is not None for v in values.values()))
    for fips, usps, name in p.STATES:
        series = {m["key"]: {str(y): v for y, v in sorted(data[m["key"]].get(usps, {}).items())} for m in METRICS}
        series = {k: v for k, v in series.items() if v}
        latest = {}
        for m in METRICS:
            if m["key"] not in latest_rank:
                continue
            year, ranks, n = latest_rank[m["key"]]
            value = data[m["key"]].get(usps, {}).get(year)
            rank, z = ranks.get(usps, (None, None))
            latest[m["key"]] = {"year": year, "value": value, "rank": rank, "of": n, "z": z,
                                # Percent metrics change in percentage points; everything else in relative %.
                                "change5": (p.change_points if m["format"] == "pct" else p.change_pct)(data[m["key"]].get(usps, {}), year),
                                "change5_unit": "pts" if m["format"] == "pct" else "%",
                                "outlier": None if z is None or abs(z) <= 2 else ("high" if z > 0 else "low")}
        state_notes = {k: {str(y): t for y, t in v.get(usps, {}).items()} for k, v in notes.items() if v.get(usps)}
        twelve = {k: v.get(usps) for k, v in latest12.items() if v.get(usps)}
        profile = {"usps": usps, "fips": fips, "name": name, "series": series, "latest": latest, "notes": state_notes,
                   "overdose_12mo": twelve, "as_of": today}
        L = lambda key: latest.get(key, {})  # noqa: E731
        facts = [["State", f"{name} ({usps}, FIPS {fips})"]]
        for key in ("population", "gdp", "gdp_per_capita", "per_capita_income", "unemployment_rate", "overdose_rate",
                    "synthetic_opioid_rate", "fars_rate", "nhtsa_complaint_rate", "fda_recalls"):
            item = L(key)
            if item:
                rank = f" · rank {item['rank']} of {item['of']}" if item.get("rank") else ""
                facts.append([f"{defs[key]['label']} ({item['year']})", fmt(item["value"], defs[key]["format"]) + rank])
        facts.append(["Sources", "; ".join(sorted({SRC[s]['publisher'] for m in METRICS for s in m['source']}))])
        links = [{"url": f"/places/{usps}", "label": f"{name} state page"}, {"url": "/places/analytics", "label": "State analytics"}]
        links += [{"url": SRC[s]["url"], "label": SRC[s]["name"]} for s in SRC if s != "fars"]
        links.append({"url": SRC["fars"]["page"], "label": SRC["fars"]["name"]})
        cells = {"state": name, "population": fmt(L("population").get("value"), "int"),
                 "gdp_per_capita": fmt(L("gdp_per_capita").get("value"), "dollars"),
                 "unemployment": fmt(L("unemployment_rate").get("value"), "pct"),
                 "overdose_rate": fmt(L("overdose_rate").get("value"), "rate"),
                 "fars_rate": fmt(L("fars_rate").get("value"), "rate")}
        # Raw totals (counts, dollar amounts) mostly track population size; only normalised metrics are flagged.
        outliers = sorted(k for k, v in latest.items()
                          if v.get("outlier") and defs[k]["selectable"] and defs[k]["format"] not in ("int", "money_m"))
        profile_rows.append(cw.record(
            PROFILES, usps, name, source_url=SRC["census2025"]["url"],
            subtitle=f"{len(series)} official series · population {cells['population']} ({L('population').get('year', '')})",
            cells=cells, facts=facts, text=f"{name} {usps} state metrics population GDP income unemployment overdose traffic fatalities recalls",
            filters={"region": [usps.lower()], "outliers": ["yes" if outliers else "no"]}, state=usps, links=links,
            badges=[{"label": f"{len(outliers)} outlier metrics", "tone": "warning"}] if outliers else [],
            extra={"kind": "state_metrics_profile", "profile": profile},
        ))

    # ---------------------------------------------------------------- national metric records
    national_rows = []
    for order, m in enumerate(METRICS):
        series = data[m["key"]]
        us = series.get(p.US, {})
        us_basis = "official national total" if m["source"][0] in ("census2020", "sagdp", "sainc", "vsrr", "causes") else (
            "sum of the 50 states + DC" if m["key"] in ("fars_fatalities", "nhtsa_complaints", "nhtsa_crash_complaints") or m["key"].startswith("fda_") and "rate" not in m["key"] else None)
        if m["denominator"]:
            us_basis = "computed from the national numerator and national population"
        if m["key"] in ("unemployment_rate", "labor_force"):
            us, us_basis = {}, None  # the national CPS rate is a different series; not mixed in
        dist = {str(y): distribution(series, y) for y in years_of(series)}
        sources = []
        for s in m["source"]:
            entry = {**SRC[s]}
            local = files.get(SRC[s]["file"])
            if local:
                entry.update({"retrieved": local["retrieved"], "sha256": local["sha256"], "bytes": local["bytes"]})
            sources.append(entry)
        if m["key"].startswith("fda_"):
            sources[0] = {**sources[0], "retrieved": meta["fda"]["retrieved"], "corpus_counts": meta["fda"]["counts"],
                          "max_report_date": meta["fda"]["max_report_date"]}
        if m["key"] in ("fars_fatalities", "fars_rate"):
            sources[0] = {**sources[0], "files": {str(y): {"url": p.fars_national_csv_url(y),
                                                           "member": meta["fars_files"][y],
                                                           "sha256": files.get(f"fars_{y}_national_csv.zip", {}).get("sha256")}
                                                   for y in sorted(meta["fars_files"])}}
        if m["key"] in meta and isinstance(meta[m["key"]], dict) and meta[m["key"]].get("file"):
            sources[0] = {**sources[0], "table_file": meta[m["key"]]["file"], "table_updated": meta[m["key"]]["updated"],
                          "line_description": meta[m["key"]]["description"]}
        definition = {**m, "national": {str(y): v for y, v in sorted(us.items())}, "national_basis": us_basis,
                      "distribution": dist, "sources": sources, "order": order,
                      "provisional": provisional.get(m["key"]) if isinstance(provisional.get(m["key"]), str) else
                      {str(k): v for k, v in (provisional.get(m["key"]) or {}).items()}}
        del definition["source"]
        latest = m["latest_year"]
        d_latest = dist.get(str(latest)) if latest else None
        primary = sources[0]
        national_rows.append(cw.record(
            NATIONAL, m["key"], m["label"], source_url=primary.get("page") or primary["url"],
            subtitle=f"{m['group']} · {m['unit']} · {m['years'][0]}–{m['years'][1]}" if m["years"] else m["group"],
            cells={"metric": m["label"], "group": m["group"], "unit": m["unit"],
                   "years": f"{m['years'][0]}–{m['years'][1]}" if m["years"] else "Not recorded",
                   "latest_median": fmt(d_latest["median"], m["format"]) if d_latest else "Not recorded",
                   "source": primary["publisher"]},
            facts=[["Definition", m["method"]], ["Unit", m["unit"]], ["Group", m["group"]],
                   ["Years", f"{m['years'][0]}–{m['years'][1]}" if m["years"] else "Not recorded"],
                   ["Latest ranked year", str(latest) if latest else "Not recorded"],
                   ["State median (latest)", fmt(d_latest["median"], m["format"]) if d_latest else "Not recorded"],
                   ["Sources", "; ".join(f"{s['publisher']}: {s['name']}" for s in sources)],
                   *([["Caveats", " ".join(m["caveats"])]] if m["caveats"] else [])],
            text=f"{m['label']} {m['group']} {m['method']}",
            filters={"group": [m["group"].lower()], "selectable": ["yes" if m["selectable"] else "no"]},
            links=[{"url": s["url"], "label": s["name"]} for s in sources] + [{"url": "/places/analytics", "label": "State analytics"}],
            extra={"kind": "state_metric_definition", "metric": definition},
        ))

    summary = {"generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "states": len(profile_rows),
               "metrics": len(METRICS), "sources": {k: {**v, **({kk: files[v['file']][kk] for kk in ('retrieved', 'sha256')} if v['file'] in files else {})}
                                                  for k, v in SRC.items()},
               "rank_rule": f"Ranks and z-scores use the latest year in which at least {MIN_STATES_FOR_RANK} of 51 jurisdictions report a value; partial years are never ranked.",
               "outlier_rule": "Flagged when |z| > 2 (population standard deviation across the 50 states + DC).",
               "fda": meta["fda"], "nhtsa_received_through": meta["nhtsa_max_date"]}
    if dry:
        (ROOT / "private" / "scratch" / "state-metrics" / "dry_profiles.json").write_text(json.dumps(profile_rows[:3], indent=1, default=str))
        (ROOT / "private" / "scratch" / "state-metrics" / "dry_national.json").write_text(json.dumps(national_rows, indent=1, default=str))
        print(json.dumps(summary, indent=1)[:3000])
        print("profiles", len(profile_rows), "national", len(national_rows),
              "bytes", len(json.dumps(profile_rows)), len(json.dumps(national_rows)))
        return
    cw.publish(PROFILES, "State metrics profiles", profile_rows,
               listing_block=cw.listing([("state", "State"), ("population", "Population"), ("gdp_per_capita", "GDP / resident"),
                                         ("unemployment", "Unemployment"), ("overdose_rate", "Overdose / 100k"), ("fars_rate", "Traffic deaths / 100k")],
                                        [("outliers", "Outlier flags", {"yes": "Has outlier metrics", "no": "No outliers"})]),
               summary=summary)
    cw.publish(NATIONAL, "State metrics: national series and definitions", national_rows,
               listing_block=cw.listing([("metric", "Metric"), ("group", "Group"), ("unit", "Unit"), ("years", "Years"),
                                         ("latest_median", "State median (latest)"), ("source", "Source")],
                                        [("group", "Group", {g.lower(): g for g in (GROUP_ECON, GROUP_HEALTH, GROUP_SAFETY, GROUP_CAUSES)})]),
               summary=summary)


if __name__ == "__main__":
    main()
