"""Parsing, normalisation and small statistics for the SaferProducts.gov public database export (SPDB.zip).

Nothing here guesses: a value that does not match a stated rule comes back as None / "not_recorded".
Used by build_saferproducts.py and by the offline tests. The independent verifier (verify_saferproducts.py) does
NOT import this module.

Source: https://www.saferproducts.gov/SPDB.zip -> IncidentReports.csv (one row per published report), Recalls.csv.
The export carries no data dictionary; field meanings below come from the column headers, the public search
page filters and FAQ pages saved under private/acq/saferproducts/pages/.
"""
import codecs
import collections
import csv
import datetime as dt
import gzip
import io
import math
import os
import re
import statistics
import unicodedata
import zipfile

csv.field_size_limit(10 ** 8)

# ------------------------------------------------------------------ export columns

COLUMNS = {
    "report_no": "Report No.",
    "report_date": "Report Date",
    "sent_date": "Sent to Manufacturer / Importer / Private Labeler",
    "pub_date": "Publication Date",
    "submitter": "Category of Submitter",
    "product_desc": "Product Description",
    "category": "Product Category",
    "subcategory": "Product Sub Category",
    "ptype": "Product Type",
    "pcode": "Product Code",
    "mfr": "Manufacturer / Importer / Private Labeler Name",
    "brand": "Brand",
    "model": "Model Name or Number",
    "retailer": "Retailer",
    "purchase_date": "Purchase Date",
    "description": "Incident Description",
    "state": "State",
    "severity": "(Primary) Victim Severity",
    "age": "(Primary) Victim's Age (years)",
    "comments": "Company Comments",
    "associated": "Associated Report Numbers",
}
REQUIRED = ("report_no", "report_date", "pub_date", "category", "mfr", "severity")
REPORT_NO = re.compile(r"^\d{8}-[0-9A-Za-z]{5}-\d{6,12}$")


class ExportError(ValueError):
    """The export does not have the structure this parser supports."""


def _latin1_fallback(error):
    # cp1252 leaves five bytes undefined (0x81 0x8d 0x8f 0x90 0x9d): keep them as the same code point (latin-1)
    if isinstance(error, UnicodeDecodeError):
        return "".join(chr(b) for b in error.object[error.start:error.end]), error.end
    raise error


codecs.register_error("saferproducts_latin1_fallback", _latin1_fallback)


def decode_export(raw):
    """UTF-8 when valid (BOM removed), else Windows-1252 (the encoding of the 2026-10-18 export). Returns (text, encoding)."""
    try:
        text = raw.decode("utf-8")
        return (text[1:] if text.startswith("﻿") else text), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="saferproducts_latin1_fallback"), "cp1252"


def read_member(acq_dir, name):
    """Raw bytes of one SPDB.zip member: the gzipped copy under members/ when present, else straight from SPDB.zip."""
    gz_path = os.path.join(acq_dir, "members", name + ".gz")
    if os.path.exists(gz_path):
        with gzip.open(gz_path, "rb") as fh:
            return fh.read()
    with zipfile.ZipFile(os.path.join(acq_dir, "SPDB.zip")) as zf:
        return zf.read(name)


def clean(value):
    """Trim and collapse internal whitespace; None -> ''."""
    return re.sub(r"\s+", " ", value or "").strip()


# ------------------------------------------------------------------ dates

_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$", re.I)


def parse_date(value):
    """'M/D/YYYY' (optional time part ignored) -> date; blank, malformed or impossible dates -> None."""
    match = _DATE.match(clean(value))
    if not match:
        return None
    month, day, year = (int(g) for g in match.groups()[:3])
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


def plausible_year(day, low=2008, high=None):
    """Published-database dates must fall between the CPSIA (2008) and next year."""
    if day is None:
        return False
    high = high or dt.date.today().year + 1
    return low <= day.year <= high


# ------------------------------------------------------------------ severity and age

SEVERITY_GROUPS = {
    "Death": "death",
    "Injury, Hospital Admission": "injury",
    "Injury, Emergency Department Treatment Received": "injury",
    "Injury, Seen by Medical Professional": "injury",
    "Injury, First Aid Received by Non-Medical Professional": "injury",
    "Injury, No First Aid or Medical Attention Received": "injury",
    "Injury, Level of care not known": "injury",
    "Incident, No Injury": "incident_no_injury",
    "No Incident, No Injury": "no_incident",
    "Unspecified": "unspecified",
}
SEVERITY_GROUP_LABELS = {
    "death": "Death",
    "injury": "Injury (any level of care)",
    "incident_no_injury": "Incident, no injury",
    "no_incident": "No incident, no injury",
    "unspecified": "Unspecified",
    "not_recorded": "Not recorded",
    "unmapped": "Unmapped value",
}


def severity_group(value):
    text = clean(value)
    if not text:
        return "not_recorded"
    return SEVERITY_GROUPS.get(text, "unmapped")


AGE_BANDS = (
    ("under_1", "Under 1 year"),
    ("1_4", "1–4 years"),
    ("5_12", "5–12 years"),
    ("13_17", "13–17 years"),
    ("18_64", "18–64 years"),
    ("65_plus", "65+ years"),
)
AGE_BAND_LABELS = dict(AGE_BANDS)
AGE_BAND_LABELS["not_recorded"] = "Not recorded"
MAX_AGE = 120


def parse_age(value):
    """Victim age in years as a float; blank, non-numeric, negative or above 120 -> None."""
    text = clean(value)
    if not re.fullmatch(r"\d{1,3}(?:\.\d+)?", text):
        return None
    age = float(text)
    return age if 0 <= age <= MAX_AGE else None


def age_band(age):
    """Bands follow the SaferProducts.gov Victim's Age filter (<1, 1-4, 5-12, 13-17, 18-64, 65+) on the whole years completed."""
    if age is None:
        return "not_recorded"
    years = math.floor(age)
    if years < 1:
        return "under_1"
    if years <= 4:
        return "1_4"
    if years <= 12:
        return "5_12"
    if years <= 17:
        return "13_17"
    if years <= 64:
        return "18_64"
    return "65_plus"


# ------------------------------------------------------------------ placeholders (never counted as an identifying value)

_PLACEHOLDER = re.compile(
    r"^(?:unknown(?: (?:model|brand|manufacturer|retailer|company|store))?|unk|unkown|unknow|n/?a|na|none|nil|null|nothing|no|not (?:known|available|applicable|sure|provided|listed|visible|specified|stated)"
    r"|no (?:model|brand|name|idea|number|label|manufacturer)|i (?:do ?n[o'’]?t|do not|dont) know|don[' ’]?t know|dont know|can[' ’]?t (?:remember|recall|read)|\[?redacted\]?|unspecified|various|multiple|other|gift|generic|see (?:above|below|description)|\?+|-+|\.+|_+|x+|0+)$",
    re.I,
)


WITHHELD = "[contact details withheld]"
_CONTACT = (
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),  # email address
    re.compile(r"(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)"),  # US-style phone number
    re.compile(r"\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){0,3}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way|circle|place|pl\.?|terrace|highway|hwy\.?)(?=\W|$)", re.I),  # street address
)


def contact_like(value):
    """True when a name-like field holds an email address, a phone number or a street address. Business websites are not
    treated as personal contact details (they are names of firms and sites), so they pass."""
    text = clean(value)
    return bool(text) and any(rx.search(text) for rx in _CONTACT)


def guard_contact(value):
    """Name-like export field -> the value, or WITHHELD when it holds a personal-contact-like string."""
    return WITHHELD if contact_like(value) else value


def is_placeholder(value):
    """True for blank or a placeholder such as 'Unknown', 'N/A', "I don't know", '[REDACTED]' (apostrophes folded), or the
    withheld marker that replaces contact-like text."""
    text = clean(value).replace("’", "'").strip(" .")
    return (not text) or text == WITHHELD or bool(_PLACEHOLDER.match(text))


# ------------------------------------------------------------------ company-name normalisation (deterministic, exact)

_SUFFIXES = {
    "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "lp", "llp", "plc",
    "nv", "sa", "ag", "gmbh", "bv", "pte", "pty", "sarl", "sas", "srl", "spa", "ab", "oy", "as", "kk",
}


def company_key(name):
    """Comparison key: NFKC, case-folded, '&'->'and', apostrophes and periods removed, other punctuation -> space,
    SEC state markers ('/DE', '/NEW/') dropped, leading 'the' dropped, trailing legal-form words (Inc, LLC, Corp, Co, Ltd,
    Company, ...) dropped. Equality of keys is the only matching rule: there is no fuzzy or token matching."""
    text = unicodedata.normalize("NFKC", clean(name)).casefold()
    text = re.sub(r"/(?:new|[a-z]{2,3})/?\s*$", "", text)
    text = text.replace("&", " and ")
    text = re.sub(r"[.'’`]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    tokens = text.split()
    if tokens and tokens[0] == "the" and len(tokens) > 1:
        tokens = tokens[1:]
    while len(tokens) > 1 and tokens[-1] in _SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


_LEGAL_WORDS = _SUFFIXES | {"llc.", "inc.", "usa", "us", "dba", "d/b/a"}
_LOCATION = re.compile(r"^(?P<name>.+?)(?P<comma>,)?\s+of\s+(?P<place>[^,]+(?:,\s*[^,]+)?)\.?$")


def strip_location(name):
    """Recall firms are often written 'Acme Inc., of Reno, Nev.' / 'KTM Motorrad AG, of Austria'. Remove that trailing
    ', of <place>' clause so the name can be compared. Only applied when the clause is introduced by a comma or has the
    'City, State' shape and the second part is not a legal-form word (so 'Bank of America' and 'House of Marley, LLC' are untouched)."""
    text = clean(name)
    match = _LOCATION.match(text)
    if not match:
        return text
    place = match.group("place")
    parts = [p.strip() for p in place.split(",")]
    if len(parts) == 2 and company_key(parts[1]) in _LEGAL_WORDS | {""}:
        return text
    if match.group("comma") or len(parts) == 2:
        return match.group("name").rstrip(", ")
    return text


# ------------------------------------------------------------------ hazard themes (regex keyword rules over the incident description)

def _theme(label, pattern, stems):
    """Theme entry: display label, regex (matched against the lower-cased description) and the literal stems a description must
    contain for the regex to be tried at all (a pure speed-up: every regex match contains one of its stems)."""
    return label, re.compile(pattern), tuple(stems)


THEMES = collections.OrderedDict([
    ("fire", _theme("Fire", r"\b(?:fires?|flames?|ignit(?:e|ed|es|ing)(?!\s+(?:the\s+)?(?:burners?|gas|pilot|grill|stove|oven|fireplace))|combust\w*|smold?ering)\b(?!\s*(?:tv|stick|tablet|hd|phone|kids?|cube|os)\b)", ("fire", "flame", "ignit", "combust", "smoulder", "smolder"))),
    ("burn", _theme("Burn or scald", r"\b(?:burn(?:s|ed|t|ing)?|scald(?:s|ed|ing)?|blister(?:s|ed|ing)?|(?:first|second|third)[- ]degree)\b", ("burn", "scald", "blister", "degree"))),
    ("battery", _theme("Battery", r"\b(?:batter(?:y|ies)|lithium|li-?ion|lipo)\b", ("batter", "lithium", "li-ion", "liion", "lipo"))),
    ("choking", _theme("Choking", r"\b(?:chok(?:e|ed|es|ing)|gagg?(?:ed|ing)|aspirat(?:e|ed|ing|ion))\b(?!\s*(?:lever|cable|valve|plate|knob|control)\b)", ("chok", "gag", "aspirat"))),
    ("strangulation", _theme("Strangulation", r"\b(?:strangl(?:e|ed|es|ing)|strangulat\w*|wrapped around (?:his|her|their|the|my|your|baby'?s|child'?s) (?:neck|throat)|(?:cord|rope|string|strap)s? around (?:his|her|their|the|my|your) neck)\b", ("strangl", "strangul", "around"))),
    ("tip_over", _theme("Tip-over", r"\b(?:tip(?:s|ped|ping)?[- ]?overs?|tipp?ed (?:over|forward|backward|back)|topple[sd]?|toppling|(?:fell|falls|fall|falling) over)\b", ("tip", "toppl", "over"))),
    ("fall", _theme("Fall", r"\b(?:(?:i|he|she|they|we|child|baby|toddler|infant|son|daughter|grandson|granddaughter|husband|wife|mother|father|grandmother|grandfather|man|woman|boy|girl|person|user|rider|kid|consumer|victim)(?:[ ,]+\w+){0,3}?[ ,]+(?:fell|fall|fallen|falling|slipped|tripped)\b(?!\s+(?:asleep|ill|sick|apart|short|in love))|(?:slipp?ed|trip(?:ped|ping)) (?:and fell|over|on)|(?:fell|fall|falls|falling) (?:backwards?|forwards?)|(?:caused|causing|causes|made|making) (?:me|him|her|them|the (?:consumer|victim|child|user)) (?:to )?(?:fall|trip|slip))\b", ("fell", "fall", "slip", "trip"))),
    ("laceration", _theme("Laceration or cut", r"\b(?:lacerat\w*|gash\w*|stitches|sutures?|sliced|cut open|cut (?:my|his|her|their|the|a)? ?(?:finger|thumb|hand|arm|leg|foot|face|head|lip|toe|skin|palm|wrist)s?)\b", ("lacerat", "gash", "stitches", "suture", "sliced", "cut "))),
    ("lead", _theme("Lead or heavy metals", r"\b(?:lead[- ](?:poison\w*|paint\w*|based|levels?|content|contamina\w*|test\w*|exposure)|(?:contains?|containing|tested (?:positive )?for|traces? of|high levels? of|elevated|blood) lead|heavy metals\b|heavy metal (?:poison\w*|content|contamina\w*|levels?|test\w*|exposure))\b", ("lead", "heavy metal"))),
    ("poisoning", _theme("Poisoning or toxic exposure", r"\b(?:(?<!food\s)poison\w*|(?<!non-)(?<!non\s)toxic\w*|toxins?|overdos\w*|noxious|chemical (?:fumes?|exposure|leak\w*))\b", ("poison", "toxic", "toxin", "overdos", "noxious", "chemical"))),
    ("ingestion", _theme("Swallowing or ingestion", r"\b(?:swallow\w*|ingest\w*)\b", ("swallow", "ingest"))),
    ("electric_shock", _theme("Electric shock", r"\b(?:electrocut\w*|electric(?:al)?[- ]shock\w*|(?:got|gets?|getting|received|felt|feel|experienced) (?:an? )?(?:electric(?:al)? )?shock(?:ed|s)?|shocked (?:me|him|her|them|my)|zapp?ed)\b", ("electrocut", "shock", "zap"))),
    ("carbon_monoxide", _theme("Carbon monoxide", r"\b(?:carbon[- ]monoxide|co (?:alarms?|detectors?|poisoning|monitors?|levels?|sensors?))\b", ("monoxide", "co "))),
    ("suffocation", _theme("Suffocation or entrapment", r"\b(?:suffocat\w*|asphyxi\w*|smother\w*(?!\s+(?:out|it|with|the\s+fire|the\s+flames|a\s+fire))|entrap\w*|trapped (?:in|between|under|inside|beneath)|wedged|stuck between|pinned (?:under|between|beneath)|(?:could ?n[o']?t|could not|unable to|cannot|can't) breathe|stopped breathing)\b", ("suffocat", "asphyxi", "smother", "entrap", "trapped", "wedged", "stuck between", "pinned", "breathe", "breathing"))),
])


def theme_hits(text):
    """Set of theme ids whose regex matches the lower-cased incident description (typographic apostrophes folded); empty set for blank text."""
    lowered = (text or "").lower().replace("’", "'")
    if not lowered:
        return set()
    return {tid for tid, (_label, rx, stems) in THEMES.items() if any(s in lowered for s in stems) and rx.search(lowered)}


# ------------------------------------------------------------------ statistics

def median(values):
    return None if not values else statistics.median(values)


def percentile_nearest_rank(values, pct):
    """Nearest-rank percentile: the ceil(pct/100 * n)-th smallest value (n >= 1)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100.0 * len(ordered)))
    return ordered[rank - 1]


def pct(part, whole, digits=2):
    return None if not whole else round(100.0 * part / whole, digits)


def change_pct(new, old, digits=2):
    return None if not old else round(100.0 * (new - old) / old, digits)


def ratio_ci95(recent, prior):
    """Rate ratio recent/prior for two equal-length windows with a 95% interval from the log-ratio normal approximation
    (standard error sqrt(1/recent + 1/prior)). Returns (ratio, low, high) or None when either count is zero."""
    if recent <= 0 or prior <= 0:
        return None
    ratio = recent / prior
    se = math.sqrt(1.0 / recent + 1.0 / prior)
    return round(ratio, 4), round(math.exp(math.log(ratio) - 1.96 * se), 4), round(math.exp(math.log(ratio) + 1.96 * se), 4)


# ------------------------------------------------------------------ parsing the incident export

class Report:
    """One published report, reduced to the fields the analysis uses (free text is kept only for theme matching)."""

    __slots__ = (
        "report_no", "report_date", "sent_date", "pub_date", "submitter", "category", "subcategory", "ptype", "pcode",
        "mfr", "brand", "model", "retailer", "purchase_date", "state", "severity_raw", "severity", "age", "band",
        "has_comment", "assoc", "themes", "has_description", "dates_ok", "product_desc", "contact_withheld",
    )


def to_report(row):
    """Build a Report from a dict keyed by the export headers. Returns (Report | None, reason). A row is rejected only when the
    report number is malformed; any other missing field is carried as '' / None so totals stay complete."""
    get = lambda key: row.get(COLUMNS[key]) or ""  # noqa: E731
    number = clean(get("report_no"))
    if not REPORT_NO.match(number):
        return None, "report_no"
    r = Report()
    r.report_no = number
    r.report_date = parse_date(get("report_date"))
    r.sent_date = parse_date(get("sent_date"))
    r.pub_date = parse_date(get("pub_date"))
    r.dates_ok = plausible_year(r.report_date) and plausible_year(r.pub_date)
    r.submitter = clean(get("submitter")) or "Not recorded"
    r.category = clean(get("category")) or "Not recorded"
    r.subcategory = clean(get("subcategory")) or "Not recorded"
    r.pcode = clean(get("pcode")) or "Not recorded"
    r.ptype = clean(get("ptype")) or "Not recorded"
    r.mfr = guard_contact(clean(get("mfr")))
    r.product_desc = guard_contact(clean(get("product_desc")))
    r.brand = guard_contact(clean(get("brand")))
    r.model = guard_contact(clean(get("model")))
    r.retailer = guard_contact(clean(get("retailer")))
    r.contact_withheld = sum(1 for v in (r.mfr, r.product_desc, r.brand, r.model, r.retailer) if v == WITHHELD)
    r.purchase_date = parse_date(get("purchase_date"))
    r.state = clean(get("state")) or "Not recorded"
    r.severity_raw = clean(get("severity"))
    r.severity = severity_group(r.severity_raw)
    r.age = parse_age(get("age"))
    r.band = age_band(r.age)
    r.has_comment = bool(clean(get("comments")))
    r.assoc = len([p for p in re.split(r"[,;\s]+", get("associated")) if p])
    description = get("description")
    r.has_description = bool(clean(description))
    r.themes = theme_hits(description)
    return r, None


def parse_incident_csv(text):
    """Parse IncidentReports.csv text. The file starts with a one-cell disclaimer row, then the header row.
    Returns a dict: reports (list), disclaimer, header, stats {rows_read, blank_rows, repeated_header, malformed, duplicates}."""
    reader = csv.reader(io.StringIO(text, newline=""))
    disclaimer, header = None, None
    reports, seen = [], set()
    stats = collections.Counter()
    malformed = []
    for line, row in enumerate(reader, 1):
        if header is None:
            if not any(c.strip() for c in row):
                continue
            first = row[0].strip()
            if first.startswith("Disclaimer"):
                disclaimer = first
                continue
            if first == COLUMNS["report_no"]:
                header = [c.strip() for c in row]
                missing = [COLUMNS[k] for k in REQUIRED if COLUMNS[k] not in header]
                if missing:
                    raise ExportError("required columns missing: %s" % ", ".join(missing))
                continue
            raise ExportError("row %d precedes the header and is not a disclaimer" % line)
        stats["rows_read"] += 1
        if not any(c.strip() for c in row):
            stats["blank_rows"] += 1
            continue
        if row and row[0].strip() == COLUMNS["report_no"]:
            stats["repeated_header"] += 1
            continue
        if len(row) != len(header):
            stats["malformed"] += 1
            malformed.append((line, "columns=%d" % len(row)))
            continue
        report, reason = to_report(dict(zip(header, row)))
        if report is None:
            stats["malformed"] += 1
            malformed.append((line, reason))
            continue
        if report.report_no in seen:
            stats["duplicates"] += 1
            continue
        seen.add(report.report_no)
        if report.contact_withheld:
            stats["contact_like_values_withheld"] += report.contact_withheld
            stats["reports_with_contact_like_value"] += 1
        reports.append(report)
    if header is None:
        raise ExportError("no header row found")
    return {"reports": reports, "disclaimer": disclaimer, "header": header, "stats": dict(stats), "malformed": malformed}


def parse_recalls_csv(text):
    """Parse Recalls.csv: disclaimer row, a header row (Title, Date, Summary, Repair Number) followed by the repair entries, then a
    second header row (Title, Date, Summary, Recall Number, Recall URL) followed by the recalls. Each block has its own column
    count, taken from its header; each data row is tagged by the header in force ('Repair Number' -> repair, 'Recall Number' -> recall)."""
    reader = csv.reader(io.StringIO(text, newline=""))
    rows, kind, header, stats = [], None, None, collections.Counter()
    for line, row in enumerate(reader, 1):
        if not any(c.strip() for c in row):
            continue
        if kind is None and row[0].strip().startswith("Disclaimer"):
            continue
        if row[0].strip() == "Title" and len(row) >= 4:
            label = row[3].strip()
            if label not in ("Repair Number", "Recall Number"):
                raise ExportError("unexpected recalls header: %r" % (row,))
            kind, header = label, [c.strip() for c in row]
            stats["headers"] += 1
            continue
        if kind is None:
            raise ExportError("recall row %d precedes any header" % line)
        if len(row) != len(header):
            stats["malformed"] += 1
            continue
        fields = dict(zip(header, row))
        day = parse_date(fields.get("Date"))
        number = clean(fields.get(kind))
        if not number or day is None:
            stats["malformed"] += 1
            continue
        rows.append({"title": clean(fields.get("Title")), "date": day, "number": number, "kind": "repair" if kind == "Repair Number" else "recall",
                     "url": clean(fields.get("Recall URL")) or None, "summary_chars": len(fields.get("Summary") or "")})
    return {"rows": rows, "stats": dict(stats)}


# ------------------------------------------------------------------ small helpers shared by the builder

def slug(text, limit=60):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:limit] or "x"


def business_days_between(start, end):
    """Weekdays after `start` up to and including `end` (no holiday calendar)."""
    if start is None or end is None or end <= start:
        return 0
    days, day = 0, start
    while day < end:
        day += dt.timedelta(days=1)
        if day.weekday() < 5:
            days += 1
    return days


def year_cutoff(max_date):
    """(month, day) of the latest publication date: the same-window cutoff for year-to-date comparisons."""
    return max_date.month, max_date.day


def in_ytd(day, year, cutoff):
    return day is not None and day.year == year and (day.month, day.day) <= cutoff
