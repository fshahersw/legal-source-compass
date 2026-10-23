"""Deterministic extraction from one page of stored document text (documents/1).

Kinds: case_citation, usc, cfr (the shared citation parser, citations.py), state_code (state_codes.py), mdl_number,
docket_number, date, dollar_amount. Every extraction keeps the page, the exact code-point span [start, end) and the exact
matched text (`text[start:end]`), so the database can re-check it against the stored page before accepting it. Keys are
lookup keys for exact resolution in the database (usc:<title>:<section>, cfr:<title>:<part>.<section>,
cfr-part:<title>:<part>, case:<volume> <reporter> <page>, mdl:<number>); nothing is resolved or guessed here.

Rules:
- the CM/ECF header a court prints on every page ("Case 3:16-md-02738 Document 9 Filed 06/26/24 Page 1 of 3") is page
  furniture: dates and docket numbers inside it are not extracted (the database reads the header itself);
- a date is a full calendar date (month name + day + four-digit year, M/D/YYYY, or YYYY-MM-DD) that exists; years alone,
  two-digit years and month-year forms are not dates here;
- a dollar amount is "$" + number (+ thousand/million/billion/trillion); its value is computed exactly (Decimal) and kept
  with the sentence it stands in (offsets plus text, at most 500 characters);
- an MDL number is written as MDL / M.D.L. / Multidistrict Litigation followed by a number; a docket number "3:16-md-02738"
  is a docket number, never read as an MDL number;
- extractions of other kinds never overlap a citation span; within a kind, overlapping matches keep the earliest.
"""

from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal, InvalidOperation

from citations import S, extract_citations, js
from state_codes import state_code_citations

EXTRACTOR_VERSION = "documents-extract/1"
KINDS = ("case_citation", "usc", "cfr", "state_code", "mdl_number", "docket_number", "date", "dollar_amount")

ECF_RE = re.compile(
    js(
        r"Case:?\s*(MDL\s+No\.\s*\d{1,5}|\d{1,2}:\d{2}-[A-Za-z]{2,4}-\d{1,6}(?:-[A-Za-z0-9]{1,6}){0,4})\s+Document:?\s*#?:?\s*"
        r"(\d{1,6}(?:-\d{1,3})?)\s+Filed:?\s*(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})\s+Page:?\s*(\d{1,5})\s+of\s+(\d{1,5})"
        r"(?:\s+PageI[Dd]\s*#?:?\s*\d{1,9})?"
    ),
    re.I,
)

MDL_RE = re.compile(
    js(
        r"(?<![A-Za-z0-9_])(?:MDL|M\.D\.L\.|Multi-?\s?[Dd]istrict\s+Litigation)"
        r"(?:\s*[-–]\s*|\s+)(?:(?:Docket\s+)?No\.?\s*:?\s*|Number\s+)?(?P<n>\d{1,5})(?![0-9A-Za-z_:/])(?!\s*[-–]\s*\d)(?![.,]\d)"
    )
)
DOCKET_TYPES = r"(?:cv|cr|md|mc|ml|bk|ap|mj|po|sw|gj|dp|ms|cb|ad)"
DOCKET_RE = re.compile(
    js(
        r"(?<![A-Za-z0-9_:/.-])(?P<office>\d{1,2}):(?P<yy>\d{2}|\d{4})-(?P<type>" + DOCKET_TYPES + r")-(?P<num>\d{1,6})"
        r"(?:-(?P<judge>[A-Z]{1,5}(?:-[A-Z]{1,5}){0,3}))?(?![A-Za-z0-9_])"
    ),
    re.I,
)

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5, "jun": 6,
    "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10,
    "nov": 11, "november": 11, "dec": 12, "december": 12,
}
MON = r"(?P<mon>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE_MDY = re.compile(js(r"(?<![A-Za-z0-9_])" + MON + r"\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<year>\d{4})(?![0-9])"), re.I)
DATE_DMY = re.compile(
    js(r"(?<![A-Za-z0-9_])(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?" + MON + r"\.?,?\s+(?P<year>\d{4})(?![0-9])"), re.I
)
DATE_NUM = re.compile(r"(?<![0-9/.-])(?P<mon>\d{1,2})/(?P<day>\d{1,2})/(?P<year>\d{4})(?![0-9/])")
DATE_ISO = re.compile(r"(?<![0-9/.-])(?P<year>\d{4})-(?P<mon>\d{2})-(?P<day>\d{2})(?![0-9-])")

MULT = {"thousand": Decimal(1_000), "million": Decimal(1_000_000), "billion": Decimal(1_000_000_000),
        "trillion": Decimal(1_000_000_000_000)}
DOLLAR_RE = re.compile(
    js(
        r"(?<![A-Za-z0-9_$])\$\s?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?)(?![0-9,]*\d)"
        r"(?:\s?(?P<mult>thousand|million|billion|trillion)(?![A-Za-z]))?"
    ),
    re.I,
)

# Abbreviations whose period does not end a sentence (legal text is full of them).
ABBREV = {
    "no", "nos", "v", "vs", "u.s", "inc", "co", "corp", "ltd", "llc", "l.l.c", "mr", "mrs", "ms", "dr", "jr", "sr", "st",
    "cir", "fed", "supp", "e.g", "i.e", "etc", "stat", "reg", "cf", "al", "ex", "art", "ch", "sec", "secs", "p", "pp",
    "para", "app", "ct", "dist", "f", "s", "n", "id", "ann", "rev", "gen", "civ", "proc", "prac", "rem", "jan", "feb",
    "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "dkt", "doc", "ecf", "hon", "u.s.c", "c.f.r",
    "approx", "est", "dept", "assn", "ass'n", "int'l", "nat'l", "bros", "mfg", "l", "pub",
}
SENTENCE_MAX = 500
_WS = re.compile(S + "+")


def _ok_date(y: int, m: int, d: int) -> str | None:
    if not 1900 <= y <= 2100:
        return None
    try:
        return dt.date(y, m, d).isoformat()
    except ValueError:
        return None


def _ends_sentence(text: str, i: int) -> bool:
    """Whether the character at i ('.', '!' or '?') ends a sentence (it must be followed by whitespace)."""
    if i + 1 < len(text) and not _WS.match(text[i + 1]):
        return False
    if text[i] != ".":
        return True
    j = i
    while j > 0 and not _WS.match(text[j - 1]) and text[j - 1] not in "(\"'“":
        j -= 1
    token = text[j:i].lower().rstrip(".")
    if token in ABBREV or (len(token) == 1 and token.isalpha()) or re.fullmatch(r"[a-z](?:\.[a-z])+", token):
        return False
    return True


def sentence_bounds(text: str, start: int, end: int) -> tuple[int, int]:
    """The sentence holding [start, end): from just after the previous sentence end (or blank line) to the next one."""
    lo = max(0, start - 1500)
    s = lo
    i = start - 1
    while i >= lo:
        ch = text[i]
        if ch == "\n" and i > 0 and "\n" in text[max(lo, i - 3) : i]:
            s = i + 1
            break
        if ch in ".!?" and _ends_sentence(text, i):
            s = i + 1
            break
        i -= 1
    hi = min(len(text), end + 1500)
    e = hi
    i = end
    while i < hi:
        ch = text[i]
        if ch == "\n" and "\n" in text[i + 1 : i + 4]:
            e = i
            break
        if ch in ".!?" and _ends_sentence(text, i):
            e = i + 1
            break
        i += 1
    while s < start and _WS.match(text[s]):
        s += 1
    while e > end and _WS.match(text[e - 1]):
        e -= 1
    if e - s > SENTENCE_MAX:  # keep a window centred on the amount
        half = (SENTENCE_MAX - (end - start)) // 2
        s = max(s, start - half)
        e = min(e, s + SENTENCE_MAX)
    return s, e


def docket_key(office: str, yy: str, typ: str, num: str) -> str:
    n = num.lstrip("0") or "0"
    return f"{int(office)}:{yy[-2:]}-{typ.lower()}-{n if len(n) >= 5 else n.zfill(5)}"


def _row(page_text: str, start: int, end: int, kind: str, normalized: str | None, key: str | None, value: dict | None) -> dict:
    return {"start": start, "end": end, "kind": kind, "matched": page_text[start:end], "normalized": normalized,
            "key": key, "value": value}


def extract_page(text: str) -> list[dict]:
    """All extractions of one page, in reading order (start, kind)."""
    rows: list[dict] = []
    furniture = [(m.start(), m.end()) for m in ECF_RE.finditer(text)]

    cites = extract_citations(text, limit=100_000)
    taken: list[tuple[int, int]] = []
    for c in cites:
        if c["kind"] == "case":
            pin = c.get("pin")
            rows.append(_row(text, c["start"], c["end"], "case_citation", c["normalized"], c["key"],
                             {"group": c["group"], **({"pin": pin} if pin else {})}))
        elif c["kind"] in ("usc", "cfr"):
            s, e = c["item_start"], c["item_end"]
            value = {k: c[k] for k in ("title", "part", "section", "sectionEnd", "pin") if c.get(k) is not None}
            rows.append(_row(text, s, e, c["kind"], c["normalized"], c["key"], value or None))
        taken.append((c["start"], c["end"]))  # statutes at large, public laws, Fed. Reg. pages hold their span too

    def free(s: int, e: int, spans: list[tuple[int, int]]) -> bool:
        return all(e <= a or s >= b for a, b in spans)

    for c in state_code_citations(text):
        if free(c["start"], c["end"], taken):
            rows.append(_row(text, c["start"], c["end"], "state_code", c["normalized"], c["key"],
                             {"state": c["state"], "code": c["code"], "section": c["section"]}))
            taken.append((c["start"], c["end"]))

    def add(kind: str, items: list[tuple[int, int, str | None, str | None, dict | None]], skip_furniture: bool) -> None:
        last_end = -1
        for s, e, norm, key, value in sorted(items, key=lambda x: (x[0], -x[1])):
            if s < last_end or not free(s, e, taken):
                continue
            if skip_furniture and not free(s, e, furniture):
                continue
            rows.append(_row(text, s, e, kind, norm, key, value))
            last_end = e

    mdl = []
    for m in MDL_RE.finditer(text):
        n = int(m.group("n"))
        if n >= 1:
            mdl.append((m.start(), m.end(), f"MDL No. {n}", f"mdl:{n}", None))
    add("mdl_number", mdl, False)

    dockets = []
    for m in DOCKET_RE.finditer(text):
        key = docket_key(m.group("office"), m.group("yy"), m.group("type"), m.group("num"))
        dockets.append((m.start(), m.end(), key, f"docket:{key}", {"judge_suffix": m.group("judge")} if m.group("judge") else None))
    add("docket_number", dockets, True)

    dates = []
    for rx in (DATE_MDY, DATE_DMY):
        for m in rx.finditer(text):
            mon = m.group("mon")
            if mon[0].islower():  # "may 5, 2024" is a verb, not a month
                continue
            iso = _ok_date(int(m.group("year")), MONTHS[mon.lower()], int(m.group("day")))
            if iso:
                dates.append((m.start(), m.end(), iso, None, {"iso": iso, "form": "words"}))
    for m in DATE_NUM.finditer(text):
        iso = _ok_date(int(m.group("year")), int(m.group("mon")), int(m.group("day")))
        if iso:
            dates.append((m.start(), m.end(), iso, None, {"iso": iso, "form": "m/d/yyyy"}))
    for m in DATE_ISO.finditer(text):
        iso = _ok_date(int(m.group("year")), int(m.group("mon")), int(m.group("day")))
        if iso:
            dates.append((m.start(), m.end(), iso, None, {"iso": iso, "form": "iso"}))
    add("date", dates, True)

    amounts = []
    for m in DOLLAR_RE.finditer(text):
        try:
            base = Decimal(m.group("num").replace(",", ""))
        except InvalidOperation:
            continue
        mult = (m.group("mult") or "").lower()
        amount = base * MULT[mult] if mult else base
        if amount == amount.to_integral_value():
            amount_json: int | float = int(amount)
            norm = f"${int(amount):,}"
        else:
            amount_json = float(amount)
            norm = "$" + format(amount, ",f")
        ss, se = sentence_bounds(text, m.start(), m.end())
        amounts.append((m.start(), m.end(), norm, None,
                        {"amount": amount_json, "currency": "USD", **({"multiplier": mult} if mult else {}),
                         "sentence": text[ss:se], "sentence_start": ss, "sentence_end": se}))
    add("dollar_amount", amounts, False)

    order = {k: i for i, k in enumerate(KINDS)}
    rows.sort(key=lambda r: (r["start"], order[r["kind"]]))
    return rows


def extract_document_pages(pages: list[dict]) -> list[dict]:
    """Rows for the database loader from [{sha256, page, text}]: one row per extraction with sha256 and page."""
    out = []
    for p in pages:
        text = p.get("text") or ""
        for r in extract_page(text):
            assert text[r["start"] : r["end"]] == r["matched"]
            out.append({"sha256": p["sha256"], "page": p["page"], **r})
    return out
