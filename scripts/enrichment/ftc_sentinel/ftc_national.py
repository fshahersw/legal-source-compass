"""National tables of a Consumer Sentinel Network Data Book (reports by type, categories, losses, payment, contact, age).

Every section is found by the header signature of its own table inside the page range before the state rankings and
validated against the other tables of the same book. A section that fails validation is returned as None with a
problem string; nothing is repaired.
"""
import re

from ftc_parse import (
    clean_cell,
    find_chunks,
    iter_tables,
    letters_key,
    split_pages,
    to_float,
    to_int,
    to_pct,
    to_usd,
)

AGE_GROUPS = ["19 and Under", "20 - 29", "30 - 39", "40 - 49", "50 - 59", "60 - 69", "70 - 79", "80 and Over"]
def _alnum(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


_AGE_KEYS = {_alnum(a): a for a in AGE_GROUPS}
_AGE_KEYS["80"] = "80 and Over"  # the 2017 book prints '80+'


def age_label(text):
    """Canonical age-group label for a printed one ('80+', '80 and Over'); None when it is not an age group."""
    return _AGE_KEYS.get(_alnum(text))


def _tables(pages, lo, hi):
    for idx in range(lo, hi):
        for table in iter_tables(pages[idx]):
            yield idx, table


def _all_rows(table):
    """Data rows of a table, plus the 'header' when the extraction promoted a data row to it."""
    return list(table["rows"])


def military_start(pages, upto):
    """Chunk where the military consumer section starts (status table with 'Fraud Reports' columns)."""
    for idx in range(2, upto):
        for table in iter_tables(pages[idx]):
            h = table["header"] or []
            if h and re.search(r"status", h[0].lower()) and "fraud reports" in " ".join(h).lower():
                return idx
    return upto


def _yearly(table_rows, ncols):
    out = {}
    for cells in table_rows:
        if len(cells) == ncols and re.fullmatch(r"20\d\d|19\d\d", cells[0]):
            out[int(cells[0])] = cells[1:]
    return out


def parse_national(pages, data_year):
    """Return (sections, problems). sections is a dict; absent or invalid sections map to None."""
    problems = []
    rank_idx = find_chunks(pages, r"StateRankings:FraudandOtherReports")[-1]
    mil = military_start(pages, rank_idx)
    nat = (2, mil)
    s = {}

    # --- reports by year (total) and by type (history back to 2001, as revised in this book)
    totals, by_type = {}, {}
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if len(h) == 2 and h[0] == "Year" and h[1].strip() == "# of Reports":
            for y, vals in _yearly(t["rows"], 2).items():
                if to_int(vals[0]) is not None:
                    totals[y] = to_int(vals[0])
        if len(h) == 4 and h[0] == "Year" and h[1].strip() == "Fraud" and h[2].strip() == "Identity Theft":
            for y, vals in _yearly(t["rows"], 4).items():
                nums = [to_int(v) for v in vals]
                if None not in nums:
                    by_type[y] = {"fraud": nums[0], "identity_theft": nums[1], "other": nums[2]}
    s["reports_by_year"] = totals or None
    s["reports_by_type_by_year"] = by_type or None
    if not totals or not by_type:
        problems.append("history tables missing")
    else:
        # Some subcategories are counted as both Fraud and Other (Data Book note), so the three types may add to a little
        # more than the total, never less.
        bad = [y for y in by_type if y in totals and not (totals[y] <= sum(by_type[y].values()) <= totals[y] * 1.03)]
        if bad:
            problems.append(f"fraud+identity theft+other not within [total, total*1.03] in {bad}")
        if data_year not in totals or data_year not in by_type:
            problems.append(f"{data_year} missing from history tables")

    # --- report types for the data year
    rtypes = None
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if h and h[0] == "Report Type":
            rows = {}
            for cells in t["rows"]:
                if len(cells) == 3 and to_int(cells[1]) is not None:
                    rows[cells[0]] = {"reports": to_int(cells[1]), "share_pct": to_float(cells[2])}
            if set(rows) == {"Fraud", "Identity Theft", "Other"}:
                rtypes = rows
    s["report_types"] = rtypes
    if rtypes is None:
        problems.append("report type table missing")
    elif by_type.get(data_year):
        mine = {"Fraud": by_type[data_year]["fraud"], "Identity Theft": by_type[data_year]["identity_theft"], "Other": by_type[data_year]["other"]}
        if {k: v["reports"] for k, v in rtypes.items()} != mine:
            problems.append("report type table differs from history table for the data year")

    # --- report categories: rank, category, reports, share
    cats = {}
    for idx, t in _tables(pages, *nat):
        if "ReportCategor" not in re.sub(r"\s+", "", pages[idx]):
            continue
        for cells in _all_rows(t) + ([t["header"]] if t["header"] else []):
            if len(cells) == 4 and to_int(cells[0]) and to_int(cells[2]) is not None and cells[3].endswith("%") and not re.search(r"\d", cells[1]):
                cats[to_int(cells[0])] = {"category": cells[1], "reports": to_int(cells[2]), "share_pct": to_pct(cells[3])}
    ranks = sorted(cats)
    if ranks and ranks == list(range(1, len(ranks) + 1)) and len(ranks) >= 25:
        s["report_categories"] = [dict(rank=r, **cats[r]) for r in ranks]
        counts = [cats[r]["reports"] for r in ranks]
        if any(b > a for a, b in zip(counts, counts[1:])):
            problems.append("report categories not in descending order")
        total = totals.get(data_year)
        # The ranked categories leave out reports coded 'Other Misc.' / unspecified (Data Book note), so they add to
        # less than the total but never more.
        if total and not (0.7 * total <= sum(counts) <= total):
            problems.append(f"category counts sum {sum(counts)} outside [70%, 100%] of total reports {total}")
    else:
        s["report_categories"] = None
        problems.append(f"report categories not contiguous ({len(ranks)} ranks)")

    # --- top 10 fraud categories (reports, % with loss, total loss, median)
    top_fraud = None
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if len(h) == 6 and h[0] == "Rank" and h[1] == "Category" and "$ Loss" in h[3] and h[4] == "Total $ Loss":
            rows = []
            for cells in t["rows"]:
                if len(cells) == 6 and to_int(cells[0]):
                    row = {"rank": to_int(cells[0]), "category": cells[1], "reports": to_int(cells[2]), "pct_reporting_loss": to_pct(cells[3]), "total_loss_usd": to_usd(cells[4]), "median_loss_usd": to_usd(cells[5])}
                    if None in row.values():
                        problems.append(f"top fraud row unreadable {cells}")
                    rows.append(row)
            if len(rows) == 10:
                top_fraud = rows
    s["top_fraud_categories"] = top_fraud
    if top_fraud is None:
        problems.append("top 10 fraud categories missing")

    # --- identity theft types and top other categories
    s["identity_theft_types"] = None
    s["top_other_categories"] = None
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if len(h) == 3 and h[0] == "Rank" and h[1] == "Theft Type":
            rows = [{"rank": to_int(c[0]), "type": c[1], "reports": to_int(c[2])} for c in t["rows"] if len(c) == 3 and to_int(c[0]) and to_int(c[2]) is not None]
            if 5 <= len(rows) <= 8:
                s["identity_theft_types"] = rows
        if len(h) == 3 and h[0] == "Rank" and h[1] == "Category" and h[2] == "# of Reports":
            rows = [{"rank": to_int(c[0]), "category": c[1], "reports": to_int(c[2])} for c in t["rows"] if len(c) == 3 and to_int(c[0]) and to_int(c[2]) is not None]
            if len(rows) == 10:
                s["top_other_categories"] = rows
    if s["identity_theft_types"] is None:
        problems.append("identity theft types missing")
    elif by_type.get(data_year):
        # Theft types can be multiple per report; only check that no single type exceeds the identity theft total.
        if max(r["reports"] for r in s["identity_theft_types"]) > by_type[data_year]["identity_theft"]:
            problems.append("an identity theft type exceeds identity theft reports")

    # --- fraud summary: reports, reports with loss, total loss, median loss
    summary = None
    for idx in range(nat[0], nat[1]):
        flat = re.sub(r"\s+", "", pages[idx])
        if "FraudReportsbyAmountLost" in flat and "NumberofFraudReports" in flat:
            text = pages[idx]
            head = text.split("|")[0]
            m_loss = re.search(r"([\d,]+)\s*\((\d+)%\)", head)
            ints = [to_int(x) for x in re.findall(r"^\s*([\d,]{5,})\s*$", head, re.M)]
            dollars = re.findall(r"^\s*(\$[\d,]+)\s*$", head, re.M)
            if m_loss and ints and len(dollars) >= 2:
                big = max(dollars, key=lambda d: to_usd(d))
                small = min(dollars, key=lambda d: to_usd(d))
                summary = {
                    "fraud_reports": ints[0],
                    "reports_with_loss": to_int(m_loss.group(1)),
                    "pct_reporting_loss": int(m_loss.group(2)),
                    "total_loss_usd": to_usd(big),
                    "median_loss_usd": to_usd(small),
                }
    s["fraud_summary"] = summary
    if summary is None:
        problems.append("fraud loss summary missing")
    else:
        fr = by_type.get(data_year, {}).get("fraud")
        if fr is not None and summary["fraud_reports"] != fr:
            problems.append(f"fraud summary reports {summary['fraud_reports']} != fraud history {fr}")
        pct = round(100 * summary["reports_with_loss"] / summary["fraud_reports"])
        if abs(pct - summary["pct_reporting_loss"]) > 1:
            problems.append("percent reporting loss inconsistent with counts")
        if summary["median_loss_usd"] >= summary["total_loss_usd"]:
            problems.append("median loss not below total loss")

    # --- loss ranges
    ranges = None
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if len(h) == 2 and h[0] == "Amount Lost":
            rows = [(c[0], to_int(c[1])) for c in t["rows"] if len(c) == 2 and c[0].startswith("$") or (len(c) == 2 and c[0].startswith("More"))]
            rows = [(a, b) for a, b in rows if b is not None]
            if len(rows) == 11:
                ranges = [{"range": a, "reports": b} for a, b in rows]
    s["loss_ranges"] = ranges
    if ranges and summary:
        if abs(sum(r["reports"] for r in ranges) - summary["reports_with_loss"]) > max(5, summary["reports_with_loss"] // 200):
            problems.append("loss range counts do not add to reports with a loss")

    # --- payment methods, contact methods, age groups
    pay, contact, contact_pct, age_a, age_b = None, None, None, {}, {}
    for idx, t in _tables(pages, *nat):
        h = t["header"] or []
        if len(h) == 3 and h[0] == "Category" and h[1] in ("# of Reports", "# Reports") and "Total $" in h[2]:
            labels = [age_label(c[0]) for c in t["rows"] if len(c) == 3]
            if labels and all(labels):
                for c in t["rows"]:
                    if len(c) == 3 and to_int(c[1]) is not None:
                        age_a[age_label(c[0])] = {"reports": to_int(c[1]), "total_loss_usd": None if to_int(c[2]) is None else to_int(c[2]) * 1_000_000}
            else:
                rows = [{"method": c[0], "reports": to_int(c[1]), "total_loss_usd": None if to_int(c[2]) is None else to_int(c[2]) * 1_000_000} for c in t["rows"] if len(c) == 3 and to_int(c[1]) is not None and to_int(c[2]) is not None]
                if len(rows) >= 7:
                    pay = rows
        if len(h) == 4 and h[0] == "Contact Method":
            rows = [{"method": c[0], "reports": to_int(c[1]), "total_loss_usd": to_usd(c[2]), "median_loss_usd": to_usd(c[3])} for c in t["rows"] if len(c) == 4 and to_int(c[1]) is not None]
            if len(rows) >= 6 and all(r["total_loss_usd"] is not None and r["median_loss_usd"] is not None for r in rows):
                contact = rows
        if len(h) == 3 and h[0] == "Category" and "Contact Method" in h[1]:
            contact_pct = {c[0]: {"pct_of_reports_with_contact_method": to_float(c[1]), "pct_with_loss": to_float(c[2])} for c in t["rows"] if len(c) == 3 and to_float(c[1]) is not None}
        if len(h) == 3 and h[0] == "Category" and "Percentage Reporting" in h[1]:
            for c in t["rows"]:
                lab = age_label(c[0]) if len(c) == 3 else None
                if lab and to_float(c[1]) is not None and to_float(c[2]) is not None:
                    age_b[lab] = {"pct_reporting_loss": to_float(c[1]), "median_loss_usd": to_float(c[2])}
    s["payment_methods"] = pay
    s["contact_methods"] = contact
    s["contact_method_shares"] = contact_pct or None
    if len(age_a) == 8 and len(age_b) == 8:
        s["age_groups"] = [dict(age=a, **age_a[a], **age_b[a]) for a in AGE_GROUPS]
    else:
        s["age_groups"] = None
        problems.append(f"age tables incomplete ({len(age_a)}/{len(age_b)})")
    if pay is None:
        problems.append("payment method table missing")
    if contact is None:
        problems.append("contact method table missing")
    if contact and summary:
        if sum(r["reports"] for r in contact) > summary["fraud_reports"]:
            problems.append("contact method reports exceed fraud reports")

    # --- identity theft subtypes with the printed year-over-year difference
    subs = []
    for idx in range(*nat):
        in_block = False
        for t in iter_tables(pages[idx]):
            h = t["header"] or []
            if len(h) == 4 and h[0] == "Theft Type" and h[1] == "Theft Subtype":
                in_block = True
            elif not (in_block and not h):
                continue  # a continuation after a page-internal break has no header of its own
            for c in t["rows"]:
                if len(c) == 4 and to_int(c[2]) is not None and re.fullmatch(r"[+-]?\d+%", c[3]):
                    subs.append({"type": c[0], "subtype": c[1], "reports": to_int(c[2]), "pct_change_from_previous_year": int(c[3].rstrip("%"))})
    if subs and not 25 <= len(subs) <= 32:
        problems.append(f"identity theft subtypes: {len(subs)} rows")
        subs = []
    s["identity_theft_subtypes"] = subs or None

    # --- military consumers (status, branch, rank)
    military = {}
    for idx, t in _tables(pages, mil, rank_idx):
        h = t["header"] or []
        if len(h) == 6 and "fraud reports" in " ".join(h).lower():
            kind = {"status": "status", "military status": "status", "branch": "branch", "military branch": "branch", "rank": "rank"}.get(h[0].lower())
            if not kind:
                continue
            rows = []
            for c in t["rows"]:
                if len(c) == 6 and to_int(c[1]) is not None and to_int(c[2]) is not None:
                    rows.append({"label": c[0], "reports": to_int(c[1]), "fraud_reports": to_int(c[2]), "pct_reporting_fraud_loss": to_pct(c[3]), "total_fraud_loss_usd": to_usd(c[4]), "median_fraud_loss_usd": to_usd(c[5])})
            if rows:
                military[kind] = rows
    s["military"] = military or None
    return s, problems


def parse_national_book(markdown, data_year):
    return parse_national(split_pages(markdown), data_year)
