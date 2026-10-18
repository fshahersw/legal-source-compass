"""Read every Antitrust Division workload-statistics edition into one normalised structure, with a second reading per edition.

Editions (https://www.justice.gov/atr/division-operations, "Historic Workload Statistics"):
  FY1970-1979, FY1980-1989 (web page + PDF; the web-page tables are the primary reading, the PDF is the second reading)
  FY1990-1999 (PDF, Poppler word boxes: the pdfplumber glyph placement is wrong in this file, see workload_pdf.py)
  FY2000-2009, FY2010-2019, FY2015-2024 (PDF, pdfplumber; second reading by Poppler word boxes)

Each value keeps the text exactly as printed (`as_published`), whether it was a dash, footnote marks, and its locator
(PDF page or web-page table/row). Nothing is imputed: a printed dash has value None.
"""
import json
import os
import re

import workload_html
import workload_pdf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement_series")

EDITIONS = {
    "fy1970_1979": {"label": "FY 1970-1979", "first": 1970, "primary": "html", "html": "doj/workload_fy1970_1979.htm", "pdf": "doj/workload_fy1970_1979.pdf", "engine": "pdfplumber", "second_engine": None},
    "fy1980_1989": {"label": "FY 1980-1989", "first": 1980, "primary": "html", "html": "doj/workload_fy1980_1989.htm", "pdf": "doj/workload_fy1980_1989.pdf", "engine": "pdfplumber", "second_engine": None},
    "fy1990_1999": {"label": "FY 1990-1999", "first": 1990, "primary": "pdf", "html": None, "pdf": "doj/workload_fy1990_1999.pdf", "engine": "poppler", "second_engine": None},
    "fy2000_2009": {"label": "FY 2000-2009", "first": 2000, "primary": "pdf", "html": None, "pdf": "doj/workload_fy2000_2009.pdf", "engine": "pdfplumber", "second_engine": "poppler"},
    "fy2010_2019": {"label": "FY 2010-2019", "first": 2010, "primary": "pdf", "html": None, "pdf": "doj/workload_fy2010_2019.pdf", "engine": "pdfplumber", "second_engine": "poppler"},
    "fy2015_2024": {"label": "FY 2015-2024", "first": 2015, "primary": "pdf", "html": None, "pdf": "doj/workload_fy2015_2024.pdf", "engine": "pdfplumber", "second_engine": "poppler"},
}
BULLET_RE = re.compile(r"^[\s •\-–—]+")
UNIT_RE = re.compile(r"\(\$000s?\)")


def manifest_entries(acq=ACQ):
    """path (relative to the repository root) -> latest manifest entry that is not a removal."""
    entries = {}
    with open(os.path.join(acq, "_manifest.jsonl")) as handle:
        for line in handle:
            if line.strip():
                entry = json.loads(line)
                if entry.get("action") != "removed":
                    entries[entry["path"]] = entry
    return entries


def source_of(rel, acq=ACQ):
    path = "private/acq/enforcement_series/" + rel
    entry = manifest_entries(acq).get(path)
    if not entry:
        raise KeyError(f"{rel} is not in _manifest.jsonl")
    return {"url": entry["url"], "path": path, "sha256": entry["sha256"], "bytes": entry["bytes"], "retrieved_at": entry["retrieved_at"]}


def clean_label(raw):
    """(label without bullet/leading dash, is_sub) from a printed label."""
    text = raw.replace(" ", " ").replace("’", "'")
    sub = bool(BULLET_RE.match(text)) and bool(re.match(r"^[\s•\-–—]+\S", text))
    text = BULLET_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text, sub


def cell(as_published, marks, locator):
    text = as_published.strip()
    dash = bool(workload_pdf.DASH_RE.match(text))
    value = None
    if not dash and workload_pdf.NUM_RE.match(text):
        value = workload_pdf.parse_number(text)
    return {"as_published": text, "value": value, "dash": dash, "marks": list(marks), **locator}


def from_pdf(edition_key, engine, acq=ACQ):
    spec = EDITIONS[edition_key]
    tables, footnotes, orphans = workload_pdf.read_tables(os.path.join(acq, spec["pdf"]), engine)
    out = []
    for ti, t in enumerate(tables):
        years = [c["fy"] for c in t["columns"]]
        rows = []
        for ri, r in enumerate(t["rows"]):
            label, sub = clean_label(r["label"])
            values = {fy: cell(c["as_published"], c["marks"], {"page": c["page"]}) for fy, c in r["values"].items()}
            rows.append({"ri": ri, "label": label, "published_label": r["label"], "sub": sub, "group": r["group"], "marks": list(r["marks"]), "page": r["page"], "values": values,
                         "unassigned": r.get("unassigned") or [], "conflicts": r.get("conflicts") or []})
        out.append({"id": f"{edition_key}:pdf:t{ti:02d}", "kind": "pdf", "page": t["page"], "section": t["section"], "heading": t["heading"], "heading_marks": list(t["heading_marks"]),
                    "years": years, "rows": rows, "notes": list(t["notes"])})
    return out, {k: v for k, v in footnotes.items()}, list(orphans)


def from_html(edition_key, acq=ACQ):
    spec = EDITIONS[edition_key]
    with open(os.path.join(acq, spec["html"]), "rb") as handle:
        tables = workload_html.read_html_tables(handle.read())
    out = []
    for ti, t in enumerate(tables):
        years = t["years"]
        rows = []
        for ri, r in enumerate(t["rows"]):
            label, sub = clean_label(r["label"])
            if not label:
                label = t["heading"]  # single-row tables (FOIA and Privacy Act requests, FY1970-1979) print no row label
            values = {}
            for fy, v in zip(years, r["values"]):
                values[fy] = cell(v["as_published"], v["marks"], {"table": t["index"], "row": r["row_index"]})
            rows.append({"ri": ri, "label": label, "published_label": r["label"], "sub": sub, "group": r["group"], "marks": list(r["label_marks"]), "page": None, "values": values,
                         "unassigned": [], "conflicts": [], "extra_cells": len(r["values"]) - len(years)})
        out.append({"id": f"{edition_key}:html:t{ti:02d}", "kind": "html", "page": None, "table": t["index"], "section": None, "heading": t["heading"], "heading_marks": list(t["heading_marks"]),
                    "years": years, "rows": rows, "notes": []})
    return out


def row_key(label):
    """Normalised label used only to compare two readings of the same row."""
    text = label.replace(" ", " ").replace("’", "'")
    text = BULLET_RE.sub("", text)
    text = re.sub(r"[\s*]+$", "", text)
    return re.sub(r"\s+", " ", text).lower()


def value_tuples(tables, years):
    """Multiset of (label key, as-published values per year) over all rows (dash kept as '-', missing cell as None).

    The label key is the first 20 characters: the two PDF engines wrap very long labels at different points.
    """
    counts = {}
    for t in tables:
        for r in t["rows"]:
            key = (row_key(r["label"])[:20], tuple(r["values"][fy]["as_published"] if fy in r["values"] else None for fy in years))
            counts[key] = counts.get(key, 0) + 1
    return counts


def compare_readings(first, second, years):
    """Differences between two readings: rows only in the first, rows only in the second (multiset difference)."""
    a, b = value_tuples(first, years), value_tuples(second, years)
    only_a = {k: n - b.get(k, 0) for k, n in a.items() if n > b.get(k, 0)}
    only_b = {k: n - a.get(k, 0) for k, n in b.items() if n > a.get(k, 0)}
    return {"rows_first": sum(a.values()), "rows_second": sum(b.values()), "only_first": [[k[0], list(k[1])] for k in only_a], "only_second": [[k[0], list(k[1])] for k in only_b]}


def read_edition(edition_key, acq=ACQ):
    """The normalised edition: tables of the primary reading plus the comparison with its second reading."""
    spec = EDITIONS[edition_key]
    years = list(range(spec["first"], spec["first"] + 10))
    pdf_tables, footnotes, orphans = from_pdf(edition_key, spec["engine"], acq)
    sources = {"pdf": source_of(spec["pdf"], acq)}
    if spec["primary"] == "html":
        tables = from_html(edition_key, acq)
        sources["html"] = source_of(spec["html"], acq)
        second = compare_readings(tables, pdf_tables, years)
        second_label = "primary web page tables vs PDF read by pdfplumber"
    else:
        tables = pdf_tables
        second = None
        second_label = None
        if spec["second_engine"]:
            other, _, _ = from_pdf(edition_key, spec["second_engine"], acq)
            second = compare_readings(tables, other, years)
            second_label = f"pdfplumber vs {spec['second_engine']} word boxes"
    return {"key": edition_key, "label": spec["label"], "years": years, "primary": spec["primary"], "engine": spec["engine"], "sources": sources, "tables": tables,
            "footnotes": footnotes, "orphans": orphans, "comparison": second, "comparison_label": second_label, "pdf_tables": pdf_tables}
