"""Parse HSR early termination notices (api.ftc.gov /v0/hsr-early-termination-notices) and the HSR filing CSVs.

Pure functions: no network, no private/ reads. Everything is kept as published; derived values are listed in FORMULAS.
"""
import csv
import io
import re

TXN = re.compile(r"^\d{8}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

FORMULAS = {
    "notices_by_calendar_year": "count of notices whose published `date` (the date early termination was granted) falls in the calendar year",
    "notices_by_fiscal_year": "count of notices whose published `date` falls in the federal fiscal year (October of the previous calendar year to September); labelled by the year it ends",
}


def fiscal_year(date):
    """Federal fiscal year (Oct-Sep) of an ISO date string, labelled by the year it ends; None for a date that does not parse."""
    if not ISO_DATE.match(date or ""):
        return None
    year, month = int(date[:4]), int(date[5:7])
    if not 1 <= month <= 12:
        return None
    return year + 1 if month >= 10 else year


def clean(value):
    """A published string with edge whitespace removed and runs of spaces collapsed (the FTC's titles are collapsed the same way);
    None for blank or absent. Letters, case and punctuation are untouched."""
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def normalize_notice(rec):
    """One API record -> the fields the dataset shows, as published (strings trimmed only). Returns None when the record
    publishes none of transaction number, parties and date (an empty record)."""
    a = rec.get("attributes") or {}
    entities = a.get("acquired-entities")
    if isinstance(entities, str):
        entities = [entities]
    notice = {
        "api_id": rec.get("id"),
        "transaction_number": clean(a.get("transaction-number")),
        "acquiring_party": clean(a.get("acquiring-party")),
        "acquired_party": clean(a.get("acquired-party")),
        "acquired_entities": [e for e in (clean(x) for x in (entities or [])) if e],
        "date": clean(a.get("date")),
        "title_published": clean(a.get("title")),
        "created": clean(a.get("created")),
        "updated": clean(a.get("updated")),
    }
    if not any(notice[k] for k in ("transaction_number", "acquiring_party", "acquired_party", "date")):
        return None
    return notice


def composed_title(n):
    """`<transaction number>: <acquiring party>; <acquired party>` from the three published fields; None when one is absent."""
    if not (n["transaction_number"] and n["acquiring_party"] and n["acquired_party"]):
        return None
    return f'{n["transaction_number"]}: {n["acquiring_party"]}; {n["acquired_party"]}'


def title_status(n):
    """'matches' when the published title equals the composed one, 'differs' when both exist and differ, 'unavailable' otherwise."""
    composed = composed_title(n)
    if composed is None or n["title_published"] is None:
        return "unavailable"
    return "matches" if composed == n["title_published"] else "differs"


def date_problems(n):
    """Short reasons the date cannot be used for a year count (empty list when it can)."""
    if not n["date"]:
        return ["no date published"]
    if fiscal_year(n["date"]) is None:
        return ["date is not YYYY-MM-DD"]
    return []


def merge_pages(pages):
    """Union of the records of several page documents by the API's own record id. Returns (records_by_id, stats).

    Records that share an id are identical copies from different passes; if two copies differ the later is kept and the
    id is listed in stats['changed_between_passes'].
    """
    out, seen, changed = {}, 0, []
    for doc in pages:
        for rec in doc.get("data", []):
            seen += 1
            rid = rec.get("id")
            if rid in out and out[rid].get("attributes") != rec.get("attributes"):
                changed.append(rid)
            out[rid] = rec
    return out, {"records_read": seen, "distinct": len(out), "changed_between_passes": changed}


def assign_ids(notices):
    """Stable row ids: the transaction number; when several notices share one, `<txn>-<n>` in order of (date, created, api id).

    Returns {api_id: row_id}. Notices without a transaction number get `api-<first 8 of api id>`.
    """
    groups = {}
    for n in notices:
        groups.setdefault(n["transaction_number"], []).append(n)
    ids = {}
    for txn, group in groups.items():
        group.sort(key=lambda n: (n["date"] or "", n["created"] or "", n["api_id"] or ""))
        for i, n in enumerate(group, 1):
            if not txn:
                ids[n["api_id"]] = "api-" + (n["api_id"] or "")[:8]
            else:
                ids[n["api_id"]] = txn if len(group) == 1 else f"{txn}-{i}"
    return ids


def counts_by_year(notices):
    """({calendar_year: n}, {fiscal_year: n}, undated) over notices with a usable date."""
    cal, fy, undated = {}, {}, 0
    for n in notices:
        if date_problems(n):
            undated += 1
            continue
        y = int(n["date"][:4])
        cal[y] = cal.get(y, 0) + 1
        f = fiscal_year(n["date"])
        fy[f] = fy.get(f, 0) + 1
    return dict(sorted(cal.items())), dict(sorted(fy.items())), undated


# ---------------------------------------------------------------------------------------------------------------------
# HSR filing data sets (CSV downloads from ftc.gov)

def read_csv(text):
    """Rows of a CSV as dicts keyed by the header; header and values stripped of a BOM and surrounding spaces."""
    text = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]


def to_int(value):
    """int for '1,234' or '1234'; None for blank or anything else (never 0 for a blank)."""
    text = (value or "").replace(",", "").strip()
    return int(text) if re.fullmatch(r"-?\d+", text) else None


def to_float(value):
    text = (value or "").strip()
    try:
        return float(text)
    except ValueError:
        return None


MONTH_FILINGS_COLUMNS = ("FYTransaction", "MonthTransaction", "TransactionReceived")


def parse_monthly_filings(text):
    """HSR-Merger-Transactions-by-Month.csv -> (rows, problems). Each row is {fy, month, year, key, transactions} with the
    calendar year derived from the fiscal year (October-December belong to the previous calendar year). The file's columns
    are FYTransaction, MonthTransaction and TransactionReceived.

    A (fiscal year, month) listed twice is counted once when both lines carry the same value and dropped entirely when they
    differ (the file does not say which is right); either case is listed in `problems`. Rows whose fiscal year or month is not
    a number, or whose month is not 1-12, are skipped and listed too."""
    seen, rows, problems = {}, [], []
    for line_no, r in enumerate(read_csv(text), 2):
        fy, month, n = to_int(r.get("FYTransaction")), to_int(r.get("MonthTransaction")), to_int(r.get("TransactionReceived"))
        if fy is None or month is None or not 1 <= month <= 12:
            problems.append(f"line {line_no}: not a fiscal year and month ({r.get('FYTransaction')!r}, {r.get('MonthTransaction')!r})")
            continue
        key = (fy, month)
        if key in seen:
            first_line, first_n = seen[key]
            if first_n == n:
                problems.append(f"FY{fy} month {month} appears twice with the same value {n} (lines {first_line} and {line_no}); counted once")
            else:
                problems.append(f"FY{fy} month {month} appears twice with different values ({first_n} on line {first_line}, {n} on line {line_no}); both dropped")
                rows = [x for x in rows if (x["fy"], x["month"]) != key]
                seen[key] = (first_line, None)
            continue
        seen[key] = (line_no, n)
        year = fy - 1 if month >= 10 else fy
        rows.append({"fy": fy, "month": month, "year": year, "key": f"{year}-{month:02d}", "transactions": n})
    return rows, problems


def monthly_basis(months, fys):
    """For each fiscal year with monthly rows, which FY-table column the twelve monthly values add up to:
    'filings' (FilingsReceived), 'transactions' (TransactionsReported) or 'neither'. {fy: (sum, basis)}."""
    sums = {}
    for m in months:
        sums[m["fy"]] = sums.get(m["fy"], 0) + (m["transactions"] or 0)
    out = {}
    table = {r["fy"]: r for r in fys}
    for fy, total in sums.items():
        r = table.get(fy)
        if r is None:
            out[fy] = (total, "neither")
        elif total == r["filings_received"]:
            out[fy] = (total, "filings")
        elif total == r["transactions_reported"]:
            out[fy] = (total, "transactions")
        else:
            out[fy] = (total, "neither")
    return out


FY_COLUMNS = {
    "FY": "fy",
    "TransactionsReported": "transactions_reported",
    "FilingsReceived": "filings_received",
    "AdjustedTransactions": "adjusted_transactions",
    "SecondRequestTotal": "second_requests_total",
    "SecondRequestFTC": "second_requests_ftc",
    "SecondRequestDOJ": "second_requests_doj",
    "EarlyTerminationTransactions": "et_requested",
    "EarlyTerminationTransactionsGranted": "et_granted",
    "EarlyTerminationTransactionsNotGranted": "et_not_granted",
}


def parse_fy_table(text):
    """HSR-Transactions-Filings-Second-Requests-by-FY.csv -> [{fy, ...counts}]. Percent columns are not carried (they are
    shares the FTC prints with two decimals; they are recomputed from the counts where shown)."""
    out = []
    for r in read_csv(text):
        row = {name: to_int(r.get(col)) for col, name in FY_COLUMNS.items()}
        if row["fy"] is None:
            continue
        out.append(row)
    return out


def fy_table_problems(rows):
    """Internal consistency of the FY table: second requests FTC + DOJ = total; early termination granted + not granted =
    requested. Returns a list of strings (empty when all rows agree)."""
    problems = []
    for r in rows:
        if None not in (r["second_requests_total"], r["second_requests_ftc"], r["second_requests_doj"]) and r["second_requests_ftc"] + r["second_requests_doj"] != r["second_requests_total"]:
            problems.append(f"FY{r['fy']}: second requests FTC + DOJ != total")
        if None not in (r["et_requested"], r["et_granted"], r["et_not_granted"]) and r["et_granted"] + r["et_not_granted"] != r["et_requested"]:
            problems.append(f"FY{r['fy']}: early termination granted + not granted != requested")
    return problems
