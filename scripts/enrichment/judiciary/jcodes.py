"""Code tables for the FJC Integrated Database appeals, criminal and bankruptcy files, taken from the official codebooks.

Codebooks (saved under private/acq/judiciary/codebooks, text renderings under private/build/judiciary/*_codebook.txt):
  appeals    https://www.fjc.gov/sites/default/files/idb/codebooks/Appeals%20Codebook%202008%20Forward%20rev%2002102021.pdf
  criminal   https://www.fjc.gov/sites/default/files/idb/codebooks/Criminal%20Code%20Book%201996%20Forward.pdf
  bankruptcy https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf

The short code lists are transcribed from those documents; the long lists (nature of suit, AO criminal offense codes, district
codes) are parsed from the codebook text by the functions below and checked against the transcribed district table in the
tests. Nothing is guessed: a code that is not in a table is reported as "Code <x> (not in the codebook)". Groupings marked
"project grouping" are this project's grouping of codebook codes (each group lists its codes), not FJC or AO categories.
"""
from __future__ import annotations

import re

APPEALS_CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Appeals%20Codebook%202008%20Forward%20rev%2002102021.pdf"
CRIMINAL_CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Criminal%20Code%20Book%201996%20Forward.pdf"
BANKRUPTCY_CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf"

# ---------------------------------------------------------------- districts (criminal and bankruptcy codebooks; the
# appeals file's DDIST uses the same two-character codes, its Appendix C prefixes them with the circuit)
DISTRICTS = {
    "00": "Maine", "01": "Massachusetts", "02": "New Hampshire", "03": "Rhode Island", "04": "Puerto Rico",
    "05": "Connecticut", "06": "New York - Northern", "07": "New York - Eastern", "08": "New York - Southern",
    "09": "New York - Western", "10": "Vermont", "11": "Delaware", "12": "New Jersey", "13": "Pennsylvania - Eastern",
    "14": "Pennsylvania - Middle", "15": "Pennsylvania - Western", "16": "Maryland", "17": "North Carolina - Eastern",
    "18": "North Carolina - Middle", "19": "North Carolina - Western", "20": "South Carolina", "22": "Virginia - Eastern",
    "23": "Virginia - Western", "24": "West Virginia - Northern", "25": "West Virginia - Southern", "26": "Alabama - Northern",
    "27": "Alabama - Middle", "28": "Alabama - Southern", "29": "Florida - Northern", "3A": "Florida - Middle",
    "3C": "Florida - Southern", "3E": "Georgia - Northern", "3G": "Georgia - Middle", "3J": "Georgia - Southern",
    "3L": "Louisiana - Eastern", "3N": "Louisiana - Middle", "36": "Louisiana - Western", "37": "Mississippi - Northern",
    "38": "Mississippi - Southern", "39": "Texas - Northern", "40": "Texas - Eastern", "41": "Texas - Southern",
    "42": "Texas - Western", "43": "Kentucky - Eastern", "44": "Kentucky - Western", "45": "Michigan - Eastern",
    "46": "Michigan - Western", "47": "Ohio - Northern", "48": "Ohio - Southern", "49": "Tennessee - Eastern",
    "50": "Tennessee - Middle", "51": "Tennessee - Western", "52": "Illinois - Northern", "53": "Illinois - Central",
    "54": "Illinois - Southern", "55": "Indiana - Northern", "56": "Indiana - Southern", "57": "Wisconsin - Eastern",
    "58": "Wisconsin - Western", "60": "Arkansas - Eastern", "61": "Arkansas - Western", "62": "Iowa - Northern",
    "63": "Iowa - Southern", "64": "Minnesota", "65": "Missouri - Eastern", "66": "Missouri - Western", "67": "Nebraska",
    "68": "North Dakota", "69": "South Dakota", "7-": "Alaska", "70": "Arizona", "71": "California - Northern",
    "72": "California - Eastern", "73": "California - Central", "74": "California - Southern", "75": "Hawaii", "76": "Idaho",
    "77": "Montana", "78": "Nevada", "79": "Oregon", "80": "Washington - Eastern", "81": "Washington - Western",
    "82": "Colorado", "83": "Kansas", "84": "New Mexico", "85": "Oklahoma - Northern", "86": "Oklahoma - Eastern",
    "87": "Oklahoma - Western", "88": "Utah", "89": "Wyoming", "90": "District of Columbia", "91": "Virgin Islands",
    "93": "Guam", "94": "Northern Mariana Islands",
}
USPS = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co",
    "Connecticut": "ct", "Delaware": "de", "District of Columbia": "dc", "Florida": "fl", "Georgia": "ga", "Hawaii": "hi",
    "Idaho": "id", "Illinois": "il", "Indiana": "in", "Iowa": "ia", "Kansas": "ks", "Kentucky": "ky", "Louisiana": "la",
    "Maine": "me", "Maryland": "md", "Massachusetts": "ma", "Michigan": "mi", "Minnesota": "mn", "Mississippi": "ms",
    "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv", "New Hampshire": "nh", "New Jersey": "nj",
    "New Mexico": "nm", "New York": "ny", "North Carolina": "nc", "North Dakota": "nd", "Ohio": "oh", "Oklahoma": "ok",
    "Oregon": "or", "Pennsylvania": "pa", "Puerto Rico": "pr", "Rhode Island": "ri", "South Carolina": "sc",
    "South Dakota": "sd", "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt", "Virgin Islands": "vi",
    "Virginia": "va", "Washington": "wa", "West Virginia": "wv", "Wisconsin": "wi", "Wyoming": "wy", "Guam": "gu",
    "Northern Mariana Islands": "nmi",
}
REGION = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}
STATE_USPS_UPPER = {name: code.upper() if code != "nmi" else "MP" for name, code in USPS.items()}

DISTRICT_ENTRY = re.compile(r"(?<![0-9A-Za-z])([0-9][0-9A-Z-]|3[A-Z]) [-–] ([A-Z][A-Za-z .'–-]+?)(?:\s{2,}|$)")


def parse_districts(codebook_text: str, start: str = "DISTRICT", stop: str = "OFFICE") -> dict[str, str]:
    """Two-character district code -> label, from the district section of a codebook text rendering."""
    out: dict[str, str] = {}
    on = False
    for line in codebook_text.splitlines():
        s = line.strip()
        if s == start:
            on = True
            continue
        if on and s.startswith(stop):
            break
        if on:
            for code, name in DISTRICT_ENTRY.findall(line):
                out[code] = name.replace("–", "-").strip()
    return out


def district_court_id(code: str) -> str | None:
    """CourtListener district court id for a two-character IDB district code ('08' -> 'nysd'); None when not a district."""
    label = DISTRICTS.get((code or "").strip())
    if not label:
        return None
    parts = [p.strip() for p in label.split(" - ")]
    usps = USPS.get(parts[0])
    if not usps:
        return None
    if len(parts) == 1:
        return usps + "d"
    region = REGION.get(parts[1])
    return None if region is None else usps + region + "d"


# CourtListener ids that do not follow the <district minus d> + b pattern ('arb' is Arizona; 'neb' is the Nebraska Supreme Court)
BANKRUPTCY_ID_EXCEPTIONS = {"azd": "arb", "ned": "nebraskab"}


def bankruptcy_court_id(district_id: str | None) -> str | None:
    """CourtListener bankruptcy court id paired with a district court id ('nysd' -> 'nysb'). Callers must also check that
    the id exists in court_spine with the federal-bankruptcy type (FB)."""
    if not district_id or not district_id.endswith("d"):
        return None
    return BANKRUPTCY_ID_EXCEPTIONS.get(district_id, district_id[:-1] + "b")


def district_label_for(court_id: str | None) -> str | None:
    """Codebook label of the district with this court id ('nysd' -> 'New York - Southern'); None when not a district."""
    for code, label in DISTRICTS.items():
        if court_id and district_court_id(code) == court_id:
            return label
    return None


def district_state(code: str) -> str | None:
    label = DISTRICTS.get((code or "").strip())
    return STATE_USPS_UPPER.get(label.split(" - ")[0]) if label else None


CIRCUIT_IDS = {str(n): f"ca{n}" for n in range(1, 12)} | {"0": "cadc"}
CIRCUIT_NAMES = {"0": "D.C. Circuit", "1": "First Circuit", "2": "Second Circuit", "3": "Third Circuit", "4": "Fourth Circuit",
                 "5": "Fifth Circuit", "6": "Sixth Circuit", "7": "Seventh Circuit", "8": "Eighth Circuit", "9": "Ninth Circuit",
                 "10": "Tenth Circuit", "11": "Eleventh Circuit"}


def circuit_id(code: str) -> str | None:
    c = (code or "").strip()
    if c.isdigit():
        c = str(int(c))
    return CIRCUIT_IDS.get(c)


# ---------------------------------------------------------------- appeals codebook
APPEAL_TYPE = {
    1: "Administrative review", 2: "Administrative enforcement", 3: "Civil, U.S.", 4: "Civil, private", 5: "No longer in use",
    6: "Original proceeding", 7: "No longer in use", 8: "No longer in use", 9: "No longer in use",
    10: "Bankruptcy appeal direct from bankruptcy court", 11: "Bankruptcy appeal from a bankruptcy appellate panel",
    12: "Bankruptcy appeal from district court", 13: "Criminal: guideline case, general", 14: "Criminal: pre-guideline case or other",
    15: "Criminal: guideline case, sentence only", 16: "Criminal: guideline case, conviction only",
    17: "Criminal: guideline case, sentence and conviction", 18: "Criminal case other than 14-17",
    19: "Direct criminal appeal", 20: "Criminal interlocutory appeal", 21: "Criminal post-conviction appeal", 22: "Miscellaneous case",
}
# project grouping of APPTYPE/TRMTYPE codes
APPEAL_TYPE_GROUP = {1: "administrative", 2: "administrative", 3: "civil_us", 4: "civil_private", 6: "original_proceeding",
                     10: "bankruptcy", 11: "bankruptcy", 12: "bankruptcy", 13: "criminal", 14: "criminal", 15: "criminal",
                     16: "criminal", 17: "criminal", 18: "criminal", 19: "criminal", 20: "criminal", 21: "criminal",
                     22: "miscellaneous"}
APPEAL_TYPE_GROUP_LABEL = {"administrative": "Administrative agency appeals (types 1-2)", "civil_us": "Civil, U.S. party (type 3)",
                           "civil_private": "Civil, private (type 4)", "original_proceeding": "Original proceedings (type 6)",
                           "bankruptcy": "Bankruptcy appeals (types 10-12)", "criminal": "Criminal appeals (types 13-21)",
                           "miscellaneous": "Miscellaneous (type 22)", "not_recorded": "Type not recorded"}
DISP_APPEALS = {1: "Merits: after oral hearing", 2: "Merits: after submission without hearing", 3: "Merits: discontinued code",
                4: "Procedural: after other judicial action", 5: "Procedural: without judicial action"}
MERITS_DISP = {1, 2, 3}
PROCEDURAL_DISP = {4, 5}
OUTCOME = {1: "Affirmed / enforced", 2: "Reversed / vacated", 3: "Affirmed in part, reversed or vacated in part", 5: "Dismissed",
           6: "Remanded", 7: "Other", 9: "Certificate of appealability denied"}
OUTCOME_KEY = {1: "affirmed", 2: "reversed", 3: "partial", 5: "dismissed", 6: "remanded", 7: "other", 9: "coa_denied"}
PROCTERM = {1: "Jurisdictional defects", 2: "F.R.A.P. 42 (voluntary dismissal, settlement)", 5: "Default",
            6: "Certificate of probable cause denied", 7: "Transferred", 8: "Dismissed / other", 9: "Certificate of appealability denied"}
METHOD = {1: "F.R.A.P. 42 (clerk)", 3: "Default (clerk)", 4: "Other (clerk)"}
PUBSTAT = {1: "Unpublished, oral", 2: "Published, written, signed", 3: "Unpublished, written, signed",
           4: "Published, written, unsigned reasoned", 5: "Unpublished, written, unsigned reasoned",
           6: "Published, written, unsigned without comment", 7: "Unpublished, written, unsigned without comment"}
PUBLISHED = {2, 4, 6}


def parse_appendix(codebook_text: str, start: str, stop: str, code_re: str = r"\d{3,4}") -> dict[str, str]:
    """Code -> description list between two appendix headings ('NATURE OF SUIT CODES', 'CRIMINAL OFFENSE CODES')."""
    out: dict[str, str] = {}
    on = False
    line_re = re.compile(rf"^\s*({code_re})\s+(\S.*?)\s*$")
    for line in codebook_text.splitlines():
        s = line.strip()
        if s == start:
            on = True
            continue
        if on and (s.startswith("Appendix") or s == stop):
            break
        if on:
            m = line_re.match(line)
            if m and m.group(1) not in out:
                out[m.group(1)] = re.sub(r"\s+", " ", m.group(2))
    return out


def parse_nos(appeals_codebook_text: str) -> dict[int, str]:
    return {int(k): v for k, v in parse_appendix(appeals_codebook_text, "NATURE OF SUIT CODES", "CRIMINAL OFFENSE CODES", r"\d{3}").items()}


def parse_offenses(appeals_codebook_text: str) -> dict[str, str]:
    return parse_appendix(appeals_codebook_text, "CRIMINAL OFFENSE CODES", "DISTRICT CODES", r"\d{4}")


# ---------------------------------------------------------------- criminal codebook
CRIM_DISPOSITION = {
    0: "Rule 20(a)/21 transfer", 1: "Dismissed (or other non-conviction disposition)", 2: "Acquitted by court", 3: "Acquitted by jury",
    4: "Convicted: plea of guilty", 5: "Convicted: plea of nolo contendere", 8: "Convicted by court after trial",
    9: "Convicted by jury after trial", 10: "NARA Titles I and III", 11: "Nolle prosequi", 12: "Pretrial diversion", 13: "Mistrial",
    14: "Statistically closed", 15: "Dismissed without prejudice", 16: "Not guilty by reason of insanity (court trial)",
    17: "Guilty but insane (court trial)", 18: "Not guilty by reason of insanity (jury trial)", 19: "Guilty but insane (jury trial)",
    20: "Dismissal superseded", 21: "Reassigned from judge to magistrate",
}
# DISP1 codes grouped as the columns of AO Judicial Business Table D-4 (checked against the FY2025 table by verify_criminal.py)
CRIM_DISP_GROUP = {4: "convicted_plea", 5: "convicted_plea", 8: "convicted_bench", 17: "convicted_bench", 9: "convicted_jury",
                   19: "convicted_jury", 2: "acquitted_bench", 16: "acquitted_bench", 3: "acquitted_jury", 18: "acquitted_jury",
                   1: "dismissed", 10: "dismissed", 11: "dismissed", 12: "dismissed", 13: "dismissed", 14: "dismissed",
                   15: "dismissed", 20: "dismissed", 21: "dismissed", 0: "transferred"}
CRIM_DISP_GROUP_LABEL = {"convicted_plea": "Convicted: plea of guilty or nolo contendere (codes 4, 5)",
                         "convicted_bench": "Convicted after bench trial (codes 8, 17)", "convicted_jury": "Convicted after jury trial (codes 9, 19)",
                         "acquitted_bench": "Acquitted after bench trial (codes 2, 16)", "acquitted_jury": "Acquitted after jury trial (codes 3, 18)",
                         "dismissed": "Dismissed and other non-conviction dispositions (codes 1, 10-15, 20, 21)",
                         "transferred": "Rule 20/21 transfer (code 0)", "not_recorded": "Disposition not recorded"}
CONVICTED = {"convicted_plea", "convicted_bench", "convicted_jury"}
COUNSEL = {0: "Type of counsel not reported", 1: "Criminal Justice Act appointment", 2: "Private counsel", 3: "Pro se",
           4: "Self (expired 1990)", 5: "None/other", 6: "Public defender / community defender", 7: "Pro bono"}
PRISON_SPECIAL = {-1: "less than one month", -2: "guilty, no sentence imposed", -3: "sealed sentence", -4: "life imprisonment",
                  -5: "death"}
SENTENCE_TYPE_LABEL = {
    "prison": "Prison (PRISTOT months > 0, or less than one month, life or death)",
    "probation": "Probation, no prison (PROBTOT > 0 or less than one month)",
    "fine_only": "Fine only (FINETOT > 0, no prison or probation)",
    "no_sentence": "Guilty, no sentence imposed (PRISTOT -2) or no prison, probation or fine recorded",
    "sealed": "Sealed sentence (PRISTOT -3)",
    "not_convicted": "Not convicted (no sentence applies)",
}


def as_int(v: str | None):
    v = (v or "").strip()
    if v in ("", "-8", "-9"):
        return None
    try:
        return int(v)
    except ValueError:
        return None


def sentence_type(disp_group: str, pristot: str | None, probtot: str | None, finetot: str | None) -> str:
    """Deterministic sentence type of one terminated defendant from the codebook's PRISTOT/PROBTOT/FINETOT values."""
    if disp_group not in CONVICTED:
        return "not_convicted"
    p = as_int(pristot)
    if p == -3:
        return "sealed"
    if p is not None and (p > 0 or p in (-1, -4, -5)):
        return "prison"
    pr = as_int(probtot)
    if pr is not None and (pr > 0 or pr == -1):
        return "probation"
    f = as_int(finetot)
    if f is not None and f > 0:
        return "fine_only"
    return "no_sentence"


# project grouping of AO offense codes (descriptions from the appeals codebook Appendix B) by the words of the description
OFFENSE_GROUPS = [
    ("drugs", "Drug offenses", ("NARC", "MARIHUANA", "CONTROLLED SUB", "CONTROL SUB", "DRUG", "CONTINUING CRIMINAL ENTERPRISE")),
    ("immigration", "Immigration offenses", ("IMMIGRATION", "ALIEN REGISTRATION", "NATIONALITY LAWS")),
    ("firearms", "Firearms and explosives", ("FIREARMS", "EXPLOSIVES")),
    ("sex", "Sex offenses and obscenity", ("SEX", "WHITE SLAVE", "OBSCENE")),
    ("violent", "Homicide, robbery, assault and kidnapping", ("MURDER", "MANSLAUGHTER", "NEGLIGENT", "ROBBERY", "ASSAULT", "AGGRAVATED OR FELONIOUS",
                                                             "FELONY, ON GOVERNMENT", "MISDEMEANOR, ON GOVERNMENT", "KIDNAP", "CONSPIRACY, MURDER",
                                                             "ATTEMPT, CONSPIRE/MAIM", "THREATS AGAINST", "TERRORIST")),
    ("fraud", "Fraud, embezzlement, forgery and tax", ("FRAUD", "EMBEZ", "EMBZ", "FORGE", "COUNTERFEIT", "FALSE", "LENDING", "INCOME TAX",
                                                       "SECURITIES", "BANKRUPTCY", "POSTAL, INTERSTATE WIRE", "PERSONATION", "VETERANS AND ALLOTMENTS",
                                                       "MARKETING AGREEMENTS", "SOCIAL SECURITY", "RAILROAD RETIREMENT", "TAX")),
    ("property", "Burglary, larceny and theft", ("BURGLARY", "LARCENY", "THEFT", "STOLEN", "INTERSTATE COMMERCE")),
    ("racketeering", "Racketeering, extortion, gambling and money laundering", ("RACKETEERING", "EXTORTION", "GAMBLING", "LAUDERING", "LAUNDERING", "BRIBERY")),
    ("justice", "Justice-system offenses (escape, perjury, contempt, obstruction)", ("ESCAPE", "PERJURY", "CONTEMPT", "OBSTRUCTION", "INTIMIDATION",
                                                                                     "CRIMINAL DEFAULT", "PRISON CONTRABAND")),
    ("traffic", "Traffic offenses", ("TRAFFIC",)),
]
# descriptions whose words would otherwise mislead the word rule: 9400 FOOD & DRUG ACT and 9923 FORFEITURE - CRIMINAL OR
# DRUG RELAT are regulatory statutes, not drug-trafficking offenses
OFFENSE_EXCEPTIONS = {"9400": "regulatory_other", "9923": "regulatory_other"}
OFFENSE_GROUP_LABEL = {k: lbl for k, lbl, _ in OFFENSE_GROUPS} | {"regulatory_other": "Regulatory and other federal statutes",
                                                                   "not_recorded": "Offense code not recorded",
                                                                   "not_in_codebook": "Offense code not in the codebook list"}


def offense_group(code: str | None, offenses: dict[str, str]) -> str:
    c = (code or "").strip()
    if c in ("", "-8", "-9"):
        return "not_recorded"
    desc = offenses.get(c)
    if desc is None:
        return "not_in_codebook"
    if c in OFFENSE_EXCEPTIONS:
        return OFFENSE_EXCEPTIONS[c]
    for key, _label, words in OFFENSE_GROUPS:
        if any(w in desc for w in words):
            return key
    return "regulatory_other"


# ---------------------------------------------------------------- bankruptcy codebook
CHAPTER_POST_2005 = {"7": "7", "9": "9", "11": "11", "12": "12", "13": "13", "15a": "15", "15m": "15", "15n": "15", "15x": "15"}
CHAPTER_1991_2005 = {"1": "7", "4": "9", "5": "11", "7": "13", "9": "12", "304": "304"}
CHAPTER_1987_1991 = {"1": "7", "2": "7", "4": "9", "5": "11", "6": "11", "7": "13", "9": "12", "304": "304"}
CHAPTER_PRE_1987 = {"1": "7", "2": "7", "3": "7", "4": "9", "5": "11", "6": "11", "7": "13", "304": "304"}
CHAPTER_LABEL = {"7": "Chapter 7", "9": "Chapter 9", "11": "Chapter 11", "12": "Chapter 12", "13": "Chapter 13", "15": "Chapter 15",
                 "304": "Section 304", "not_recorded": "Chapter not recorded", "not_in_codebook": "Code not in the codebook"}
NATURE_OF_DEBT = {"b": "Business", "c": "Consumer", "o": "Other"}


def chapter(code: str | None, original_filing_iso: str | None) -> str:
    """Chapter of a bankruptcy case from a chapter code, using the code set in force on the given filing date
    ('new' / 'old' may be passed instead of a date: on/after or before October 17, 2005)."""
    c = (code or "").strip().lower()
    if not c or c == "-8":
        return "not_recorded"
    d = original_filing_iso or ""
    if d == "old":  # the three pre-October-2005 code sets agree wherever they share a code
        table = CHAPTER_PRE_1987 | CHAPTER_1987_1991 | CHAPTER_1991_2005
    elif d == "new" or d >= "2005-10-17" or not d:
        table = CHAPTER_POST_2005
    elif d >= "1991-04-01":
        table = CHAPTER_1991_2005
    elif d >= "1987-07-01":
        table = CHAPTER_1987_1991
    else:
        table = CHAPTER_PRE_1987
    return table.get(c, "not_in_codebook")


def mdy_to_iso(v: str | None) -> str | None:
    """MM/DD/YYYY -> YYYY-MM-DD; the codebooks' 01/01/1900 placeholder and blanks are missing."""
    v = (v or "").strip()
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if not m:
        return None
    iso = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return None if iso == "1900-01-01" else iso


def label(table: dict, code, missing: str = "Not recorded") -> str:
    if code is None or code == "":
        return missing
    v = table.get(code)
    if v is None:
        return f"Code {code} (not in the codebook)"
    return v[0] if isinstance(v, tuple) else v
