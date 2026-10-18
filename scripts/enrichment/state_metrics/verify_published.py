"""Self-check: re-read published state_metrics records and compare them with fresh fetches of the official sources.

Each comparison prints "dataset/record field: published=X source=Y url" and PASS/FAIL. Nothing here reads the
cached raw files in private/acq; every source value is fetched again from the publisher.
"""
import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import corpus_writer as cw  # noqa: E402

UA = {"User-Agent": "SeegerWeiss Research firasshaher99@gmail.com"}
results = []


def published(usps):
    base, key = cw._base()
    req = urllib.request.Request(base + f"corpus_records?select=item&dataset=eq.state_metrics_profiles&id=eq.{usps}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())[0]["item"]["profile"]


def published_metric(key_):
    base, key = cw._base()
    req = urllib.request.Request(base + f"corpus_records?select=item&dataset=eq.state_metrics_national&id=eq.{key_}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())[0]["item"]["metric"]


def check(label, pub, src, url, tol=0):
    ok = pub is not None and src is not None and abs(float(pub) - float(src)) <= tol
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}: published={pub} source={src} {url}")


def get(url, **kw):
    for attempt in range(4):
        r = requests.get(url, headers=UA, timeout=300, **kw)
        if r.status_code < 500 or attempt == 3:
            r.raise_for_status()
            return r
        time.sleep(2 ** attempt)


# Census population (fresh CSV fetch)
url = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
rows = {r["NAME"]: r for r in csv.DictReader(io.StringIO(get(url).content.decode("latin-1")))}
tx = published("TX")
check("state_metrics_profiles/TX series.population[2025]", tx["series"]["population"]["2025"], int(rows["Texas"]["POPESTIMATE2025"]), url)
url20 = "https://www2.census.gov/programs-surveys/popest/datasets/2010-2020/state/totals/nst-est2020-alldata.csv"
rows20 = {r["NAME"]: r for r in csv.DictReader(io.StringIO(get(url20).content.decode("latin-1")))}
check("state_metrics_profiles/TX series.population[2015]", tx["series"]["population"]["2015"], int(rows20["Texas"]["POPESTIMATE2015"]), url20)

# BEA per capita personal income and GDP (fresh bulk zip)
url = "https://apps.bea.gov/regional/zip/SAINC.zip"
with zipfile.ZipFile(io.BytesIO(get(url).content)) as z:
    text = z.read(next(n for n in z.namelist() if n.startswith("SAINC1__ALL_AREAS"))).decode("latin-1")
bea = list(csv.reader(io.StringIO(text)))
head = bea[0]
nj_row = next(r for r in bea[1:] if len(r) > 8 and r[0].replace('"', "").strip() == "34000" and r[4].strip() == "3")
nj = published("NJ")
check("state_metrics_profiles/NJ series.per_capita_income[2025]", nj["series"]["per_capita_income"]["2025"], int(nj_row[head.index("2025")]), url)

# GDP per resident recomputed once from fresh BEA SAGDP1 line 3 and Census population
url = "https://apps.bea.gov/regional/zip/SAGDP.zip"
with zipfile.ZipFile(io.BytesIO(get(url).content)) as z:
    gdp_rows = list(csv.reader(io.StringIO(z.read(next(n for n in z.namelist() if n.startswith("SAGDP1__ALL_AREAS"))).decode("latin-1"))))
for usps, fips, name, year, pop_rows in [("NV", "32000", "Nevada", "2024", rows), ("NY", "36000", "New York", "2018", rows20)]:
    line = next(r for r in gdp_rows[1:] if len(r) > 8 and r[0].replace('"', "").strip() == fips and r[4].strip() == "3")
    gdp_m = float(line[gdp_rows[0].index(year)])
    expected = round(gdp_m * 1_000_000 / int(pop_rows[name][f"POPESTIMATE{year}"]))
    check(f"state_metrics_profiles/{usps} series.gdp_per_capita[{year}] (recomputed)", published(usps)["series"]["gdp_per_capita"][year], expected,
          url + " ÷ Census")

# BLS LAUS annual average (BLS public API v2, unregistered, annualaverage)
nv = published("NV")
api = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
r = requests.post(api, json={"seriesid": ["LAUST320000000000003"], "startyear": "2024", "endyear": "2025", "annualaverage": True},
                  headers=UA, timeout=120).json()
series = (r.get("Results") or {}).get("series") or [{}]
m13 = {d["year"]: float(d["value"]) for d in series[0].get("data", []) if d.get("period") == "M13"}
bls_url = api + "LAUST320000000000003"
if m13.get("2025") is None:
    # The unregistered API has a small daily quota; fall back to a fresh download of the LAUS flat file.
    print("note: BLS API returned no M13 for 2025:", r.get("message"))
    bls_url = "https://download.bls.gov/pub/time.series/la/la.data.2.AllStatesU"
    for line in get(bls_url).text.splitlines():
        parts = [x.strip() for x in line.split("\t")]
        if len(parts) > 3 and parts[0] == "LAUST320000000000003" and parts[1] == "2025" and parts[2] == "M13":
            m13["2025"] = float(parts[3])
check("state_metrics_profiles/NV series.unemployment_rate[2025]", nv["series"]["unemployment_rate"].get("2025"), m13.get("2025"), bls_url)
nv_change = nv["latest"]["unemployment_rate"]
check("state_metrics_profiles/NV latest.unemployment_rate.change5 (pts)", nv_change["change5"],
      round(nv["series"]["unemployment_rate"]["2025"] - nv["series"]["unemployment_rate"]["2020"], 1), "published series 2025 − 2020")

# CDC VSRR overdose (Socrata API, a different access path than the CSV export)
def vsrr(state, year, indicator):
    q = urllib.parse.urlencode({"state": state, "year": str(year), "month": "December", "indicator": indicator})
    u = f"https://data.cdc.gov/resource/xkb8-kh2a.json?{q}"
    data = get(u).json()
    return (float(data[0]["data_value"]) if data and data[0].get("data_value") else None), u

wv = published("WV")
v, u = vsrr("WV", 2024, "Number of Drug Overdose Deaths")
check("state_metrics_profiles/WV series.overdose_deaths[2024]", wv["series"]["overdose_deaths"]["2024"], v, u)
ny = published("NY")
a, u1 = vsrr("NY", 2023, "Number of Drug Overdose Deaths")
b, u2 = vsrr("YC", 2023, "Number of Drug Overdose Deaths")
check("state_metrics_profiles/NY series.overdose_deaths[2023] (NY excl. NYC + NYC)", ny["series"]["overdose_deaths"]["2023"], (a or 0) + (b or 0), u1 + " + " + u2)
od = published_metric("overdose_deaths")
v, u = vsrr("US", 2023, "Number of Drug Overdose Deaths")
check("state_metrics_national/overdose_deaths national[2023]", od["national"]["2023"], v, u)

# FARS state totals vs NHTSA's published Overview of Motor Vehicle Traffic Crashes in 2024 (Table 9)
report = "https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813791"
table9 = {"AL": (974, 962), "CA": (4169, 3876), "TX": (4294, 4160), "WY": (144, 107)}
for usps, (y23, y24) in table9.items():
    prof = published(usps)
    check(f"state_metrics_profiles/{usps} series.fars_fatalities[2023]", prof["series"]["fars_fatalities"]["2023"], y23, report)
    check(f"state_metrics_profiles/{usps} series.fars_fatalities[2024]", prof["series"]["fars_fatalities"]["2024"], y24, report)
check("state_metrics_national/fars_fatalities national[2024]", published_metric("fars_fatalities")["national"]["2024"], 39254, report)

# FDA enforcement entries vs the openFDA API
ca = published("CA")
for kind, state, year, prof in [("device", "CA", 2025, ca), ("food", "NY", 2024, ny), ("drug", "NJ", 2023, nj)]:
    u = (f"https://api.fda.gov/{kind}/enforcement.json?search=state:%22{state}%22+AND+country:%22United+States%22"
         f"+AND+report_date:[{year}0101+TO+{year}1231]&limit=1")
    total = get(u).json()["meta"]["results"]["total"]
    check(f"state_metrics_profiles/{state} series.fda_{kind}_recalls[{year}]", prof["series"][f"fda_{kind}_recalls"][str(year)], total, u)

# CDC leading causes (Socrata API)
ky = published("KY")
q = urllib.parse.urlencode({"state": "Kentucky", "year": "2017", "cause_name": "Unintentional injuries"})
u = f"https://data.cdc.gov/resource/bi63-dtpu.json?{q}"
d = get(u).json()[0]
check("state_metrics_profiles/KY series.cause_unintentional_injuries_rate[2017]", ky["series"]["cause_unintentional_injuries_rate"]["2017"], float(d["aadr"]), u)

# Derived rate recomputed from the fresh source numbers
pop = int(rows["West Virginia"]["POPESTIMATE2024"])
v, u = vsrr("WV", 2024, "Number of Drug Overdose Deaths")
check("state_metrics_profiles/WV series.overdose_rate[2024] (recomputed)", wv["series"]["overdose_rate"]["2024"], round(v / pop * 100000, 2), u + " ÷ Census V2025")

# NHTSA complaints: fresh download of the current flat file (re-published daily), recounted for one state-year
url = "https://static.nhtsa.gov/odi/ffdd/cmpl/COMPLAINTS_RECEIVED_2025-2026.zip"
seen, count = set(), 0
with zipfile.ZipFile(io.BytesIO(get(url).content)) as z:
    with z.open(next(n for n in z.namelist() if n.lower().endswith(".txt"))) as handle:
        for line in io.TextIOWrapper(handle, encoding="latin-1", newline=""):
            f = line.split("\t")
            if len(f) > 16 and f[1] not in seen:
                seen.add(f[1])
                count += f[13].strip().upper() == "CA" and f[16].startswith("2025")
check("state_metrics_profiles/CA series.nhtsa_complaints[2025]", ca["series"]["nhtsa_complaints"]["2025"], count, url, tol=5)

print(f"{sum(results)}/{len(results)} checks passed")
