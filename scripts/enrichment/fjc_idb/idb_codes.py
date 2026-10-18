"""Code tables of the FJC Integrated Database civil file, taken from the official codebook.

Codebook: https://www.fjc.gov/sites/default/files/idb/codebooks/Civil%20Codebook%201988%20Forward%2010252023.pdf
(saved text: private/acq/courtlistener/idb_civil_codebook_1988_forward.txt). The NOS list and the district list are parsed from that
text; the short code lists are transcribed from the same document. Nothing is guessed: a code that is not in these tables
is reported as "Code <n> (not in the codebook)".
"""
from __future__ import annotations

import re

ORIGIN = {
    1: "Original proceeding",
    2: "Removed from state court",
    3: "Remanded for further action (from court of appeals)",
    4: "Reinstated or reopened",
    5: "Transferred from another district (28 USC 1404)",
    6: "Multidistrict litigation transfer (28 USC 1407)",
    7: "Appeal to a district judge of a magistrate judge's decision",
    8: "Second reopen",
    9: "Third reopen",
    10: "Fourth reopen",
    11: "Fifth reopen",
    12: "Sixth reopen",
    13: "Multidistrict litigation originating in the district (from July 1, 2016)",
}
JURISDICTION = {
    1: "US government plaintiff",
    2: "US government defendant",
    3: "Federal question",
    4: "Diversity of citizenship",
    5: "Local question",
}
# DISP: (label, group)
DISPOSITION = {
    0: ("Transfer to another district", "Transferred or remanded"),
    1: ("Remanded to state court", "Transferred or remanded"),
    10: ("Multidistrict litigation transfer", "Transferred or remanded"),
    11: ("Remanded to U.S. agency", "Transferred or remanded"),
    2: ("Dismissed: want of prosecution", "Dismissed"),
    3: ("Dismissed: lack of jurisdiction", "Dismissed"),
    12: ("Dismissed: voluntarily", "Dismissed"),
    13: ("Dismissed: settled", "Dismissed"),
    14: ("Dismissed: other", "Dismissed"),
    4: ("Judgment on default", "Judgment"),
    5: ("Judgment on consent", "Judgment"),
    6: ("Judgment on motion before trial", "Judgment"),
    7: ("Judgment on jury verdict", "Judgment"),
    8: ("Judgment on directed verdict", "Judgment"),
    9: ("Judgment on court trial", "Judgment"),
    15: ("Award of arbitrator", "Judgment"),
    16: ("Stayed pending bankruptcy", "Judgment"),
    17: ("Judgment: other", "Judgment"),
    18: ("Statistical closing", "Judgment"),
    19: ("Appeal affirmed (magistrate judge)", "Judgment"),
    20: ("Appeal denied (magistrate judge)", "Judgment"),
}
PROCEDURAL_PROGRESS = {
    1: ("No court action", "Before issue joined"),
    2: ("Order entered", "Before issue joined"),
    11: ("Hearing held", "Before issue joined"),
    12: ("Order decided", "Before issue joined"),
    3: ("No court action", "After issue joined"),
    4: ("Judgment on motion", "After issue joined"),
    5: ("Pretrial conference held", "After issue joined"),
    6: ("During court trial", "After issue joined"),
    7: ("During jury trial", "After issue joined"),
    8: ("After court trial", "After issue joined"),
    9: ("After jury trial", "After issue joined"),
    10: ("Other", "After issue joined"),
    13: ("Request for trial de novo after arbitration", "After issue joined"),
}
NATURE_OF_JUDGMENT = {
    0: "No monetary award",
    1: "Monetary award only",
    2: "Monetary award and other",
    3: "Injunction",
    4: "Forfeiture, foreclosure or condemnation",
    5: "Costs only",
    6: "Costs and attorney fees",
}
JUDGMENT_FOR = {1: "Plaintiff", 2: "Defendant", 3: "Both", 4: "Unknown"}
PRO_SE = {
    0: "No pro se party",
    1: "Pro se plaintiff(s) only",
    2: "Pro se defendant(s) only",
    3: "Pro se plaintiff(s) and defendant(s)",
}
JURY_DEMAND = {"B": "Both parties", "D": "Defendant", "P": "Plaintiff", "N": "Neither"}
CLASS_ACTION_TERMINATION = {2: "Class certification denied", 3: "Class certification granted"}

NOS_LINE = re.compile(r"^\s*(\d{3})\s+(\S.*?)\s*$")
DISTRICT_ENTRY = re.compile(r"(?<![0-9A-Za-z])([0-9][0-9A-Z-]|3[A-Z]) - ([A-Z][A-Za-z .'-]+?)(?:\s{2,}|$)")

USPS = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co",
    "Connecticut": "ct", "Delaware": "de", "District of Columbia": "dc", "Florida": "fl", "Georgia": "ga",
    "Hawaii": "hi", "Idaho": "id", "Illinois": "il", "Indiana": "in", "Iowa": "ia", "Kansas": "ks", "Kentucky": "ky",
    "Louisiana": "la", "Maine": "me", "Maryland": "md", "Massachusetts": "ma", "Michigan": "mi", "Minnesota": "mn",
    "Mississippi": "ms", "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv", "New Hampshire": "nh",
    "New Jersey": "nj", "New Mexico": "nm", "New York": "ny", "North Carolina": "nc", "North Dakota": "nd",
    "Ohio": "oh", "Oklahoma": "ok", "Oregon": "or", "Pennsylvania": "pa", "Puerto Rico": "pr", "Rhode Island": "ri",
    "South Carolina": "sc", "South Dakota": "sd", "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt",
    "Virgin Islands": "vi", "Virginia": "va", "Washington": "wa", "West Virginia": "wv", "Wisconsin": "wi",
    "Wyoming": "wy", "Guam": "gu", "Northern Mariana Islands": "nmi",
}
REGION = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}


def parse_nos(codebook_text: str) -> dict[int, str]:
    """NOS code -> description, from the 'NATURE OF SUIT' section of the codebook."""
    out: dict[int, str] = {}
    on = False
    for line in codebook_text.splitlines():
        if line.strip() == "NATURE OF SUIT":
            on = True
            continue
        if on and line.strip() == "TITLE":
            break
        if on:
            m = NOS_LINE.match(line)
            if m and m.group(1) != "Code":
                out[int(m.group(1))] = re.sub(r"\s+", " ", m.group(2))
    return out


def parse_districts(codebook_text: str) -> dict[str, str]:
    """FJC district code -> 'State - Region' label, from the 'DISTRICT' section of the codebook."""
    out: dict[str, str] = {}
    on = False
    for line in codebook_text.splitlines():
        if line.strip() == "DISTRICT":
            on = True
            continue
        if on and line.strip() == "OFFICE":
            break
        if on:
            for code, name in DISTRICT_ENTRY.findall(line):
                out[code] = name.strip()
    return out


def court_id_for(label: str) -> str | None:
    """CourtListener court id for a codebook district label ('Texas - Southern' -> 'txsd'); None if not derivable."""
    parts = [p.strip() for p in label.split(" - ")]
    state = parts[0]
    usps = USPS.get(state)
    if not usps:
        return None
    if len(parts) == 1:
        return usps + "d"
    region = REGION.get(parts[1])
    return None if region is None else usps + region + "d"


def label(table: dict, code, missing: str = "Not recorded") -> str:
    if code is None:
        return missing
    v = table.get(code)
    if v is None:
        return f"Code {code} (not in the codebook)"
    return v[0] if isinstance(v, tuple) else v


# Grouping of NOS codes used for category mapping. It is this project's grouping of the codebook's codes, not an FJC category.
NOS_GROUPS = [
    ("contract", "Contract", [110, 120, 130, 140, 150, 151, 152, 153, 160, 190, 196]),
    ("real_property", "Real property", [210, 220, 230, 240, 290]),
    ("injury", "Personal injury (not product liability)", [310, 320, 330, 340, 350, 360, 362]),
    ("product", "Product liability and health-care / pharma injury", [195, 245, 315, 345, 355, 365, 367, 368, 385]),
    ("fraud_property", "Fraud, truth in lending and property damage", [370, 371, 380]),
    ("false_claims", "False Claims Act", [375, 376]),
    ("civil_rights", "Civil rights", [440, 441, 442, 443, 445, 446, 448]),
    ("prisoner", "Prisoner petitions and civil detainees", [510, 530, 535, 540, 550, 555, 560]),
    ("labor", "Labor and employment statutes", [710, 720, 740, 751, 790, 791]),
    ("ip", "Intellectual property and trade secrets", [820, 830, 835, 840, 880]),
    ("securities_antitrust_banking", "Securities, antitrust and banking", [410, 430, 850]),
    ("consumer_credit", "Consumer credit and communications", [480, 485, 490]),
    ("social_security", "Social Security", [861, 862, 863, 864, 865]),
    ("tax", "Tax suits", [870, 871]),
    ("immigration", "Immigration", [460, 462, 463, 465]),
    ("forfeiture", "Forfeiture and penalty suits", [625, 690]),
    ("bankruptcy", "Bankruptcy appeals and withdrawals", [422, 423]),
    ("other_statutes", "Other statutory actions", [400, 450, 470, 890, 891, 893, 895, 896, 899, 950]),
]
# A code listed in two groups would go to the first one; each code is listed once.
NOS_TO_GROUP: dict[int, str] = {}
for key, _label, codes in NOS_GROUPS:
    for c in codes:
        NOS_TO_GROUP.setdefault(c, key)
GROUP_LABEL = {k: lbl for k, lbl, _ in NOS_GROUPS}
GROUP_LABEL["unmapped"] = "Codes not in a group above"
