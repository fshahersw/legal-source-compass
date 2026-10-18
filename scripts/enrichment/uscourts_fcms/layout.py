"""Layout reader for FCMS judicial caseload profile PDFs (born-digital editions only).

pdftotext -bbox (poppler) gives every word with its box. Words are grouped into lines; the year header line
(four or more tokens 19xx/20xx) fixes the period columns; labels are the words left of the first column;
value tokens are assigned to the nearest period column, or to a standing column right of the last period.
Label lines accumulate until a line carries values, so a row's label is every label word since the previous
value line (labels printed above their values and labels printed beside them both work).

Nothing here interprets a value: tokens are kept exactly as printed ("4,666", "-", "84.6%").
"""
import html
import re
import subprocess

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')
PAGE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">')
YEAR = re.compile(r"^(19|20)\d\d$")
# A printed value: optional minus (hyphen, U+2212 or the soft hyphen U+00AD that 2008-2016 editions use as minus
# and as the "not available" dash), digits with optional thousands commas, optional decimals (".7" and "-.7" occur
# in 2004-2009 editions) and optional percent sign; or a lone dash.
MINUS = "\\-\u2212\u00ad\u2010\u2011"  # hyphen-minus, minus sign, soft hyphen (2008-2016), hyphen / non-breaking hyphen (2011)
VALUE = re.compile(r"^(?:[" + MINUS + r"]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)%?|[" + MINUS + r"–—]"
                   r"|\d+/\d+(?:\.\d+)?)$")  # last alternative: "12/4.0" (judgeships/panels, 2004-2009 appeals pages)
DASHES = {"-", "–", "—", "−", "­"}
SUPERSCRIPTS = set("¹²³⁴⁵*")
STOP_LINE = re.compile(r"(nature of suit|nature of offense|^type of\b|^total civil|explanation of|^note:|^includes only judges"
                       r"|^prior to december|^filings in the|for national profile)", re.I)


def pdf_words(path):
    """Return [{'width','height','words':[(x0,y0,x1,y1,text)]}] for every page of a PDF (poppler pdftotext -bbox)."""
    out = subprocess.run(["pdftotext", "-bbox", str(path), "-"], check=True, capture_output=True).stdout.decode("utf-8", "replace")
    return parse_bbox(out)


def parse_bbox(text):
    pages = []
    chunks = re.split(r"(?=<page )", text)
    for chunk in chunks:
        m = PAGE.search(chunk)
        if not m:
            continue
        words = []
        for a, b, c, d, t in WORD.findall(chunk):
            words.extend(split_glued(float(a), float(b), float(c), float(d), html.unescape(t)))
        pages.append({"width": float(m.group(1)), "height": float(m.group(2)), "words": words})
    return pages


GLUED = re.compile(r"\d{1,3}(?:,\d{3})+")
GLUED_JP = re.compile(r"\d+/\d+\.\d")  # "67/55.766/55.3": judgeships/panels cells printed with no space


def split_glued(x0, y0, x1, y1, text):
    """2004-2009 national pages print adjacent large numbers with no space ("330,721358,983328,520").

    A word is split only when two or more comma-grouped numbers concatenate to exactly the word; each piece gets
    the share of the word box proportional to its characters. Anything else is returned unchanged.
    """
    for pattern, need in ((GLUED, ","), (GLUED_JP, "/")):
        if need in text and len(text) > 8:
            pieces = pattern.findall(text)
            if len(pieces) >= 2 and "".join(pieces) == text:
                out, pos, n = [], 0, len(text)
                for piece in pieces:
                    a = x0 + (x1 - x0) * pos / n
                    pos += len(piece)
                    out.append((a, y0, x0 + (x1 - x0) * pos / n, y1, piece))
                return out
    return [(x0, y0, x1, y1, text)]


def group_lines(words, tol=3.0):
    """Group words into lines by vertical centre; each line is sorted left to right."""
    items = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    lines = []
    for w in items:
        mid = (w[1] + w[3]) / 2
        if lines and abs(lines[-1]["mid"] - mid) <= tol:
            lines[-1]["words"].append(w)
            n = len(lines[-1]["words"])
            lines[-1]["mid"] = (lines[-1]["mid"] * (n - 1) + mid) / n
        else:
            lines.append({"mid": mid, "words": [w]})
    for line in lines:
        line["words"].sort(key=lambda w: w[0])
    return lines


def is_value(token):
    return bool(VALUE.match(token))


def year_header(lines):
    """Index and year words of the first line holding at least four year tokens."""
    for i, line in enumerate(lines):
        years = [w for w in line["words"] if YEAR.match(w[4])]
        if len(years) >= 4:
            return i, years
    return None, []


def panels_from_years(year_words, gap_factor=2.2):
    """Split year header words into panels where the gap between neighbours is much wider than usual."""
    ys = sorted(year_words, key=lambda w: w[0])
    if len(ys) < 2:
        return [ys]
    gaps = [ys[i + 1][0] - ys[i][0] for i in range(len(ys) - 1)]
    typical = sorted(gaps)[len(gaps) // 2]
    panels, cur = [], [ys[0]]
    for g, w in zip(gaps, ys[1:]):
        if g > gap_factor * typical:
            panels.append(cur)
            cur = [w]
        else:
            cur.append(w)
    panels.append(cur)
    return panels


def clean_label(words):
    toks = []
    for w in words:
        t = w[4]
        if len(t) == 1 and t.isalpha():  # rotated section captions are printed one letter per word
            continue
        t = "".join(ch for ch in t if ch not in SUPERSCRIPTS)
        if t:
            toks.append(t)
    return " ".join(toks)


def read_panel(lines, start, years, x_left, x_right, standing_cols=(), right_limit=None):
    """Rows of one table panel.

    years: year header words of this panel (left to right). Labels are words with x0 in [x_left, first column
    left edge - 4); values are value tokens between the first column and right_limit. standing_cols is a list of
    (name, x_centre) for numeric standing columns right of the last period column.
    """
    centres = [((w[0] + w[2]) / 2, w[4]) for w in years]
    spacing = (centres[-1][0] - centres[0][0]) / max(1, len(centres) - 1)
    first_left = min(w[0] for w in years) - 0.45 * spacing
    last_right = centres[-1][0] + 0.55 * spacing
    right_limit = right_limit if right_limit is not None else 1e9
    rows, label = [], []
    for line in lines[start:]:
        words = [w for w in line["words"] if x_left <= w[0] < right_limit]
        if not words:
            continue
        label_words = [w for w in words if w[0] < first_left and not is_value(w[4])]
        text = clean_label(label_words)
        if STOP_LINE.search(text.strip()) or (words and words[0][4][:1] in "¹²³" and words[0][0] < first_left):
            break
        value_words = [w for w in words if w[0] >= first_left - 2 and is_value(w[4])]
        label.extend(label_words)
        if not value_words:
            continue
        values, standing, stray = {}, {}, []
        for w in value_words:
            cx = (w[0] + w[2]) / 2
            if cx <= last_right:
                # numbers are right-aligned under the period header: compare right edges
                best = min(centres, key=lambda c: abs(c[0] - cx))
                if abs(best[0] - cx) <= 0.6 * spacing:
                    if best[1] in values:
                        stray.append(w[4])
                    else:
                        values[best[1]] = w[4]
                else:
                    stray.append(w[4])
            elif standing_cols:
                name, sx = min(standing_cols, key=lambda c: abs(c[1] - cx))
                if abs(sx - cx) <= 30 and name not in standing:
                    standing[name] = w[4]
                else:
                    stray.append(w[4])
            else:
                stray.append(w[4])
        rows.append({"label": clean_label(label), "values": values, "standing": standing, "stray": stray, "y": round(line["mid"], 1)})
        label = []
    return rows


def header_text(lines, upto, x_max):
    """Upper-case caption words (court name) starting left of x_max on the lines above the year header.

    The title line ("U.S. District Court - Judicial Caseload Profile") and the period caption words
    ("12-MONTH PERIOD ENDING SEPTEMBER 30") are skipped; no court name contains those words.
    """
    start = 0
    for i, line in enumerate(lines[:upto + 1]):
        if any(w[4].upper() == "PROFILE" for w in line["words"]):
            start = i + 1
            break
    words = []
    for line in lines[start:upto + 1]:
        for w in line["words"]:
            if w[0] < x_max and re.match(r"^[A-Z][A-Z.'&-]*$", w[4]) and w[4] not in ("U.S.",) \
                    and w[4] not in ("PERIOD", "ENDING", "SEPTEMBER", "JUNE", "MARCH", "DECEMBER"):
                words.append(w[4])
    return " ".join(words)
