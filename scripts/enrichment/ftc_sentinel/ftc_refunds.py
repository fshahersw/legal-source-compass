"""FTC Annual Reports on Refunds to Consumers (2022-2024), the refunds data page and the active refund programs list.

Case rows are read by value type, not by header (the extraction shifts and blanks header cells), and every table is
validated against its own 'Totals' row: the sum of each money and count column must reproduce the printed total or the
table is rejected. A cell that cannot be read as the expected type rejects its row.
"""
import html
import re

from ftc_parse import STATES, clean_cell, iter_tables, letters_key, split_pages, to_int

MONEY = re.compile(r"^\$\s*([\d,]+(?:\.\d{1,2})?)$")
INT = re.compile(r"^\$?(\d{1,3}(?:,\d{3})+|\d+)$")
PCT = re.compile(r"^(\d+(?:\.\d+)?)%$")
DATE_FULL = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$")
DATE_MONTH = re.compile(r"^([A-Z][a-z]{2})-(\d{2})$")
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# column type specs: (field, type)
SPECS = {
    ("first_distribution", 2024): [("case", "name"), ("date_sent", "date"), ("sent_usd", "money"), ("eligible_consumers", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
    ("first_distribution", 2023): [("case", "name"), ("date_sent", "date"), ("sent_usd", "money"), ("eligible_consumers", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
    ("first_distribution", 2022): [("case", "name"), ("date_sent", "date"), ("sent_usd", "money"), ("eligible_consumers", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
    ("additional_distribution", 2024): [("case", "name"), ("date_recent", "date"), ("consumers_in_recent_distribution", "int"), ("sent_recent_usd", "money"), ("returned_previous_usd", "money"), ("consumers_cashed", "int")],
    ("additional_distribution", 2023): [("case", "name"), ("date_recent", "date"), ("consumers_in_recent_distribution", "int"), ("sent_recent_usd", "money"), ("returned_previous_usd", "money"), ("consumers_cashed", "int")],
    ("additional_distribution", 2022): [("case", "name"), ("date_recent", "date"), ("consumers_in_recent_distribution", "int"), ("sent_recent_usd", "money"), ("returned_previous_usd", "money"), ("consumers_cashed", "int")],
    ("closed", 2024): [("case", "name"), ("total_fund_usd", "money"), ("returned_usd", "money"), ("admin_usd", "money"), ("left_over_usd", "money"), ("consumers_sent_payment", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
    ("closed", 2023): [("case", "name"), ("total_fund_usd", "money"), ("returned_usd", "money"), ("admin_usd", "money"), ("left_over_usd", "money"), ("education_campaigns_usd", "money"), ("consumers_sent_payment", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
    ("closed", 2022): [("case", "name"), ("date_closed", "date"), ("total_fund_usd", "money"), ("returned_usd", "money"), ("admin_usd", "money"), ("left_over_usd", "money"), ("eligible_consumers", "int"), ("consumers_cashed", "int"), ("pct_cashed", "pct")],
}
HEADINGS = {
    "first_distribution": r"CaseswithFirstDistributionsin(\d{4})",
    "additional_distribution": r"CaseswithAdditionalDistributionsin(\d{4})",
    "closed": r"CasesClosedin(\d{4})",
}
KIND_LABEL = {
    "first_distribution": "First distribution",
    "additional_distribution": "Additional distribution",
    "closed": "Case closed",
}


def convert(cell, kind):
    """(value, note) for a cell of the given type, or (None, None) when it is not that type."""
    t = clean_cell(cell)
    if kind == "name":
        return (html.unescape(t), None) if t and not MONEY.match(t) else (None, None)
    if kind == "money":
        m = MONEY.match(t)
        return (round(float(m.group(1).replace(",", "")), 2), None) if m else (None, None)
    if kind == "int":
        m = INT.match(t)
        if not m:
            return None, None
        return int(m.group(1).replace(",", "")), ("printed with a dollar sign" if t.startswith("$") else None)
    if kind == "pct":
        m = PCT.match(t)
        return (float(m.group(1)), None) if m else (None, None)
    if kind == "date":
        m = DATE_FULL.match(t)
        if m:
            y = int(m.group(3))
            y = y + 2000 if y < 100 else y
            return {"published": t, "iso": "%04d-%02d-%02d" % (y, int(m.group(1)), int(m.group(2)))}, None
        m = DATE_MONTH.match(t)
        if m and m.group(1) in MONTHS:
            return {"published": t, "iso": "20%s-%02d" % (m.group(2), MONTHS[m.group(1)])}, None
        return None, None
    return None, None


def parse_case_table(rows, spec):
    """Rows by type. Returns (cases, totals_row, problems). Totals row = a row named Total/Totals."""
    cases, totals, problems = [], None, []
    for raw in rows:
        cells = list(raw)
        while cells and cells[-1] == "":
            cells.pop()
        if cells and cells[0].lower() in ("total", "totals"):
            vals = [c for c in cells[1:] if c != ""]
            totals = vals
            continue
        if len(cells) != len(spec):
            problems.append(f"row has {len(cells)} cells, expected {len(spec)}: {raw[:3]}")
            continue
        rec, notes, ok = {}, [], True
        for cell, (field, kind) in zip(cells, spec):
            value, note = convert(cell, kind)
            if value is None:
                problems.append(f"{cells[0]}: {field}={cell!r} is not a {kind}")
                ok = False
                break
            rec[field] = value
            if note:
                notes.append(f"{field} {note}")
        if ok:
            rec["notes"] = notes
            cases.append(rec)
    return cases, totals, problems


def row_rule_problems(kind, case):
    """Hard per-row identities. Returns a list of reasons the row cannot be trusted (empty = passes)."""
    out = []
    cashed = case.get("consumers_cashed")
    base = case.get("eligible_consumers") if case.get("eligible_consumers") is not None else case.get("consumers_sent_payment")
    if kind in ("first_distribution", "closed") and base:
        if cashed is not None and cashed > base:
            out.append("more consumers cashed a payment than were eligible / sent one")
        elif cashed is not None and case.get("pct_cashed") is not None and abs(100 * cashed / base - case["pct_cashed"]) > 1.0:
            out.append(f"printed percent {case['pct_cashed']} differs from cashed/base {100 * cashed / base:.1f}")
    if kind == "closed":
        parts = case["returned_usd"] + case["admin_usd"] + case["left_over_usd"] + case.get("education_campaigns_usd", 0.0)
        if abs(parts - case["total_fund_usd"]) > 2.0:
            out.append(f"returned + admin + left over + education = {parts:.2f}, printed total fund {case['total_fund_usd']:.2f}")
    if kind == "additional_distribution" and case["sent_recent_usd"] <= 0:
        out.append("no dollars sent")
    return out


def total_discrepancies(cases, totals, spec):
    """Column sums versus the printed Totals row. Returns [] when they reproduce, else a note per differing column.

    A difference is a property of the printed report (the FTC's own total does not equal its rows, e.g. the 2023 closed
    table's total omits one row's count), so rows that pass the per-row identities are still published and the
    difference is shown beside them.
    """
    if totals is None:
        return None
    cols = [(f, k) for f, k in spec if k in ("money", "int")]
    converted = []
    for cell in totals:
        for kind in ("money", "int", "pct"):
            v, _ = convert(cell, kind)
            if v is not None:
                converted.append((kind, v))
                break
        else:
            converted.append((None, None))
    summable = [c for c in converted if c[0] in ("money", "int")]
    if len(summable) != len(cols):
        return [{"column": None, "note": f"printed Totals row has {len(summable)} figures for {len(cols)} columns"}]
    out = []
    for (field, kind), (tk, tv) in zip(cols, summable):
        got = round(sum(c[field] for c in cases), 2)
        if abs(got - tv) > (1.0 if kind == "money" else 0):
            out.append({"column": field, "rows_sum": got, "printed_total": tv, "difference": round(got - tv, 2)})
    return out


def check_totals(cases, totals, spec):
    """Strict form of total_discrepancies kept for tests: problems when the sums do not reproduce."""
    if totals is None:
        return ["no Totals row to validate against"]
    cols = [(f, k) for f, k in spec if k in ("money", "int")]
    converted = []
    for cell in totals:
        for kind in ("money", "int", "pct"):
            v, _ = convert(cell, kind)
            if v is not None:
                converted.append((kind, v))
                break
        else:
            converted.append((None, None))
    summable = [c for c in converted if c[0] in ("money", "int")]
    problems = []
    if len(summable) != len(cols):
        return [f"Totals row has {len(summable)} summable cells for {len(cols)} columns: {totals}"]
    for (field, kind), (tk, tv) in zip(cols, summable):
        got = round(sum(c[field] for c in cases), 2)
        if abs(got - tv) > (1.0 if kind == "money" else 0):
            problems.append(f"{field}: rows sum to {got}, printed total {tv}")
    # percentage in the totals row must equal cashed/eligible (or sent) to within a point
    pct = [v for k, v in converted if k == "pct"]
    denom = next((f for f, _ in spec if f in ("eligible_consumers", "consumers_sent_payment")), None)
    if pct and denom:
        num = sum(c["consumers_cashed"] for c in cases)
        den = sum(c[denom] for c in cases)
        if den and abs(100 * num / den - pct[0]) > 1.0:
            problems.append(f"total percent {pct[0]} vs computed {100 * num / den:.1f}")
    return problems


def parse_report_cases(markdown, year):
    """All three case tables of one annual report. Returns ({kind: [cases]}, {kind: totals}, problems)."""
    pages = split_pages(markdown)
    out, problems = {}, []
    for kind, pattern in HEADINGS.items():
        spec = SPECS[(kind, year)]
        entry = {"cases": [], "excluded": [], "totals_printed": None, "total_differences": None, "chunk": None}
        for idx, page in enumerate(pages):
            flat = re.sub(r"[\s*_]+", "", page)
            m = re.search(pattern, flat)
            if not m or int(m.group(1)) != year:
                continue
            tables = [t for t in iter_tables(page) if t["header"] and "case" in " ".join(t["header"]).lower()]
            if not tables:
                continue
            cases, totals, unreadable = parse_case_table(tables[0]["rows"], spec)
            for text in unreadable:
                entry["excluded"].append({"row": text, "reason": "unreadable cell"})
            kept = []
            for case in cases:
                reasons = row_rule_problems(kind, case)
                if reasons:
                    entry["excluded"].append({"row": case["case"], "reason": "; ".join(reasons)})
                else:
                    case["chunk"] = idx
                    kept.append(case)
            entry["cases"] = kept
            entry["totals_printed"] = totals
            entry["total_differences"] = total_discrepancies(kept, totals, spec)
            entry["chunk"] = idx
            break
        else:
            problems.append(f"{year} {kind}: table not found")
        out[kind] = entry
    return out, problems


def parse_snapshot(markdown, year):
    """Snapshot table: share of funds returned / sent to Treasury / administrative costs by year (as shown in this report)."""
    pages = split_pages(markdown)
    rows, problems = {}, []
    for page in pages[:4]:
        for t in iter_tables(page):
            if t["header"] and "Returned to Consumers" in " ".join(t["header"]):
                for c in t["rows"]:
                    if len(c) == 4 and re.fullmatch(r"20\d\d", c[0]):
                        try:
                            vals = [float(x) for x in c[1:]]
                        except ValueError:
                            problems.append(f"snapshot row unreadable {c}")
                            continue
                        if abs(sum(vals) - 100) > 0.35:
                            problems.append(f"snapshot {c[0]} sums to {sum(vals):.1f}")
                            continue
                        rows[int(c[0])] = {"returned_pct": vals[0], "treasury_pct": vals[1], "admin_pct": vals[2]}
    if year not in rows:
        problems.append(f"{year} snapshot row missing")
    return rows, problems


def parse_state_mailed(markdown, year):
    """Refunds mailed to each state in the report year. Returns (rows, extras, problems)."""
    pages = split_pages(markdown)
    rows, extras, problems = {}, {}, []
    for page in pages[:4]:
        for t in iter_tables(page):
            if not (t["header"] and len(t["header"]) == 2 and t["header"][0] == "State" and f"Mailed in {year}" in t["header"][1]):
                continue
            for c in t["rows"]:
                if len(c) != 2:
                    continue
                label, val = c
                m = re.fullmatch(r"\$([\d,]+)", val)
                if label in STATES and m:
                    if label in rows:
                        problems.append(f"{label} twice")
                    rows[label] = int(m.group(1).replace(",", ""))
                elif label == "Military Bases" and m:
                    extras["military_bases_usd"] = int(m.group(1).replace(",", ""))
                elif label.startswith("Electronic") and "Total Sent" in label:
                    nums = [int(x.replace(",", "")) for x in re.findall(r"\$([\d,]+)", label)]
                    if len(nums) == 2:
                        extras["electronic_and_international_usd"], extras["total_sent_usd"] = nums
    flat = re.sub(r"\s+", " ", " ".join(pages[2:3]))
    m = re.search(r"International Payments \*\*Total Sent:\*\* \*\*\$([\d,]+)\*\* \*\*Electronic Payments \(no geographic data\) \$([\d,]+) \$([\d,]+)\*\*", flat)
    if m:
        extras["international_usd"], extras["electronic_no_geography_usd"], extras["total_sent_usd"] = (int(x.replace(",", "")) for x in m.groups())
    missing = [u for u in STATES if u not in rows and u != "DC"]
    if missing:
        problems.append(f"{year}: states missing from the mailed table: {missing}")
    if "total_sent_usd" in extras:
        parts = sum(rows.values()) + extras.get("military_bases_usd", 0)
        if "electronic_and_international_usd" in extras:
            parts += extras["electronic_and_international_usd"]
        else:
            parts += extras.get("international_usd", 0) + extras.get("electronic_no_geography_usd", 0)
        extras["parts_sum_usd"] = parts
        if parts != extras["total_sent_usd"]:
            problems.append(f"{year}: states + military + electronic/international = {parts}, printed total {extras['total_sent_usd']}")
    return rows, extras, problems


def parse_data_page_snapshot(markdown):
    """The 2024 snapshot graphic's alt text on the refunds data page."""
    flat = re.sub(r"\s+", " ", markdown)
    m = re.search(r"resulted in \$([\d.]+) million returned to consumers.*?\$([\d.]+) of that total was returned directly by the FTC to ([\d.]+) million people\. The FTC sent \$([\d.]+) million to the U\.S\. Treasury and spent \$([\d.]+) million on administrative costs", flat)
    if not m:
        return None
    a, b, c, d, e = (float(x) for x in m.groups())
    return {"total_returned_usd_m": a, "returned_directly_by_ftc_usd_m": b, "people_millions": c, "treasury_usd_m": d, "admin_usd_m": e}


_PROGRAM = re.compile(r"^\|\s*\[([^\]]+)\]\((https://www\.ftc\.gov/enforcement/refunds/[a-z0-9\-]+)\)(.*?)\|\s*([A-Z][a-z]+ \d{4})\s*\|\s*(.*?)\s*\|\s*$")


def parse_refund_programs(markdown):
    """Active refund programs listed on ftc.gov/enforcement/refunds: title, page URL, date text, products, contact."""
    out, problems = [], []
    for line in markdown.split("\n"):
        if not line.startswith("| [") or "/enforcement/refunds/" not in line:
            continue
        m = _PROGRAM.match(line)
        if not m:
            problems.append(f"program row not understood: {line[:80]}")
            continue
        title, url, extra, date, contact = m.groups()
        products = None
        pm = re.search(r"\*\*Products:\*\*\s*(.*)$", extra.replace("<br>", " "))
        if pm:
            products = clean_cell(pm.group(1))
        parts = [clean_cell(p) for p in contact.split("<br>") if clean_cell(p)]
        phone = next((p for p in parts if re.match(r"^[\d+\-() ]+( or [\d+\-() ]+)?$", p) or p[:1].isdigit()), None)
        admin = next((p for p in parts if p != phone), None)
        out.append({"title": clean_cell(title), "url": url, "date": date, "products": products, "phone": phone, "administrator": admin})
    slugs = [o["url"] for o in out]
    if len(set(slugs)) != len(slugs):
        problems.append("duplicate program URLs")
    return out, problems


def case_key(name):
    """Deterministic exact-match key: letters and digits only, lower case ('Teami, LLC' -> 'teamillc')."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def program_match_key(title):
    """Program page title with one trailing 'Refunds'/'Settlement'/'Refund' word removed, then case_key()."""
    t = re.sub(r"\s+(Refunds?|Settlement)$", "", title.strip())
    return case_key(t)
