"""Name the columns of a PDF table (pdf_grid.py) after the columns of a reference workbook edition of the same table.

A PDF edition often prints fewer or more columns than the spreadsheet editions (a column added or dropped over the years), so its
columns cannot be named by position. They are named by the heading words the PDF itself prints:

  * a PDF column can take a reference column only if every word of the reference column's own heading (its last heading
    element, "Original", "By Staff", "Pending July 1, 2016") is printed in that PDF column's heading band, with years made relative
    to each edition's period ("2016" in the 2017 edition and "2009" in the 2010 edition are both "the year before");
  * columns are matched in order (left to right in both), every PDF column must be matched, and the match with the most heading
    words in common must be the only one with that score;
  * every group heading of the matched reference columns ("Terminated", "On Procedural Grounds") must be printed above the PDF
    columns it covers (its words inside the horizontal span of those columns), so a column whose group changed meaning between
    editions ("Procedural Terminations" without consolidation in 2010, "On Procedural Grounds" with it in 2017) is not matched.

If no such match exists the edition is not read this way (it stays a gap). The figures are then checked against the table's own
totals by reconcile.py like every other table-period.
"""
import re

# The publisher's own renamings of the same heading (checked against editions that print both forms in their notes or titles):
# "Commenced" became "Filed", "Terminations"/"Disposed" became "Terminated", "Oral Hearing" became "Oral Argument" (B-10, B-4),
# "Pct." is "Percent", and "Defendents" is a misspelling some editions print.
SYNONYMS = {"commenced": "filed", "filing": "filed", "filed": "filed", "termination": "terminated", "terminated": "terminated",
            "disposed": "terminated", "defendent": "defendant", "pct": "percent", "hearing": "argument"}
STOP = {"of", "the", "and", "a", "an", "in", "on", "by", "to", "for", "or", "as", "at", "case", "number", "total", "per"}
YEAR = re.compile(r"\b((?:19|20)\d{2})\b")
MONTHS = {m[:3]: m for m in ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")}


# Abbreviations the older editions print for the same heading word.
ABBREVIATIONS = {"percentchange": "percent", "chap": "chapter", "cert": "certificate", "govt": "government", "gov": "government", "mos": "month", "yrs": "year",
                 "dist": "district", "pct": "percent"}
MONTH_DAY = re.compile(r"\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?)\s+\d{1,2}(?=\s*,|\s+(?:19|20)\d{2})", re.I)


def words_of(text, year, parts=True):
    """Normalised heading words: lower case, years relative to the edition's year ("ym1"), the day of a date left out ("July 1, 2009"),
    a footnote digit glued to a word left out ("Conditions1"), month names and abbreviations spelled out ("Chap." = "Chapter"),
    plurals singular, and the publisher's renamings unified ("Commenced" = "Filed"). Other numbers stay ("Chapter 7", "1 Day").
    A word broken over two lines ("Consoli- dation") is joined; a hyphenated compound ("Non-Jury", "Percent-Change") gives the
    joined word and, with parts=True, its parts as well, so "Nonjury" and "Non-Jury" read the same."""
    t = re.sub(r"(\w)-\s+(\w)", r"\1\2", text)
    t = MONTH_DAY.sub(r"\1", t)
    t = re.sub(r"(?<=[A-Za-z])\d+\b", "", t)
    t = YEAR.sub(lambda m: f" y{'m' if int(m.group(1)) < year else ''}{abs(int(m.group(1)) - year)} ", t)
    out = []
    for raw in re.findall(r"[A-Za-z0-9]+(?:-[A-Za-z]+)*", t):
        pieces = raw.lower().split("-")
        forms = ["".join(pieces)] + (pieces if parts and len(pieces) > 1 else [])
        for w in forms:
            w = MONTHS.get(w[:3], w) if w[:3] in MONTHS and len(w) <= 9 and not w[0].isdigit() else w
            w = ABBREVIATIONS.get(w, w)
            if len(w) > 4 and w.endswith("s") and not w.endswith("ss") and not w[0].isdigit():
                w = w[:-1]  # "Arguments" and "Argument", "Schedules" and "Schedule"
            out.append(SYNONYMS.get(w, w))
    return out


def band_words(block, year):
    """{band: [words]} and the header words with their x centres (for group checks), marks left out; a word broken over two heading
    lines with a hyphen ("Consoli-" / "dation") in the same band is joined."""
    per, placed = {}, []
    for line in block["headers"]:
        for w in line:
            if w["mark"]:
                continue
            placed.append(((w["x0"] + w["x1"]) / 2, w["text"]))
            if w["band"] is not None:
                per.setdefault(w["band"], []).append(w["text"])
    out = {}
    for b, texts in per.items():
        joined = []
        for t in texts:
            if joined and joined[-1].endswith("-") and not joined[-1].endswith("--"):
                joined[-1] = joined[-1] + t  # kept as a compound: words_of reads both the joined word and its parts
            else:
                joined.append(t)
        out[b] = words_of(" ".join(joined), year)
    return out, placed


def ref_columns(ref):
    year = int(ref["period_end"][:4])  # the reference's own headings are relative to its own period
    cols = []
    for c in ref["columns"]:
        path = c.get("path") or []
        cols.append({"col": c, "leaf": set(words_of(path[-1], year, parts=False)) if path else set(), "path": [set(words_of(p, year)) for p in path], "elems": path})
    return cols


def align(block, ref, period_end):
    """[reference column dict per PDF column] or (None, reason)."""
    year = int(period_end[:4])
    bw, placed = band_words(block, year)
    n = block["ncols"]
    rc = ref_columns(ref)
    m = len(rc)
    W = [set(bw.get(i, [])) for i in range(n)]

    def ok(i, j):
        leaf = rc[j]["leaf"] - STOP if rc[j]["leaf"] - STOP else rc[j]["leaf"]
        return bool(leaf) and leaf <= W[i] and _years(rc[j]["leaf"]) <= W[i] and _years(W[i]) <= set().union(*rc[j]["path"]) | rc[j]["leaf"]

    def score(i, j):
        return sum(len(p & W[i]) for p in rc[j]["path"])

    # A PDF column whose heading no reference column fits at all (a measure the spreadsheet editions no longer print, "Average
    # Sentence in Months" before "Median") is not stored; at most a quarter of the columns may be left out this way.
    free = [i for i in range(n) if not any(ok(i, j) for j in range(m))]
    if len(free) > max(1, n // 4) or n - len(free) < 2:
        return None, "no match of the PDF's column headings to the reference columns"
    keep = [i for i in range(n) if i not in free]
    K = 64
    kn = len(keep)
    # best[a][j] = up to K alignments [(score, pairs)] of the kept PDF columns keep[0..a-1] within reference columns 0..j-1, highest
    # scores first
    best = [[[] for _ in range(m + 1)] for _ in range(kn + 1)]
    for j in range(m + 1):
        best[0][j] = [(0, ())]
    for a in range(1, kn + 1):
        i = keep[a - 1]
        for j in range(1, m + 1):
            cand = list(best[a][j - 1])
            if ok(i, j - 1):
                add = score(i, j - 1)
                cand += [(sc + add, pairs + ((i, j - 1),)) for sc, pairs in best[a - 1][j - 1]]
            cand.sort(key=lambda c: -c[0])
            best[a][j] = cand[:K]
    found = best[kn][m]
    if not found:
        return None, "no match of the PDF's column headings to the reference columns"
    ref_year = int(ref["period_end"][:4])
    passing = [(sc, pairs) for sc, pairs in found if not group_check(block, rc, list(pairs), placed, year, ref_year)]
    if not passing:
        return None, group_check(block, rc, list(found[0][1]), placed, year, ref_year)
    top = passing[0][0]
    if len(found) >= K and top <= found[-1][0]:
        return None, "the PDF's column headings match the reference columns in too many ways to tell apart"
    if len([1 for sc, _ in passing if sc == top]) > 1:
        return None, f"the PDF's column headings match the reference columns in {len([1 for sc, _ in passing if sc == top])} ways"
    chosen = dict(passing[0][1])
    return [rc[chosen[i]]["col"] if i in chosen else None for i in range(n)], ""


def _years(words):
    return {w for w in words if re.fullmatch(r"ym?\d+", w)}


def group_check(block, rc, pairs, placed, year, ref_year):
    """Every group heading of the matched reference columns is printed over the span of the PDF columns it covers; a group over every
    column of the table may instead be printed in the title ("Appeals Terminated on the Merits ...")."""
    bnds = block["pages"][0].get("bands") or []
    title = set(words_of(" ".join(block.get("title") or []), year))
    spans = {}
    for i, j in pairs:
        if j is None:
            continue
        elems = rc[j]["elems"]
        for depth in range(len(elems) - 1):
            key = tuple(elems[: depth + 1])
            spans.setdefault(key, []).append(i)
    for key, cols in spans.items():
        words = set(words_of(key[-1], ref_year)) - STOP
        if not words:
            continue
        left, right = bnds[min(cols)][0], bnds[max(cols)][1]
        # the heading words over the span, read in order so a word broken over two lines ("NON-" / "BUSINESS") is whole again
        printed = set(words_of(" ".join(text for x, text in placed if left <= x <= right), year))
        if len(cols) == block["ncols"] or all(re.fullmatch(r"ym?\d+", w) for w in words):
            printed |= title  # a heading over every column, or a year heading ("2017"), may be printed in the title instead
        if not words <= printed:
            return f"group heading '{key[-1]}' is not printed over its columns (missing {sorted(words - printed)[:3]})"
    return ""
