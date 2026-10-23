"""Read an older (PDF-only) edition of a district / appeals / bankruptcy table against a reference workbook layout.

Before spreadsheets were published (Judicial Business to FY2016, Statistical Tables / Caseload Statistics to 2017) a table
exists only as a PDF whose text layer holds the same rows. For tables with one row per court (a "Total" row, circuit
roll-ups, districts) the rows are read with pdf_rows.py and their columns are named by the table's reference workbook
edition: the nearest later XLSX edition of the same table, so a column keeps the heading the publisher printed there.

A PDF edition is accepted only when ALL of these hold; otherwise it is rejected with the reason and nothing is kept:
  * the title block names the same table id and the same period end as the listing;
  * the printed figure count per row equals the reference column count and every reference court label is present, with
    no extra court (the same 94-district / 12-circuit set);
  * every roll-up identity holds (checks.rollup_failures == 0): the Total row equals the sum of the circuit rows and each
    circuit row equals the sum of its districts, for every count column;
  * the header words of the PDF contain every distinct heading word of the reference columns (a layout that dropped or
    renamed a column fails here).
Values are the printed figures; a printed dash is a dash, never zero.
"""
import re

import checks as C
import entities as E
import normalize as N
import pdf_rows as R
import utx_parse as P


def pdf_notes(text):
    """The footnote paragraphs printed under the last data row of a PDF table, as printed (wrapped lines joined, page numbers dropped).
    They are not linked to rows or columns; they are kept so a change of definition between editions shows as a footnote change."""
    lines = text.replace("\f", "\n").splitlines()
    last = -1
    for i, line in enumerate(lines):
        m = R.LABEL.match(line.replace("\t", " "))
        if m:
            parts = m.group("rest").split()
            if len(parts) >= 3 and all(R.TOKEN.match(p) for p in parts):
                last = i
    tail = [re.sub(r"\s+", " ", ln).strip() for ln in lines[last + 1:]]
    tail = [ln for ln in tail if ln and not re.fullmatch(r"\d{1,3}|Page \d+ of \d+", ln, re.I)][:40]
    paragraphs, current = [], []
    for ln in tail:
        current.append(ln)
        if re.search(r"[.:;)]$", ln):
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def header_words(text):
    """Distinct lower-case words of the title and column-heading block (everything before the first data row)."""
    words = set()
    for line in text.splitlines():
        if R.LABEL.match(line.replace("\t", " ")) and re.search(r"\d", line) and len(line.split()) > 3 and re.match(r"^\s*(TOTAL|Total)\b", line):
            break
        words.update(re.findall(r"[a-z]{3,}", line.lower()))
    return words


YEAR_TOKEN = re.compile(r"\b((?:19|20)\d{2})\b")
# a footnote mark printed against a column year reads as one more digit in the text layer ("20001" is 2000 with footnote 1)
PRINTED_YEAR = re.compile(r"\b((?:19|20)\d{2})\d?\b")
PURE_YEARS = re.compile(r"^[\s,]*(?:(?:19|20)\d{2}[\s,]*(?:and|through|to)?[\s,]*)+$", re.I)


def _collapse(seq):
    out = []
    for x in seq:
        if not out or out[-1] != x:
            out.append(x)
    return out


def heading_block(text):
    """The column-heading lines of a PDF table: after the title lines (the last of the first ten that holds the period phrase, and a
    wrapped line that is only years) and before the first data row."""
    lines = text.splitlines()
    first_data = len(lines)
    for i, line in enumerate(lines):
        if R.LABEL.match(line.replace("\t", " ")) and re.search(r"\d", line) and len(line.split()) > 3 and re.match(r"^\s*(TOTAL|Total)\b", line):
            first_data = i
            break
    start = 0
    for i, line in enumerate(lines[: min(10, first_data)]):
        if re.search(r"\b(?:Ending|Ended|As of)\b", line, re.I):
            start = i + 1
    while start < first_data and (not lines[start].strip() or PURE_YEARS.match(lines[start])):
        start += 1
    return lines[start:first_data]


def year_order_matches(text, ref, period_end):
    """(ok, detail). The years printed over the figure columns, in order, must be the years the reference's columns carry (relative to
    their own period) moved to this PDF's period: a PDF that prints the current year before the prior year, or other years, would
    otherwise have its figures read into the wrong columns. Consecutive repeats (a group heading spanning columns) count once."""
    base = int(ref["period_end"][:4])
    shift = int(period_end[:4]) - base
    expected = _collapse([int(y) + shift for c in ref["columns"] for el in c["path"] for y in YEAR_TOKEN.findall(el)])
    observed = _collapse([int(y) for line in heading_block(text) for y in PRINTED_YEAR.findall(line)])
    if expected == observed:
        return True, ""
    return False, f"column years printed {observed[:8]} but the reference columns carry {expected[:8]}"


# Tables whose older editions word the column headings differently from the spreadsheet edition that names the columns (F-2: "Predominant
# Nature of Debt / Business Filings" there, "Business Filings" in the PDFs) are accepted on their own arithmetic instead of the heading words:
# the PDF must still print the words in `words`, every court row must satisfy each `equal` identity (a total column equals the sum of its
# business and nonbusiness parts) and the business total must be smaller than the nonbusiness total, which fixes the column alignment.
_DEBT = "predominant_nature_of_debt"
HEADER_OVERRIDES = {
    "f-2": {
        "words": {"total", "filings", "chapter", "business"},
        "equal": [
            ("total_filings", [f"{_DEBT}/business_filings/total", f"{_DEBT}/nonbusiness_filings/total"]),
            ("total_chapter_7", [f"{_DEBT}/business_filings/chapter_7", f"{_DEBT}/nonbusiness_filings/chapter_7"]),
            ("total_chapter_11", [f"{_DEBT}/business_filings/chapter_11", f"{_DEBT}/nonbusiness_filings/chapter_11"]),
            ("total_chapter_13", [f"{_DEBT}/business_filings/chapter_13", f"{_DEBT}/nonbusiness_filings/chapter_13"]),
        ],
        "less": [(f"{_DEBT}/business_filings/total", f"{_DEBT}/nonbusiness_filings/total")],
    },
}


def column_identities_hold(ref, out_rows, spec):
    """True when the reference has the columns the spec names and every court row satisfies every identity (a printed dash counts as no
    cases in a sum; a row with an unknown figure is skipped, never assumed)."""
    pos = {c["key"]: i for i, c in enumerate(ref["columns"])}
    applied = 0
    for total, parts in spec["equal"]:
        if total not in pos or any(p not in pos for p in parts):
            return False
        applied += 1
        for r in out_rows:
            v = r["values"]
            fl = r["flags"]
            def num(i):
                return 0 if v[i] is None and fl[i] == "dash" else v[i]
            whole, sums = num(pos[total]), [num(pos[p]) for p in parts]
            if whole is None or any(x is None for x in sums):
                continue
            if whole != sum(sums):
                return False
    for small, large in spec.get("less", []):
        if small not in pos or large not in pos:
            return False
        applied += 1
        for r in out_rows:
            if r["entity"] == "national" and r["values"][pos[small]] is not None and r["values"][pos[large]] is not None:
                if not r["values"][pos[small]] < r["values"][pos[large]]:
                    return False
    return applied > 0


def ref_words(ref):
    words = set()
    for c in ref["columns"]:
        for element in c["path"]:
            words.update(re.findall(r"[a-z]{3,}", element.lower()))
    return words


def parse_pdf_table(text, ref, entry):
    """Return (normalized table, []) or (None, reasons). `ref` is a normalized reference table (utx normalize output)."""
    reasons = []
    period_end = entry["period_end"]
    m = re.search(r"Table\s+([A-Za-z0-9\-\s]+?)\s*[.\n]", text[:600])
    printed = (m.group(1).strip().upper().replace(" ", "") if m else "")
    listed = entry["table"].upper().replace(" ", "")
    base = re.sub(r"(CASES|RETIRED)$", "", listed)
    if printed and printed not in (listed, base):
        reasons.append(f"title table {printed} != listing {listed}")
    phrase, end = P.parse_period_phrase(re.sub(r"\s+", " ", text[:1500]))
    if end and end != period_end:
        reasons.append(f"period in title {end} differs from listing {period_end}")
    width = len(ref["columns"])
    rows, rejected = R.rows_from_text(text, width)
    if not rows:
        return None, reasons + [f"no rows with {width} figures" + (f" (saw counts {sorted({c for _, c in rejected})[:5]})" if rejected else "")]
    out_rows = []
    for label, tokens in rows:
        label = R.CIRCUIT_WORDS.get(label.upper(), label)
        clean = E.clean_label(label)
        values, flags = [], []
        for t in tokens:
            v, f = R.to_number(t)
            values.append(v)
            flags.append(f)
        entity = N.classify_row(ref["scope"], label)
        out_rows.append({"label_raw": label, "label": clean, "indent": 0, "section": False, "values": values, "flags": flags,
                         "entity": entity[0], "entity_id": entity[1], "path": [clean], "row": None})
    got = {(r["entity"], r["entity_id"]) for r in out_rows}
    want = {(r["entity"], r["entity_id"]) for r in ref["rows"] if not r["section"]}
    # A national Total row whose figures the text layer scatters over several lines cannot be read exactly: that one row is left out
    # (a gap, never a guess) while every court row, each with the full figure count, is kept. Any other missing or extra court rejects.
    total_unreadable = (want - got) == {("national", "national")} and not (got - want)
    # Appeals tables before the Federal Circuit was reported say so in their own note ("This table does not include data for the
    # U.S. Court of Appeals for the Federal Circuit"): that circuit is then simply not in the edition.
    no_federal = ref["scope"] == "appeals" and (want - got) == {("circuit", "cafc")} and not (got - want) and re.search(r"does not include data for the u\.?s\.? court of appeals for the federal circuit", re.sub(r"\s+", " ", text), re.I)
    # The combined Arkansas bankruptcy court ("AR") replaced the separate Eastern and Western courts: an older edition prints the two.
    arkansas_split = ref["scope"] == "bankruptcy" and (want - got) == {("district", "arcomb")} and (got - want) == {("district", "ared"), ("district", "arwd")}
    if got != want and not total_unreadable and not no_federal and not arkansas_split:
        missing = sorted(want - got)[:6]
        extra = sorted(got - want)[:6]
        reasons.append(f"court set differs: missing {missing} extra {extra}")
    if len(out_rows) != len(got):
        reasons.append("duplicate court rows")
    words = header_words(text)
    lacking = sorted(w for w in ref_words(ref) if w not in words)
    override = HEADER_OVERRIDES.get(ref["table_key"])
    reworded = False
    if lacking and override and override["words"] <= words and column_identities_hold(ref, out_rows, override):
        lacking, reworded = [], True
    if lacking:
        reasons.append(f"header words not in the PDF: {lacking[:6]}")
    years_ok, years_why = year_order_matches(text, ref, period_end)
    if not years_ok:
        reasons.append(years_why)
    norm = {
        "pub": entry["pub"], "table": entry["table"], "table_key": N.table_slug(entry["table"]), "period_end": period_end,
        "months": N.months_of(phrase, ref.get("months")), "period_phrase": phrase, "title": entry["title"] or ref["title"], "title_listing": entry["title"],
        "printed_table_id": printed, "scope": ref["scope"], "row_kinds": ref["row_kinds"], "label_header": ref["label_header"],
        "columns": [dict(c) for c in ref["columns"]], "rows": out_rows, "notes": pdf_notes(text), "sheet": None, "problems": [],
    }
    if total_unreadable:
        norm["warnings"] = ["The national Total row could not be read exactly from the PDF text layer and is left out of this period."]
    if no_federal:
        norm["warnings"] = ["The edition's own note says the Federal Circuit is not included in this table."]
    if arkansas_split:
        norm["warnings"] = norm.get("warnings", []) + ["This edition prints the Eastern and Western Arkansas bankruptcy courts as separate courts."]
    if reworded:
        norm["warnings"] = norm.get("warnings", []) + ["The column headings of this edition are worded differently from the reference spreadsheet; the column positions are confirmed by the table's own sums (total = business + nonbusiness for every court row)."]
    if not reasons:
        fails = C.rollup_failures(norm)
        if fails:
            reasons.append(f"{len(fails)} roll-up identity failures, first {fails[0]}")
    return (norm if not reasons else None), reasons
