"""State ranking tables of the National Do Not Call Registry Data Books read straight from the official PDFs (pdfplumber).

Why this exists: the Firecrawl text of these PDFs loses digits and whole table rows, and a hidden overlay header
('Blank Consumer State ...') sits inside rows 24 and 50 of the tables, which merges words at the default tolerance.
Reading the PDF's own word positions with a fine vertical tolerance (0.3 pt) and dropping the overlay tokens recovers
every row. The two numbers of a row are the count and the per-100K rate; a count always exceeds the per-100K rate
because every jurisdiction has more than 100,000 residents, so max/min identify them whichever column is printed first.

Pages (1-based) in all five editions: 8 = active registrations ranking, 9 = complaints ranking.
"""
import re

from ftc_parse import STATES, letters_key, state_usps

CID = {"(cid:415)": "ti", "(cid:425)": "tt", "(cid:332)": "ft"}
OVERLAY = {"Blank", "Consumer", "State", "p..", "Rank"}
REGISTRATIONS_PAGE, COMPLAINTS_PAGE = 8, 9
_PAIR = re.compile(r"(?:(\d{1,2})\s+)?([A-Z][A-Za-z\.]*(?:\s+(?:of\s+)?[A-Z][A-Za-z\.]*)*)\s+([\d,]+)\s+([\d,]+)(?=\s|$)")


def _fix(text):
    for bad, good in CID.items():
        text = text.replace(bad, good)
    return text


def page_rows(pdf_path, page_no, y_tolerance=0.3, row_tolerance=3.0):
    """Text rows (top to bottom) of one page; overlay header words inside the table body are dropped."""
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_no - 1]
        words = page.extract_words(x_tolerance=1.5, y_tolerance=y_tolerance)
    kept = []
    for w in words:
        text = _fix(w["text"])
        if w["top"] > 300 and (text in OVERLAY or text.startswith(("Active", "Registrations", "Complaints")) or text in ("per", "100K")):
            continue
        kept.append((w, text))
    kept.sort(key=lambda x: (round(x[0]["top"]), x[0]["x0"]))
    rows, current, top = [], [], None
    for w, text in kept:
        if top is None or abs(w["top"] - top) > row_tolerance:
            if current:
                rows.append(current)
            current, top = [(w, text)], w["top"]
        else:
            current.append((w, text))
    if current:
        rows.append(current)
    return [" ".join(t for w, t in sorted(r, key=lambda x: x[0]["x0"])) for r in rows]


def parse_ranking_rows(rows):
    """{usps: {rank, count, per100k}} from page rows. A pair is read only when the name is exactly a state name."""
    out, problems = {}, []
    for line in rows:
        for m in _PAIR.finditer(line):
            usps = state_usps(m.group(2).strip())
            if not usps:
                continue
            a, b = int(m.group(3).replace(",", "")), int(m.group(4).replace(",", ""))
            row = {"rank": int(m.group(1)) if m.group(1) else None, "count": max(a, b), "per100k": min(a, b)}
            if usps in out and out[usps] != row:
                problems.append(f"{usps} read twice with different values")
            out.setdefault(usps, row)
    return out, problems


def validate_pdf_table(table, label):
    """Hard checks on a parsed table: 52 jurisdictions, ranks 1-50 contiguous, DC/PR unranked, per-100K non-increasing."""
    problems = []
    missing = [u for u in STATES if u not in table]
    if missing:
        problems.append(f"{label}: missing {missing}")
    ranks = sorted(r["rank"] for r in table.values() if r["rank"] is not None)
    if ranks != list(range(1, 51)):
        problems.append(f"{label}: ranks are not 1..50 ({len(ranks)} found)")
    for u in ("DC", "PR"):
        if u in table and table[u]["rank"] is not None:
            problems.append(f"{label}: {u} should be unranked")
    ordered = sorted((r["rank"], r["per100k"]) for r in table.values() if r["rank"] is not None)
    for (r1, v1), (r2, v2) in zip(ordered, ordered[1:]):
        if v2 > v1:
            problems.append(f"{label}: per-100K rises from rank {r1} to rank {r2}")
    return problems


def read_book(pdf_path, label):
    """({'registrations': table, 'complaints': table}, problems) for one Data Book PDF."""
    out, problems = {}, []
    for kind, page_no in (("registrations", REGISTRATIONS_PAGE), ("complaints", COMPLAINTS_PAGE)):
        table, p = parse_ranking_rows(page_rows(pdf_path, page_no))
        out[kind] = table
        problems += p + validate_pdf_table(table, f"{label} {kind}")
    return out, problems
