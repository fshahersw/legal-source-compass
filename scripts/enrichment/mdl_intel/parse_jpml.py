"""Parsers for official JPML publications (text from `pdftotext -layout`, chart labels via pdfplumber).

Every parser returns only values printed in the source; anything unparsed is left out (never guessed).
"""
import re
from datetime import date

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}

SUMMARY_FIELDS = [
    "hearings",
    "orders_issued",
    "motions_filed",
    "motions_granted",
    "actions_in_granted",
    "motions_denied_moot_withdrawn",
    "actions_in_denied",
    "tag_along_transfers",
    "remands",
]

SUMMARY_LABELS = {
    "hearings": "Hearing sessions",
    "orders_issued": "Panel judge issued orders",
    "motions_filed": "Motions for centralization filed",
    "motions_granted": "Motions for centralization granted",
    "actions_in_granted": "Actions in motions granted",
    "motions_denied_moot_withdrawn": "Motions denied, moot or withdrawn",
    "actions_in_denied": "Actions in motions denied",
    "tag_along_transfers": "Actions transferred as tag-alongs",
    "remands": "Actions remanded (§1407)",
}

NUM = r"(\d{1,3}(?:[,.]\d{3})+|\d+)"
RE_SUMMARY_ROW = re.compile(r"^\s*(?:Jan-Dec\s+)?(19[6-9]\d|20\d\d)\s+" + r"\s+".join([NUM] * 9) + r"\s*$")


def to_int(token: str):
    """Parse a printed count. '8.210' (period as thousands separator in one edition) parses as 8210 only when the
    group after the separator has exactly three digits; otherwise the token is rejected."""
    token = token.strip()
    if token in ("-", "—", ""):
        return 0
    if re.fullmatch(r"\d{1,3}(?:[,.]\d{3})+", token):
        return int(re.sub(r"[,.]", "", token))
    if re.fullmatch(r"\d+", token):
        return int(token)
    return None


def parse_summary_table(text: str) -> dict:
    """Calendar Year Summary of JPML Activity: {year: {field: value, 'printed': {field: token}}}."""
    rows = {}
    for line in text.splitlines():
        m = RE_SUMMARY_ROW.match(line)
        if not m:
            continue
        year = int(m.group(1))
        tokens = m.groups()[1:]
        values = [to_int(t) for t in tokens]
        if any(v is None for v in values) or year in rows:
            continue
        if all(1900 <= v <= 2100 for v in values) and all(b - a == 1 for a, b in zip([year] + values, values)):
            continue  # a chart's year axis ("2006 2007 ... 2015"), not a table row
        rows[year] = {**dict(zip(SUMMARY_FIELDS, values)), "printed": dict(zip(SUMMARY_FIELDS, tokens))}
    return rows


RE_CATEGORY_ROW = re.compile(r"^\s*(19[7-9]\d|20\d\d)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)\s+(\d+)\s*$")


def parse_category_table(text: str) -> dict:
    """'Denied by Category' text table (editions 2009-2014): Denied, Moot, Motion Withdrawn, Admin. Closed, Stricken, Totals."""
    out = {}
    start = re.search(r"Year\s+Denied\s+Moot\s+Motion\s+Admin\.\s+Stricken\s+Totals", text)
    if not start:
        return out
    for line in text[start.end():].splitlines():
        if line.strip().lower().startswith("totals"):
            break
        m = RE_CATEGORY_ROW.match(line)
        if not m:
            continue
        year = int(m.group(1))
        vals = [to_int(x) for x in m.groups()[1:]]
        denied, moot, withdrawn, closed, stricken, total = vals
        if denied + moot + withdrawn + closed + stricken != total:
            continue  # internal inconsistency: do not store
        out[year] = {"denied": denied, "moot": moot, "withdrawn": withdrawn, "closed": closed, "stricken": stricken, "total": total}
    return out


RE_SESSION_ROW = re.compile(r"^\s*([A-Z][a-z]+)(?:\s+(\d{1,2}),)?\s+(\d{4})\*?\s+(\d+)\s+(\d+)\s*$")


def parse_session_table(text: str) -> list:
    """'Hearing Matters Set and Considered During Calendar Year' table: one row per hearing session."""
    out = []
    m = re.search(r"HEARING\s+DATE\s+MATTERS\s+SET\s+MATTERS\s+CONSIDERED", text, re.I)
    if not m:
        return out
    for line in text[m.end():].splitlines():
        if line.strip().upper().startswith("TOTALS"):
            break
        r = RE_SESSION_ROW.match(line)
        if not r or r.group(1).lower() not in MONTHS:
            continue
        out.append({"label": " ".join(line.split()[:-2]).rstrip("*"), "month": MONTHS[r.group(1).lower()], "day": int(r.group(2)) if r.group(2) else None, "year": int(r.group(3)), "matters_set": int(r.group(4)), "matters_considered": int(r.group(5)), "two_day_note": "*" in line})
    return out


RE_TYPE_LABEL = re.compile(r"([A-Z][A-Za-z ]+?(?: and [A-Z][A-Za-z ]+?)?),\s*(\d+)(?:\s+MDLs?)?(?:,\s*(\d+)%)?(?=\s{2,}|\s*$)")
KNOWN_TYPES = {
    "Air Disaster", "Antitrust", "Common Disaster", "Contract", "Employment Practices", "Intellectual Property",
    "Miscellaneous", "Products Liability", "Sales Practices", "Securities", "Data Breach and Consumer Privacy",
    "Data Security Breach", "Data Breach", "Consumer Privacy",
}


TYPE_NAMES = sorted(KNOWN_TYPES, key=len, reverse=True)
RE_TYPE_ANY = re.compile(r"(" + "|".join(re.escape(t) for t in TYPE_NAMES) + r")\s*[:,]\s*(\d+)(?:\s*MDLs?)?(?:\s*,\s*(\d+(?:\.\d+)?)%)?")


def parse_type_distribution(text: str) -> dict:
    """Pie labels on the last page ('Distribution of Pending MDLs by Type') -> {type: count}.

    Works on whitespace-normalised text so labels split across lines ("Products Liability:\\n 61 MDLs, 33%") parse.
    Only exact JPML type names are accepted; the first label per type wins.
    """
    pages = text.split("\f")
    block = pages[-1] if len(pages) > 1 and not pages[-1].strip() == "" else text
    if len(pages) > 1 and not pages[-1].strip():
        block = pages[-2]
    flat = " ".join(block.split())
    out = {}
    for m in RE_TYPE_ANY.finditer(flat):
        if m.group(1) not in out:
            out[m.group(1)] = int(m.group(2))
    return out


def as_of_from_type_section(text: str):
    m = re.search(r"As of December 31,?\s*(\d{4})", text)
    return f"{m.group(1)}-12-31" if m else None


def chart_series(words, years, n_series, axis_x_max):
    """Assign numeric bar labels to year columns by x-centre; returns {year: [v1..vn]} only for complete columns.

    words: pdfplumber words for one page; years: {year: x_centre}; axis_x_max: labels with x1 <= this are axis ticks.
    """
    centres = sorted(years.items(), key=lambda kv: kv[1])
    if len(centres) < 2:
        return {}
    spacing = min(b[1] - a[1] for a, b in zip(centres, centres[1:]))
    out = {}
    for year, cx in centres:
        vals = sorted(
            (w for w in words if re.fullmatch(r"\d+", w["text"]) and w["x1"] > axis_x_max and abs((w["x0"] + w["x1"]) / 2 - cx) < spacing / 2 and w["top"] < years_top(words)),
            key=lambda w: w["x0"],
        )
        if len(vals) == n_series:
            out[year] = [int(w["text"]) for w in vals]
    return out


def years_top(words):
    tops = [w["top"] for w in words if re.fullmatch(r"20\d\d\*?", w["text"])]
    return min(tops) if tops else 10 ** 6


def year_centres(words):
    out = {}
    for w in words:
        m = re.fullmatch(r"(20\d\d)\*?", w["text"])
        if m:
            out[int(m.group(1))] = (w["x0"] + w["x1"]) / 2
    return out


# ---------------- Pending MDL statistics reports (CM/ECF for JPML) ----------------

RE_DISTRICT_ROW = re.compile(r"^\s{0,3}([A-Z]{2,4})?\s+(.+?)\s+\(([^)]+)\)\s+MDL\s*-\s*(\d+)\s+(.+?)\s+([\d,]+)\s+([\d,]+)\s*$")


def parse_by_district(text: str) -> list:
    rows, district = [], None
    for line in text.splitlines():
        m = RE_DISTRICT_ROW.match(line)
        if not m:
            continue
        if m.group(1):
            district = m.group(1)
        rows.append({"district": district, "judge": " ".join(m.group(2).split()), "judge_title": m.group(3).strip(), "mdl": int(m.group(4)), "title": " ".join(m.group(5).split()), "pending": to_int(m.group(6)), "total": to_int(m.group(7))})
    return rows


def report_date(text: str):
    m = re.search(r"Report Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})", text)
    return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat() if m else None


RE_TYPE_ROW = re.compile(r"^\s{2,6}(\d{3,4})\s+(IN\s+RE:?.+?)(?:\s{2,}(\S[^\d]*?,\s*[^\d]+?)\s{2,}([A-Z]{2,4})\s+(\S+)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})|\s{2,}(\d{2}/\d{2}/\d{4}))\s*$", re.I)
RE_TYPE_HEAD = re.compile(r"^\s{2,4}([A-Z][A-Za-z ]+)\s*$")
# Fallback for rows where a long title runs into the judge column with a single space:
# "…Products Liability Litigation Story, Richard W.      GAN   1:17-md-2782   03/09/2017   06/02/2017"
RE_TYPE_ROW_TIGHT = re.compile(r"^\s{2,6}(\d{3,4})\s+(IN\s+RE:?.+)\s([A-Z][A-Za-z'.-]+,\s[A-Z][A-Za-z.' -]*?)\s{2,}([A-Z]{2,4})\s+(\S+)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s*$", re.I)


def _iso(us: str):
    if not us:
        return None
    mo, d, y = us.split("/")
    return f"{y}-{mo}-{d}"


def parse_by_type(text: str) -> list:
    """Docket Type Summary: rows with type, MDL, title, judge, district, master docket, filed, transferred."""
    rows, current, last = [], None, None
    for raw in text.splitlines():
        if "Number of" in raw and "Litigations Listed" in raw:
            current, last = None, None
            continue
        head = RE_TYPE_HEAD.match(raw)
        if head and head.group(1).strip() in KNOWN_TYPES:
            current, last = head.group(1).strip(), None
            continue
        m = RE_TYPE_ROW.match(raw)
        if (not m or not m.group(3)) and current:
            t = RE_TYPE_ROW_TIGHT.match(raw)
            if t:
                last = {"type": current, "mdl": int(t.group(1)), "title": " ".join(t.group(2).split()), "judge": " ".join(t.group(3).split()), "district": t.group(4), "master_docket": t.group(5), "date_filed": _iso(t.group(6)), "date_transferred": _iso(t.group(7))}
                rows.append(last)
                continue
        if m and current:
            if m.group(8):
                last = {"type": current, "mdl": int(m.group(1)), "title": " ".join(m.group(2).split()), "judge": None, "district": None, "master_docket": None, "date_filed": _iso(m.group(8)), "date_transferred": None}
            else:
                last = {"type": current, "mdl": int(m.group(1)), "title": " ".join(m.group(2).split()), "judge": " ".join(m.group(3).split()), "district": m.group(4), "master_docket": m.group(5), "date_filed": _iso(m.group(6)), "date_transferred": _iso(m.group(7))}
            rows.append(last)
            continue
        cont = raw.strip()
        if last and current and cont and not re.match(r"^(https?://|\d+/\d+/\d+|Number of|_+|MDLs Listed)", cont) and raw.startswith("    ") and not re.match(r"^\s{2,6}\d{3,4}\s", raw) and len(cont) < 110:
            last["title"] = f"{last['title']} {' '.join(cont.split())}"
    return rows


# ---------------- Hearing session notices ----------------

RE_SESSION_DATE = re.compile(r"DATE OF HEARING SESSION:\s+([A-Z][a-z]+ \d{1,2}, \d{4})")
RE_DOCKET = re.compile(r"^\s*MDL\s+No\.\s*(\d{3,4})\s*[−–-]+\s*(IN\s+RE:?.*)$", re.I)
RE_CASE = re.compile(r"C\.A\.\s+No\.")
RE_FOOTER = re.compile(r"^\s*Case MDL No\.|^\s*-\s*\d+\s*-\s*$|^\s*\(This schedule")


def us_long_date(s: str):
    m = re.match(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", s or "")
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()


RE_LOCATION_LABEL = re.compile(r"^(\s*LOCATION OF HEARING SESSION:\s+)(\S.*)$")
US_STATES = (
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|"
    "Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|"
    "Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|"
    "Pennsylvania|Puerto Rico|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|"
    "West Virginia|Wisconsin|Wyoming|[A-Z]{2}"
)
RE_CITY_LINE = re.compile(rf"^(?P<city>[A-Z][A-Za-z.' -]{{1,40}}?),\s*(?P<state>{US_STATES})\.?(?:\s+\d{{5}}(?:-\d{{4}})?)?$")


def hearing_location(text: str):
    """The hearing location as printed on the notice: the line after 'LOCATION OF HEARING SESSION:' plus the lines
    printed in the same column below it, up to the first blank line (pdftotext -layout). City and state are read only
    from a printed 'City, State [ZIP]' line; otherwise they stay None (never guessed from the building name)."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        m = RE_LOCATION_LABEL.match(raw)
        if not m:
            continue
        col = len(m.group(1))
        printed = [" ".join(m.group(2).split())]
        for nxt in lines[i + 1:i + 9]:
            if not nxt.strip():
                break
            if abs((len(nxt) - len(nxt.lstrip())) - col) > 3:
                break
            printed.append(" ".join(nxt.split()))
        city = state = None
        for line in printed[1:]:
            c = RE_CITY_LINE.match(line)
            if c:
                city, state = c.group("city").strip(), c.group("state")
        return {"lines": printed, "city": city, "state": state}
    return None


def parse_hearing_notice(text: str) -> dict:
    session = us_long_date((RE_SESSION_DATE.search(text) or [None, None])[1] if RE_SESSION_DATE.search(text) else None)
    loc = hearing_location(text)
    matters, section, current = [], None, None
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = raw.strip()
        if re.fullmatch(r"SECTION\s+A", line):
            section = "A"
            continue
        if re.fullmatch(r"SECTION\s+B", line):
            section = "B"
            continue
        if not section or RE_FOOTER.match(raw):
            continue
        m = RE_DOCKET.match(raw)
        if m:
            current = {"section": section, "mdl": int(m.group(1)), "title": " ".join(m.group(2).split()), "motion": "", "actions_listed": 0, "_title_open": True}
            matters.append(current)
            continue
        if not current:
            continue
        if current["_title_open"]:
            if line and line.isupper() and not RE_CASE.search(line) and not line.startswith("MDL"):
                current["title"] += " " + " ".join(line.split())
                continue
            current["_title_open"] = False
        if RE_CASE.search(line):
            current["actions_listed"] += len(RE_CASE.findall(line))
        elif line and not current["motion"].endswith(":") and len(current["motion"]) < 600 and (current["motion"] or re.match(r"^(Motion|Oppositions?|Opposition|Motions)\b", line)):
            current["motion"] = (current["motion"] + " " + line).strip()
    for mt in matters:
        mt.pop("_title_open", None)
        motion = mt["motion"]
        to = re.search(r"to the United States District Court for the\s+(.+?)(?:\s+or,|\s+or\s+|:|;|$)", motion)
        mt["requested_district"] = " ".join(to.group(1).split()).rstrip(".,") if to and mt["section"] == "A" else None
        mt["motion"] = motion[:600]
    return {
        "session_date": session, "location": loc["lines"][0] if loc else None, "location_lines": loc["lines"] if loc else [],
        "location_city": loc["city"] if loc else None, "location_state": loc["state"] if loc else None, "matters": matters,
    }


# ---------------- JPML order PDFs (Panel Orders page / hearing-session archive) ----------------

RE_ORDER_HEADER = re.compile(r"Case MDL No\.\s*(\d+)\s+Document\s+(\d+)\s+Filed\s+(\d{2})/(\d{2})/(\d{2})")
RE_OPERATIVE = re.compile(r"IT IS (?:THEREFORE |FURTHER )?ORDERED that (.+?(?:proceedings|denied|withdrawn|moot|vacated)[^.]*\.)", re.S)
RE_TRANSFEREE = re.compile(r"transferred to the (.+?) and, with the consent of that court, assigned to the Honorable (.+?)(?:,)? for coordinated", re.S)


def parse_order_pdf_text(text: str) -> dict:
    flat = " ".join(text.split())
    head = RE_ORDER_HEADER.search(flat)
    out = {"mdl": None, "document": None, "filed": None, "caption": None, "operative": None, "transferee_district": None, "transferee_judge": None}
    if head:
        out["mdl"], out["document"] = int(head.group(1)), int(head.group(2))
        out["filed"] = f"20{head.group(5)}-{head.group(3)}-{head.group(4)}"
    cap = re.search(r"(IN RE:?\s.+?LITIGATION(?:\s*\(NO\.\s*[IVX]+\))?)", flat)
    if cap:
        out["caption"] = cap.group(1)[:300]
    op = RE_OPERATIVE.search(flat)
    if op:
        out["operative"] = op.group(0).strip()[:700]
        tr = RE_TRANSFEREE.search(op.group(1))
        if tr:
            out["transferee_district"] = " ".join(tr.group(1).split())
            out["transferee_judge"] = " ".join(tr.group(2).split())
    return out


RE_ARCHIVE_ORDER = re.compile(r"^MDL-(\d+)\s*-\s*(Order .+?)(?:\s+and\s+Vacating\s+the\s+([A-Z][a-z]+ \d{1,2}, \d{4}),?\s+Hearing Session(?: Order)?)?(?:\s*-\s*(.+))?$")


def parse_archive_order_link(text: str):
    """'MDL-2873 - Order Deeming Motion Withdrawn and Vacating the January 29, 2026, Hearing Session Order - 2 actions'."""
    m = RE_ARCHIVE_ORDER.match(" ".join(text.split()))
    if not m:
        return None
    action = m.group(2)
    kind = ("withdrawn" if "Withdrawn" in action else "moot" if "Moot" in action else "cto_vacated" if "Vacating Conditional Transfer" in action or "Vacating CTO" in action
            else "cto_stay_lifted" if "Lifting Stay" in action else "unopposed_transfer_granted" if "Granting Unopposed" in action or "Granting Unoppsed" in action
            else "cro_vacated" if "Conditional Remand" in action else "other")
    return {"mdl": int(m.group(1)), "action": action, "kind": kind, "session": us_long_date(m.group(3)) if m.group(3) else None, "scope": m.group(4)}
