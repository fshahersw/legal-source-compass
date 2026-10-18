"""Parsers for the JPML fiscal-year "Statistical Analysis of Multidistrict Litigation" reports (statistics-info).

Only printed values are returned. Every table is validated arithmetically against its own printed totals; an
edition whose table does not add up is reported as failing and excluded by the builder, never repaired.

Tables parsed (text from `pdftotext -layout`):
  district table  "Summary of Multidistrict Litigation by Circuit and District": per transferee district, flows in the
                  printed period ("12 Months Ending ..." or the one-off "15 Months Ending September 30, 1992"),
                  cumulative totals and actions pending at fiscal-year end. Grand totals = the report's cumulative summary.
  docket table    "Summary by Docket of Multidistrict Litigation Pending as of September 30 or Closed Since October 1":
                  per MDL, total transferred / total filed in transferee court / closed / remanded / pending.
  narrative       FY narrative sentences (FY2012+ layouts): motions filed/granted/denied, pending MDLs
"""
import re
import subprocess
from pathlib import Path

NUM = r"-?\d{1,3}(?:,\d{3})+|-?\d+|-"
COLS = ["into_12m", "out_12m", "net_12m", "filed_12m", "closed_12m", "into_cum", "out_cum", "net_cum", "filed_cum", "closed_cum", "pending"]
RE_ROW11 = re.compile(r"^(?P<label>\s*\S.*?|\s*)(?:\s+(?P<code>\d{3}))?\s+(?P<nums>(?:(?:" + NUM + r")\s+){10}(?:" + NUM + r"))\s*$")
RE_CIRCUIT_ORD = re.compile(r"^(\d{1,2})(ST|ND|RD|TH)$")
RE_CIRCUIT_NAME = re.compile(r"^(?:DISTRICT OF COLUMBIA(?:\s+CIRCUIT)?|(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH)\s+CIRCUIT)(?:\s+TOTALS)?$")
RE_FY = re.compile(r"(?:THROUGH|Through|through)\s+SEPTEMBER\s+30,\s*(\d{4})|September\s+30,\s*(\d{4})", re.I)
RE_PERIOD = re.compile(r"(\d{1,2})\s+Months\s+Ending\s+September\s+30,\s*(\d{4})", re.I)


def pdftotext(path: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout


def to_int(token: str):
    t = (token or "").strip()
    if t == "-":
        return None
    if re.fullmatch(r"-?\d{1,3}(?:,\d{3})+|-?\d+", t):
        return int(t.replace(",", ""))
    return None


def cell(token: str):
    """A printed table cell: '-' is the report's zero/blank marker and counts as 0 in sums."""
    v = to_int(token)
    return 0 if v is None and token.strip() == "-" else v


def fiscal_year(text: str):
    years = [int(a or b) for a, b in RE_FY.findall(text[:6000])]
    return max(years) if years else None


def period_months(text: str):
    """(months, year) of the printed flow period, e.g. (12, 2025); FY1992 prints '15 Months Ending September 30, 1992'."""
    m = RE_PERIOD.search(text)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _rows11(lines):
    out = []
    for i, raw in enumerate(lines):
        m = RE_ROW11.match(raw)
        if not m:
            continue
        nums = m.group("nums").split()
        out.append({"line": i + 1, "label": " ".join(m.group("label").split()), "code": m.group("code"), "printed": nums, "values": [cell(x) for x in nums]})
    return out


def _is_grand(label):
    return label.upper() in ("TOTAL", "GRAND TOTALS", "GRAND TOTAL", "TOTALS GRAND")


def _is_circuit(label, prev_label):
    up = label.upper()
    if up == "TOTALS":
        return True
    if RE_CIRCUIT_ORD.match(up):
        return True
    if label == up and RE_CIRCUIT_NAME.match(up):
        return True
    return label.lower() == "district of columbia" and prev_label is not None and _is_grand(prev_label)


def _circuit_title(label):
    return re.sub(r"\s+TOTALS$", "", label.strip())


def _district_start(lines):
    """Index of the first line of the 'by Circuit and District' table header: the 'Into Dist.' header line whose
    neighbourhood prints 'Circuit and' (the circuit-only table prints 'Circuit' alone). The header may wrap
    ('Circuit and' / 'District')."""
    for i, l in enumerate(lines):
        if re.search(r"Into Dist", l):
            around = "\n".join(lines[max(0, i - 3): i + 3])
            if re.search(r"Circuit\s+and", around):
                return i
    return None


def parse_district_table(text: str) -> dict:
    """Return {fy, period, grand, circuits:[{label, values, districts:[{label, code, values, printed}]}], tables_seen}.

    Rows split into tables at each grand-total row; the table with the most district-level rows is kept. Circuit
    rows: 'FIRST CIRCUIT [TOTALS]' (uppercase), ordinals '1ST', 'TOTALS' under a circuit heading, and the
    D.C. circuit ('DISTRICT OF COLUMBIA' uppercase, or 'District of Columbia' straight after the grand total).
    A district row printed with only its 3-digit code (FY1992-94 D.C.) or with no label takes the label of its
    circuit heading (the D.C. Circuit has one district)."""
    lines = text.splitlines()
    start = _district_start(lines)
    period = period_months(text)
    if start is None:
        return {"fy": fiscal_year(text), "period": period, "grand": None, "circuits": [], "tables_seen": 0, "unassigned": []}
    end = next((i for i in range(start, len(lines)) if re.search(r"SUMMARY BY DOCKET|Summary by Docket", lines[i]) and i > start + 5 and not re.search(r"Cases Pending|Cases Terminated", lines[i])), len(lines))
    rows = _rows11(lines[start:end])
    heading = None
    headings = {}
    for i in range(start, end):
        s = lines[i].strip()
        if re.fullmatch(r"(DISTRICT OF COLUMBIA|[A-Z]+ CIRCUIT)", s):
            heading = s
        headings[i - start + 1] = heading
    tables, cur = [], None
    for r in rows:
        if _is_grand(r["label"]):
            cur = {"grand": r, "rows": []}
            tables.append(cur)
        elif cur is not None:
            r["heading"] = headings.get(r["line"])
            cur["rows"].append(r)
    best = None
    for t in tables:
        circuits, unassigned, prev = [], [], t["grand"]["label"]
        for r in t["rows"]:
            lab, code = r["label"], r["code"]
            if re.fullmatch(r"\d{3}", lab) and not code:
                lab, code = "", lab
            cm = re.fullmatch(r"(.+?)\s+(\d{2,4}[A-Z]?)\*?", lab)
            if cm and not code and any(ch.isdigit() for ch in cm.group(2)):
                lab, code = cm.group(1), cm.group(2)
            lab = lab.rstrip("*").strip()
            if _is_circuit(lab, prev):
                label = _circuit_title(lab) if lab.upper() != "TOTALS" else (r.get("heading") or "TOTALS")
                circuits.append({"label": label, "values": r["values"], "printed": r["printed"], "line": r["line"], "districts": []})
            elif circuits:
                dlab = lab or circuits[-1]["label"]
                circuits[-1]["districts"].append({"label": dlab, "code": code, "values": r["values"], "printed": r["printed"], "line": r["line"]})
            else:
                unassigned.append(r)
            prev = lab
        cand = {"grand": t["grand"], "circuits": circuits, "unassigned": unassigned}
        if sum(len(c["districts"]) for c in circuits) > (sum(len(c["districts"]) for c in best["circuits"]) if best else -1):
            best = cand
    if best is None:
        return {"fy": fiscal_year(text), "period": period, "grand": None, "circuits": [], "tables_seen": len(tables), "unassigned": []}
    return {"fy": fiscal_year(text), "period": period, "grand": {"values": best["grand"]["values"], "printed": best["grand"]["printed"], "line": best["grand"]["line"]}, "circuits": best["circuits"], "tables_seen": len(tables), "unassigned": best["unassigned"]}


def validate_district_table(parsed: dict) -> dict:
    checks = []
    if not parsed["grand"] or not parsed["circuits"]:
        return {"valid": False, "checks": [{"check": "table_found", "ok": False}], "failed": [{"check": "table_found", "ok": False}], "failed_required": [{"check": "table_found", "ok": False}]}
    for c in parsed["circuits"]:
        if not c["districts"]:
            checks.append({"check": f"circuit_has_districts:{c['label']}", "ok": False})
            continue
        for j, col in enumerate(COLS):
            s = sum(d["values"][j] or 0 for d in c["districts"])
            if s != (c["values"][j] or 0):
                checks.append({"check": f"districts_sum:{c['label']}:{col}", "parsed": s, "printed": c["values"][j], "ok": False})
    for j, col in enumerate(COLS):
        s = sum(c["values"][j] or 0 for c in parsed["circuits"])
        ok = s == (parsed["grand"]["values"][j] or 0)
        checks.append({"check": f"circuits_sum:{col}", "parsed": s, "printed": parsed["grand"]["values"][j], "ok": ok})
    checks.append({"check": "no_rows_before_first_circuit", "parsed": len(parsed["unassigned"]), "printed": 0, "ok": not parsed["unassigned"]})
    failed = [c for c in checks if not c["ok"]]
    # required: grand total adds up across circuits on every column and pending adds up within every circuit
    required_fail = [c for c in failed if c["check"].startswith("circuits_sum") or c["check"].endswith(":pending") or c["check"].startswith("circuit_has") or c["check"] == "no_rows_before_first_circuit"]
    return {"valid": not required_fail, "checks": checks, "failed": failed, "failed_required": required_fail}


# ---------------------------------------------------------------- narrative (FY2012+ editions)

WORDNUM = {w: i for i, w in enumerate(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"])}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


def word_number(s: str):
    s = s.strip().lower()
    if re.fullmatch(r"\d{1,3}(?:,\d{3})*", s):
        return int(s.replace(",", ""))
    if s in WORDNUM:
        return WORDNUM[s]
    m = re.fullmatch(r"(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(one|two|three|four|five|six|seven|eight|nine))?", s)
    if m:
        return TENS[m.group(1)] + (WORDNUM[m.group(2)] if m.group(2) else 0)
    return None


NARRATIVE = {
    "actions_subjected_fy": r"([\d,]+) civil actions were subjected",
    "cases_transferred_fy": r"Panel transferred ([\d,]+) cases",
    "transferor_districts_fy": r"pending in ([\d,]+) district courts",
    "transferee_districts_fy": r"to ([\d,]+) transferee districts",
    "filed_directly_fy": r"Another ([\d,]+) actions were filed directly",
    "motions_filed_fy": r"([A-Za-z-]+|\d+) motions to (?:centralize|transfer) were filed",
    "motions_granted_fy": r"The Panel granted ([A-Za-z-]+|\d+) motions",
    "motions_denied_fy": r"The Panel denied ([A-Za-z-]+|\d+) motions",
    "cases_declined_fy": r"declined to transfer ([\d,]+) cases",
    "actions_centralized_cumulative": r"there have been ([\d,]+) civil actions centralized",
    "remanded_cumulative": r"a total of ([\d,]+) actions had been remanded",
    "terminated_cumulative": r"([\d,]+)\s+actions had been terminated in the transferee court",
    "pending_actions_fy_end": r"there were ([\d,]+) actions pending in",
    "pending_mdls_fy_end": r"actions pending in ([\d,]+) MDLs",
    "pending_transferee_districts_fy_end": r"MDLs in ([\d,]+) transferee district courts",
}


def parse_narrative(text: str) -> dict:
    flat = " ".join(text[:20000].split())
    out = {}
    for key, rx in NARRATIVE.items():
        m = re.search(rx, flat)
        if m:
            raw = m.group(1)
            out[key] = {"value": word_number(raw), "printed": raw, "sentence": _sentence(flat, m.start())}
    return out


def _sentence(flat, pos):
    a = flat.rfind(". ", 0, pos)
    b = flat.find(".", pos)
    return flat[a + 2 if a >= 0 else 0: b + 1 if b >= 0 else len(flat)][:400]


# ---------------------------------------------------------------- docket table (per MDL, fiscal-year end)

NUMTOK = r"(?:-?\d{1,3}(?:,\d{3})+|-?\d+|-)"
RE_END5 = re.compile(r"(?:^|\s)(" + NUMTOK + r"(?:\s+" + NUMTOK + r"){4})\s*$")
# the printed word is sometimes misspelt ("Ltigations", "Litigatios"), so any 6-14 letter word after the count closes a heading
RE_DISTRICT_HEAD = re.compile(r"^\s*(?:(?P<code>\d{2,4}[A-Z]?)\s+)?(?P<name>[A-Z][A-Z .,'’&-]*?)\s{2,}(?P<n>\d+)\s+L[a-z]{3,12}s?\s*$")
RE_TOTAL_LITIGATIONS = re.compile(r"(?P<n>\d+)\s+Total Litigations\s+(?P<nums>" + NUMTOK + r"(?:\s+" + NUMTOK + r"){4})\s*$")
RE_TOTALS_LINE = re.compile(r"^\s*TOTALS\s+(?P<nums>" + NUMTOK + r"(?:\s+" + NUMTOK + r"){4})\s*$", re.I)
_JNAME = r"[A-Z][A-Za-z'’.\-]*(?: [A-Za-z'’.\-]+)*(?:,\s?(?:Jr\.?|Sr\.?|III|II|IV))?,\s?[A-Za-z][A-Za-z.'’\-]*(?: [A-Za-z.'’\-]+)*"
# one judge ("Hogan, T.F."), several ("Motz, J.F.; Davis, A.M.; and Blake, C.C." wraps to a second line), or a judge
# sitting by designation ("Magnuson, P.A. (MN)")
RE_JUDGE = re.compile(r"^" + _JNAME + r"(?:\s*;\s*(?:and\s+)?" + _JNAME + r")*;?(?:\s*\([A-Z]{2,3}\))?$")
RE_JUDGE_CONT = re.compile(r"^(?:and\s+)?" + _JNAME + r";?(?:\s*\([A-Z]{2,3}\))?$")
RE_HEADER_LINE = re.compile(r"SUMMARY BY DOCKET OF|Cases Terminated|Cases Pending|^\s*Index to|^\s*Tr'e Dist|^\s*Court Code|MDL Caption|\(continued\)|CIRCUIT\s*$|^\s*Page \d+\s*$", re.I)
RE_END_SECTION = re.compile(r"^\s*(?:BUT NOT TRANSFERRED|NOT CENTRALIZED|MULTICIRCUIT PETITIONS|SUMMARY OF MULTICIRCUIT)")
DOCKET_COLS = ["transferred", "filed_in_transferee", "closed", "remanded", "pending"]
RE_PENDING_CLOSED_COUNT = re.compile(r"includes\s+([\d,]+)\s+MDLs\s+pending", re.I)
RE_CLOSED_COUNT = re.compile(r"also\s+includes\s+([\d,]+)\s+MDLs\s+closed", re.I)
RE_TOTAL_MDLS_COUNT = re.compile(r"includes\s+([\d,]+)\s+MDLs\.", re.I)


DIRECTIONS = {"NORTHERN": "N", "SOUTHERN": "S", "EASTERN": "E", "WESTERN": "W", "MIDDLE": "M", "CENTRAL": "C", "N": "N", "S": "S", "E": "E", "W": "W", "M": "M", "C": "C"}


SPELLING = {"tennesee": "tennessee", "massachussetts": "massachusetts", "pensylvania": "pennsylvania"}
STATE_ABBREV = {"n": "north", "s": "south", "w": "west"}
ABBREV_FOLLOWERS = {"carolina", "dakota", "virginia"}


def district_key(name: str) -> str:
    """Identity of a district from its printed name: lower-case state name plus a trailing direction letter, so that
    'ILLINOIS NORTHERN', 'ILLINOIS, NORTHERN' and 'Illinois, N.' all give 'illinois|N'. States without a direction
    ('MINNESOTA', 'Maine') give 'minnesota|'. Printed abbreviations and misspellings seen in the reports are
    normalised from a fixed list ('N. Carolina', 'S. Dakota', 'W. Virginia', 'Tennesee'); nothing else is guessed."""
    toks = re.sub(r"[.,*]", " ", name or "").split()
    direction = ""
    if len(toks) > 1 and toks[-1].upper() in DIRECTIONS:
        direction = DIRECTIONS[toks[-1].upper()]
        toks = toks[:-1]
    toks = [t.lower() for t in toks]
    if len(toks) > 1 and toks[0] in STATE_ABBREV and toks[1] in ABBREV_FOLLOWERS:
        toks[0] = STATE_ABBREV[toks[0]]
    toks = [SPELLING.get(t, t) for t in toks]
    return " ".join(toks) + "|" + direction


def _docket_bounds(lines):
    start = next((i for i, l in enumerate(lines) if re.search(r"SUMMARY BY DOCKET OF", l)), None)
    if start is None:
        return None, None
    end = next((i for i in range(start + 20, len(lines)) if RE_END_SECTION.match(lines[i])), len(lines))
    return start, end


def _mdl_start(raw, fields, modal_end):
    """(match, judge) when the line opens an MDL entry. The MDL number is right-aligned in one column per edition
    (`modal_end`); an entry opens at '<mdl> <caption>' followed by the judge field. An entry whose judge field is
    blank in the report (e.g. MDLs 3078 and 3148 in the FY2025 edition) opens on the number column alone and gets
    judge None."""
    m = re.match(r"^(\d{1,4})\s+(\S.*)$", fields[0])
    if not m:
        return None, None
    num_end = len(raw) - len(raw.lstrip()) + len(m.group(1))
    judge = fields[1] if len(fields) > 1 and RE_JUDGE.match(fields[1]) and len(fields[1]) <= 60 else None
    if judge is None and (modal_end is None or abs(num_end - modal_end) > 1):
        return None, None
    return m, judge


def _modal_number_end(lines, start, end):
    from collections import Counter

    c = Counter()
    for i in range(start, end):
        raw = lines[i]
        if not raw.strip() or RE_HEADER_LINE.search(raw):
            continue
        fields = re.split(r"\s{2,}", raw.strip())
        m = re.match(r"^(\d{1,4})\s+(\S.*)$", fields[0]) if len(fields) > 1 else None
        if m and RE_JUDGE.match(fields[1]) and len(fields[1]) <= 60:
            c[len(raw) - len(raw.lstrip()) + len(m.group(1))] += 1
    return c.most_common(1)[0][0] if c else None


def parse_docket_table(text: str) -> dict:
    """Summary by Docket. Entry = an 'MDL No. + caption + judge' line, transferor-list continuation lines, and a
    closing line that ends with five numbers (total transferred, total filed in transferee court, closed,
    remanded, pending at the fiscal-year end). Returns {rows, totals, printed_count, district_heads, orphans, incomplete}."""
    lines = text.splitlines()
    start, end = _docket_bounds(lines)
    if start is None:
        return {"rows": [], "totals": None, "printed_count": None, "district_heads": {}, "orphans": [], "incomplete": [], "bounds": None}
    flat_intro = " ".join(" ".join(lines[start: start + 25]).split())
    pm, cm = RE_PENDING_CLOSED_COUNT.search(flat_intro), RE_CLOSED_COUNT.search(flat_intro)
    tm = RE_TOTAL_MDLS_COUNT.search(flat_intro)
    intro_counts = {"pending": to_int(pm.group(1)) if pm else None, "closed": to_int(cm.group(1)) if cm else None, "total": to_int(tm.group(1)) if tm else None}
    rows, heads, orphans, incomplete = [], {}, [], []
    totals, printed_count = None, None
    cur, district = None, None
    modal_end = _modal_number_end(lines, start, end)
    for i in range(start, end):
        raw = lines[i]
        if not raw.strip():
            continue
        t = RE_TOTAL_LITIGATIONS.search(raw)
        if t and totals is None:
            totals, printed_count = [cell(x) for x in t.group("nums").split()], int(t.group("n"))
            continue
        t = RE_TOTALS_LINE.match(raw)
        if t and totals is None:
            totals = [cell(x) for x in t.group("nums").split()]
            continue
        h = RE_DISTRICT_HEAD.match(raw)
        if h:
            name = " ".join(h.group("name").replace(",", " ").split())
            key = district_key(name)
            district = {"code": h.group("code"), "name": name, "key": key, "line": i + 1}
            heads.setdefault(key, {"name": name, "code": h.group("code"), "printed": int(h.group("n")), "headings": 0})
            heads[key]["headings"] += 1
            if h.group("code") and not heads[key]["code"]:
                heads[key]["code"] = h.group("code")
            if cur is not None and cur["values"] is None:
                incomplete.append({"mdl": cur["mdl"], "line": cur["line"]})  # an entry cut off before its numbers
            cur = None
            continue
        if RE_HEADER_LINE.search(raw):
            continue
        fields = re.split(r"\s{2,}", raw.strip())
        indent = len(raw) - len(raw.lstrip())
        start_m, judge_text = _mdl_start(raw, fields, modal_end)
        if start_m and district is not None:
            if cur is not None and cur["values"] is None:
                incomplete.append({"mdl": cur["mdl"], "line": cur["line"]})
            cap_col = raw.index(start_m.group(2)[:12], indent + len(start_m.group(1)))
            cur = {"mdl": int(start_m.group(1)), "caption": " ".join(start_m.group(2).split()), "judge": " ".join(judge_text.split()) if judge_text else None,
                   "district_code": district["code"], "district_name": district["name"], "district_key": district["key"], "line": i + 1, "values": None, "printed": None,
                   "adjustments": [], "transferor": " ".join(fields[2:] if judge_text else fields[1:]), "_cap_col": cap_col, "_judge_col": raw.index(judge_text, indent) if judge_text else -999}
            rows.append(cur)
            rest = raw
        else:
            rest = raw
            if cur is not None and cur["values"] is None:
                # wrapped caption / wrapped judge list / transferor list, possibly closed by the five numbers on this line
                n0 = RE_END5.search(raw)
                body = raw[: n0.start(1)] if n0 else raw
                bf = re.split(r"\s{2,}", body.strip()) if body.strip() else []
                if bf:
                    bi = len(body) - len(body.lstrip())
                    if abs(bi - cur["_cap_col"]) <= 3 and not re.match(r"^\d+\s*-\s*[A-Za-z]", bf[0]) and not RE_JUDGE_CONT.match(bf[0]):
                        cur["caption"] += " " + " ".join(bf[0].split())
                        bf = bf[1:]
                    elif cur["judge"] and abs(bi - cur["_judge_col"]) <= 3 and RE_JUDGE_CONT.match(bf[0]):
                        cur["judge"] += " " + " ".join(bf[0].split())
                        bf = bf[1:]
                    if bf:
                        cur["transferor"] += " " + " ".join(" ".join(bf).split())
                if not n0:
                    continue
        n = RE_END5.search(rest)
        if n:
            vals = n.group(1).split()
            if cur is not None and cur["values"] is None:
                cur["values"] = [cell(x) for x in vals]
                cur["printed"] = vals
                cur["end_line"] = i + 1
            elif cur is not None:
                # a labelled adjustment line under a finished entry ("Returned/Claims Remain...", "Reassigned to PAE tr'or judge ..."):
                # kept beside the entry; the printed totals include these lines
                label = re.sub(r"[….]{2,}.*$", "", rest[: n.start(1)]).strip()
                cur["adjustments"].append({"label": " ".join(label.split()), "values": [cell(x) for x in vals], "printed": vals, "line": i + 1})
            else:
                orphans.append({"line": i + 1, "text": " ".join(raw.split())[:200]})
    if cur is not None and cur["values"] is None:
        incomplete.append({"mdl": cur["mdl"], "line": cur["line"]})
    # a page printed twice in the report repeats its entries verbatim: an entry identical in MDL, district, caption and all
    # five printed numbers to an earlier one is the same entry and is dropped (recorded); the totals check then decides
    seen, kept, dropped = {}, [], []
    for r in rows:
        key = (r["mdl"], r["district_key"])
        if key in seen and seen[key]["printed"] == r["printed"] and seen[key]["caption"] == r["caption"] and r["values"] is not None:
            dropped.append({"mdl": r["mdl"], "district": r["district_name"], "line": r["line"], "first_line": seen[key]["line"]})
            continue
        seen.setdefault(key, r)
        kept.append(r)
    rows = kept
    for r in rows:
        r["transferor"] = re.sub(r"[….]{2,}", " ", r["transferor"]).strip()
        r.pop("_cap_col", None)
        r.pop("_judge_col", None)
    return {"rows": rows, "totals": totals, "printed_count": printed_count, "intro_counts": intro_counts, "district_heads": heads, "orphans": orphans, "incomplete": incomplete, "duplicates_dropped": dropped, "bounds": [start + 1, end]}


def validate_docket_table(parsed: dict, district_table: dict | None = None) -> dict:
    """Two verdicts.

    valid (numbers): every entry is closed by five numbers, no stray number lines, the five columns (entries plus the
    labelled adjustment lines under them) sum to the printed totals line, the entry count equals the printed count
    when the edition prints one, and (MDL, district) keys are unique. A failing edition is excluded by the builder.

    attribution ('verified' | 'unverified'): which district heading an entry sits under. Verified when every district's
    entry count equals its printed 'N Litigations', or every district's pending actions equal that district's 'Total
    Pending in Transferee District' in the Circuit-and-District table (districts matched on the printed JPML code,
    else on the exact normalised name). The reports disagree with themselves in a few editions (e.g. FY2021 prints
    '8 Litigations' over seven entries); the district of an MDL in such an edition is then shown as printed but is
    not used for district analytics. Never repaired."""
    rows = parsed["rows"]
    complete = [r for r in rows if r["values"] is not None]
    checks, warnings = [], []

    def req(name, a, b, ok=None):
        checks.append({"check": name, "parsed": a, "printed": b, "ok": (a == b and b is not None) if ok is None else ok})

    req("entries_found", len(rows), None, ok=bool(rows))
    req("every_entry_has_numbers", len(complete), len(rows), ok=len(complete) == len(rows) and bool(rows))
    req("no_orphan_number_lines", len(parsed["orphans"]), 0)
    req("totals_line_found", parsed["totals"] is not None, True)
    if parsed["totals"] is not None:
        for j, col in enumerate(DOCKET_COLS):
            s = sum((r["values"][j] or 0) for r in complete) + sum((a["values"][j] or 0) for r in complete for a in r.get("adjustments", []))
            req(f"sum:{col}", s, parsed["totals"][j])
    if parsed.get("printed_count") is not None:
        req("entry_count_vs_total_litigations", len(rows), parsed["printed_count"])
    ic = parsed.get("intro_counts") or {}
    if ic.get("pending") is not None and ic.get("closed") is not None:
        req("entry_count_vs_pending_plus_closed", len(rows), ic["pending"] + ic["closed"])
    elif ic.get("total") is not None:
        req("entry_count_vs_printed_total_mdls", len(rows), ic["total"])
    elif ic.get("pending") is not None:
        req("entry_count_at_least_printed_pending_mdls", len(rows), ic["pending"], ok=len(rows) >= ic["pending"])
    keys = [(r["mdl"], r["district_key"]) for r in rows]
    req("mdl_district_keys_unique", len(set(keys)), len(keys))
    # per-entry balance: total transferred + total filed in the transferee court - closed - remanded = pending, labelled
    # adjustment lines under the entry included. An independent arithmetic check on every parsed row.
    bad = []
    for r in complete:
        t, f, c, rem, pnd = r["values"]
        for a in r.get("adjustments", []):
            t, f, c, rem, pnd = t + a["values"][0], f + a["values"][1], c + a["values"][2], rem + a["values"][3], pnd + a["values"][4]
        if t + f - c - rem != pnd:
            bad.append({"mdl": r["mdl"], "line": r["line"], "values": r["values"], "gap": t + f - c - rem - pnd})
    req("entry_balance_transferred_plus_filed_minus_closed_minus_remanded_equals_pending", len(complete) - len(bad), len(complete))
    checks[-1]["failures"] = bad[:20]
    failed = [c for c in checks if not c["ok"]]

    per = {}
    for r in rows:
        per[r["district_key"]] = per.get(r["district_key"], 0) + 1
    count_diffs = {k: [per.get(k, 0), h["printed"]] for k, h in parsed["district_heads"].items() if per.get(k, 0) != h["printed"]}
    counts_ok = bool(parsed["district_heads"]) and not count_diffs
    attribution = {"counts_agree": counts_ok, "count_differences": count_diffs, "pending_agree": None, "pending_differences": {}, "unknown_districts": [], "districts_missing_from_docket": []}
    if district_table and district_table.get("circuits"):
        # districts are matched on the printed JPML code (exact); a heading without a printed code is matched on its normalised name
        t_code, t_key = {}, {}
        for c in district_table["circuits"]:
            for d in c["districts"]:
                v = d["values"][10] or 0
                if d.get("code"):
                    t_code[d["code"]] = t_code.get(d["code"], 0) + v
                t_key[district_key(d["label"])] = t_key.get(district_key(d["label"]), 0) + v
        by = {}
        for r in complete:
            ident = (r["district_code"], r["district_key"])
            by[ident] = by.get(ident, 0) + (r["values"][4] or 0) + sum((a["values"][4] or 0) for a in r.get("adjustments", []))
        diffs, unknown = {}, []
        for (code, key), got in by.items():
            if code and code in t_code:
                want = t_code[code]
            elif key in t_key:
                want = t_key[key]
            else:
                unknown.append(code or key)
                continue
            if got != want:
                diffs[code or key] = [got, want]
        seen_codes = {c for (c, _k) in by if c}
        seen_keys = {k for (_c, k) in by}
        if t_code:
            missing = sorted(k for k, v in t_code.items() if v and k not in seen_codes)
        else:
            missing = sorted(k for k, v in t_key.items() if v and k not in seen_keys)
        attribution.update({"pending_agree": not diffs and not unknown and not missing, "pending_differences": diffs, "unknown_districts": unknown, "districts_missing_from_docket": missing})
    verified = counts_ok or bool(attribution["pending_agree"])
    attribution["status"] = "verified" if verified else "unverified"
    return {"valid": not failed, "checks": checks, "failed": failed, "attribution": attribution, "warnings": [], "warnings_checked": 0}


def line_pages(text: str) -> list:
    """PDF page number (1-based) of every line of text.splitlines(): pdftotext ends each page with a form feed, which
    splitlines() treats as a line boundary, so page = 1 + form feeds seen before the line."""
    pages, page = [], 1
    for seg in text.splitlines(keepends=True):
        pages.append(page)
        if seg.endswith("\f"):
            page += 1
    return pages
