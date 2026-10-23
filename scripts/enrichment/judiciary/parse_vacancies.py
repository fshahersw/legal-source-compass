"""Parse the uscourts.gov judicial vacancy reports (current pages and the monthly archive 1981-2026) into rows.

Formats handled (decided per file, never guessed per value):
  * HTML tables with a header row (2009 onward): columns mapped by their header names;
  * HTML one-row tables (1999-2001): circuit header row, court-code row, then data rows;
  * PDF with a text layer (1981-1987 vacancy lists; 2001-2009 vacancy and future lists): pdftotext -layout lines split on
    runs of two or more spaces, with the same circuit / court-code / data-row state machine.
Scanned PDFs without a text layer (most of 1988-2001) are kept raw and counted as not parsed; nothing is read from them.

Every parsed row keeps the report it came from and its source text (the cells joined with " | "); verify_vacancies.py checks
that each parsed value occurs in that text. Names are kept exactly as published ("Last, First" or "Last,First").
Output: private/build/judiciary/vacancies_parsed.json.
"""
from __future__ import annotations

import gzip
import html
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

BASE = fl.ACQ / "vacancies"
ARCHIVE = BASE / "judges-judgeships" / "judicial-vacancies" / "archive-judicial-vacancies"
CURRENT = BASE / "data-news" / "judicial-vacancies"
HOST = "https://www.uscourts.gov"
OUT = fl.ROOT / "private" / "build" / "judiciary" / "vacancies_parsed.json"

REASONS = {"Senior", "Retired", "Elevated", "Resigned", "Deceased", "New Position", "Impeached", "AO Director", "FJC Director",
           "Not Specified", "Term Expired", "Removed", "Reassigned", "Retiring", "Died", "Abolished"}
CIRCUIT_WORDS = {"First": "01", "Second": "02", "Third": "03", "Fourth": "04", "Fifth": "05", "Sixth": "06", "Seventh": "07",
                 "Eighth": "08", "Ninth": "09", "Tenth": "10", "Eleventh": "11", "Federal": "FD", "District of Columbia": "DC", "D.C.": "DC"}
CIRCUIT_RE = re.compile(r"^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Federal|District of Columbia|D\.C\.) Circuit$")
SECTION_HEADERS = {"International Trade": "IT", "Court of International Trade": "IT", "Supreme Court": "SUP",
                   "Supreme Court of the United States": "SUP", "Claims Court": "CLM", "Court of Federal Claims": "CLM"}
DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$")
CODE_RE = re.compile(r"^(\d{2}|DC|FD|IT) -(?: ([A-Z]{2,3}(?:-[A-Z])?))?$")
SHORT_CODE_RE = re.compile(r"^(CCA|CIT|IT|USIT|[A-Z]{2}(?:[-,][A-Z])?|[A-Z]{3})$")
REGION = {"N": "n", "S": "s", "E": "e", "W": "w", "M": "m", "C": "c"}
STATE_CODES = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
               "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
               "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "GU", "MP"}
TERRITORY = {"PR": "prd", "VI": "vid", "GU": "gud", "MP": "nmid", "NMI": "nmid", "GUAM": "gud"}


def iso_date(text: str, report_year: int) -> str | None:
    m = DATE_RE.match(text.strip())
    if not m:
        return None
    mo, d, y = int(m.group(1)), int(m.group(2)), m.group(3)
    if len(y) == 2:
        year = (report_year // 100) * 100 + int(y)
        if year > report_year + 5:
            year -= 100
        elif year < report_year - 95:
            year += 100
    else:
        year = int(y)
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return f"{year:04d}-{mo:02d}-{d:02d}"


def court_id(circuit: str | None, code: str | None) -> str | None:
    """Court id from the circuit prefix and the court code as printed ('02', 'NY-S' -> 'nysd'; '09', 'CCA' -> 'ca9')."""
    c = (circuit or "").strip().upper()
    if c == "IT" and (not code or code.strip().upper() in ("USIT", "IT", "CIT", "CCA")):  # Court of International Trade
        return "cit"
    if c == "SUP":
        return "scotus"
    if c == "CLM":
        return "uscfc"
    if not code:
        return None
    code = code.strip().upper().replace(",", "-")
    if code in ("CCA",):
        if c.isdigit():
            return f"ca{int(c)}"
        return {"DC": "cadc", "FD": "cafc", "IT": "cit"}.get(c)
    if code in ("CIT", "IT") or (c == "IT" and code in ("", "CCA")):
        return "cit"
    if code == "SC":  # bare 'SC' rows (without a circuit prefix) are the Supreme Court; '04 - SC' is South Carolina
        return "scotus" if not c else "scd"
    if code == "CL":
        return "uscfc"
    if c == "DC" and code == "DC":
        return "dcd"
    if code in TERRITORY:
        return TERRITORY[code]
    m = re.fullmatch(r"([A-Z]{2})-?([NSEWMC])?", code)
    if not m or m.group(1) not in STATE_CODES:
        return None
    st, reg = m.group(1).lower(), m.group(2)
    return st + (REGION[reg] if reg else "") + "d"


def html_rows(text: str) -> list[list[str]]:
    out = []
    for r in re.findall(r"<tr.*?</tr>", text, re.S):
        cells = [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split()) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
        out.append(cells)
    return out


def pdf_rows(data: bytes) -> tuple[list[list[str]], int]:
    text = subprocess.run(["pdftotext", "-layout", "-", "-"], input=data, capture_output=True, check=False).stdout.decode("utf-8", "replace")
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        rows.append([c.strip() for c in re.split(r"\s{2,}", line.strip())])
    return rows, len(text.split())


def as_of(text_rows: list[list[str]], fallback: str) -> str:
    for cells in text_rows[:12]:
        for c in cells:
            m = re.search(r"[Aa]s of (\d{1,2}/\d{1,2}/\d{4})", c)
            if m:
                return iso_date(m.group(1), int(m.group(1)[-4:])) or fallback
    return fallback


HEADER_KEYS = {
    "Circuit/District": "court", "Court": "court", "Incumbent": "incumbent", "Vacancy Created By": "incumbent", "Vacancy Reason": "reason",
    "Reason": "reason", "Vacancy Date": "vacancy_date", "Vacancy Notification Date": "notification_date", "Nominee": "nominee",
    "Nomination Date": "nomination_date", "Confirmation Date": "confirmation_date", "Days Pending": "days_pending", "Title": "title",
    "Weighted*": "weighted", "Adjusted*": "adjusted", "Weighted Filings per Judgeship (District) *": "weighted",
    "Adjusted Filings per Panel (Appeals) *": "adjusted", "Vacancies": "vacancies", "Nominees Pending": "nominees_pending",
    "Nominees Pending for Future Vacancies": "nominees_pending_future", "Authorized Judgeships": "authorized",
}
DATE_FIELDS = {"vacancy_date", "notification_date", "nomination_date", "confirmation_date"}


def parse_rows(rows: list[list[str]], kind: str, report_year: int, use_header: bool = True) -> tuple[list[dict], int]:
    """State machine over table rows or PDF lines. Returns (parsed rows, unparsed data-looking lines). PDF lines never use
    header mapping (their header words do not line up with the cells of continuation lines)."""
    out, unparsed = [], 0
    circuit, court_code, header = None, None, None
    for cells in rows:
        ne = [c for c in cells if c]
        if not ne:
            continue
        joined = " | ".join(ne)
        names = [HEADER_KEYS.get(c) for c in cells]
        if not use_header and sum(1 for n in names if n) >= 3 and not any(DATE_RE.match(c) for c in ne):
            continue
        if sum(1 for n in names if n) >= 3 and "" not in cells and not any(DATE_RE.match(c) for c in ne):
            header = names
            continue
        if sum(1 for n in names if n) >= 3:  # header with spacer cells (1999-2001 one-row tables): positional parsing
            header = None
            continue
        if len(ne) == 2 and re.fullmatch(r"\d{2}|DC|FD|IT", ne[0]) and SHORT_CODE_RE.match(ne[1]):  # 1999 rows: ['01', 'PR']
            circuit, court_code = ne[0], ne[1]
            continue
        if len(ne) == 1:
            m = CIRCUIT_RE.match(ne[0])
            if m:
                circuit = CIRCUIT_WORDS[m.group(1)]
                court_code = None
                continue
            if ne[0] in SECTION_HEADERS:
                circuit, court_code = SECTION_HEADERS[ne[0]], None
                continue
            if SHORT_CODE_RE.match(ne[0]) and ne[0] not in REASONS:
                court_code = ne[0]
                continue
        if not any(DATE_RE.match(c) for c in ne):
            if kind == "summary" and header and len(cells) == len(header):
                rec = {header[i]: cells[i] for i in range(len(cells)) if header[i]}
                if rec.get("court") and any(rec.get(k, "").replace(",", "").isdigit() for k in ("vacancies", "nominees_pending")):
                    out.append({"kind": kind, **rec, "source_text": joined})
            continue
        rec = None
        if header and len(cells) == len(header):
            rec = {header[i]: cells[i] for i in range(len(cells)) if header[i]}
            m = CODE_RE.match(rec.get("court", ""))
            if m:
                rec["court_circuit"], rec["court_code"] = m.group(1), m.group(2)
            elif rec.get("court") in ("IT", "CIT"):  # Court of International Trade rows print the bare code
                rec["court_circuit"], rec["court_code"] = "IT", None
            elif rec.get("court") in ("SC", "CL"):  # Supreme Court / Court of Federal Claims rows print the bare code
                rec["court_circuit"], rec["court_code"] = None, rec["court"]
        else:
            rec = positional(ne, kind)
            if rec is not None:
                if rec.get("court_code"):
                    court_code = rec["court_code"]
                rec.setdefault("court_code", court_code)
                rec["court_circuit"] = circuit
        if not rec or not (rec.get("incumbent") or rec.get("nominee") or rec.get("vacancy_date")):
            unparsed += 1
            continue
        for k in DATE_FIELDS:
            if rec.get(k):
                raw = rec[k]
                rec[k + "_raw"] = raw
                rec[k] = iso_date(raw, report_year) if DATE_RE.match(raw) else None
        rec["court_id"] = court_id(rec.get("court_circuit"), rec.get("court_code"))
        rec["kind"] = kind
        rec["source_text"] = joined
        out.append(rec)
    return out, unparsed


def positional(ne: list[str], kind: str) -> dict | None:
    """[court?] incumbent reason date [date] [nominee date] - for the one-row-table HTML and PDF layouts."""
    cells = list(ne)
    rec: dict = {}
    if cells and (CODE_RE.match(cells[0]) or (SHORT_CODE_RE.match(cells[0]) and cells[0] not in REASONS and len(cells) >= 4)):
        m = CODE_RE.match(cells[0])
        rec["court_code"] = m.group(2) if m else cells[0]
        if m:
            rec["court_circuit_inline"] = m.group(1)
        cells = cells[1:]
    if len(cells) < 3:
        return None
    # the reason is a word cell (no comma, no digit) directly followed by a date; known values are in REASONS
    if not (cells[1] in REASONS or (re.fullmatch(r"[A-Z][A-Za-z .]{2,30}", cells[1]) and (DATE_RE.match(cells[2]) or cells[2] == "TBD"))):
        return None
    rec["incumbent"], rec["reason"] = cells[0], cells[1]
    rest = cells[2:]
    dates = []
    while rest and (DATE_RE.match(rest[0]) or rest[0] == "TBD"):
        dates.append(rest.pop(0))
    if not dates:
        return None
    if len(dates) == 2:
        rec["notification_date"], rec["vacancy_date"] = dates
    else:
        rec["vacancy_date"] = dates[0]
    if kind == "emergencies":  # days pending, then weighted / adjusted filings, all numeric
        for key in ("days_pending", "weighted", "adjusted"):
            if rest and re.fullmatch(r"\d[\d,]*|N/A", rest[0]):
                rec[key] = rest.pop(0)
        return None if rest else rec
    if rest:
        rec["nominee"] = rest.pop(0)
        if rest and DATE_RE.match(rest[0]):
            rec["nomination_date"] = rest.pop(0)
    if rest:
        return None
    return rec


def reports():
    for path in sorted(ARCHIVE.glob("*/*/*.gz")):
        y, m = int(path.parts[-3]), int(path.parts[-2])
        kind = path.name[:-3]
        yield f"{y:04d}-{m:02d}", kind, path, f"{HOST}/judges-judgeships/judicial-vacancies/archive-judicial-vacancies/{y:04d}/{m:02d}/{kind}"
    for name, kind in (("current-judicial-vacancies", "vacancies"), ("future-judicial-vacancies", "future"),
                       ("judicial-emergencies", "emergencies"), ("confirmation-listing", "confirmations")):
        yield "current", kind, CURRENT / f"{name}.gz", f"{HOST}/data-news/judicial-vacancies/{name}"


def main() -> None:
    parsed, coverage = [], []
    for month, kind, path, url in reports():
        data = gzip.decompress(path.read_bytes())
        year = 2026 if month == "current" else int(month[:4])
        if data[:4] == b"%PDF":
            rows, words = pdf_rows(data)
            fmt = "pdf_text" if words > 30 else "pdf_image"
            if fmt == "pdf_image" or kind not in ("vacancies", "future"):
                coverage.append({"month": month, "kind": kind, "url": url, "format": fmt, "parsed": 0,
                                 "status": "not parsed: scanned image without a text layer" if fmt == "pdf_image" else "not parsed: PDF layout of this report type not supported"})
                continue
            report_as_of = as_of(rows, f"{month}-01")
        else:
            rows = html_rows(data.decode("utf-8", "replace"))
            fmt = "html"
            report_as_of = as_of(rows, f"{month}-01" if month != "current" else "2026-10-22")
        recs, unparsed = parse_rows(rows, kind, year, use_header=fmt == "html")
        totals = {}
        for cells in rows:
            for c in cells:
                m = re.search(r"Total (Vacancies|Confirmations|Emergencies|Nominees Pending)\s*:\s*(\d+)", c)
                if m and m.group(1) not in totals:
                    totals[m.group(1)] = int(m.group(2))
        for r in recs:
            r["month"], r["url"], r["as_of"] = month, url, report_as_of
        parsed += recs
        expected = totals.get({"vacancies": "Vacancies", "future": "Vacancies", "confirmations": "Confirmations"}.get(kind, ""))
        status = "parsed" if recs else "no rows found"
        if recs and expected is not None and expected != len(recs):
            status = f"partial: {len(recs)} rows parsed, the report prints a total of {expected}"
        coverage.append({"month": month, "kind": kind, "url": url, "format": fmt, "parsed": len(recs), "unparsed_lines": unparsed,
                         "as_of": report_as_of, "published_totals": totals, "status": status})
    OUT.write_text(json.dumps({"rows": parsed, "coverage": coverage}))
    by = {}
    for c in coverage:
        by.setdefault(c["status"], 0)
        by[c["status"]] += 1
    print(json.dumps({"rows": len(parsed), "reports": len(coverage), "by_status": by,
                      "unparsed_lines": sum(c.get("unparsed_lines", 0) for c in coverage),
                      "rows_without_court_id": sum(1 for r in parsed if not r.get("court_id") and r["kind"] != "summary")}))


if __name__ == "__main__":
    main()
