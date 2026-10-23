"""Parsers for EOUSA National Caseload Data (LIONS) FY2025 release files: the ANNUAL DATA.ZIP "TRAC deliverable"
CSVs and the code tables on DISK28 (global_LIONS.txt). Pure functions; no person-level field is returned.

The deliverable CSVs are comma-separated without quoting, so a lead-charge code that itself contains a comma
("08 :01326a, b2") spreads over extra fields; rows are therefore read from both ends (fixed leading and trailing
columns, the middle re-joined with commas).
"""
from __future__ import annotations

import csv
import io
import re

# EOUSA district code -> court id (court_spine); only exact entries below are linked
DISTRICT_SUFFIX = {"N": "n", "S": "s", "E": "e", "W": "w", "M": "m", "C": "c"}
SPECIAL = {"NMI": "nmid", "MP": "nmid", "VI": "vid", "PR": "prd", "GU": "gud", "DC": "dcd"}


def court_id_for(code: str, known: set[str]) -> str | None:
    c = (code or "").strip().upper()
    cid = SPECIAL.get(c)
    if not cid:
        if len(c) == 2 and c.isalpha():
            cid = c.lower() + "d"
        elif len(c) == 3 and c[:2].isalpha() and c[2] in DISTRICT_SUFFIX:
            cid = c[:2].lower() + DISTRICT_SUFFIX[c[2]] + "d"
    return cid if cid in known else None


def code_tables(global_lions: str) -> dict[str, dict[str, dict]]:
    """{table: {code: {'description', 'status', 'master'?}}} from the fixed-width blocks in global_LIONS.txt.
    Column widths come from each block's dashed separator line."""
    lines = global_lions.splitlines()
    out: dict[str, dict[str, dict]] = {}
    i = 0
    while i < len(lines):
        name = lines[i].strip()
        if re.fullmatch(r"GS_[A-Z0-9_]+", name):
            j = i + 1
            while j < len(lines) and not lines[j].strip().startswith("---"):
                j += 1
            if j >= len(lines):
                break
            header, dashes = lines[j - 1], lines[j]
            spans = [(m.start(), m.end()) for m in re.finditer(r"-+", dashes)]
            cols = [header[a:b].strip() or header[a:].split()[0] for a, b in spans]
            table: dict[str, dict] = {}
            k = j + 1
            while k < len(lines) and not re.fullmatch(r"\s*GS_[A-Z0-9_]+\s*", lines[k]):
                row = lines[k]
                if row.strip():
                    vals = [row[a:b].strip() if a < len(row) else "" for a, b in spans]
                    # the last column runs to the end of the line
                    if spans and len(row) > spans[-1][1]:
                        vals[-1] = row[spans[-1][0]:].strip()
                    rec = dict(zip(cols, vals))
                    code = rec.get("Code") or rec.get("District") or rec.get("MasterCode")
                    if code:
                        table[code] = {"description": rec.get("Description", ""), "status": rec.get("Status", ""),
                                       "master": rec.get("MasterCode", "") if "Code" in rec else ""}
                k += 1
            out[name] = table
            i = k
            continue
        i += 1
    return out


def read_rows(text_stream, leading: int, trailing: int):
    """Yield (header, row) with rows re-assembled when an unquoted comma split the middle column."""
    reader = csv.reader(text_stream)
    header = next(reader)
    middle = len(header) - leading - trailing
    if middle != 1:
        raise ValueError("expected exactly one free-text middle column")
    for row in reader:
        if not row:
            continue
        if len(row) > len(header):
            row = row[:leading] + [",".join(row[leading:len(row) - trailing])] + row[len(row) - trailing:]
        elif len(row) < len(header):
            continue
        yield header, row


def count(v: str) -> int:
    return 0 if v in ("NULL", "") else int(v)


def charge_title(code: str) -> str | None:
    """U.S.C. title from a LIONS charge code ('18 :00922g1' -> '18'); codes with a state/DC suffix ('05S:', '36R')
    or the '0000' DC-local code return None (not U.S. Code titles)."""
    m = re.match(r"^(\d{2}) :", code or "")
    return str(int(m.group(1))) if m else None


def open_text(z, name: str):
    return io.TextIOWrapper(z.open(name), encoding="latin-1", newline="")
