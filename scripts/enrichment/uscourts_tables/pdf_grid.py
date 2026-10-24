"""Read a U.S. Courts table PDF from the positions of the words in its text layer (pdfplumber), into the sheet structure utx_parse
returns for a workbook: title, column heading words per column, rows with label, indentation, figures and flags, notes.

The text layer holds every printed word with its position; nothing is recognised from images. A figure column is a run of
right-aligned numbers: the right edges of the numbers on the table's data lines cluster at one position per column, and every
figure of a data line must fall into exactly one column (a line with two figures in one column, or a figure outside every column,
is not read). Words above the first data line are the title and the column headings; each heading word belongs to the column
whose band holds its centre. Text lines between data lines are section headings or the first half of a wrapped row label; the
words after the last data line are the notes. Footnote marks are printed smaller than the text (pdfplumber reports the size)
and are kept as marks, never read as figures.

Values are the printed figures (thousands separators removed; a printed dash is a dash, never zero; "(NA)" stays text). Nothing
is computed here. Column names come from a reference workbook edition (pdf_align.py); this module only reports what the page
prints.
"""
import io
import re
from statistics import median

# a printed dash: hyphen, en and em dashes, the hyphen and minus signs, and the soft hyphen some BAPCPA PDFs print for a dash
DASHES = {"-", "—", "–", "‐", "‑", "−", "\u00ad", "--"}
NUM = re.compile(r"^(?:\(?-?\$?\d[\d,]*(?:\.\d+)?%?\)?|-?\.\d+|\(NA\)|NA|N/A|NP|NR|NI|\*\*?|" + "|".join(re.escape(d) for d in sorted(DASHES)) + r")$")
NA_TOKENS = {"(NA)", "NA", "N/A", "*", "**"}
# the Wiretap reports print NP (no prosecutor's report), NR (not reported) and NI (never installed) in figure columns: text cells
# a wrapped label line ends with a word that cannot end a row label
CONNECTORS = {"and", "of", "or", "the", "for", "to", "in", "by", "with", "on", "including", "under", "from", "&", "-", "/"}
ROW_TOL = 2.6       # points: words whose tops differ by less are on one line
COL_GAP = 7.0       # points: right edges further apart than this start a new figure column
MARK_RATIO = 0.82   # a word printed at less than this share of the line's text size is a footnote mark
SPLIT_GAP = 3.0    # points: a lone capital this close before a lower-case word is the first letter of that word


def is_number(text):
    return bool(NUM.match(text))


def to_value(token):
    """Printed token -> (value | None, flag): a number, a dash ('dash'), not available ('na'); text is ('text:...')."""
    t = token.strip()
    if t in DASHES:
        return None, "dash"
    if t in NA_TOKENS:
        return None, "na"
    neg = t.startswith("(") and t.endswith(")") and re.fullmatch(r"\(\$?[\d,.]+\)", t) is not None
    pct = t.endswith("%")
    plain = t.strip("()").replace("$", "").rstrip("%").replace(",", "")
    try:
        value = int(plain) if re.fullmatch(r"-?\d+", plain) else float(plain)
    except ValueError:
        return None, "text:" + t[:40]
    if neg:
        value = -value
    return value, ("pct" if pct else None)


# ------------------------------------------------------------------------------------------------------------- words, lines

def page_words(page):
    return page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False, use_text_flow=False, extra_attrs=["size"])


def lines_of(words):
    """Words grouped into lines (top within ROW_TOL), in reading order; small words become marks of the word before them."""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for line in lines[-3:]:
            if abs(line["top"] - w["top"]) <= ROW_TOL or (w["size"] < line["size"] * MARK_RATIO and -1 <= w["top"] - line["top"] <= ROW_TOL + 3):
                line["words"].append(w)
                break
        else:
            lines.append({"top": w["top"], "size": w["size"], "words": [w]})
    out = []
    for line in lines:
        ws = sorted(line["words"], key=lambda w: w["x0"])
        size = median([w["size"] for w in ws])
        words = []
        for w in ws:
            item = {"text": w["text"], "x0": w["x0"], "x1": w["x1"], "size": w["size"], "mark": w["size"] < size * MARK_RATIO}
            prev = words[-1] if words else None
            # a capital the text layer sets apart from the rest of its word ("A cquitted"): one word again
            if prev and re.fullmatch(r"[A-Z]", prev["text"]) and re.match(r"[a-z]", w["text"]) and 0 <= w["x0"] - prev["x1"] < SPLIT_GAP \
                    and abs(w["size"] - prev["size"]) < 0.1:
                prev["text"] += w["text"]
                prev["x1"] = w["x1"]
                continue
            words.append(item)
        out.append({"top": line["top"], "size": size, "words": words})
    out.sort(key=lambda l: l["top"])
    return out


# ------------------------------------------------------------------------------------------------------------- lines -> label + figures

LABEL_GAP = 6.0     # points: a number this close after the label's last word is part of the label ("Chapter 7")
YEAR = re.compile(r"^(?:19|20)\d{2}$")


def split_line(line):
    """(label words, figure words, mark words) of a line: the figures are the run of numbers at the end of the line; a number set at
    word spacing right after the label text belongs to the label."""
    words = [w for w in line["words"] if not w["mark"]]
    marks = [w for w in line["words"] if w["mark"]]
    k = len(words)
    while k > 0 and is_number(words[k - 1]["text"]):
        k -= 1
    label, figs = words[:k], words[k:]
    while figs and label and figs[0]["x0"] - label[-1]["x1"] < LABEL_GAP:
        label.append(figs.pop(0))
    return label, figs, marks


SORT_CODE = re.compile(r"^(?:0\.0|\d{2,3}[A-Z]?)$")


def _trailing_codes(lines):
    out = []
    for ln in lines:
        ws = [w for w in ln["words"] if not w["mark"]] or ln["words"]
        if ws and SORT_CODE.match(ws[-1]["text"]):
            out.append(((ws[-1]["x0"] + ws[-1]["x1"]) / 2, ws[-1]))
    return out


def sort_band(pages_lines):
    """Per page, the x centre of the publisher's sort-order codes printed at the right edge of BAPCPA pages ("0.0" for the Total,
    "00" and "05" for circuits, "050" or "09A" for districts; the workbooks head this helper column "Sort Order"), or None. The
    document must print such codes, several with a leading zero (no count is printed with one); on each page the codes sit in a
    narrow band of their own at the right, which no figure of the page reaches."""
    every = [c for lines in pages_lines for c in _trailing_codes(lines)]
    if len(every) < 5 or sum(1 for _, w in every if w["text"].startswith("0")) < 3:
        return [None] * len(pages_lines)
    out = []
    for lines in pages_lines:
        codes = _trailing_codes(lines)
        if len(codes) < 2:
            out.append(None)
            continue
        centre = median([c for c, _ in codes])
        clash = False
        for ln in lines:
            if sum(1 for w in ln["words"] if is_number(w["text"])) < 2:
                continue  # notes and titles run across the page; only lines with figures can hold a column
            for w in ln["words"]:
                if abs((w["x0"] + w["x1"]) / 2 - centre) <= 8 and not SORT_CODE.match(w["text"]) and w["text"].lower() not in ("sort", "order"):
                    clash = True
        out.append(None if clash else centre)
    return out


def strip_sort_codes(lines, centre):
    """Remove the codes (and their "Sort Order" heading) in the sort band; returns how many words were removed."""
    if centre is None:
        return 0
    removed = 0
    for ln in lines:
        if not any(SORT_CODE.match(w["text"]) or w["text"].lower() in ("sort", "order") for w in ln["words"]):
            continue
        keep = [w for w in ln["words"] if not (abs((w["x0"] + w["x1"]) / 2 - centre) <= 10 and (SORT_CODE.match(w["text"]) or w["text"].lower() in ("sort", "order")))]
        removed += len(ln["words"]) - len(keep)
        ln["words"] = keep
    return removed


def modal(values):
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(sorted(counts), key=lambda v: counts[v]) if counts else None


TITLE_ID = re.compile(r"^\s*(?:(BAPCPA|Wiretap)\s+)?Table\s+([A-Z]{0,4}-?\d+[A-Z]?(?:-\d+)?)\b", re.I)
PERIOD = re.compile(r"\b(?:Ending|Ended|As of|Calendar Year)\b", re.I)


def parse_page(page, lines=None, sort_centre=None):
    """One page: {"title": [lines], "headers": [[words with "band"]], "rows": [...], "notes": [lines], "ncols", "edges", "problems"}.

    Every data line of a court or category table prints a figure (or a dash) in every column, so the figures of a line are read in
    order: the page's column count is the most common figure count of its data lines, and a line with that count fills every
    column. A line with fewer figures is placed by the right edges of its numbers (each must sit at a column edge); a line with more
    is not read. Column edges come from the first full lines under the headings, which is where the headings were set."""
    lines = lines if lines is not None else lines_of(page_words(page))
    sort_codes = strip_sort_codes(lines, sort_centre)
    lines = [ln for ln in lines if ln["words"]]
    result = {"title": [], "headers": [], "rows": [], "notes": [], "ncols": 0, "edges": [], "problems": [], "width": page.width, "sort_codes": sort_codes}
    split = [(ln, *split_line(ln)) for ln in lines]
    counts = [len(f) for ln, lab, f, m in split if lab and len(f) >= 2 and not all(YEAR.match(w["text"]) for w in f)]
    ncols = modal(counts)
    if not ncols:
        result["text"] = [text_of(ln["words"]) for ln in lines]
        return result
    first = next((i for i, (ln, lab, f, m) in enumerate(split) if lab and len(f) == ncols and not all(YEAR.match(w["text"]) for w in f)), None)
    full = [f for ln, lab, f, m in split[first:] if lab and len(f) == ncols][:15]
    edges = [median([f[i]["x1"] for f in full]) for i in range(ncols)]
    # the widest figure under the headings gives a column's left side (numbers are right-aligned, headings centred over the column)
    lefts = [min(f[i]["x0"] for f in full if abs(f[i]["x1"] - edges[i]) <= COL_GAP) for i in range(ncols)]
    result.update({"ncols": ncols, "edges": edges})
    bnds = []
    for i in range(ncols):
        left = (edges[i - 1] + lefts[i]) / 2 if i else lefts[i] - 30
        right = (edges[i] + lefts[i + 1]) / 2 if i + 1 < ncols else edges[i] + 40
        bnds.append((left, right))
    result["bands"] = bnds
    items = []
    for i, (ln, lab, figs, marks) in enumerate(split):
        if i < first:
            items.append(("pre", ln, lab, figs, marks))
            continue
        if figs and not lab:
            items.append(("figs" if len(figs) >= 2 else "pagenum", ln, lab, figs, marks))
        elif figs:
            items.append(("data", ln, lab, figs, marks))
        elif lab and all(is_number(w["text"]) for w in lab):
            items.append(("pagenum", ln, lab, figs, marks))
        else:
            items.append(("text", ln, lab, figs, marks))
    last = max(i for i, it in enumerate(items) if it[0] in ("data", "figs"))
    # title and headings
    pre = [it for it in items[:first] if text_of(it[1]["words"]) and not all(is_number(w["text"]) for w in it[1]["words"])]
    title_end = title_lines(pre)
    result["title"] = [text_of(it[1]["words"]) for it in pre[:title_end]]
    for it in pre[title_end:]:
        result["headers"].append([{**w, "top": it[1]["top"]} for w in phrase_bands(it[1]["words"], bnds)])
    for kind, ln, lab, figs, marks in items[first:last + 1]:
        if kind in ("data", "figs"):
            values, flags, ok = place(figs, ncols, edges)
            if not ok:
                result["problems"].append(f"a line prints {len(figs)} figures where the page has {ncols} columns: " + text_of(ln["words"])[:90])
                continue
            result["rows"].append({"kind": "data", "label_words": lab, "marks": [m["text"] for m in marks], "x0": round(lab[0]["x0"] - edges[0], 1) if lab else None,
                                   "values": values, "flags": flags, "top": ln["top"], "raw": raw_tokens(figs, values, ncols, edges)})
        elif kind == "text" and lab:
            result["rows"].append({"kind": "text", "label_words": lab, "marks": [m["text"] for m in marks], "x0": round(lab[0]["x0"] - edges[0], 1), "top": ln["top"]})
    result["notes"] = [t for t in (text_of(it[1]["words"]) for it in items[last + 1:] if it[0] in ("text", "data") and it[1]["words"])
                       if not re.fullmatch(r"(?:Page\s+)?\d+(?:\s+of\s+\d+)?", t, re.I)]
    return result


STRICT_PERIOD = re.compile(r"\b(?:Ending|Ended|Calendar Year|Fiscal Years?\s+(?:19|20)\d{2}|Through December 31)\b", re.I)


def title_lines(pre):
    """How many of the lines above the headings are the title: through the line with the period phrase ("... Ending June 30, 2010");
    on a continued page only the first line ("Table D-1. (September 30, 2012--Continued)"), so a heading such as "Not Terminated as of
    September 30, 2011" is never read as the title."""
    texts = [text_of(it[1]["words"]) for it in pre]
    if not texts:
        return 0
    if re.search(r"continued", texts[0], re.I):
        return 1
    for i, t in enumerate(texts[:5]):
        if STRICT_PERIOD.search(t):
            return i + 1
    for i, t in enumerate(texts[:3]):
        if re.search(r"\bAs of\b", t, re.I):
            return i + 1
    return 1 if TITLE_ID.match(texts[0]) else 0


def place(figs, ncols, edges):
    """(values, flags, ok): a full line in order; a short line by the right edge of each number (a centred dash by its centre)."""
    if len(figs) > ncols:
        return None, None, False
    values, flags = [None] * ncols, ["blank"] * ncols
    if len(figs) == ncols:
        slots = list(range(ncols))
    else:
        slots, j = [], 0
        for w in figs:
            centre = (w["x0"] + w["x1"]) / 2
            best = None
            for i in range(j, ncols):
                if abs(w["x1"] - edges[i]) <= COL_GAP or (w["text"] in DASHES and abs(centre - edges[i]) <= 3 * COL_GAP):
                    best = i
                    break
            if best is None:
                return None, None, False
            slots.append(best)
            j = best + 1
    for w, i in zip(figs, slots):
        values[i], flags[i] = to_value(w["text"])
    return values, flags, True


def raw_tokens(figs, values, ncols, edges):
    """The printed tokens of a data line by column (None where nothing is printed), for checks that need the exact text ("010")."""
    if len(figs) == ncols:
        return [w["text"] for w in figs]
    out = [None] * ncols
    j = 0
    for w in figs:
        for i in range(j, ncols):
            if abs(w["x1"] - edges[i]) <= COL_GAP or (w["text"] in DASHES and abs((w["x0"] + w["x1"]) / 2 - edges[i]) <= 3 * COL_GAP):
                out[i] = w["text"]
                j = i + 1
                break
    return out


PHRASE_GAP = 4.0  # points: heading words closer than this are one phrase ("Class A", "By Judge") and sit over one column


def phrase_bands(words, bnds):
    """Heading words with the band (column) each belongs to: the words of one phrase take the band of the phrase's centre, so a
    short word between two columns ("A" in "Class A") goes with the phrase it belongs to."""
    out, phrase = [], []

    def flush():
        if not phrase:
            return
        centre = (phrase[0]["x0"] + phrase[-1]["x1"]) / 2
        band = band_of({"x0": centre, "x1": centre}, bnds)
        out.extend({**w, "band": band} for w in phrase)
        phrase.clear()

    for w in sorted(words, key=lambda w: w["x0"]):
        if w["mark"]:
            out.append({**w, "band": band_of(w, bnds)})
            continue
        if phrase and w["x0"] - phrase[-1]["x1"] >= PHRASE_GAP:
            flush()
        phrase.append(w)
    flush()
    return out


def band_of(word, bnds):
    centre = (word["x0"] + word["x1"]) / 2
    for i, (l, r) in enumerate(bnds):
        if l <= centre <= r:
            return i
    return None


def read_pdf(data):
    import pdfplumber

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        pages_lines = [lines_of(page_words(p)) for p in pdf.pages]
        centres = sort_band(pages_lines)
        out = [parse_page(p, lines, c) for p, lines, c in zip(pdf.pages, pages_lines, centres)]
    for i, page in enumerate(out):
        page["index"] = i
        for r in page["rows"]:
            r["page"] = i
    return out


# ------------------------------------------------------------------------------------------------------------- blocks

def header_signature(page):
    """The page's layout: its column count and the words of its column headings in reading order (marks and title left out); every
    page of one layout prints the same headings."""
    # words over the label column ("Major Offense", or "FRAUD (CONTINUED)" printed at the top of a continued page) are not headings
    words = [re.sub(r"[^a-z]", "", w["text"].lower()) for line in page["headers"] for w in line if not w["mark"] and w["band"] is not None]
    return (page["ncols"], " ".join(w for w in words if w))


def blocks_of(pages):
    """Pages grouped into blocks by layout: pages with the same column headings are one block (a table running over several pages
    repeats its headings), in page order; a wide table printed in halves (left columns on one page, right columns on the next)
    gives one block per half, and each half lists the same rows."""
    order, blocks = [], {}
    last = None
    for p in pages:
        if not p["rows"]:
            continue
        sig = header_signature(p)
        if not p["headers"] and last is not None and last[0] == p["ncols"] and \
                all(abs(a - b) <= 8 for a, b in zip(blocks[last]["pages"][-1]["edges"], p["edges"])):
            blocks[last]["pages"].append(p)  # a continued page that does not repeat the headings
            continue
        last = sig
        if sig not in blocks:
            blocks[sig] = {"pages": [], "sig": sig}
            order.append(sig)
        blocks[sig]["pages"].append(p)
    out = []
    for sig in order:
        b = blocks[sig]
        first = b["pages"][0]
        b.update({"ncols": first["ncols"], "edges": first["edges"], "headers": first["headers"], "title": first["title"],
                  "rows": [r for p in b["pages"] for r in p["rows"]], "notes": [n for p in b["pages"] for n in p["notes"]],
                  "problems": [x for p in b["pages"] for x in p["problems"]]})
        out.append(b)
    return out


# ------------------------------------------------------------------------------------------------------------- labels

def text_of(words):
    return re.sub(r"\s+", " ", " ".join(w["text"] for w in words)).strip()


def ends_open(text):
    """True when a label line cannot end there ("RECOVERY OF OVERPAYMENTS AND", "PERSONAL INJURY/")."""
    t = text.strip()
    if not t:
        return False
    if t.endswith(("/", "-", ",", "—", "–", "(")):
        return True
    last = t.split()[-1].lower()
    return last in CONNECTORS


def join_rows(rows, known_labels=None):
    """Merge each wrapped label into the data row it continues: a text line whose words cannot end a label, or whose words joined to
    the next data row's label give a label the reference prints (known_labels, normalised), is the first half of that row's label.
    Every other text line is a section heading. Returns rows: {"label", "x0", "section", "values", "flags", "marks"}."""
    known = known_labels or set()
    out = []
    pending = []
    for r in rows:
        if r["kind"] == "text":
            pending.append(r)
            continue
        label = text_of(r["label_words"])
        x0 = r["x0"]
        heads = []
        while pending:
            t = pending.pop(0)
            text = text_of(t["label_words"])
            joined = f"{text} {label}" if not text.endswith("/") else f"{text}{label}"
            rest = pending
            # a wrapped label: the text line can only continue, or the joined label is one the reference prints and the short
            # one is not, or the figures stand on a line of their own under it; it is the line right above the row
            if not rest and (not label or ends_open(text) or (norm_label(joined) in known and norm_label(label) not in known)):
                label, x0 = (joined.strip() if label else text), t["x0"]
            else:
                heads.append(t)
        for t in heads:
            out.append({"label": text_of(t["label_words"]), "x0": t["x0"], "section": True, "values": None, "flags": None, "marks": t["marks"]})
        out.append({"label": label, "x0": x0, "section": False, "values": r["values"], "flags": r["flags"], "marks": r["marks"], "raw": r.get("raw")})
    return out


def norm_label(text):
    t = text.lower().replace("’", "'").replace("—", "-").replace("–", "-").replace("--", "-")
    t = re.sub(r"\s*/\s*", "/", t)
    t = re.sub(r"[^a-z0-9/&'.,() -]+", " ", t)
    return re.sub(r"\s+", " ", t).strip(" ,.")
