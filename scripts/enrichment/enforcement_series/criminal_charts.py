"""Readers for the data pages behind the DOJ Antitrust Division "Criminal Enforcement Trends Charts" (through FY2025).

Each chart on https://www.justice.gov/atr/criminal-enforcement-fine-and-jail-charts links a "[D]" data page:
  total criminal cases filed        FY, Total Cases
  corporations and individuals      FY, Corporations, Individuals
  total criminal fines & penalties  FY, Fine Amounts in $ Millions
  average number of jail days       FY, Average Number of Jail Days
  average prison sentence (months)  decade averages printed as text (no table)
Values are kept as printed (a fine of "2000" for FY2017 is NOT corrected: the workload report prints $2,785,856 thousand for
that year; the builder records both and the difference).
"""
import html
import re

import workload_html

UPDATED_RE = re.compile(r"Updated\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})")
DECADE_RE = re.compile(r"^(\d{4})-(\d{4}) Average - (\d+(?:\.\d+)?)$")


def _text(markup):
    return markup if isinstance(markup, str) else markup.decode("utf-8", "replace")


def updated(markup):
    m = UPDATED_RE.findall(_text(markup))
    return m[-1] if m else None


def read_table(markup):
    """[{fy, values: [as printed...]}] from the page's single data table (row header = fiscal year)."""
    tables = workload_html.parse_tables(markup)
    rows = None
    for t in tables:
        if t["rows"] and any(c["text"] in ("Fiscal Year", "Total Cases", "Corporations") or c["text"].startswith(("Fine Amounts", "Average Number")) for c in t["rows"][0]):
            rows = t["rows"]
            break
    if rows is None:
        raise ValueError("data table not found")
    header = [c["text"] for c in rows[0]]
    out = []
    for position, row in enumerate(rows[1:], 1):
        cells = [c["text"] for c in row]
        if not re.fullmatch(r"\d{4}", cells[0]):
            raise ValueError(f"unexpected fiscal year cell {cells[0]!r}")
        out.append({"fy": int(cells[0]), "values": cells[1:], "position": position})
    return header, out


def parse_number(text):
    t = text.strip().replace(",", "")
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", t):
        return None
    return float(t) if "." in t else int(t)


def read_decade_averages(markup):
    """[{from, to, months, text}] from lines such as '1990-1999 Average - 8' (the page prints no table)."""
    text = html.unescape(re.sub(r"<[^>]+>", "\n", _text(markup))).replace(" ", " ")
    out = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        m = DECADE_RE.match(line)
        if m:
            out.append({"from": int(m.group(1)), "to": int(m.group(2)), "months": parse_number(m.group(3)), "text": line})
    return out
