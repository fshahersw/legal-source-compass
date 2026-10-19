"""Investor documents filed with the SEC: exhibit tables, document types and extracted figures (pure functions, tested).

Earnings releases and presentations are the EX-99 exhibits of 8-K filings reporting Item 2.02 (results of operations) or
Item 7.01 (Regulation FD disclosure). Figures a model reads from a release are kept only when the quoted passage appears
verbatim in the exhibit text and contains the number; revenue, net income and diluted EPS are then compared with the
registrant's XBRL value for the same quarter.
"""
from __future__ import annotations

import html
import re
from datetime import date

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
HREF = re.compile(r'href="([^"]+)"', re.I)


def strip(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def exhibit_rows(index_html: str) -> list[dict]:
    """Rows of the filing index's document table: seq, description, document name, href, type, size."""
    out = []
    for row in ROW.findall(index_html):
        cells = CELL.findall(row)
        if len(cells) < 4:
            continue
        href = HREF.search(cells[2])
        typ = strip(cells[3])
        if not href or not typ:
            continue
        out.append({"seq": strip(cells[0]), "description": strip(cells[1]), "document": strip(cells[2]), "href": html.unescape(href.group(1)),
                    "type": typ, "size": strip(cells[4]) if len(cells) > 4 else ""})
    return out


def is_exhibit_99(row: dict) -> bool:
    return bool(re.match(r"^EX-99(\.\d+)?", row["type"], re.I)) and row["document"].lower().endswith((".htm", ".html", ".pdf", ".txt"))


def document_type(items: str, row: dict, text: str) -> str:
    """earnings_release | presentation | transcript | other, from the 8-K items, the exhibit description and its opening text."""
    desc = f"{row['description']} {row['document']}".lower()
    head = text[:3000].lower()
    if "transcript" in desc or re.search(r"\b(earnings|conference) call transcript\b", head):
        return "transcript"
    if re.search(r"presentation|slides|deck|investor day|investor update", desc) or (row["document"].lower().endswith(".pdf") and "presentation" in head):
        return "presentation"
    if "2.02" in items and re.search(r"press release|earnings|results|financial results", desc + " " + head[:1500]):
        return "earnings_release"
    if "2.02" in items and row["type"].upper() in ("EX-99.1", "EX-99"):
        return "earnings_release"
    return "other"


KPI_SYSTEM = (
    "You extract reported figures from a company's earnings release or results presentation filed with the SEC. Return JSON only:\n"
    '{"period_label": str|null, "period_end": "YYYY-MM-DD"|null, "currency": str|null,\n'
    ' "revenue": {"value": number, "scale": "units|thousands|millions|billions", "quote": str}|null,\n'
    ' "net_income": {...same...}|null, "eps_diluted": {"value": number, "quote": str}|null,\n'
    ' "segments": [{"name": str, "value": number, "scale": str, "quote": str}],\n'
    ' "kpis": [{"name": str, "value": str, "quote": str}],\n'
    ' "guidance": [{"metric": str, "text": str, "quote": str}]}\n'
    "Rules: figures are for the most recent quarter reported (GAAP figures, not adjusted, for revenue, net income and EPS). Each "
    "quote must be copied word for word from the text and contain the number. Losses are negative. Use null or [] when absent. "
    "At most 12 segments, 10 kpis and 6 guidance items. Never invent figures."
)
SCALE = {"units": 1, "thousands": 1e3, "millions": 1e6, "billions": 1e9}


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("’", "'").replace("“", '"').replace("”", '"').replace("—", "-").replace("–", "-")).strip()


def number_in(quote: str, value) -> bool:
    """True when the quote contains the number (allowing thousands separators, a decimal point and parentheses for negatives)."""
    if not isinstance(value, (int, float)):
        return False
    digits = re.sub(r"[^\d.]", "", f"{abs(value):,.4f}".rstrip("0").rstrip("."))
    compact = re.sub(r"[^\d.]", "", quote)
    if not digits:
        return False
    whole = digits.split(".")[0]
    return digits in compact or (whole and len(whole) >= 2 and whole in compact.replace(".", ""))


def validated(item: dict | None, text: str, *, needs_number: bool = True) -> dict | None:
    if not isinstance(item, dict):
        return None
    quote = item.get("quote")
    if not isinstance(quote, str) or len(quote) < 8 or norm(quote) not in norm(text):
        return None
    if needs_number and not number_in(quote, item.get("value")):
        return None
    return item


def validate_extraction(answer, text: str) -> dict | None:
    """Keep only quoted, verbatim figures; drop the rest and count what was dropped."""
    if not isinstance(answer, dict):
        return None
    out = {"period_label": answer.get("period_label") if isinstance(answer.get("period_label"), str) else None,
           "period_end": answer.get("period_end") if isinstance(answer.get("period_end"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", answer.get("period_end") or "") else None,
           "currency": answer.get("currency") if isinstance(answer.get("currency"), str) else None, "dropped": 0}
    for key in ("revenue", "net_income", "eps_diluted"):
        v = validated(answer.get(key), text)
        if answer.get(key) and not v:
            out["dropped"] += 1
        if v and key != "eps_diluted" and v.get("scale") not in SCALE:
            v = None
            out["dropped"] += 1
        out[key] = v
    for key, needs in (("segments", True), ("kpis", False), ("guidance", False)):
        kept = []
        items = answer.get(key) if isinstance(answer.get(key), list) else []
        for item in items[:12]:
            v = validated(item, text, needs_number=needs and key == "segments")
            if v:
                kept.append(v)
            else:
                out["dropped"] += 1
        out[key] = kept
    return out


def amount(item: dict | None) -> float | None:
    if not item or not isinstance(item.get("value"), (int, float)):
        return None
    return float(item["value"]) * SCALE.get(item.get("scale") or "units", 1)


def rounding_step(item: dict | None) -> float | None:
    """The size of the last digit the release reports, in units: 0.4 (millions) -> 100,000; 4,486 (millions) -> 1,000,000."""
    if not item or not isinstance(item.get("value"), (int, float)) or isinstance(item.get("value"), bool):
        return None
    text = repr(float(item["value"]))
    decimals = 0 if "e" in text or text.endswith(".0") else len(text.split(".")[1])
    return 10 ** -decimals * SCALE.get(item.get("scale") or "units", 1)


def xbrl_check(extracted: float | None, reported: float | None, tolerance: float, step: float | None = None) -> str:
    """matches (within the relative tolerance), rounded (equal once the XBRL value is rounded to the release's last
    reported digit), differs, or why no comparison was made."""
    if extracted is None:
        return "not_extracted"
    if reported is None:
        return "no_xbrl_value"
    if reported != 0 and abs(extracted - reported) / abs(reported) <= tolerance or extracted == reported:
        return "matches"
    if step and abs(extracted - reported) <= step / 2 * (1 + 1e-9):
        return "rounded"
    return "differs"


def quarter_for(period_end: str | None, filing_date: str, quarters: list[dict]) -> int | None:
    """Index of the XBRL quarter the release reports: the stated period end (within 7 days), else the latest quarter
    ending in the 100 days before the filing."""
    def d(s):
        return date.fromisoformat(s)

    if period_end:
        for i, q in enumerate(quarters):
            if abs((d(q["end"]) - d(period_end)).days) <= 7:
                return i
    best = None
    for i, q in enumerate(quarters):
        gap = (d(filing_date) - d(q["end"])).days
        if 0 <= gap <= 100 and (best is None or q["end"] > quarters[best]["end"]):
            best = i
    return best
