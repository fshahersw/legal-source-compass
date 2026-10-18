"""Reader for "Appropriation Figures for the Antitrust Division, Fiscal Years 1903-2028" (HTML page, with the XLS as a second reading).

The page table has five columns: fiscal year; general fund amount included in the appropriations bill; filing fee revenue amount
included in the appropriations bill; total funding appropriated (all $ thousands); notes. A dash is printed where the source
shows no amount. The XLS (converted to CSV by LibreOffice, see register_derived.py) prints 0 or a blank in those cells; the
comparison reports that as a representation difference, not a value conflict.
"""
import csv
import io
import re

import workload_html

NUM_RE = re.compile(r"^\$?-?[\d,]+(?:\.\d+)?$")


def _cell(text):
    t = (text or "").replace(" ", " ").strip()
    dash = t in ("-", "–", "—")
    value = None
    if t and not dash and NUM_RE.match(t):
        value = float(t.replace("$", "").replace(",", ""))
        value = int(value) if value == int(value) else value
    return {"as_published": t, "value": value, "dash": dash, "blank": t == ""}


def read_html(markup):
    """({fy: {gf, fee, total, note}}, {title, updated, basis}) from the appropriation page."""
    tables = workload_html.parse_tables(markup)
    rows = None
    for t in tables:
        if t["rows"] and t["rows"][0][0]["text"] == "Fiscal Year" and len(t["rows"][0]) == 5:
            rows = t["rows"]
            break
    if rows is None:
        raise ValueError("appropriation table not found")
    out = {}
    last_note = ""
    for row in rows[1:]:
        if len(row) not in (4, 5) or not re.fullmatch(r"\d{4}", row[0]["text"]):
            raise ValueError(f"unexpected appropriation row {[c['text'] for c in row]}")
        fy = int(row[0]["text"])
        if fy in out:
            raise ValueError(f"duplicate fiscal year {fy}")
        spanned = len(row) == 4  # the notes cell of an earlier row spans this row (FY1904-FY1907 share one note)
        note = last_note if spanned else re.sub(r"\s+", " ", row[4]["text"]).strip()
        if not spanned:
            last_note = note
        out[fy] = {"gf": _cell(row[1]["text"]), "fee": _cell(row[2]["text"]), "total": _cell(row[3]["text"]), "note": note, "note_spanned": spanned}
    text = markup if isinstance(markup, str) else markup.decode("utf-8", "replace")
    upd = re.search(r"\(Updated ([A-Za-z]+ \d{4})\)", text)
    basis = re.search(r"\*The fiscal year from 1903 to 1976 was from July 1 through June 30\. In 1977, it changed to the current period from October 1 through September 30\.", text)
    return out, {"updated": upd.group(1) if upd else None, "basis": basis.group(0).lstrip("*") if basis else None}


def read_csv(text):
    """{fy: {gf, fee, total, note}} from the CSV conversion of the XLS (header row starts with 'Fiscal Year')."""
    rows = list(csv.reader(io.StringIO(text)))
    start = next(i for i, r in enumerate(rows) if r and r[0].strip() == "Fiscal Year")
    out = {}
    for r in rows[start + 1:]:
        if not r or not re.fullmatch(r"\d{4}", r[0].strip()):
            continue
        r = (r + [""] * 5)[:5]
        out[int(r[0])] = {"gf": _cell(r[1]), "fee": _cell(r[2]), "total": _cell(r[3]), "note": re.sub(r"\s+", " ", r[4]).strip()}
    return out


def compare(html_rows, csv_rows):
    """Value conflicts (both readings give a number and the numbers differ), representation differences (dash vs 0 or blank), missing years."""
    conflicts, representation = [], []
    for fy in sorted(set(html_rows) | set(csv_rows)):
        a, b = html_rows.get(fy), csv_rows.get(fy)
        if a is None or b is None:
            conflicts.append({"fy": fy, "field": "row", "html": None if a is None else "present", "xls": None if b is None else "present"})
            continue
        for field in ("gf", "fee", "total"):
            x, y = a[field], b[field]
            if x["value"] is not None and y["value"] is not None:
                if x["value"] != y["value"]:
                    conflicts.append({"fy": fy, "field": field, "html": x["as_published"], "xls": y["as_published"]})
            elif (x["dash"] or x["blank"]) != (y["blank"] or y["value"] == 0) and not (x["dash"] and y["blank"]):
                representation.append({"fy": fy, "field": field, "html": x["as_published"], "xls": y["as_published"]})
        if re.sub(r"\W+", "", a["note"]).lower() != re.sub(r"\W+", "", b["note"]).lower():
            representation.append({"fy": fy, "field": "note", "html": a["note"][:80], "xls": b["note"][:80]})
    return {"conflicts": conflicts, "representation": representation}
