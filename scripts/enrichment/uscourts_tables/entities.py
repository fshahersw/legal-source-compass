"""Map the row labels the U.S. Courts tables print to court ids used in the app (exact rules only, no fuzzy matching).

District tables print "Circuit and District" labels: "Total", "DC", circuit roll-ups ("1st" ... "11th") and districts
("ME", "NY,S", "GU", "NMI"). Appeals tables print circuits ("DC", "1st" ... "11th", "Fed."). Bankruptcy tables print the
same district codes for the bankruptcy courts. Ids follow the court directory (court_spine): districts end in "d",
bankruptcy courts in "b", circuits are "ca<n>", "cadc", "cafc".
"""
import re
import unicodedata

SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹⁰"
ORDINAL = re.compile(r"^(\d{1,2})(ST|ND|RD|TH)$", re.I)

# State/territory codes the tables print, with the two-letter district code the directory ids are built from.
DISTRICT_CODE = re.compile(r"^([A-Z]{2}),([A-Z])$")
SINGLE = re.compile(r"^[A-Z]{2}$")
# Directory ids that do not follow the "<code><subdistrict>d" rule (the directory spells these states out).
SPECIAL_DISTRICT = {"NMI": "nmid", "GU": "gud", "GUAM": "gud", "VI": "vid", "PR": "prd", "DC": "dcd"}
# Directory ids for single-district states follow "<code>d" (AK -> akd); multi-district states "<code><sub>d".
SPECIAL_BANKRUPTCY = {"AR": "arb", "NMI": "nmib", "GU": "gub", "GUAM": "gub", "VI": "vib", "PR": "prb", "DC": "dcb"}
CIRCUIT_NAMES = {
    "cadc": "D.C. Circuit", "ca1": "First Circuit", "ca2": "Second Circuit", "ca3": "Third Circuit", "ca4": "Fourth Circuit",
    "ca5": "Fifth Circuit", "ca6": "Sixth Circuit", "ca7": "Seventh Circuit", "ca8": "Eighth Circuit", "ca9": "Ninth Circuit",
    "ca10": "Tenth Circuit", "ca11": "Eleventh Circuit", "cafc": "Federal Circuit",
}
NATIONAL_LABELS = {"TOTAL", "U.S. TOTAL", "US TOTAL", "TOTAL ALL", "ALL COURTS", "NATIONAL"}


def clean_label(value):
    """Label without footnote marks and extra whitespace; a trailing footnote digit after a district code is removed."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value).replace("_x000D_", " ")).strip()
    text = "".join(ch for ch in text if ch not in SUPERSCRIPTS)
    text = re.sub(r"\s+", " ", text).strip()
    match = re.match(r"^([A-Z]{2},[A-Z])\s?\d$", text)
    if match:
        return match.group(1)
    match = re.match(r"^(\d{1,2}(?:st|nd|rd|th|ST|ND|RD|TH))\s?\d$", text)  # "2nd2": the 2nd Circuit with footnote 2 in plain digits
    if match:
        return match.group(1)
    match = re.match(r"^([A-Z]{2})\s?\d$", text)
    if match and match.group(1) not in ("DC",):
        return match.group(1)
    return text


def circuit_id(label):
    """'1st' -> ca1, '11TH' -> ca11, 'DC' -> cadc, 'Fed.' / 'Federal' -> cafc; None otherwise."""
    text = clean_label(label).upper().rstrip(".")
    match = ORDINAL.match(text)
    if match:
        return f"ca{int(match.group(1))}"
    if text == "DC":
        return "cadc"
    if text in ("FED", "FEDERAL", "FEDERAL CIRCUIT"):
        return "cafc"
    return None


def district_id(label, kind="d"):
    """Directory id for a district code: 'NY,S' -> nysd (kind 'd') or nysb (kind 'b'); None when the label is not a district."""
    text = re.sub(r",\s+", ",", clean_label(label).upper())  # older editions print "NY, S", newer ones "NY,S"
    if kind == "b" and text in SPECIAL_BANKRUPTCY:
        return SPECIAL_BANKRUPTCY[text]
    if text in SPECIAL_DISTRICT and kind == "d":
        return SPECIAL_DISTRICT[text]
    match = DISTRICT_CODE.match(text)
    if match:
        return (match.group(1) + match.group(2)).lower() + kind
    if SINGLE.match(text) and text not in ("DC",):
        return text.lower() + kind
    if text in SPECIAL_DISTRICT:
        return SPECIAL_DISTRICT[text][:-1] + kind
    return None


def is_national(label):
    return clean_label(label).upper() in NATIONAL_LABELS
