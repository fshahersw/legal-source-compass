"""Parsers for the public (logged-out) Stanford Securities Class Action Clearinghouse pages and the external market series.

Every parser reads the raw bytes kept under private/acq/scac/raw/ and returns plain values; nothing is inferred. A page whose
structure does not match returns an empty result, which the builder treats as a failure rather than a zero.
"""
from __future__ import annotations

import csv
import datetime as dt
import html
import io
import re
import zipfile

_TAG = re.compile(r"<[^>]+>")
_COMMENT = re.compile(r"(?s)<!--.*?-->")


def text(fragment: str) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", fragment)).split())


def money(s: str) -> int | None:
    m = re.search(r"\$\s*([\d,]+)", s or "")
    return int(m.group(1).replace(",", "")) if m else None


def us_date(s: str) -> str | None:
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    if not m:
        return None
    try:
        return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
    except ValueError:
        return None


def year_chart(page: str) -> list[tuple[int, int]]:
    """Filings by year from the charts page's chartData array."""
    block = re.search(r"var chartData = \[(.*?)\];", page, re.S)
    if not block:
        return []
    return [(int(y), int(n)) for y, n in re.findall(r"cld_filing_year:\s*'(\d{4})',\s*cnt:\s*(\d+)", block.group(1))]


def heat_list(page: str) -> list[tuple[str, int]]:
    """Label and count pairs of the visible heat-map list (ul#mapnav); commented-out template lists are ignored."""
    page = _COMMENT.sub("", page)
    block = re.search(r'<ul id="mapnav"[^>]*>(.*?)</ul>', page, re.S)
    if not block:
        return []
    out = []
    for title, inner in re.findall(r'<li title="([^"]*)">(.*?)</li>', block.group(1), re.S):
        m = re.search(r"<tiny[^>]*>\s*([\d,]+)\s*</tiny>", inner)
        if m:
            out.append((html.unescape(title).strip(), int(m.group(1).replace(",", ""))))
    return out


def total_filings(page: str) -> int | None:
    m = re.search(r"([\d,]+)\s*</?[^>]*>?\s*total Filings", _COMMENT.sub("", page))
    if m:
        return int(m.group(1).replace(",", ""))
    m = re.search(r"([\d,]+)\s+total Filings", text(_COMMENT.sub("", page)))
    return int(m.group(1).replace(",", "")) if m else None


KEY_STAT_LABELS = (
    "Most Active District Court", "Total $ Amount of All Settlements", "Total # of Defendants (Individual and Companies) sued",
    "Number of Filings Settled", "Number of Filings Dismissed", "Number of Filings Still Ongoing", "Most frequently Sued Sector",
    "Most Frequently Sued Industry", "Exchange of Most Frequently Sued Issuers",
)


def key_stats(page: str) -> list[tuple[str, str]]:
    """Box-score values of the key statistics page: each value is printed directly before its label."""
    t = text(_COMMENT.sub("", page))
    start = t.find("Box scores or key statistics")
    if start < 0:
        return []
    t = t[start:]
    out = []
    pos = len("Box scores or key statistics from 1996 to YTD")
    for label in KEY_STAT_LABELS:
        i = t.find(label, pos)
        if i < 0:
            return []
        out.append((label, t[pos:i].strip()))
        pos = i + len(label)
    return out


def accordions(page: str) -> list[dict]:
    """Top-ten accordion entries: entity, headline figure, stage sentence, detail pairs and the SCAC case id."""
    out = []
    for block in re.split(r'<div class="accordion-group', page)[1:]:
        ent = re.search(r'<div class="top-offenders-entity">(.*?)</div>', block, re.S)
        fig = re.search(r'<div class="top-offenders-sanctions">(.*?)</div>', block, re.S)
        if not ent or not fig:
            continue
        stage = re.search(r"<p>(.*?)</p>", block, re.S)
        pairs = re.findall(r"<tr[^>]*>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", block, re.S)
        case = re.search(r"filings-case\.html\?id=(\d+)", block)
        firm_id = re.search(r"input_filing_plaintif_law_firm_id'\)\.val\((\d+)\)", block)
        out.append({"entity": text(ent.group(1)), "figure": text(fig.group(1)), "stage": text(stage.group(1)) if stage else None,
                    "details": {text(a): text(b) for a, b in pairs}, "case_id": int(case.group(1)) if case else None,
                    "scac_firm_id": int(firm_id.group(1)) if firm_id else None})
    return out


def current_trends(page: str) -> list[dict]:
    """Current-trend sections: name, published count, first and last filing dates, and the public filing rows."""
    out = []
    heads = list(re.finditer(r"<h4>(.*?)<div class=\"pull-right\"><small[^>]*>(.*?)</small>", page, re.S))
    for i, h in enumerate(heads):
        name = text(h.group(1))
        meta = text(h.group(2))
        m = re.search(r"([\d,]+) Filings \| First case filed on (\d{2}/\d{2}/\d{4}) \| Last case filed on (\d{2}/\d{2}/\d{4})", meta)
        if not m:
            continue
        body = page[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(page)]
        rows = []
        for case, cells in re.findall(r"<tr class=\"table-link\" page=\"current-trends\" onclick=\"window\.location='filings-case\.html\?id=(\d+)'\">(.*?)</tr>", body, re.S):
            tds = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", cells, re.S)]
            if len(tds) == 6:
                rows.append({"case_id": int(case), "name": tds[0], "filed": us_date(tds[1]), "court": tds[2], "exchange": tds[3], "ticker": tds[4], "sector": tds[5]})
        out.append({"name": name, "filings": int(m.group(1).replace(",", "")), "first": us_date(m.group(2)), "last": us_date(m.group(3)), "rows": rows})
    return out


def fred_csv(raw: bytes) -> list[tuple[dt.date, float]]:
    out = []
    for row in csv.reader(io.StringIO(raw.decode("utf-8"))):
        if len(row) != 2 or row[0] == "observation_date":
            continue
        try:
            out.append((dt.date.fromisoformat(row[0]), float(row[1])))
        except ValueError:
            continue  # FRED marks missing days with an empty or "." value
    return out


def ff_annual(raw_zip: bytes) -> dict[int, dict[str, float]]:
    """Annual Fama/French factors (January-December): Mkt-RF, SMB, HML, RF in percent."""
    z = zipfile.ZipFile(io.BytesIO(raw_zip))
    lines = z.read(z.namelist()[0]).decode("latin-1").splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if "Annual Factors" in l)
    except StopIteration:
        return {}
    head = [h.strip() for h in lines[start + 1].split(",")]
    out = {}
    for l in lines[start + 2:]:
        parts = [p.strip() for p in l.split(",")]
        if len(parts) != len(head) or not parts[0].isdigit():
            break
        out[int(parts[0])] = {h: float(v) for h, v in zip(head[1:], parts[1:])}
    return out


def yearly(series: list[tuple[dt.date, float]]) -> dict[int, dict[str, float]]:
    """Calendar-year mean, max and last value of a daily series, with the observation count."""
    by = {}
    for d, v in series:
        by.setdefault(d.year, []).append((d, v))
    out = {}
    for y, obs in by.items():
        obs.sort()
        vals = [v for _, v in obs]
        out[y] = {"mean": sum(vals) / len(vals), "max": max(vals), "last": obs[-1][1], "last_date": obs[-1][0].isoformat(), "n": len(vals)}
    return out
