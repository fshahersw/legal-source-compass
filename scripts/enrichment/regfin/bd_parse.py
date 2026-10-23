"""Parse the SEC "Company Information About Active Broker-Dealers" monthly files.

Layout (SEC page): tab-delimited, one broker-dealer per line - CIK NUMBER (10), COMPANY NAME (60), REPORTING FILE NUMBER
(25), ADDRESS1 (40), ADDRESS2 (40), CITY (30), STATE CODE (2), ZIP CODE (10). Files are UTF-16 little-endian with a
byte-order mark; a one-space first line precedes the rows. Every field is kept exactly as published (only the
trailing line terminator is removed and runs of whitespace are collapsed).
"""
import re
from datetime import datetime

FIELDS = ["cik", "name", "file_number", "address1", "address2", "city", "state", "zip"]
MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    )
}


def decode(raw):
    """Bytes of one monthly file -> text. UTF-16 (BOM) as the SEC publishes it; UTF-8 accepted for robustness."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8-sig")


def parse(raw):
    """Return (rows, skipped) where rows are dicts keyed by FIELDS and skipped are non-data lines (as strings)."""
    rows, skipped = [], []
    for line in decode(raw).splitlines():
        if not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) < 8 or not re.fullmatch(r"\d{10}", cols[0].strip()):
            skipped.append(line)
            continue
        cols = [" ".join(c.split()) for c in cols[:8]]
        rows.append(dict(zip(FIELDS, cols)))
    return rows, skipped


def month_from_label(label):
    """'October 2026' -> '2026-10'; None when the label is not 'Month YYYY'."""
    m = re.fullmatch(r"\s*([A-Za-z]+)\s+(\d{4})\s*", label or "")
    if not m or m.group(1) not in MONTHS:
        return None
    return f"{int(m.group(2)):04d}-{MONTHS[m.group(1)]:02d}"


def validate_month(month):
    try:
        datetime.strptime(month, "%Y-%m")
        return True
    except (TypeError, ValueError):
        return False
