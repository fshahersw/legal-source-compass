"""Deterministic parsers and small statistics for the cpsc_catalog stream.

Nothing here guesses: a value that does not match a stated pattern comes back as None / "not_recorded".
"""
import datetime as dt
import hashlib
import re
import statistics
import unicodedata

# ---------------------------------------------------------------- generic text


def clean_text(value):
    """Collapse internal whitespace and trim; empty -> ''."""
    return re.sub(r"\s+", " ", value or "").strip()


def squash(text):
    """Comparison form for quoting PDF text: NFKC (fi ligatures etc.), typographic dashes/quotes folded, all whitespace removed."""
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    text = text.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", "", text)


def quote_on_page(page_text, quote):
    """True when the quote's characters appear in the page in order (whitespace and line wraps ignored)."""
    needle = squash(quote)
    return bool(needle) and needle in squash(page_text)


def slugify(text, limit=80):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:limit]


def short_hash(text, size=8):
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()[:size]


# ---------------------------------------------------------------- dates

_MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}


def parse_long_date(text):
    """'October 13, 2026' -> '2026-10-13'; anything else (including impossible dates) -> None."""
    match = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", clean_text(text))
    if not match or match.group(1).lower() not in _MONTHS:
        return None
    try:
        return dt.date(int(match.group(3)), _MONTHS[match.group(1).lower()], int(match.group(2))).isoformat()
    except ValueError:
        return None


# ---------------------------------------------------------------- research-page listings

AREA_BY_PAGE = {
    "Research--Statistics/Sports--Recreation": "Sports & Recreation",
    "Research--Statistics/Chemicals": "Chemicals",
    "Research--Statistics/Fuel-Lighters-and-Fireworks1": "Fuel, Lighters & Fireworks",
    "Research--Statistics/Kitchen-and-Dining-": "Kitchen & Dining",
    "Research--Statistics/Toys-and-Childrens-Products": "Toys & Children Products",
    "Research--Statistics/Furniture-and-Decor-1": "Furniture & Decor",
    "Research--Statistics/Home-Appliances-Maintenance-and-Construction": "Home Maintenance & Construction",
    "Research--Statistics/Older-Adults": "Older Adults",
    "Research--Statistics/Public-Facilities-and-Products": "Public Facilities & Products",
    "Research--Statistics/Carbon-Monoxide": "Carbon Monoxide",
    "Research--Statistics/Electrocutions1": "Electrocutions",
    "Research--Statistics/Fire": "Fire",
    "Research--Statistics/Pediatric-Poisonings": "Pediatric Poisonings",
    "Research--Statistics/Non-Pool-Submersions": "Non-Pool Submersions",
    "Research--Statistics/COVID-19": "COVID-19",
    "Research--Statistics/other-technical-reports": "Other Technical Reports",
}
HEADER_URL = re.compile(r"https://www\.cpsc\.gov/(Research--Statistics/[A-Za-z0-9_\-]+)")
LABELS = ("Injury Statistics", "Technical Reports")


def area_for_page(url):
    match = HEADER_URL.search(url or "")
    return AREA_BY_PAGE.get(match.group(1)) if match else None


def norm_url(url):
    return (url or "").strip().rstrip("/")


def read_listing_tsv(path):
    """Parse a cat_*.tsv capture. Returns (source_line, rows); rows are dicts
    {date_text, title, url, pairs: [(subsection, label)]} in file order. Comment lines start with '#'."""
    rows, source = [], ""
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if line.startswith("# source") or line.startswith("# sources"):
                source = line
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                raise ValueError(f"{path}: expected 4 tab-separated columns, got {len(parts)}: {line[:120]}")
            pairs = []
            for item in parts[3].split(";"):
                subsection, _, label = item.partition("|")
                pairs.append((clean_text(subsection), clean_text(label)))
            rows.append({"date_text": clean_text(parts[0]), "title": clean_text(parts[1]), "url": norm_url(parts[2]), "pairs": pairs})
    return source, rows


_MD_ROW = re.compile(r"^\|\s*(?P<date>[A-Za-z]+ \d{1,2}, \d{4})\s*\|\s*\[(?P<title>.+?)\]\((?P<url>https?://[^)\s]+)\)\s*\|\s*$")


def read_listing_md(path):
    """Parse a cat_*.md capture (page markdown with '| Date | Report |' tables).
    A table's heading is the last plain line before it; its label ('Injury Statistics' / 'Technical Reports') is the
    plain line printed right after it. Returns (source_line, rows) shaped like read_listing_tsv (pairs merged per URL)."""
    heading, table, source, found = "", [], "", []
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    if lines and lines[0].startswith("<!--"):
        source = lines[0]

    def close(label):
        nonlocal table
        for date_text, title, url in table:
            found.append({"date_text": date_text, "title": title, "url": norm_url(url), "pair": (heading, label)})
        table = []

    for line in lines[1:]:
        text = line.strip()
        if not text or text.startswith("# "):
            continue
        if text.startswith("|"):
            match = _MD_ROW.match(text)
            if match:
                table.append((clean_text(match.group("date")), clean_text(match.group("title").replace("\\_", "_")), match.group("url")))
            elif not re.match(r"^\|\s*(Date|---)", text):
                raise ValueError(f"{path}: unparsed table row: {text[:120]}")
            continue
        if text in LABELS:
            close(text)
            continue
        if table:  # a heading arrived before the table got its label
            close("unlabeled")
        heading = text
    if table:
        close("unlabeled")
    merged = {}
    for item in found:
        entry = merged.setdefault(item["url"], {"date_text": item["date_text"], "title": item["title"], "url": item["url"], "pairs": []})
        if item["pair"] not in entry["pairs"]:
            entry["pairs"].append(item["pair"])
    return source, list(merged.values())


def series_key(title):
    """Title with years, month words and the word 'report(s)' removed, lower-cased: groups yearly editions. Heuristic label only."""
    text = re.sub(r"\b(19|20)\d\d\b(\s*(to|and|through|-|–)\s*(19|20)?\d\d)?", " ", (title or "").lower())
    text = re.sub(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\b", " ", text)
    text = re.sub(r"\b(reports?|annual|memorandum|update)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


# ---------------------------------------------------------------- units

_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)"
_SCALE = r"(?:million|thousand)"
_NOUNS = r"(?:units?|pairs|sets|bottles|packages|pieces|boxes|cans|kits|jugs)"

# Exact copy of the enforcement lane's strict rule (parsing.parse_units) so parity with regulatory_cpsc_aggregates can be tested.
_STRICT = re.compile(r"^(?:about|approximately)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(million|thousand)?\s*(?:units)?\.?$", re.I)


def number_value(raw, scale=None):
    """'14,250' -> 14250; '1.2','million' -> 1200000; 'seven' -> 7; a decimal without a scale word -> None."""
    raw = (raw or "").lower().strip()
    scale = (scale or "").lower().strip()
    if raw in _WORDS:
        value = float(_WORDS[raw])
    else:
        try:
            value = float(raw.replace(",", ""))
        except ValueError:
            return None
    if scale == "million":
        value *= 1_000_000
    elif scale == "thousand":
        value *= 1_000
    elif "." in raw:
        return None
    return int(round(value))


def parse_units_strict(text):
    """Same result as the enforcement lane's parse_units: only 'About N', 'N', 'N million', 'Approximately N', 'N units'."""
    match = _STRICT.match(clean_text(text))
    if not match:
        return None
    return number_value(match.group(1), match.group(2))


_PREFIX = re.compile(r"^(?P<pre>about|approximately|roughly|an estimated|estimated|more than|over|at least|nearly|almost|up to|fewer than|less than)?\s*(?P<num>" + _NUM + r")(?:\s*(?P<scale>" + _SCALE + r"))?(?P<rest>.*)$", re.I)
_BOUND_LOWER = {"more than", "over", "at least", "nearly", "almost"}  # figure is a floor (or a near-ceiling for nearly/almost): not exact
_BOUND_UPPER = {"up to", "fewer than", "less than"}
_CANADA = re.compile(
    r"^[\s,;(]*(?:and\s+|in addition,?\s*|an additional\s+|additionally,?\s*)*(?:about\s+|approximately\s+)?(?P<n2>" + _NUM + r")(?:\s*(?P<s2>" + _SCALE + r"))?\s*(?:units?\s+)?(?:were\s+|was\s+)?(?:sold\s+|distributed\s+)?(?:in|to)\s+canada"
    r"(?:\s*(?:,|and)\s*(?:about\s+|approximately\s+)?(?P<n3>" + _NUM + r")(?:\s*(?P<s3>" + _SCALE + r"))?\s*(?:units?\s+)?(?:were\s+|was\s+)?(?:sold\s+)?in\s+mexico)?[\s.)]*$",
    re.I,
)
_ANNOUNCED = re.compile(r"^\s*\(this recall was first announced in [a-z.]+ \d{4}\)\.?\s*$", re.I)
_US_LABEL = re.compile(r"^\s*(?:in the (?:u\.\s?s\.|united states)|in the u\.s\.|in u\.s\.)", re.I)
_NOUN_LEAD = re.compile(r"^\s*(" + _NOUNS + r")\b", re.I)


def parse_units_detail(text):
    """Parse one product's NumberOfUnits string without guessing.
    status 'stated'     - the leading number is the stated U.S. count (qualifier 'about'/'approximately'/... kept);
                          optional Canada / Mexico clauses are read as separate counts, never added to us;
    status 'bound'      - 'More than N' / 'Up to N' style: not an exact figure (bound_kind lower/upper);
    status 'not_recorded' - blank, ranges, lists of several figures or any other text (reason 'blank' / 'unparsed').
    noun is None for the generic 'units' (or no noun) and the stated noun ('pairs', 'sets', ...) otherwise."""
    cleaned = clean_text(text)
    out = {"status": "not_recorded", "us": None, "canada": None, "mexico": None, "noun": None, "qualifier": None, "bound_kind": None, "rule": None, "reason": None, "text": cleaned}
    if not cleaned:
        out["reason"] = "blank"
        return out
    match = _PREFIX.match(cleaned)
    if not match:
        out["reason"] = "unparsed"
        return out
    pre = (match.group("pre") or "").lower() or None
    us = number_value(match.group("num"), match.group("scale"))
    if us is None:
        out["reason"] = "unparsed"
        return out
    rest = match.group("rest")
    noun = None
    noun_match = _NOUN_LEAD.match(rest)
    if noun_match:
        word = noun_match.group(1).lower()
        noun = None if word in ("unit", "units") else word
        rest = rest[noun_match.end():]
    labelled = _US_LABEL.match(rest)
    if labelled:
        rest = rest[labelled.end():]
    rule = "plain"
    if re.fullmatch(r"[\s.]*", rest):
        pass
    elif _ANNOUNCED.match(rest):
        rule = "first_announced_note"
    else:
        canada = _CANADA.match(rest)
        if not canada:
            # "About 340,000 toys", "About 2,100 bicycles": a count in a stated item word that is not the generic 'units';
            # kept out of unit totals (different things are being counted) but identified rather than called unparsed.
            out["reason"] = "other_unit_noun" if re.fullmatch(r"\s+[A-Za-z][A-Za-z '&-]{1,40}\.?", rest) and not noun_match else "unparsed"
            return out
        out["canada"] = number_value(canada.group("n2"), canada.group("s2"))
        if canada.group("n3"):
            out["mexico"] = number_value(canada.group("n3"), canada.group("s3"))
        if out["canada"] is None or (canada.group("n3") and out["mexico"] is None):
            out["reason"] = "unparsed"
            out["canada"] = out["mexico"] = None
            return out
        rule = "canada_clause"
    if labelled and rule == "plain":
        rule = "us_label"
    out.update({"us": us, "noun": noun, "qualifier": pre, "rule": rule})
    if pre in _BOUND_LOWER or pre in _BOUND_UPPER:
        out["status"] = "bound"
        out["bound_kind"] = "lower" if pre in _BOUND_LOWER else "upper"
    else:
        out["status"] = "stated"
    return out


def recall_units_detail(units_texts):
    """Recall-level units from the product rows' NumberOfUnits strings (blank rows ignored).
    Exactly one distinct non-blank string -> that string's parse (a repeated total is not summed);
    several distinct strings -> not recorded at recall level (reason 'several_figures'); none -> 'blank'."""
    distinct = []
    for item in units_texts:
        cleaned = clean_text(item)
        if cleaned and cleaned not in distinct:
            distinct.append(cleaned)
    if not distinct:
        return parse_units_detail("")
    if len(distinct) > 1:
        out = parse_units_detail("")
        out.update({"reason": "several_figures", "text": " | ".join(distinct)})
        return out
    return parse_units_detail(distinct[0])


def size_band(units):
    """Fixed size bands for exact U.S. unit counts."""
    if units is None:
        return None
    if units >= 1_000_000:
        return "1,000,000 or more"
    if units >= 100_000:
        return "100,000 to 999,999"
    if units >= 10_000:
        return "10,000 to 99,999"
    if units >= 1_000:
        return "1,000 to 9,999"
    return "Fewer than 1,000"


SIZE_BANDS = ["1,000,000 or more", "100,000 to 999,999", "10,000 to 99,999", "1,000 to 9,999", "Fewer than 1,000"]

# ---------------------------------------------------------------- stated incident / injury / death figures

_COUNT_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
                "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}
_STATED = re.compile(
    r"(?<![\w$.,])(?P<qual>(?:more than|over|at least|nearly|almost|about|approximately|fewer than|up to)\s+)?"
    r"(?P<num>\d{1,3}(?:,\d{3})+|\d+|" + "|".join(_COUNT_WORDS) + r")\s+"
    r"(?:(?:separate|additional|other|known|confirmed|similar|consumer|customer|reported|serious|minor|more|further|new)\s+){0,2}"
    r"(?P<noun>reports?|incidents?|injur(?:y|ies)|deaths?|fatalit(?:y|ies)|complaints?)\b",
    re.I,
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?;])\s+(?=[A-Z0-9\"(])")
_STATED_BACKGROUND = re.compile(
    r"\bCPSC estimates\b|\bper year\b|\beach year\b|\bannually\b|\bevery (year|two weeks)\b|\bsince (19|20)\d\d\b|\bin the past\b|\bother (firms?|compan(y|ies)|manufacturers?|products?|models?)\b|\banother (company|firm|manufacturer)\b"
    r"|\bsimilar (products?|models?|incidents?)\b|\b(dogs?|cats?|pets?|animals?)\b",
    re.I,
)
STATED_GROUPS = {"report": "reports", "incident": "reports", "complaint": "reports", "injury": "injuries", "injurie": "injuries", "death": "deaths", "fatality": "deaths", "fatalitie": "deaths"}


def _noun_group(noun):
    key = noun.lower().rstrip("s") if not noun.lower().endswith("ies") else noun.lower()[:-1]
    return STATED_GROUPS.get(key)


def stated_counts(text):
    """Numbers a recall's injury statement puts directly in front of report / incident / complaint / injury / death words.
    Returns [{n, group, bound, phrase, sentence}] in text order. Sentences carrying background markers (CPSC estimates,
    per year, since <year>, other firms, similar products, animals) are skipped; bare 4-digit years are not counts.
    Nothing is summed: one statement can restate the same events (12 reports ... including 3 injuries)."""
    found = []
    for sentence in _SENTENCE_SPLIT.split(clean_text(text)):
        if _STATED_BACKGROUND.search(sentence):
            continue
        for match in _STATED.finditer(sentence):
            raw = match.group("num").lower()
            if re.fullmatch(r"(19[5-9]\d|20[0-3]\d)", raw):
                continue
            value = _COUNT_WORDS[raw] if raw in _COUNT_WORDS else int(raw.replace(",", ""))
            qual = (match.group("qual") or "").strip().lower()
            group = _noun_group(match.group("noun"))
            if group is None:
                continue
            found.append({"n": value, "group": group, "bound": qual in ("more than", "over", "at least", "nearly", "almost", "fewer than", "up to"), "phrase": match.group(0).strip(), "sentence": sentence[:400]})
    return found


def largest_stated(text, group):
    """The single largest stated figure of a group (reports / injuries / deaths), or None."""
    items = [item for item in stated_counts(text) if item["group"] == group]
    return max(items, key=lambda item: item["n"]) if items else None


# ---------------------------------------------------------------- remedies

REMEDY_PRIMARY = ["Refund", "Repair", "Replace"]
REMEDY_OTHER_KNOWN = ["New Instructions", "Dispose", "Label", "Inspect", "No Remedy Available"]


def remedy_label(option):
    """Recorded RemedyOption -> display key. Known labels are matched exactly (after whitespace cleanup, case-insensitively);
    anything else (a sentence, a stray letter) is 'Unrecognized value' and kept visible rather than reassigned."""
    cleaned = clean_text(option)
    for known in REMEDY_PRIMARY + REMEDY_OTHER_KNOWN:
        if cleaned.lower() == known.lower():
            return known
    return "Unrecognized value"


def remedy_combo(options):
    """Recall-level remedy signature from the recorded options: 'Refund only', 'Refund + Replace', ... or None when none recorded."""
    labels = sorted({remedy_label(o) for o in options if clean_text(o)}, key=lambda x: (REMEDY_PRIMARY + REMEDY_OTHER_KNOWN + ["Unrecognized value"]).index(x))
    if not labels:
        return None
    return f"{labels[0]} only" if len(labels) == 1 else " + ".join(labels)


# ---------------------------------------------------------------- retailers (dictionary match on the Sold-at text)

# (display name, [case-insensitive regexes], [case-sensitive regexes]) ; a recall counts once per name no matter how often it is mentioned.
RETAILERS = [
    ("Walmart", [r"\bwal[- ]?mart\b"], []),
    ("Amazon", [r"\bamazon(\.com)?\b"], []),
    ("Target", [], [r"\bTarget(?: stores?| Corp| Corporation|\.com)?\b(?!\s+(?:market|audience|date))"]),
    ("The Home Depot", [r"\bhome depot\b"], []),
    ("Lowe's", [r"\blowe['’]?s\b"], []),
    ("Costco", [r"\bcostco\b"], []),
    ("Sam's Club", [r"\bsam['’]?s club\b"], []),
    ("Best Buy", [r"\bbest buy\b"], []),
    ("Kmart", [r"\bk[- ]?mart\b"], []),
    ("Sears", [], [r"\bSears\b"]),
    ("JCPenney", [r"\bj\.? ?c\.? ?penney\b"], []),
    ("Dollar General", [r"\bdollar general\b"], []),
    ("Dollar Tree", [r"\bdollar tree\b"], []),
    ("Family Dollar", [r"\bfamily dollar\b"], []),
    ("Five Below", [r"\bfive below\b"], []),
    ("Big Lots", [r"\bbig lots\b"], []),
    ("TJ Maxx", [r"\bt\.? ?j\.? ?maxx\b"], []),
    ("Marshalls", [], [r"\bMarshalls\b"]),
    ("Ross Stores", [], [r"\bRoss (?:Stores|Dress for Less)\b"]),
    ("Burlington", [], [r"\bBurlington (?:Coat Factory|Stores)\b"]),
    ("Walgreens", [r"\bwalgreens?\b"], []),
    ("CVS", [], [r"\bCVS\b"]),
    ("Rite Aid", [r"\brite aid\b"], []),
    ("Toys R Us", [r"\btoys ?[\"']?r[\"']? ?us\b"], []),
    ("Babies R Us", [r"\bbabies ?[\"']?r[\"']? ?us\b"], []),
    ("Kohl's", [r"\bkohl['’]?s\b"], []),
    ("Macy's", [r"\bmacy['’]?s\b"], []),
    ("Bed Bath & Beyond", [r"\bbed,? bath (?:&|and) beyond\b"], []),
    ("Michaels", [], [r"\bMichaels (?:Stores|craft|arts)"]),
    ("Hobby Lobby", [r"\bhobby lobby\b"], []),
    ("Jo-Ann Stores", [r"\bjo[- ]?ann\b"], []),
    ("Ace Hardware", [r"\bace hardware\b"], []),
    ("Menards", [r"\bmenards\b"], []),
    ("Tractor Supply", [r"\btractor supply\b"], []),
    ("Dick's Sporting Goods", [r"\bdick['’]?s sporting goods\b"], []),
    ("Academy Sports", [r"\bacademy sports\b"], []),
    ("Bass Pro Shops", [r"\bbass pro\b"], []),
    ("REI", [], [r"\bREI\b"]),
    ("eBay", [], [r"\b[eE][bB]ay\b"]),
    ("Etsy", [r"\betsy\b"], []),
    ("Temu", [r"\btemu\b"], []),
    ("Shein", [r"\bshein\b"], []),
    ("AliExpress", [r"\baliexpress\b"], []),
    ("Wayfair", [r"\bwayfair\b"], []),
    ("Overstock", [r"\boverstock\b"], []),
    ("QVC", [], [r"\bQVC\b"]),
    ("HSN", [], [r"\bHSN\b"]),
    ("IKEA", [], [r"\bIKEA\b"]),
    ("Williams-Sonoma", [r"\bwilliams[- ]sonoma\b"], []),
    ("Pottery Barn", [r"\bpottery barn\b"], []),
    ("Meijer", [r"\bmeijer\b"], []),
    ("Harbor Freight", [r"\bharbor freight\b"], []),
]
_RETAILER_RX = [(name, [re.compile(p, re.I) for p in ci] + [re.compile(p) for p in cs]) for name, ci, cs in RETAILERS]


def retailer_mentions(text):
    """Names from RETAILERS whose patterns occur in a recall's Sold-at text (each name once). Dictionary matching only."""
    cleaned = clean_text(text)
    return [name for name, patterns in _RETAILER_RX if any(p.search(cleaned) for p in patterns)]


# ---------------------------------------------------------------- firm names

_CORP_WORDS = re.compile(r"\b(inc|llc|corp|corporation|co|ltd|limited|company|gmbh|lp|plc)\b\.?", re.I)


def split_location(name):
    """Split a recorded firm string at its last ', of ' when the tail looks like a place (<= 6 words, capitalised, no company suffix):
    'Target Corp., of Minneapolis, Minn.' -> ('Target Corp.', 'Minneapolis, Minn.'). Otherwise (name, None).
    The name part is NOT merged with look-alike names (no alias or case folding): it only drops the place suffix."""
    cleaned = clean_text(name)
    index = cleaned.rfind(", of ")
    if index <= 0:
        return cleaned, None
    tail = cleaned[index + 5:].strip()
    if not tail or len(tail.split()) > 6 or not tail[0].isupper() or _CORP_WORDS.search(tail):
        return cleaned, None
    return cleaned[:index].strip(), tail


def exact_unique_match(name, index):
    """Return the single index value whose key equals the name after case and whitespace normalisation, else None.
    index maps normalised key -> list of values. Ambiguous (>1 distinct value) or absent -> None."""
    key = clean_text(name).lower()
    values = list(dict.fromkeys(index.get(key, [])))
    return values[0] if len(values) == 1 else None


def build_name_index(pairs):
    """[(name, value)] -> {normalised name: [values]} for exact_unique_match."""
    index = {}
    for name, value in pairs:
        index.setdefault(clean_text(name).lower(), []).append(value)
    return index


# ---------------------------------------------------------------- statistics


def median_int(values):
    values = sorted(values)
    if not values:
        return None
    value = statistics.median(values)
    return int(value) if float(value).is_integer() else value


def share(part, whole, digits=4):
    return round(part / whole, digits) if whole else None


def yoy(current, previous, digits=4):
    """Fractional change; None when the previous value is missing or zero."""
    if current is None or not previous:
        return None
    return round((current - previous) / previous, digits)


def hhi(counts):
    """Herfindahl-Hirschman index on a 0-10,000 scale from category counts (shares in percent, squared, summed)."""
    total = sum(counts)
    if not total:
        return None
    return round(sum((100.0 * c / total) ** 2 for c in counts), 1)


def rank_dict(counter, limit=None):
    """Counter -> {key: count} ordered by count desc then key (deterministic)."""
    items = sorted(counter.items(), key=lambda kv: (-kv[1], str(kv[0])))
    return dict(items[:limit] if limit else items)
