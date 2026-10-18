"""Coordinate-based reader for the DOJ Antitrust Division workload-statistics PDFs (FY1990-1999 ... FY2015-2024).

The PDFs are year-by-column tables. pdftotext -layout output glues superscript footnote markers to values
(e.g. FY2018 "19" + note 20 next to FY2019 "610" prints as "19 20 / 610"), and pdfminer/pdfplumber mis-places
glyphs in the FY1990-1999 file (a "5" drawn under FY1991 is reported next to the FY1990 dash; "21" is split into
"2" + "1" by overlapping space glyphs). Poppler's word boxes (`pdftotext -bbox`, display orientation) match the
rendered page, so this reader takes words from Poppler and uses each word's box height as its size:

* the body size is the height of the fiscal-year header tokens; 1-2 digit or '*' words under 80% of it are
  footnote marks; lines whose words are all under 96% of it are footnote text;
* body words form lines (same bottom edge within LINE_TOL points);
* a line with >= 5 four-digit fiscal-year tokens is a table header and defines the year columns;
* numeric/dash tokens right of the label area go to the year column whose right edge or centre is nearest;
* values-only lines (staggered cells) merge into the row just above them when within ROW_BAND points;
* a text-only line less than CONT_GAP points below a data row continues that row's label (wrapped cell);
  text-only lines between a header and its first data row continue the table heading when equally tight;
* other text-only lines are: all-caps section titles (end the current table), notes ('*...' or long
  sentences), or label-only rows; label-only rows that never receive values become sub-headings ("group")
  for the rows below them (e.g. "Grand Jury Investigations" / "Initiated").

Every value keeps the text exactly as printed (as_published), its PDF page (1-based) and any footnote marks.
"""
import collections
import html
import re
import subprocess

PDFTOTEXT = "/usr/bin/pdftotext"
LINE_TOL = 2.5
CONT_GAP = 14.6  # wrapped-label lines sit 12.6-14.0 pt below their row; distinct rows are >= 15.0 pt apart
ROW_BAND = 16.0
YEAR_RE = re.compile(r"^(19[5-9]\d|20[0-4]\d)$")
NUM_RE = re.compile(r"^\$?-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$")
DASH_RE = re.compile(r"^[-–—]$")
MARK_RE = re.compile(r"^(\d{1,2}|\*+)$")
FOOTER_RE = re.compile(r"^Antitrust Division,? Workload Statistics(\s+\d+)?$")
CONNECTORS = {"and", "or", "of", "with", "to", "the", "for", "in", "a", "an", "by", "as", "from", "on"}


def parse_number(text):
    """'$1,475,109' -> 1475109; '609.8' -> 609.8; '-' -> None (a dash is kept as published, never read as 0)."""
    t = text.strip()
    if DASH_RE.match(t):
        return None
    t = t.replace("$", "").replace(",", "")
    if "." in t:
        return float(t)
    return int(t)


def is_value_token(text):
    return bool(NUM_RE.match(text) or DASH_RE.match(text))


def _text(words):
    return " ".join(w["text"] for w in words).strip()


def _strip_star(label):
    """Trailing '*' footnote marks used by the FY2015-2024 report."""
    marks = []
    while label.endswith("*"):
        label = label[:-1].rstrip()
        marks.append("*")
    return label, marks


PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">')
WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')


def parse_bbox(xhtml):
    """Pages of words from `pdftotext -bbox` XHTML: [[{text, x0, x1, top, bottom, size}]]; size = box height."""
    pages = []
    for chunk in xhtml.split("<page ")[1:]:
        words = []
        for x0, y0, x1, y1, text in WORD_RE.findall(chunk):
            x0, y0, x1, y1 = float(x0), float(y0), float(x1), float(y1)
            words.append({"text": html.unescape(text), "x0": x0, "x1": x1, "top": y0, "bottom": y1, "size": round(y1 - y0, 2), "y": y1})
        pages.append(words)
    return pages


def poppler_pages(path):
    out = subprocess.run([PDFTOTEXT, "-bbox", path, "-"], check=True, capture_output=True)
    return parse_bbox(out.stdout.decode("utf-8"))


def pdfplumber_pages(path):
    """Words with true font sizes. Used for files whose fonts mix (Times headers, Calibri labels), where Poppler box
    heights are not comparable across fonts; pdfminer's glyph placement is correct in those files."""
    import pdfplumber

    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(extra_attrs=["size"], x_tolerance=1.5)
            pages.append([{"text": w["text"], "x0": w["x0"], "x1": w["x1"], "top": w["top"], "bottom": w["bottom"], "size": round(w["size"], 2), "y": w["top"]} for w in words])
    return pages


ENGINES = {"poppler": poppler_pages, "pdfplumber": pdfplumber_pages}


def poppler_version():
    out = subprocess.run([PDFTOTEXT, "-v"], capture_output=True)
    return (out.stderr or out.stdout).decode("utf-8", "replace").splitlines()[0].strip()


def _body_size(words):
    years = [round(w["size"], 1) for w in words if YEAR_RE.match(w["text"])]
    pool = years or [round(w["size"], 1) for w in words]
    return collections.Counter(pool).most_common(1)[0][0]


def _lines(words, body):
    # Footnote marks are 1-2 digit numbers or '*' set in a smaller font. Other smaller words stay in the text:
    # the FY2015-2024 report prints two wide FY2017 dollar cells at 10 pt instead of 12 pt.
    small = [w for w in words if w["size"] < body * 0.8 and MARK_RE.match(w["text"])]
    big = [w for w in words if w not in small]
    lines = []
    for w in sorted(big, key=lambda w: (round(w["y"], 1), w["x0"])):
        if lines and abs(lines[-1]["top"] - w["y"]) <= LINE_TOL:
            lines[-1]["words"].append(w)
        else:
            # a line's "top" is its first word's bottom edge (baseline-like, stable across font sizes)
            lines.append({"top": w["y"], "words": [w], "marks": []})
    for line in lines:
        merged = []
        for w in sorted(line["words"], key=lambda w: w["x0"]):
            if merged and 0 <= w["x0"] - merged[-1]["x1"] < 0.3:
                # touching glyph runs split only by a fractional size/font change ("Case" + bold "s")
                merged[-1] = {**merged[-1], "text": merged[-1]["text"] + w["text"], "x1": w["x1"]}
            else:
                merged.append(w)
        line["words"] = merged
    for w in small:
        if lines:
            # superscripts sit above the baseline: compare the mark's bottom with the line's bottom edge
            nearest = min(lines, key=lambda line: abs(line["top"] - w["y"]))
            if abs(nearest["top"] - w["y"]) <= 8:
                nearest["marks"].append(w)
    return lines, small


def _is_note_text(line, body):
    return all(w["size"] < body * 0.96 for w in line["words"])


def _footnotes(small, lines, body):
    """Footnote texts at the page bottom: a small marker near the left margin, then smaller-size text lines."""
    notes = {}
    markers = sorted((w for w in small if re.match(r"^\d{1,2}$", w["text"]) and w["x0"] < 120), key=lambda w: w["y"])
    text_lines = [ln for ln in lines if _is_note_text(ln, body)]
    for i, m in enumerate(markers):
        end = markers[i + 1]["y"] if i + 1 < len(markers) else 10_000
        body_lines = [ln for ln in text_lines if m["y"] - 4 <= ln["top"] < end - 4]
        text = re.sub(r"\s+", " ", " ".join(_text(ln["words"]) for ln in body_lines)).strip()
        if text and not FOOTER_RE.match(text):
            notes[m["text"]] = text
    return notes


def _is_section_title(text):
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 4 and text == text.upper() and not any(c.isdigit() for c in text)


def read_tables(path, engine="pdfplumber"):
    """Return (tables, footnotes, orphans). engine: 'poppler' (pdftotext -bbox) or 'pdfplumber'.

    tables: [{page, section, heading, heading_marks, columns, notes, rows:[{label, group, page, marks, values:{fy: cell}}]}]
    cell: {as_published, value, page, marks}
    """
    return read_pages(ENGINES[engine](path))


def read_pages(pages):
    """read_tables on already-extracted word pages (tests feed synthetic pages here)."""
    tables, footnotes, orphans = [], {}, []
    section = None
    for _ in (0,):
        for pno, words in enumerate(pages, 1):
            if not words:
                continue
            body = _body_size(words)
            lines, small = _lines(words, body)
            for key, text in _footnotes(small, lines, body).items():
                footnotes[key] = {"page": pno, "text": text}
            table, prev_row, prev_top = None, None, None
            last_text, prefix, pending = None, None, []
            for line in lines:
                ws = line["words"]
                text = _text(ws)
                if FOOTER_RE.match(text) or re.match(r"^\d{1,2}$", text):
                    continue
                if _is_note_text(line, body):
                    continue  # footnote text, read by _footnotes
                if text.startswith("*"):
                    if table is not None:
                        table["notes"].append(text)
                        last_text = {"kind": "note", "top": line["top"]}
                        prev_top = line["top"]
                    continue
                years = [w for w in ws if YEAR_RE.match(w["text"])]
                if len(years) >= 5:
                    first = min(w["x0"] for w in years)
                    table = {
                        "page": pno, "section": section,
                        "heading": _text([w for w in ws if w["x1"] < first - 2]),
                        "heading_marks": [m["text"] for m in line["marks"] if m["x1"] < first - 2],
                        "columns": [{"fy": int(w["text"]), "x0": w["x0"], "x1": w["x1"], "xc": (w["x0"] + w["x1"]) / 2} for w in years],
                        "label_right": first - 8, "rows": [], "notes": [], "open_heading": True,
                    }
                    tables.append(table)
                    prev_row, prev_top, last_text, prefix = None, line["top"], None, None
                    continue
                gap = line["top"] - prev_top if prev_top is not None else 99.0
                if table is None:
                    if any(is_value_token(w["text"]) for w in ws) and not _is_section_title(text):
                        orphans.append({"page": pno, "text": text})
                    elif _is_section_title(text):
                        section = text
                    continue
                label_words = [w for w in ws if w["x1"] <= table["label_right"] or not is_value_token(w["text"])]
                value_words = [w for w in ws if w not in label_words]
                label = _text(label_words)
                if value_words and len(label) > 85:
                    value_words = []  # a sentence (note/footnote) whose stray digit or dash fell in a year column
                    label = text
                if value_words and not label:
                    target = table["rows"][-1] if table["rows"] else None
                    if target is not None and line["top"] - target["top"] <= ROW_BAND and not _clashes(target, value_words, table):
                        _assign(table, target, value_words, line, pno)
                        prev_row, prev_top, last_text = target, line["top"], None
                    else:
                        # cells printed just above their label (FY1990-1999 file): hold for the next label line
                        pending.append({"words": value_words, "line": line, "text": text})
                    continue
                if value_words:
                    label, star = _strip_star(label)
                    if prefix is not None and line["top"] - prefix["top"] <= ROW_BAND + 1:
                        label = prefix["text"] + " " + label  # wrapped label printed above its values
                    prefix = None
                    row = {"label": label, "group": None, "top": line["top"], "x0": label_words[0]["x0"], "page": pno,
                           "values": {}, "marks": star + [m["text"] for m in line["marks"] if m["x1"] <= table["label_right"] + 4]}
                    table["rows"].append(row)
                    _assign(table, row, value_words, line, pno)
                    table["open_heading"] = False
                    prev_row, prev_top, last_text = row, line["top"], None
                    continue
                # text-only line
                if table["open_heading"] and not table["rows"] and gap < CONT_GAP:
                    table["heading"] = (table["heading"] + " " + text).strip()
                    table["heading_marks"] += [m["text"] for m in line["marks"]]
                    prev_top = line["top"]
                    continue
                if prev_row is not None and last_text is None and gap < CONT_GAP and ws[0]["x0"] >= prev_row["x0"] - 12:
                    prev_row["label"] = _strip_star((prev_row["label"] + " " + text).strip())[0]
                    prev_row["marks"] += [m["text"] for m in line["marks"]]
                    prev_top = line["top"]
                    continue
                if text[:1].islower() and last_text is not None and line["top"] - last_text["top"] <= ROW_BAND + 1:
                    # lower-case start: the previous sub-heading or note wraps onto this line
                    if last_text["kind"] == "note":
                        table["notes"][-1] += " " + text
                    else:
                        last_text["row"]["label"] = (last_text["row"]["label"] + " " + text).strip()
                    last_text["top"] = prev_top = line["top"]
                    continue
                if _is_section_title(text):
                    section = text
                    table, prev_row, last_text, prefix = None, None, None, None
                    prev_top = line["top"]
                    continue
                if text.endswith(".") or len(text) > 80:
                    table["notes"].append(text)
                    last_text = {"kind": "note", "top": line["top"]}
                    prev_top = line["top"]
                    continue
                if text.split()[-1].lower() in CONNECTORS:
                    prefix = {"text": text, "top": line["top"]}  # first half of a label wrapped above its values
                    prev_top = line["top"]
                    continue
                row = {"label": _strip_star(text)[0], "group": None, "top": line["top"], "x0": ws[0]["x0"], "page": pno,
                       "values": {}, "marks": [m["text"] for m in line["marks"]]}
                table["rows"].append(row)
                table["open_heading"] = False
                prev_row, prev_top = row, line["top"]
                last_text = {"kind": "row", "row": row, "top": line["top"]}
                held = [p for p in pending if 0 < line["top"] - p["line"]["top"] <= ROW_BAND]
                for p in held:
                    _assign(table, row, p["words"], p["line"], pno)
                    pending.remove(p)
                if held:
                    last_text = None
            orphans.extend({"page": pno, "text": p["text"]} for p in pending)
            pending.clear()
    for t in tables:
        _finalise(t)
    return tables, footnotes, orphans


def _column(table, w):
    xc = (w["x0"] + w["x1"]) / 2
    return min(table["columns"], key=lambda c: min(abs(w["x1"] - c["x1"]), abs(xc - c["xc"])))["fy"]


def _clashes(row, value_words, table):
    """True when any of these cells would land in a year the row already holds (they belong to another row)."""
    return any(_column(table, w) in row["values"] for w in value_words)


def _assign(table, row, value_words, line, pno):
    cols = table["columns"]
    for w in value_words:
        xc = (w["x0"] + w["x1"]) / 2
        best = min(cols, key=lambda c: min(abs(w["x1"] - c["x1"]), abs(xc - c["xc"])))
        dist = min(abs(w["x1"] - best["x1"]), abs(xc - best["xc"]))
        if dist > 30:
            row.setdefault("unassigned", []).append(w["text"])
            continue
        if best["fy"] in row["values"]:
            row.setdefault("conflicts", []).append({"fy": best["fy"], "text": w["text"]})
            continue
        marks = [m["text"] for m in line["marks"] if 0 <= m["x0"] - w["x1"] <= 3]
        row["values"][best["fy"]] = {"as_published": w["text"], "value": parse_number(w["text"]), "page": pno, "marks": marks}


def _finalise(table):
    """Label-only rows that never received values become sub-headings ("group") for the rows below them."""
    rows, group = [], None
    for row in table["rows"]:
        if not row["values"]:
            group = row["label"]
            continue
        row["group"] = group
        rows.append(row)
    table["rows"] = rows
    table.pop("open_heading", None)
