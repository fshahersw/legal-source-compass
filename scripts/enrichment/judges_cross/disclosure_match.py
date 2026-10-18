"""Disclosure-name matching tiers for the judges-cross lane.

Tier "match": the normalised investment name equals the normalised name of a company with explicit party evidence.
Tier "near_match" (always "Near match — review"):
  - alias: equals a reviewed alias of that party (same SEC registrant, or a reviewed parent company from a stated
    year), or the SEC ticker of that registrant (tickers and registrant names from sec.gov/files/company_tickers.json);
  - prefix: the investment name begins with a party name of two or more words.
Nothing else is compared. Non-company party names (defendant placeholders, governments, insurers) are not compared.
"""
import json
import re
from collections import defaultdict

import common as c

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
EDGAR_CIK = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}"

# Reviewed alias / parent table. party_keys are company_key() values of evidenced party names the entry applies to;
# ticker (when the entity is an SEC registrant) is resolved to its CIK and registrant title from the SEC file and
# checked against `expect`. valid_from: first disclosure report year the parent relation applies to.
REVIEWED_ALIASES = [
    {"party_keys": ["3m"], "ticker": "MMM", "expect": "3M", "relation": "same company", "names": ["3M Co", "3M Company", "Minnesota Mining and Manufacturing"]},
    {"party_keys": ["johnson and johnson"], "ticker": "JNJ", "expect": "JOHNSON & JOHNSON", "relation": "same company", "names": []},
    {"party_keys": ["ethicon", "depuy orthopaedics", "depuy"], "ticker": "JNJ", "expect": "JOHNSON & JOHNSON",
     "relation": "parent: Johnson & Johnson owns Ethicon and DePuy", "names": ["Johnson & Johnson"]},
    {"party_keys": ["abbott", "abbott laboratories"], "ticker": "ABT", "expect": "ABBOTT", "relation": "same company", "names": ["Abbott Laboratories", "Abbott Labs"]},
    {"party_keys": ["generac"], "ticker": "GNRC", "expect": "GENERAC", "relation": "same company (SEC registrant Generac Holdings)", "names": ["Generac Holdings"]},
    {"party_keys": ["philips"], "ticker": "PHG", "expect": "PHILIPS", "relation": "same company (SEC registrant Koninklijke Philips)",
     "names": ["Koninklijke Philips", "Royal Philips", "Philips Electronics", "Royal Philips Electronics", "Koninklijke Philips Electronics"]},
    {"party_keys": ["zimmer"], "ticker": "ZBH", "expect": "ZIMMER", "relation": "same company (SEC registrant Zimmer Biomet Holdings)",
     "names": ["Zimmer Biomet Holdings", "Zimmer Biomet", "Zimmer Holdings"]},
    {"party_keys": ["hyundai"], "ticker": None, "expect": None, "relation": "Hyundai Motor Company (not an SEC registrant)", "names": ["Hyundai Motor"]},
    {"party_keys": ["covidien"], "ticker": "MDT", "expect": "MEDTRONIC", "relation": "parent: Medtronic acquired Covidien (January 2015)", "names": ["Medtronic"], "valid_from": 2015},
    {"party_keys": ["allergan"], "ticker": "ABBV", "expect": "ABBVIE", "relation": "parent: AbbVie acquired Allergan (May 2020)", "names": ["AbbVie"], "valid_from": 2020},
    {"party_keys": ["davol", "cr bard", "bard"], "ticker": "BDX", "expect": "BECTON", "relation": "parent: Becton Dickinson acquired C. R. Bard (December 2017)",
     "names": ["Becton Dickinson", "Becton Dickinson and Co", "Becton, Dickinson"], "valid_from": 2018},
    {"party_keys": ["stryker"], "ticker": "SYK", "expect": "STRYKER", "relation": "same company", "names": []},
    {"party_keys": ["boston scientific"], "ticker": "BSX", "expect": "BOSTON SCIENTIFIC", "relation": "same company", "names": []},
    {"party_keys": ["toyota motor"], "ticker": "TM", "expect": "TOYOTA", "relation": "same company", "names": []},
    {"party_keys": ["angiodynamics"], "ticker": "ANGO", "expect": "ANGIODYNAMICS", "relation": "same company", "names": []},
]

US_STATES = {s.lower() for s in c.STATES}
NON_COMPANY = [
    (re.compile(r"^(?:all\s+)?(?:other\s+)?defendants?\b|\bdefendants?\s*$", re.I), "defendant placeholder"),
    (re.compile(r"\bdoes?\s*\d|\bjohn\s+doe|\bjane\s+doe|\bunknown\b|\bunidentified\b", re.I), "unnamed party"),
    (re.compile(r"\bunited states\b|\bu\.?\s?s\.? (?:government|department|army|navy|air force)\b|\bfederal government\b", re.I), "government"),
    (re.compile(r"^(?:the\s+)?(?:state|commonwealth|county|city|town|township|village|borough|parish|district|territory|people) of\b", re.I), "government"),
    (re.compile(r"\bcounty\b|\bdepartment of\b|\bagency\b|\bgovernment\b|\bmunicipal", re.I), "government"),
    (re.compile(r"\binsurance\b|\bassurance\b|\bindemnity\b|\bcasualty\b|\bunderwriters\b|\breinsurance\b|\blloyd'?s\b", re.I), "insurer"),
]


def non_company_reason(name: str):
    """Why a party name is not a company to compare (None when it may be one)."""
    text = (name or "").strip()
    if not text:
        return "empty"
    if text.lower().strip(". ") in US_STATES:
        return "government"
    for pattern, reason in NON_COMPANY:
        if pattern.search(text):
            return reason
    return None


def load_sec_tickers(path):
    data = json.loads(path.read_text())
    by_ticker, by_cik = {}, defaultdict(list)
    for row in data.values():
        cik = str(row["cik_str"]).zfill(10)
        by_ticker[row["ticker"].upper()] = (cik, row["title"])
        by_cik[cik].append(row["ticker"].upper())
    return by_ticker, by_cik


def resolve_aliases(by_ticker):
    """Expand the reviewed table into {party_key: [alias dict]}; fail loudly if a ticker no longer resolves."""
    out = defaultdict(list)
    for entry in REVIEWED_ALIASES:
        cik = title = None
        if entry["ticker"]:
            if entry["ticker"] not in by_ticker:
                raise SystemExit(f"alias ticker {entry['ticker']} not in SEC company_tickers.json")
            cik, title = by_ticker[entry["ticker"]]
            if entry["expect"].lower() not in title.lower():
                raise SystemExit(f"alias ticker {entry['ticker']} resolves to {title!r}, expected {entry['expect']!r}")
        keys = {c.company_key(n) for n in entry["names"]} | ({c.company_key(title)} if title else set())
        tickers = {entry["ticker"].lower()} if entry["ticker"] and len(entry["ticker"]) >= 2 else set()
        alias = {"keys": {k for k in keys if len(k) >= 2}, "tickers": tickers, "cik": cik, "registrant": title,
                 "relation": entry["relation"], "valid_from": entry.get("valid_from"),
                 "url": EDGAR_CIK.format(cik=cik) if cik else None}
        for pk in entry["party_keys"]:
            out[pk].append(alias)
    return out


def classify(investment_key, party_key, report_year, aliases, sec_tickers):
    """Return (tier, rule) for one investment line against one party, or None."""
    if not investment_key or len(party_key) < 2:
        return None
    if investment_key == party_key:
        return "match", "exact normalised name"
    for alias in aliases.get(party_key, []):
        if alias["valid_from"] and report_year < alias["valid_from"]:
            continue
        cik = f" (SEC CIK {alias['cik']})" if alias["cik"] else ""
        if investment_key in alias["keys"]:
            return "near_match", f"reviewed alias: {alias['relation']}{cik}"
        if investment_key in alias["tickers"]:
            return "near_match", f"ticker of {alias['registrant']}{cik}; {alias['relation']}"
    if investment_key in sec_tickers:
        return "near_match", "SEC ticker of the party's registrant"
    if len(party_key.split()) >= 2 and investment_key.startswith(party_key + " "):
        return "near_match", "investment name begins with the party name"
    return None
