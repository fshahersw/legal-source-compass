"""Self-verification: compare published records against an independent re-fetch of the official sources.

Usage: python3 scripts/enrichment/enforcement/verify_samples.py
Writes private/scratch/enforcement/sample_checks.json and prints one line per comparison.
"""
import csv
import io
import json
import os
import sys
import urllib.parse
import urllib.request
import zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
VERIFY = os.path.join(ROOT, "private", "acq", "enforcement", "verify")
UA = "SeegerWeiss Research firasshaher99@gmail.com"
BASE = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
KEY = os.environ["EXTERNAL_SUPABASE_KEY"]
checks = []


def http(url, timeout=300):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def db(path):
    req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def check(label, published, source, url):
    ok = published == source
    checks.append({"check": label, "published": published, "source": source, "url": url, "match": ok})
    print(("OK  " if ok else "DIFF"), f"{label}: published={published} source={source} {url}")


def us_iso(text):
    parts = (text or "").split("/")
    return f"{parts[2]}-{parts[0]}-{parts[1]}" if len(parts) == 3 else None


def dollars(text):
    return float(text.replace("$", "").replace(",", "")) if text else None


# ---- EPA cases vs ECHO case report REST service
for case in ["HQ-2020-0001", "03-2019-7000", "06-2021-3401", "08-2017-0088", "05-2020-5003"]:
    rows = db(f"corpus_records?select=item&dataset=eq.regulatory_epa_cases&id=eq.epa-case:{case}")
    url = f"https://echodata.epa.gov/echo/case_rest_services.get_case_report?p_id={case}&output=JSON"
    info = json.loads(http(url))["Results"]["CaseInformation"]
    if not rows:
        check(f"regulatory_epa_cases/{case} present", False, True, url)
        continue
    pub = rows[0]["item"]["case"]
    check(f"regulatory_epa_cases/{case} fed_penalty", pub["penalties"]["fed_penalty"], dollars(info.get("TotalFederalPenalty")), url)
    check(f"regulatory_epa_cases/{case} type_code", pub["type_code"], info.get("CaseType"), url)
    if case == "HQ-2020-0001":
        check(f"regulatory_epa_cases/{case} latest settlement date vs ECHO case status date", pub["settled"], us_iso(info.get("CaseStatusDate")), url)

# ---- Deepwater Horizon: both regional records hold equal shares; combined = BP $5.5B + Transocean $1B + Anadarko $159.5M + MOEX US share $45M
combined = 0.0
for case in ["06-2011-4881", "04-2010-9036"]:
    url = f"https://echodata.epa.gov/echo/case_rest_services.get_case_report?p_id={case}&output=JSON"
    combined += dollars(json.loads(http(url))["Results"]["CaseInformation"].get("TotalFederalPenalty"))
us_top = db("corpus_records?select=item&dataset=eq.regulatory_epa_state_profiles&id=eq.epa-profile:US")[0]["item"]["profile"]["top_cases"][0]
check("regulatory_epa_state_profiles/US top_cases[0] combined national case (06-2011-4881 + 04-2010-9036)", us_top["fed_penalty"], combined, "https://echodata.epa.gov/echo/case_rest_services.get_case_report?p_id=06-2011-4881&output=JSON")

# ---- EPA state profiles vs a fresh download of case_downloads.zip, recomputed with pandas
os.makedirs(VERIFY, exist_ok=True)
zip_url = "https://echo.epa.gov/files/echodownloads/case_downloads.zip"
data = http(zip_url, timeout=1800)
with open(os.path.join(VERIFY, "case_downloads.zip"), "wb") as out:
    out.write(data)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    enf = pd.read_csv(archive.open("CASE_ENFORCEMENTS.csv"), dtype=str, keep_default_na=False, usecols=["ACTIVITY_ID", "FISCAL_YEAR", "ACTIVITY_TYPE_CODE"])
    fac = pd.read_csv(archive.open("CASE_FACILITIES.csv"), dtype=str, keep_default_na=False, usecols=["ACTIVITY_ID", "STATE_CODE"])
    conc = pd.read_csv(archive.open("CASE_ENFORCEMENT_CONCLUSIONS.csv"), dtype=str, keep_default_na=False, usecols=["ACTIVITY_ID", "SETTLEMENT_FY", "FED_PENALTY_ASSESSED_AMT"])
conc["FED"] = pd.to_numeric(conc["FED_PENALTY_ASSESSED_AMT"], errors="coerce").fillna(0)
fac["STATE_CODE"] = fac["STATE_CODE"].str.strip().str.upper()
pairs = fac[fac.STATE_CODE != ""].drop_duplicates()
joined = pairs.merge(enf, on="ACTIVITY_ID")
settled = pairs.merge(conc, on="ACTIVITY_ID")
for state, fy in [("TX", "2024"), ("CA", "2026"), ("NJ", "2020"), ("WY", "2025")]:
    rows = db(f"corpus_records?select=item&dataset=eq.regulatory_epa_state_profiles&id=eq.epa-profile:{state}")
    years = {y["fy"]: y for y in rows[0]["item"]["profile"]["years"]}
    sub = joined[(joined.STATE_CODE == state) & (joined.FISCAL_YEAR == fy)]
    check(f"regulatory_epa_state_profiles/{state} FY{fy} cases", years[int(fy)]["cases"], int(sub.ACTIVITY_ID.nunique()), zip_url)
    ssub = settled[(settled.STATE_CODE == state) & (settled.SETTLEMENT_FY == fy)]
    check(f"regulatory_epa_state_profiles/{state} FY{fy} fed_penalty settled that FY", round(years[int(fy)]["fed_penalty"], 2), round(float(ssub.FED.sum()), 2), zip_url)
us = db("corpus_records?select=item&dataset=eq.regulatory_epa_state_profiles&id=eq.epa-profile:US")[0]["item"]["profile"]
check("regulatory_epa_state_profiles/US total cases", us["totals"]["cases"], int(enf.ACTIVITY_ID.nunique()), zip_url)
check("regulatory_epa_state_profiles/US judicial cases", us["totals"]["judicial"], int((enf.ACTIVITY_TYPE_CODE == "JDC").sum()), zip_url)
check("regulatory_epa_state_profiles/US settled federal penalties, all settlements", round(us["totals"]["fed_penalty"], 2), round(float(conc.FED.sum()), 2), zip_url)
us_years = {y["fy"]: y for y in us["years"]}
check("regulatory_epa_state_profiles/US FY2024 fed_penalty settled (includes Cummins $1.478B entered 2024-04-09)", round(us_years[2024]["fed_penalty"], 2), round(float(conc[conc.SETTLEMENT_FY == "2024"].FED.sum()), 2), zip_url)

# ---- Census population (fresh fetch)
census_url = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
census = {r["NAME"]: int(r["POPESTIMATE2025"]) for r in csv.DictReader(io.StringIO(http(census_url).decode("latin-1")))}
tx = db("corpus_records?select=item&dataset=eq.regulatory_epa_state_profiles&id=eq.epa-profile:TX")[0]["item"]["profile"]
check("regulatory_epa_state_profiles/TX population 2025", tx["population"]["value"], census["Texas"], census_url)

# ---- CPSC recalls vs the Recall API by RecallNumber
api = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber={}"
picked = [db(f"corpus_records?select=id&dataset=eq.agency_safety_cpsc_recalls_api&order=ordinal.asc&offset={o}&limit=1")[0]["id"].split(":", 1)[1] for o in (150, 4000, 8500)]
for number in ["26659"] + picked:
    url = api.format(number)
    fresh = json.loads(http(url))
    rows = db(f"corpus_records?select=item&dataset=eq.agency_safety_cpsc_recalls_api&id=eq.cpsc-api:{number}")
    if not fresh or not rows:
        check(f"agency_safety_cpsc_recalls_api/{number} present", bool(rows), bool(fresh), url)
        continue
    f, pub = fresh[0], rows[0]["item"]["recall"]
    check(f"agency_safety_cpsc_recalls_api/{number} title", pub["title"], " ".join((f.get("Title") or "").split()), url)
    check(f"agency_safety_cpsc_recalls_api/{number} date", pub["date"], (f.get("RecallDate") or "")[:10], url)
    check(f"agency_safety_cpsc_recalls_api/{number} countries_raw", pub["countries_raw"], [" ".join(c["Country"].split()) for c in f.get("ManufacturerCountries") or [] if c.get("Country")], url)
    check(f"agency_safety_cpsc_recalls_api/{number} units_text", [p["units_text"] for p in pub["products"]], [(" ".join((p.get("NumberOfUnits") or "").split()) or None) for p in (f.get("Products") or [])[:12]], url)

# ---- CPSC death-mention classes, recomputed from freshly fetched injury text
sys.path.insert(0, HERE)
from parsing import death_foreign_only, death_mention_class  # noqa: E402

for number in ["24048", "01194", "26659", "06255", "12089"]:
    url = api.format(number)
    fresh = json.loads(http(url))
    rows = db(f"corpus_records?select=item&dataset=eq.agency_safety_cpsc_recalls_api&id=eq.cpsc-api:{number}")
    text = " ".join(" ".join((i.get("Name") or "").split()) for i in fresh[0].get("Injuries") or [])
    pub = rows[0]["item"]["recall"]
    check(f"agency_safety_cpsc_recalls_api/{number} death_class", pub["death_class"], death_mention_class(text), url)
    check(f"agency_safety_cpsc_recalls_api/{number} death_foreign_only", pub["death_foreign_only"], death_mention_class(text) == "product" and death_foreign_only(text), url)

# ---- CPSC aggregates vs fresh per-year API windows
for year in [2015, 2024]:
    url = f"https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={year}-01-01&RecallDateEnd={year}-12-31"
    fresh = json.loads(http(url))
    agg = db(f"corpus_records?select=item&dataset=eq.regulatory_cpsc_aggregates&id=eq.cpsc-agg:year:{year}")[0]["item"]["agg"]
    check(f"regulatory_cpsc_aggregates/year:{year} recalls", agg["recalls"], len(fresh), url)
    china = sum(1 for r in fresh if any(" ".join(c["Country"].split()).startswith("China") for c in r.get("ManufacturerCountries") or [] if c.get("Country")))
    check(f"regulatory_cpsc_aggregates/year:{year} countries.China (recalls listing China, qualifier dropped)", agg["countries"].get("China"), china, url)

with open(os.path.join(ROOT, "private", "scratch", "enforcement", "sample_checks.json"), "w") as out:
    json.dump(checks, out, indent=1)
print(sum(c["match"] for c in checks), "of", len(checks), "match")
sys.exit(0 if all(c["match"] for c in checks) else 1)
