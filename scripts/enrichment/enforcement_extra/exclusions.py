"""Parsers for the SAM.gov public exclusions extract and the HHS-OIG LEIE file (pure functions, no I/O).

Names are kept exactly as published (letters, case and punctuation unchanged; only surrounding whitespace is
trimmed). Street addresses, ZIP codes and LEIE dates of birth are never carried into a record.
"""
from __future__ import annotations

import hashlib
import re

from common import clean

USPS = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
    "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "GU",
    "AS", "MP",
}
SAM_RECORD_URL = "https://sam.gov/exclusion/{}/view"
SAM_DATA_PAGE = "https://sam.gov/data-services/Exclusions/Public%20V2?privacy=Public"
LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv"
LEIE_SEARCH = "https://exclusions.oig.hhs.gov/"
LEIE_AUTHORITIES_URL = "https://oig.hhs.gov/exclusions/background-information-exclusion-authorities/"
COMMENT_WITHHELD = "Withheld here because it contains a street address; full text on the SAM.gov record"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# HHS-OIG "Exclusion Authorities" table (LEIE_AUTHORITIES_URL), quoted. Keys are the LEIE EXCLTYPE codes.
# Codes the table does not describe (1128Aa, 1160, BRCH SA, BRCH CIA) are shown as published, without a gloss.
LEIE_AUTHORITIES = {
    "1128a1": ("1128(a)(1)", "1320a-7(a)(1)", "Mandatory", "Conviction of program-related crimes. Minimum Period: 5 years"),
    "1128a2": ("1128(a)(2)", "1320a-7(a)(2)", "Mandatory", "Conviction relating to patient abuse or neglect. Minimum Period: 5 years"),
    "1128a3": ("1128(a)(3)", "1320a-7(a)(3)", "Mandatory", "Felony conviction relating to health care fraud. Minimum Period: 5 years"),
    "1128a4": ("1128(a)(4)", "1320a-7(a)(4)", "Mandatory", "Felony conviction relating to controlled substance. Minimum Period: 5 years"),
    "1128b1": ("1128(b)(1)", "1320a-7(b)(1)", "Permissive",
               "(A) Misdemeanor conviction relating to health care fraud. Baseline Period: 3 years; (B) Conviction relating to fraud in non-health care programs. Baseline Period: 3 years"),
    "1128b2": ("1128(b)(2)", "1320a-7(b)(2)", "Permissive", "Conviction relating to obstruction of an investigation or audit. Baseline Period: 3 years"),
    "1128b3": ("1128(b)(3)", "1320a-7(b)(3)", "Permissive", "Misdemeanor conviction relating to controlled substance. Baseline Period: 3 years"),
    "1128b4": ("1128(b)(4)", "1320a-7(b)(4)", "Permissive", "License revocation, suspension, or surrender. Minimum Period: Period imposed by the state licensing authority."),
    "1128b5": ("1128(b)(5)", "1320a-7(b)(5)", "Permissive", "Exclusion or suspension under federal or state health care program. Minimum Period: No less than the period imposed by federal or state health care program."),
    "1128b6": ("1128(b)(6)", "1320a-7(b)(6)", "Permissive", "Claims for excessive charges, unnecessary services or services which fail to meet professionally recognized standards of health care, or failure of an HMO to furnish medically necessary services. Minimum Period: 1 year"),
    "1128b7": ("1128(b)(7)", "1320a-7(b)(7)", "Permissive", "Fraud, kickbacks, and other prohibited activities. Minimum Period: None"),
    "1128b8": ("1128(b)(8)", "1320a-7(b)(8)", "Permissive", "Entities controlled by a sanctioned individual. Minimum Period: Same as length of individual's exclusion."),
    "1128b9": ("1128(b)(9)", "1320a-7(b)(9)", "Permissive", "Failure to disclose required information, supply requested information on subcontractors and suppliers; or supply payment information. Minimum Period: None"),
    "1128b10": ("1128(b)(10)", "1320a-7(b)(10)", "Permissive", "Failure to disclose required information, supply requested information on subcontractors and suppliers; or supply payment information. Minimum Period: None"),
    "1128b11": ("1128(b)(11)", "1320a-7(b)(11)", "Permissive", "Failure to disclose required information, supply requested information on subcontractors and suppliers; or supply payment information. Minimum Period: None"),
    "1128b12": ("1128(b)(12)", "1320a-7(b)(12)", "Permissive", "Failure to grant immediate access. Minimum Period: None"),
    "1128b13": ("1128(b)(13)", "1320a-7(b)(13)", "Permissive", "Failure to take corrective action. Minimum Period: None"),
    "1128b14": ("1128(b)(14)", "1320a-7(b)(14)", "Permissive", "Default on health education loan or scholarship obligations. Minimum Period: Until default or obligation has been resolved."),
    "1128b15": ("1128(b)(15)", "1320a-7(b)(15)", "Permissive", "Individuals controlling a sanctioned entity. Minimum Period: Same as length of entity's exclusion."),
    "1128b16": ("1128(b)(16)", "1320a-7(b)(16)", "Permissive", "Making false statement or misrepresentations of material fact. Minimum period: None."),
    "1156": ("1156", "1320c-5", "Other", "Failure to meet statutory obligations of practitioners and providers to provide medically necessary services meeting professionally recognized standards of health care (Quality Improvement Organization (QIO) findings). Minimum Period: 1 year"),
}


def iso_date(value: str) -> str | None:
    """SAM 'YYYY-MM-DD' or LEIE 'YYYYMMDD'; '0', '00000000', blank and impossible dates -> None."""
    v = clean(value)
    if not v or set(v) <= {"0"}:
        return None
    if re.fullmatch(r"\d{8}", v):
        v = f"{v[:4]}-{v[4:6]}-{v[6:]}"
    if not _ISO.match(v):
        return None
    y, m, d = (int(p) for p in v.split("-"))
    # Years are kept as published (the extract has termination dates such as 2220-09-17); only impossible
    # month/day values are rejected.
    if not (1 <= y <= 9999 and 1 <= m <= 12 and 1 <= d <= 31):
        return None
    return v


_ZIP = re.compile(r"\b\d{5}(?:-\d{4})?\b")
_CITY_ZIP = re.compile(r"[\s,]*\b\d{5}(?:-\d{4})?\b")


def mentions_own_address(comment: str, row: dict) -> bool:
    """True when a comment repeats the record's own street address or ZIP code (as published in the extract)."""
    if not comment:
        return False
    for k in ("Address 1", "Address 2", "Address 3", "Address 4"):
        a = clean(row.get(k))
        if len(a) >= 8 and a.lower() in comment.lower():
            return True
    z = clean(row.get("Zip Code"))
    return len(z) >= 5 and any(m[:5] == z[:5] for m in _ZIP.findall(comment))


def sam_display_name(row: dict) -> tuple[str, bool]:
    """(name as SAM.gov shows it, prefix_withheld). Entities: the Name field. Individuals: Prefix First Middle
    Last Suffix as published; a prefix containing a digit (it is not a name prefix, e.g. a register number) is
    withheld."""
    name = clean(row.get("Name"))
    if name:
        return name, False
    prefix = clean(row.get("Prefix"))
    withheld = bool(prefix) and any(ch.isdigit() for ch in prefix)
    parts = ([] if withheld or not prefix else [prefix]) + [clean(row.get(k)) for k in ("First", "Middle", "Last", "Suffix")]
    return " ".join(p for p in parts if p), withheld


def sam_record_fields(row: dict) -> dict | None:
    """Normalise one extract row; None when it has no SAM Number (record key) or no name."""
    sam_number = clean(row.get("SAM Number")).lower()
    if not _UUID.match(sam_number):
        return None
    name, withheld = sam_display_name(row)
    if not name:
        return None
    country = clean(row.get("Country"))
    state_raw = clean(row.get("State / Province"))
    usps = state_raw if country == "USA" and state_raw in USPS else ""
    termination_raw = clean(row.get("Termination Date"))
    comments = clean(row.get("Additional Comments"))
    individual = clean(row.get("Classification")) == "Individual"
    # an individual's facility-specific EPA exclusion names the facility's street address ("... at this Facility
    # Only: 3308 Briarwood Rd., ..."), which can be the person's home: such comments are withheld too
    comment_withheld = individual and (mentions_own_address(comments, row) or "facility only" in comments.lower())
    city = clean(row.get("City"))
    city_zip_removed = False
    if individual and _ZIP.search(city):
        # some City fields carry the ZIP code ("HONOLULU, HI 96819"); an individual's ZIP code is not shown
        city, city_zip_removed = _CITY_ZIP.sub("", city).strip(" ,"), True
    npi = clean(row.get("NPI"))
    return {
        "comment_withheld": comment_withheld,
        "city_zip_removed": city_zip_removed,
        "sam_number": sam_number,
        "name": name,
        "prefix_withheld": withheld,
        "classification": clean(row.get("Classification")),
        "program": clean(row.get("Exclusion Program")),
        "agency": clean(row.get("Excluding Agency")),
        "ct_code": clean(row.get("CT Code")),
        "type": clean(row.get("Exclusion Type")),
        "comments": COMMENT_WITHHELD if comment_withheld else comments,
        "active": iso_date(row.get("Active Date", "")),
        "termination": "Indefinite" if termination_raw.lower() == "indefinite" else iso_date(termination_raw),
        "status": clean(row.get("Record Status")),
        "xref": clean(row.get("Cross-Reference")),
        "uei": clean(row.get("Unique Entity ID")),
        "cage": clean(row.get("CAGE")),
        "npi": "" if set(npi) <= {"0"} else npi,
        "created": iso_date(row.get("Creation_Date", "")),
        "city": city,
        "state_province": state_raw,
        "country": country,
        "usps": usps,
    }


def leie_name(row: dict) -> str:
    """'LASTNAME, FIRSTNAME MIDNAME' for individuals (the order OIG's search shows); BUSNAME otherwise."""
    last, first, mid = (clean(row.get(k)) for k in ("LASTNAME", "FIRSTNAME", "MIDNAME"))
    if last or first:
        given = " ".join(p for p in (first, mid) if p)
        return f"{last}, {given}" if last and given else (last or given)
    return clean(row.get("BUSNAME"))


def leie_code_value(value: str) -> str:
    v = clean(value)
    return "" if not v or set(v) <= {"0"} else v


def leie_record_fields(row: dict) -> dict | None:
    name = leie_name(row)
    if not name:
        return None
    code = clean(row.get("EXCLTYPE"))
    auth = LEIE_AUTHORITIES.get(code)
    state = clean(row.get("STATE"))
    return {
        "name": name,
        "kind": "Individual" if clean(row.get("LASTNAME")) or clean(row.get("FIRSTNAME")) else "Entity",
        "business": clean(row.get("BUSNAME")),
        "general": clean(row.get("GENERAL")),
        "specialty": clean(row.get("SPECIALTY")),
        "upin": leie_code_value(row.get("UPIN", "")),
        "npi": leie_code_value(row.get("NPI", "")),
        "city": clean(row.get("CITY")),
        "state": state,
        "usps": state if state in USPS else "",
        "code": code,
        "ssa_section": auth[0] if auth else None,
        "usc": f"42 U.S.C. {auth[1]}" if auth else None,
        "authority_kind": auth[2] if auth else None,
        "authority_text": auth[3] if auth else None,
        "excluded": iso_date(row.get("EXCLDATE", "")),
        "reinstated": iso_date(row.get("REINDATE", "")),
        "waiver": iso_date(row.get("WAIVERDATE", "")),
        "waiver_state": clean(row.get("WVRSTATE")),
    }


def leie_key(fields: dict) -> str:
    """Stable record key from published fields only (never DOB or street address)."""
    basis = "|".join(str(fields.get(k) or "") for k in (
        "name", "business", "general", "specialty", "upin", "npi", "city", "state", "code", "excluded",
        "reinstated", "waiver", "waiver_state"))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


_PUNCT = re.compile(r"[^0-9a-z&]+")


def company_key(name: str) -> str:
    """Exact-match key: lowercase, every character other than letters, digits and '&' becomes a space, whitespace
    collapsed. Corporate suffixes are kept (so 'BP PLC' never equals 'BP LLC')."""
    return re.sub(r"\s+", " ", _PUNCT.sub(" ", clean(name).lower())).strip()


def company_index(rows: list[list[str]]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for cik, title in rows:
        if re.fullmatch(r"\d{10}", cik):
            index.setdefault(company_key(title), []).append(cik)
    return index


def match_company(name: str, index: dict[str, list[str]]) -> tuple[str | None, str]:
    """(CIK, outcome) where outcome is matched / ambiguous / none. A link is made only on a unique key match."""
    key = company_key(name)
    hits = index.get(key, []) if key else []
    if len(hits) == 1:
        return hits[0], "matched"
    if len(hits) > 1:
        return None, "ambiguous"
    return None, "none"
