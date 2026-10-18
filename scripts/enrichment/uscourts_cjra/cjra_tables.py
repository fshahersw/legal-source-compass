"""Read the printed summary Tables 1-4 of a CJRA report (national and circuit totals) from the report PDF text.

2004-2018 reports are one PDF (narrative, Tables 1-4, Appendices); 2019-2026 reports publish Tables 1-4 as separate small PDFs
(cjra_1 .. cjra_4). Text is read with poppler's pdftotext -layout and matched on printed labels:

  Table 1  national totals by type of matter and type of judge: previous period, current period, percent change
  Table 2  circuit totals for the current period with the district-judge and magistrate-judge percentage split
  Table 3  circuit totals for the previous and current period with the percent change (five measures x three numbers)
  Table 4  circuit totals with the average per judge (civil cases pending more than three years, motions pending more than six months)

Nothing is inferred: a table is returned only when every expected row was found with the expected number of printed values.
A stray endnote digit printed between values (for example "25,995 2 24,641 -5.2") is dropped only when the remaining values
satisfy the table's own relation (percent change = (current - previous) / previous x 100, or the two shares adding to 100).
A printed dash in a count column means none (0); a dash in a percent column means "not computed" (None).
"""
import itertools
import re

MEASURE_ORDER = ["civil_3y", "motions_6m", "bench_trials_6m", "bankruptcy_appeals_6m", "ss_appeals_6m"]
CIRCUIT_FORMS = {"total": "total", "districtofcolumbia": "dc", "dc": "dc", "first": "1", "1st": "1", "second": "2", "2nd": "2", "third": "3", "3rd": "3",
                 "fourth": "4", "4th": "4", "fifth": "5", "5th": "5", "sixth": "6", "6th": "6", "seventh": "7", "7th": "7", "eighth": "8", "8th": "8",
                 "ninth": "9", "9th": "9", "tenth": "10", "10th": "10", "eleventh": "11", "11th": "11"}
TOKEN = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$|^-?\.\d+$|^[-–—]$")
DASHES = ("-", "–", "—")


def compact(text):
    """Lower-case text without spaces (headings are extracted with stray spaces: 'D istrict of')."""
    return re.sub(r"\s+", "", text or "").lower()


def split_numbers(line):
    """(label text, [numeric tokens]) of a text line; the tokens are the trailing run of numbers/dashes."""
    parts = re.sub(r"([a-z])(\d)", r"\1 \2", line.replace("−", "-")).split()  # pdftotext glues 'Judges18,623'
    tokens = []
    while parts and TOKEN.match(parts[-1]):
        tokens.insert(0, parts.pop())
    return " ".join(parts), tokens


def pdf_text_lines(path, pages=None):
    """[(page, text)] for the PDF (or its page numbers `pages`), read with poppler's pdftotext -layout.

    poppler is used for the summary tables because Table 3 is printed on a page rotated by 90 degrees, which the
    positional extractor used for Appendix A returns as reversed single words; pdftotext restores the reading order.
    """
    import subprocess

    first = min(pages) if pages else 1
    cmd = ["pdftotext", "-layout", "-f", str(first)] + (["-l", str(max(pages))] if pages else []) + [str(path), "-"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    lines = []
    for offset, page_text in enumerate(out.split("\f")):
        n = first + offset
        if pages is not None and n not in pages:
            continue
        for raw in page_text.splitlines():
            text = re.sub(r"\s+", " ", raw).strip()
            if text:
                lines.append((n, text))
    return lines


def locate_tables(lines):
    """{table number: [lines]} for a combined report: a table runs from its 'Table N' title line to the next title / Appendix A."""
    starts = []
    for i, (_, text) in enumerate(lines):
        m = re.match(r"^Table ([1-4])\s*(?:[—–-]|\s)\s*U\.S\. District Courts", text)
        if m:
            starts.append((i, int(m.group(1))))
        elif re.match(r"^Appendix A\.?$", text, re.I):
            starts.append((i, None))
    out = {}
    for k, (i, n) in enumerate(starts):
        if n is None:
            break
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        out.setdefault(n, lines[i:end])
    return out


def count(token):
    return 0 if token in DASHES else int(token.replace(",", ""))


def pct(token):
    return None if token in DASHES else float(token.replace(",", ""))


def pct_ok(previous, current, printed):
    """The table's own relation for a (previous, current, percent change) triple: a printed percent equals
    (current - previous) / previous x 100 to one decimal; a dash (None) means "not computed" and is always accepted
    (the reports leave it out below a changing threshold of previous matters and where nothing changed)."""
    if printed is None:
        return True
    if previous == 0:
        return False
    return abs(round((current - previous) / previous * 100, 1) - printed) <= 0.11


def fit_triples(tokens, n):
    """n (previous, current, percent) triples from printed tokens. Returns (triples, ok) where ok says every triple satisfies
    the percent relation; surplus single-digit tokens (endnote digits) are removed only when that makes all triples satisfy it
    and the removal is unique."""
    def build(toks):
        return [(count(toks[3 * i]), count(toks[3 * i + 1]), pct(toks[3 * i + 2])) for i in range(n)]

    if len(tokens) == 3 * n:
        triples = build(tokens)
        return triples, all(pct_ok(*t) for t in triples)
    extra = len(tokens) - 3 * n
    if extra < 0 or extra > 2:
        return None, False
    cands = [i for i, t in enumerate(tokens) if re.fullmatch(r"\d", t)]
    good = []
    for drop in itertools.combinations(cands, extra):
        kept = [t for i, t in enumerate(tokens) if i not in drop]
        triples = build(kept)
        if all(pct_ok(*t) for t in triples):
            good.append(triples)
    if len(good) == 1:
        return good[0], True
    return None, False


def circuit_rows(table_lines, width):
    """{circuit key: tokens} for lines whose label is a circuit name and that carry at least `width` printed tokens.
    'District of' / 'Columbia' printed over two lines are joined."""
    out, pending = {}, False
    for _, text in table_lines:
        label, tokens = split_numbers(text)
        c = compact(label)
        if not tokens and c == "districtof":
            pending = True
            continue
        if pending and c == "columbia":
            c, pending = "districtofcolumbia", False
        elif tokens:
            pending = False
        key = CIRCUIT_FORMS.get(c)
        if key and len(tokens) >= width and key not in out:
            out[key] = tokens
    return out


def parse_table3(table_lines):
    """Circuit rows of Table 3: five measures x (previous, current, percent change). Returns ({circuit: {measure: {...}}}, all_checks_ok) or (None, False)."""
    rows = circuit_rows(table_lines, 15)
    if set(rows) != set(CIRCUIT_FORMS.values()):
        return None, False
    out, ok_all = {}, True
    for key, tokens in rows.items():
        triples, ok = fit_triples(tokens, 5)
        if triples is None:
            return None, False
        ok_all = ok_all and ok
        out[key] = {m: {"previous": t[0], "current": t[1], "pct_change": t[2]} for m, t in zip(MEASURE_ORDER, triples)}
    return out, ok_all


def parse_table2(table_lines):
    """Circuit rows of Table 2: civil total, % district, % magistrate, motions total, % district, % magistrate, bench, bankruptcy, SS."""
    rows = circuit_rows(table_lines, 9)
    if set(rows) != set(CIRCUIT_FORMS.values()):
        return None, False
    out, ok_all = {}, True
    for key, tokens in rows.items():
        if len(tokens) != 9:
            return None, False
        v = [count(t) if i in (0, 3, 6, 7, 8) else pct(t) for i, t in enumerate(tokens)]
        out[key] = {"civil_3y": v[0], "civil_3y_pct_district_judges": v[1], "civil_3y_pct_magistrate_judges": v[2],
                    "motions_6m": v[3], "motions_6m_pct_district_judges": v[4], "motions_6m_pct_magistrate_judges": v[5],
                    "bench_trials_6m": v[6], "bankruptcy_appeals_6m": v[7], "ss_appeals_6m": v[8]}
        for a, b, total in ((v[1], v[2], v[0]), (v[4], v[5], v[3])):
            if total and (a is None or b is None or abs(a + b - 100.0) > 0.11):
                ok_all = False
    return out, ok_all


def parse_table4(table_lines, reference=None):
    """Circuit rows of Table 4: civil total, average civil per judge, motions total, average motions per judge.

    `reference` {circuit: (civil_3y, motions_6m)} (the same report's Table 2) lets a row with one surplus single-digit token (an endnote
    digit printed inside the row, e.g. "Fifth 8,872 1 49 372 2") be read: the token is dropped only when exactly one removal makes
    both totals equal the reference. A circuit whose row is absent from the PDF text is left out and reported by the caller: the
    result is then (partial rows, False). Returns (None, False) when fewer than ten circuits could be read."""
    rows = circuit_rows(table_lines, 4)
    out = {}
    for key, tokens in rows.items():
        if len(tokens) == 5 and reference and key in reference:
            fits = []
            for i, token in enumerate(tokens):
                rest = tokens[:i] + tokens[i + 1:]
                if re.fullmatch(r"\d", token) and (count(rest[0]), count(rest[2])) == tuple(reference[key]):
                    fits.append(i)
            if len(fits) == 1:
                tokens = tokens[:fits[0]] + tokens[fits[0] + 1:]
        if len(tokens) != 4:
            continue
        out[key] = {"civil_3y": count(tokens[0]), "civil_3y_per_judge": float(tokens[1]), "motions_6m": count(tokens[2]), "motions_6m_per_judge": float(tokens[3])}
    if len(out) < 10:
        return None, False
    return out, set(out) == set(CIRCUIT_FORMS.values())


def parse_table1(table_lines):
    """National rows of Table 1: for each measure total / district judge(s) / magistrate judge(s) with previous, current, percent change.
    Returns (rows, all_checks_ok) or (None, False)."""
    out, measure, ok_all = {}, None, True
    pending_label = ""
    for _, text in table_lines:
        label, tokens = split_numbers(text)
        c = compact(label)
        if not tokens:
            pending_label = c
            continue
        full = pending_label + c if re.match(r"^three ?years", label, re.I) else c
        pending_label = ""
        kind = None
        if re.fullmatch(r"(civilcasespending,?total|.*threeyears,?total)", full):
            measure, kind = "civil_3y", "total"
        elif re.fullmatch(r"motionspending(,?total)?", c):
            measure, kind = "motions_6m", "total"
        elif re.fullmatch(r"benchtrialspending(,?total)?", c):
            measure, kind = "bench_trials_6m", "total"
        elif re.fullmatch(r"bankruptcyappealspending(,?total)?", c):
            measure, kind = "bankruptcy_appeals_6m", "total"
        elif re.fullmatch(r"socialsecurityappeals?(cases)?(pending)?(,?total)?", c):
            measure, kind = "ss_appeals_6m", "total"
        elif measure and re.match(r"^districtjudges?$", c):
            kind = "district"
        elif measure and re.match(r"^magistratejudges?$", c):
            kind = "magistrate"
        if kind is None:
            continue
        triples, ok = fit_triples(tokens, 1)
        if triples is None:
            return None, False
        ok_all = ok_all and ok
        out.setdefault(measure, {})[kind] = {"previous": triples[0][0], "current": triples[0][1], "pct_change": triples[0][2]}
    if set(out) != set(MEASURE_ORDER) or any(set(v) != {"total", "district", "magistrate"} for v in out.values()):
        return None, False
    return out, ok_all


def parse_report_tables(lines_by_table):
    """lines_by_table {1: [...], ..., 4: [...]} -> {"table1": (rows, ok), ...}; rows is None where a table could not be read."""
    table2 = parse_table2(lines_by_table.get(2, []))
    reference = {k: (v["civil_3y"], v["motions_6m"]) for k, v in table2[0].items()} if table2[0] else None
    return {"table1": parse_table1(lines_by_table.get(1, [])), "table2": table2,
            "table3": parse_table3(lines_by_table.get(3, [])), "table4": parse_table4(lines_by_table.get(4, []), reference)}
