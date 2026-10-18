"""Parsers for the FTC Consumer Sentinel Data Books, Do Not Call Data Books and refund reports.

The inputs are Firecrawl MCP captures of the official FTC PDFs (see private/acq/ftc_sentinel/_manifest.jsonl). A capture
is the tool-result JSON: {"markdown": "...", "metadata": {...}}. The markdown is a text extraction of the PDF with pages
separated by a line holding only ``---``. The extraction is imperfect (letters spaced apart, chart axis fragments,
tables split across pages, rows that spill into the next table), so every parser here

  * recognises content by its own vocabulary (state names, header signatures), never by line position alone;
  * returns only values that pass a validation rule, and reports everything else as a problem string;
  * never repairs, rounds or imputes a figure.

Pure functions, standard library only, no network.
"""
import json
import re

# --------------------------------------------------------------------------------------------------------------------
# Geography

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico",
}
UNRANKED = ("DC", "PR")  # included in the FTC tables but "not ranked"
RANKED_STATES = [u for u in STATES if u not in UNRANKED]


def letters_key(text):
    """Lower-case letters only: 'Ne wHa mps hi r e' -> 'newhampshire'."""
    return re.sub(r"[^a-z]", "", (text or "").lower())


_NAME_TO_USPS = {letters_key(name): usps for usps, name in STATES.items()}
_NAME_TO_USPS[letters_key("DistrictofColumbia")] = "DC"


def state_usps(name):
    """USPS code for a state name as printed (spacing and case tolerant); None when it is not exactly a state name."""
    return _NAME_TO_USPS.get(letters_key(name))


# --------------------------------------------------------------------------------------------------------------------
# Capture access

def load_capture_markdown(path):
    with open(path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    return doc.get("markdown") or ""


def split_pages(markdown):
    """Chunks of the capture split on page-break rules. chunk index i is 'capture chunk i' in citations."""
    return markdown.split("\n---\n")


# --------------------------------------------------------------------------------------------------------------------
# Numbers

def clean_cell(cell):
    return re.sub(r"\s+", " ", (cell or "").replace("&amp;", "&")).strip()


def to_int(text):
    """'1,234' -> 1234; None when the cell is not a plain integer (no guessing)."""
    t = clean_cell(text)
    if re.fullmatch(r"\d{1,3}(,\d{3})+|\d+", t):
        return int(t.replace(",", ""))
    return None


def to_float(text):
    t = clean_cell(text).replace(",", "")
    if re.fullmatch(r"-?\d+(\.\d+)?", t):
        return float(t)
    return None


def to_pct(text):
    """'39%' / '20.91%' / '39' -> number (percent points)."""
    t = clean_cell(text).rstrip("%").strip()
    return to_float(t)


def to_usd(text):
    """'$104,201,969' -> 104201969 (whole dollars). '$2,952M' -> 2952000000. '$104.2M' -> 104200000. None otherwise."""
    t = clean_cell(text)
    m = re.fullmatch(r"\$\s*([\d,]+(?:\.\d+)?)\s*([MBK]?)", t)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    scale = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[m.group(2)]
    out = value * scale
    return int(round(out)) if abs(out - round(out)) < 1e-6 else out


def to_ordinal(text):
    m = re.fullmatch(r"(\d+)(?:st|nd|rd|th)", clean_cell(text))
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------------------------------------------------
# Markdown tables

_SEP = re.compile(r"^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")


def split_row(line):
    parts = line.strip().strip("|").split("|")
    return [clean_cell(p) for p in parts]


_NUMLIKE = re.compile(r"^[+-]?\$?\d[\d,]*(\.\d+)?%?[MBK]?$")
_YEARLIKE = re.compile(r"^(19|20)\d\d$")


def _is_number(cell):
    return bool(_NUMLIKE.match(cell)) and not _YEARLIKE.match(cell)


def looks_like_data_row(cells):
    """True when the row a table 'header' really is data: its first cell, or half of the others, are numbers.

    Years (2021) and blank cells are normal in genuine headers and do not count.
    """
    if not cells:
        return False
    if _is_number(cells[0]) or re.fullmatch(r"\d+(st|nd|rd|th)", cells[0]):
        return True
    rest = cells[1:]
    return bool(rest) and sum(1 for c in rest if _is_number(c)) >= max(1, len(rest) / 2)


def iter_tables(text):
    """Yield dicts {line, header, rows} for every contiguous block of pipe lines.

    The extraction sometimes promotes the first data row to a header (when a table continues over a page break), so a
    header whose first cell is a number or whose cells are all numeric is returned as a data row and header=None.
    """
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        if not lines[i].startswith("|"):
            i += 1
            continue
        j = i
        block = []
        while j < len(lines) and lines[j].startswith("|"):
            block.append(lines[j])
            j += 1
        header = None
        rows = []
        for k, raw in enumerate(block):
            if _SEP.match(raw):
                continue
            cells = split_row(raw)
            if k == 0 and len(block) > 1 and _SEP.match(block[1]):
                if looks_like_data_row(cells):
                    rows.append(cells)
                else:
                    header = cells
            else:
                rows.append(cells)
        yield {"line": i, "header": header, "rows": rows}
        i = j


def header_has(table, *words):
    head = " ".join(table["header"] or []).lower()
    return all(w.lower() in head for w in words)


# --------------------------------------------------------------------------------------------------------------------
# Data Book: state rankings, appendix C, state pages

class Problems(list):
    """List of human-readable validation failures; truthy when anything failed."""

    def add(self, text):
        self.append(text)


def find_chunks(pages, pattern):
    """Indexes of chunks whose whitespace-stripped text matches the regex."""
    out = []
    for idx, page in enumerate(pages):
        if re.search(pattern, re.sub(r"\s+", "", page)):
            out.append(idx)
    return out


def parse_rank_rows(text):
    """Rows of a state-ranking table: (rank|None, usps, per100k, reports). rank None for DC and PR (unranked)."""
    out = {}
    problems = []
    for table in iter_tables(text):
        for cells in table["rows"]:
            if len(cells) != 4:
                continue
            usps = state_usps(cells[1])
            if not usps:
                continue
            rank = to_int(cells[0]) if cells[0] else None
            per100k = to_int(cells[2])
            reports = to_int(cells[3])
            if per100k is None or reports is None:
                problems.append(f"{cells[1]}: unreadable numbers {cells[2:]}")
                continue
            if usps in out:
                problems.append(f"{usps}: listed twice")
                continue
            out[usps] = {"rank": rank, "per100k": per100k, "reports": reports}
    return out, problems


def validate_ranking(rows, label, ranked_total=50):
    """Validation rules for one state-ranking table. Returns problem strings (empty list = passes)."""
    problems = []
    missing = [u for u in STATES if u not in rows]
    if missing:
        problems.append(f"{label}: missing {missing}")
    ranks = sorted(r["rank"] for u, r in rows.items() if r["rank"] is not None)
    if ranks != list(range(1, ranked_total + 1)):
        problems.append(f"{label}: ranks are not 1..{ranked_total} (got {len(ranks)})")
    for u in UNRANKED:
        if u in rows and rows[u]["rank"] is not None:
            problems.append(f"{label}: {u} should be unranked")
    ordered = sorted((r["rank"], r["per100k"]) for r in rows.values() if r["rank"] is not None)
    for (r1, v1), (r2, v2) in zip(ordered, ordered[1:]):
        if v2 > v1:
            problems.append(f"{label}: per-100K rises from rank {r1} ({v1}) to rank {r2} ({v2})")
    return problems


def population_basis(text):
    """'Population estimates are based on 2023 U.S. Census population estimates' -> '2023' (None when absent)."""
    flat = re.sub(r"[\s_*]+", "", text)
    m = re.search(r"basedon(\d{4})U\.?S\.?Census", flat)
    return m.group(1) if m else None


def parse_appendix_c(text):
    """Appendix C rows: usps -> reports, pct_reporting_loss, total_loss_usd, median_loss_usd."""
    out = {}
    problems = []
    for table in iter_tables(text):
        if not (table["header"] and header_has(table, "state", "reports")):
            continue
        for cells in table["rows"]:
            if len(cells) != 5:
                continue
            usps = state_usps(cells[0])
            if not usps:
                continue
            row = {
                "reports": to_int(cells[1]),
                "pct_reporting_loss": to_pct(cells[2]),
                "total_loss_usd": to_usd(cells[3]),
                "median_loss_usd": to_usd(cells[4]),
            }
            if None in row.values():
                problems.append(f"{usps}: unreadable appendix C row {cells}")
                continue
            out[usps] = row
    return out, problems


# State pages -------------------------------------------------------------------------------------------------------

ID_THEFT_LABELS = {
    "creditcard", "creditcardfraud", "otheridentitytheft", "loanorlease", "loanorleasefraud", "bankaccount",
    "bankfraud", "phoneorutilities", "phoneorutilitiesfraud", "employmentortaxrelated", "employmentortaxrelatedfraud",
    "governmentdocumentsorbenefits", "governmentdocumentsorbenefitsfraud",
}


_CHART_LABEL = re.compile(r"^(identitytheftreports|staterank|totalfraud|medianfraud|totalidentity|reportsper)")


def national_category_vocab(pages, first=3, last=12):
    """letters_key -> printed name of the report categories ranked in the national 'Report Categories' table."""
    vocab = {}
    for page in pages[first:last]:
        if "ReportCategor" not in re.sub(r"\s+", "", page):
            continue
        for table in iter_tables(page):
            cells_list = list(table["rows"])
            if table["header"]:
                cells_list.append(table["header"])
            for cells in cells_list:
                if len(cells) == 4 and to_int(cells[0]) and to_int(cells[2]) is not None and cells[3].endswith("%") and not re.search(r"\d", cells[1]):
                    vocab[letters_key(cells[1])] = cells[1]
    return vocab


def identify_state_page(text):
    """(USPS, how) of a state page from its own footnote 'reports from <State> consumers', else from its heading."""
    flat = re.sub(r"[\s_*]+", "", text)
    m = re.search(r"relevant\d{4}reportsfrom([A-Za-z]+?)consumers", flat)
    if m and state_usps(m.group(1)):
        return state_usps(m.group(1)), "footnote"
    for line in text.split("\n"):
        h = re.match(r"^#{2,6}\s+(.+?)\s*$", line)
        if h and state_usps(h.group(1)):
            return state_usps(h.group(1)), "heading"
    return None, None


def page_integers(text):
    """Standalone integers printed on a page (report totals appear this way)."""
    out = []
    for line in text.split("\n"):
        t = line.strip().replace("**", "")
        if re.fullmatch(r"\d{1,3}(,\d{3})+|\d{3,}", t):
            out.append(int(t.replace(",", "")))
    return out


def parse_state_page(text, category_vocab):
    """One state page. Returns top_categories, id_theft_types, ordinals, integers and problems.

    category_vocab: letters_key()s of the report categories printed in that year's national table. A two-column table
    row is a report category when its label is in the vocabulary and an identity-theft type when it is in
    ID_THEFT_LABELS (a label in both is reported). That also untangles the row the extraction moves from the top-ten
    table into the theft table.
    """
    problems = []
    cats, thefts = [], []
    for table in iter_tables(text):
        if table["header"] and "metropolitan" in " ".join(table["header"]).lower():
            continue
        for cells in table["rows"]:
            if len(cells) != 2:
                continue
            share = to_pct(cells[1])
            key = letters_key(cells[0])
            if share is None or key.startswith("unlabelled") or state_usps(cells[0]) or _CHART_LABEL.match(key):
                continue  # chart-axis and statistic fragments, not table rows of interest
            in_cat, in_theft = key in category_vocab, key in ID_THEFT_LABELS
            if in_cat and in_theft:
                problems.append(f"ambiguous label {cells[0]}")
            elif in_theft:
                thefts.append((cells[0], share))
            elif in_cat:
                cats.append((cells[0], share))
            else:
                problems.append(f"unclassified row {cells}")
    seen = set()
    cats = [c for c in cats if not (c[0] in seen or seen.add(c[0]))]
    ordinals = [to_ordinal(ln.strip()) for ln in text.split("\n") if to_ordinal(ln.strip())]
    return {"top_categories": cats, "id_theft_types": thefts, "ordinals": ordinals, "integers": page_integers(text), "problems": problems}


def validate_top_categories(cats):
    problems = []
    if len(cats) != 10:
        problems.append(f"{len(cats)} categories instead of 10")
    shares = [s for _, s in cats]
    if any(b > a for a, b in zip(shares, shares[1:])):
        problems.append("shares not in descending order")
    if sum(shares) > 100.5:
        problems.append("shares sum above 100")
    if len({n for n, _ in cats}) != len(cats):
        problems.append("duplicate category")
    return problems


def validate_id_theft_types(thefts):
    problems = []
    if not 1 <= len(thefts) <= 7:
        problems.append(f"{len(thefts)} theft types")
    shares = [s for _, s in thefts]
    if any(b > a for a, b in zip(shares, shares[1:])):
        problems.append("shares not in descending order")
    if len({n for n, _ in thefts}) != len(thefts):
        problems.append("duplicate theft type")
    return problems
