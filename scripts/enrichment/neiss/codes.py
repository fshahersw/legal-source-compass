"""Official NEISS code labels for the dataset builders (no guessed labels).

Sources (all under private/acq/neiss/docs/, retrieved from cpsc.gov):
  DataDictionary042022.xlsx                       variable code lists: Age, Sex, Race, Hispanic, Body_Part, Diagnosis, Disposition,
                                                  Location, Fire_Involvement, Alcohol, Drug (two sheets: 2018 and prior / 2019 and beyond)
  NEISS-Coding-Manual-2025-01-Rev1.pdf            Appendix H: numerical listing of NEISS product (and activity) codes with titles
  NEISS-Coding-Manual-2024-01.pdf                 same listing, January 2024 (fills codes retired in 2025, if any)
  Comparability-Table-2025.pdf                    every product code ever used with the most recent title and the dates in use
A product code that appears in none of these keeps the label "Not recorded".
"""
import re
import subprocess

NOT_RECORDED = "Not recorded"
TYPO_FIXES = {"Amputaion": "Amputation"}  # data dictionary spelling; the coding manual (Appendix B) spells it Amputation

CODE_LINE = re.compile(r"^\s*(\d{1,3})\s*[-=]\s*(.+?)\s*$")


def _fix(label):
    label = re.sub(r"\s+", " ", label).strip()
    for bad, good in TYPO_FIXES.items():
        label = label.replace(bad, good)
    return label


def parse_dictionary_rows(rows):
    """rows: iterable of (variable, sas, description). Returns {variable: {code(int): label}} for numeric code lists."""
    out, current = {}, None
    for variable, _sas, desc in rows:
        if variable:
            current = variable.strip()
            out.setdefault(current, {})
            continue
        if current is None or desc is None:
            continue
        m = CODE_LINE.match(str(desc))
        if m:
            out[current][int(m.group(1))] = _fix(m.group(2))
    return out


def load_dictionary(xlsx_path):
    """Merge both sheets of the data dictionary. Returns {variable: {code: label}}; 'old' codes keep their label from the older sheet."""
    import warnings
    import openpyxl

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(xlsx_path, read_only=True)
        merged = {}
        for ws in wb:
            rows = [(r[0], r[1], r[2]) for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
            parsed = parse_dictionary_rows(rows[1:])
            for var, codes in parsed.items():
                merged.setdefault(var, {})
                for code, label in codes.items():
                    merged[var].setdefault(code, label)
    return merged


PRODUCT_LINE = re.compile(r"^\s+(\d{4})\s{2,}(\S.*?)\s*$")


def parse_product_listing(text):
    """Appendix H of a coding manual (pdftotext -layout text) -> {code(int): title}. Wrapped titles are joined."""
    start = text.find("Numerical Listing of NEISS Product")
    # the first match is the table of contents; use the last one
    idx = [m.start() for m in re.finditer(r"Appendix H: Numerical Listing of NEISS Product", text)]
    if idx:
        start = idx[-1]
    body = text[start:] if start >= 0 else text
    out, last, prev_text = {}, None, None
    for line in body.splitlines():
        if not line.strip() or "Appendices Page" in line or "NEISS Coding Manual" in line or (line.strip().startswith("Code") and "Product Title" in line):
            continue
        m = PRODUCT_LINE.match(line)
        if m:
            last = int(m.group(1))
            out[last] = re.sub(r"\s+", " ", m.group(2))
            prev_text = None
            continue
        bare = re.match(r"^\s+(\d{4})\s*$", line)
        if bare:
            # a long description printed over three lines: text above the code, the code alone, the rest below it
            last = int(bare.group(1))
            out[last] = re.sub(r"\s+", " ", prev_text or "")
            prev_text = None
            continue
        if re.match(r"^\s{4,}\S", line):
            text_line = re.sub(r"\s+", " ", line.strip())
            if last is not None and last in out and out[last] and prev_text is None and text_line[0].islower():
                out[last] = out[last] + " " + text_line   # continuation of a wrapped title
            elif last is not None and last in out and not out[last]:
                out[last] = text_line
            else:
                prev_text = text_line
    return out


SPAN_RE = re.compile(r"^\d{2}[A-Z]?-{1,2}(?:\d{2}[A-Z]?)?$")  # years in use as printed: 72--, 72-78, 98O-19, 96A-01, 78--23
COMP_ROW = re.compile(r"^(\d{4})(\*?)(?:\s+(\S.*))?$")
COMP_SKIP = ("Title", "(IPII", "indicates a code", "page ", "January ", "NEISS ")


def parse_comparability(text):
    """Comparability table -> {code: {"title", "deleted": bool, "neiss_span"}}.

    A row is the four-digit code (a trailing * marks a deleted code), the title, then the NEISS and CPSRMS year spans and notes
    separated by runs of two or more spaces; any of those columns may be missing. A title that wraps continues on the next
    line at the title indent (4-12 columns); text far to the right (30+ columns) is the notes column and is ignored.
    Codes printed with no title (reserved numbers) are skipped.
    """
    out, last = {}, None
    for line in text.splitlines():
        line = line.rstrip()
        m = COMP_ROW.match(line)
        if m:
            rest = m.group(3)
            if not rest:
                last = None
                continue
            parts = re.split(r"\s{2,}", rest.strip())
            span = next((p for p in parts[1:3] if SPAN_RE.match(p)), None)
            last = int(m.group(1))
            out[last] = {"title": re.sub(r"\s+", " ", parts[0]), "deleted": bool(m.group(2)), "neiss_span": span}
            continue
        if last is None or not re.match(r"^\s{4,12}\S", line):
            continue
        piece = re.split(r"\s{3,}", line.strip())[0]
        if piece and not re.match(r"^\d{4}", piece) and not piece.startswith(COMP_SKIP):
            out[last]["title"] += " " + piece
    return out


def pdf_to_text(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True, text=True).stdout


def _norm_title(title):
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def product_labels(manual2025_text, manual2024_text, comparability_text):
    """Return {code: {"label", "source", "in_use", "alternates"}}.

    Precedence (one exact code, first source that lists it wins): 2025 manual, then 2024 manual, then the comparability table
    (its most recent title; "in_use" False for codes it marks deleted). Titles from lower-precedence sources that differ after
    punctuation/case normalisation are kept in "alternates" as [label, source] pairs and never merged into the label.
    """
    comparability = parse_comparability(comparability_text)
    sources = [
        (parse_product_listing(manual2025_text), "NEISS Coding Manual January 2025 (rev.1), Appendix H", None),
        (parse_product_listing(manual2024_text), "NEISS Coding Manual January 2024, Appendix H", None),
        ({c: i["title"] for c, i in comparability.items()},
         "NEISS Product Code Comparability Table (January 2025), most recent title", comparability),
    ]
    out = {}
    for titles, source, comp in sources:
        for code, title in titles.items():
            if code not in out:
                # a code listed in a coding manual is in use; a code known only from the comparability table is in use unless it is marked deleted
                in_use = True if comp is None else not comp[code]["deleted"]
                out[code] = {"label": title, "source": source, "in_use": in_use, "alternates": [], "comparability": None}
            elif _norm_title(title) != _norm_title(out[code]["label"]):
                if not any(_norm_title(a[0]) == _norm_title(title) for a in out[code]["alternates"]):
                    out[code]["alternates"].append([title, source])
            if comp is not None:
                out[code]["comparability"] = {"deleted": comp[code]["deleted"], "span": comp[code]["neiss_span"]}
    return out
