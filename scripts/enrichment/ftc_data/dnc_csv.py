"""Aggregate the FTC's daily Do Not Call reported-calls CSV files (same fields as the API) with dnc_agg. Pure functions.

A daily file is named for the day it was posted (DNC_Complaint_Numbers_2026-09-17.csv holds complaints created on
2026-09-16; a Monday file also holds the weekend). Records are therefore counted by their own created-date, never by file name.
A row that does not have exactly the 8 published columns cannot be attributed to fields; it is counted in `malformed_rows`
of its file and left out of the aggregates. A created-date that is not a valid timestamp goes to the 'undated' bucket.
"""
import csv
import io
import hashlib

import dnc_agg

COLUMNS = (
    "Company_Phone_Number", "Created_Date", "Violation_Date", "Consumer_City", "Consumer_State", "Consumer_Area_Code",
    "Subject", "Recorded_Message_Or_Robocall",
)
ATTR = {
    "Company_Phone_Number": "company-phone-number", "Created_Date": "created-date", "Violation_Date": "violation-date",
    "Consumer_City": "consumer-city", "Consumer_State": "consumer-state", "Consumer_Area_Code": "consumer-area-code",
    "Subject": "subject", "Recorded_Message_Or_Robocall": "recorded-message-or-robocall",
}
UNDATED = "undated"


def decode(raw):
    """UTF-8 text of the file bytes; invalid bytes are replaced (and counted by the caller through raw != text.encode())."""
    return raw.decode("utf-8", errors="replace")


def aggregate_file(raw):
    """Aggregate one file's bytes. Returns {"rows": n, "malformed_rows": n, "header_ok": bool, "sha256": hex,
    "days": {created_day | 'undated': {"agg": {key: n}, "quality": {...}}}}."""
    text = decode(raw)
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except StopIteration:
        return {"rows": 0, "malformed_rows": 0, "header_ok": False, "sha256": hashlib.sha256(raw).hexdigest(), "days": {}}
    header_ok = tuple(h.strip() for h in header) == COLUMNS
    days, rows, malformed = {}, 0, 0
    for row in reader:
        if not row:
            continue
        rows += 1
        if len(row) != len(COLUMNS):
            malformed += 1
            continue
        attrs = {ATTR[c]: v for c, v in zip(COLUMNS, row)}
        created = dnc_agg.parse_ts(attrs["created-date"].strip())
        day = "%04d-%02d-%02d" % created[:3] if created else UNDATED
        bucket = days.setdefault(day, {"agg": {}, "quality": dnc_agg.new_quality()})
        dnc_agg.add_record(attrs, day if created else "0000-00-00", bucket["agg"], bucket["quality"])
    return {"rows": rows, "malformed_rows": malformed, "header_ok": header_ok, "sha256": hashlib.sha256(raw).hexdigest(), "days": days}


def merge_days(results):
    """Combine several aggregate_file results into {day: {"agg", "quality", "files": n}}."""
    out = {}
    for res in results:
        for day, b in res["days"].items():
            o = out.setdefault(day, {"agg": {}, "quality": dnc_agg.new_quality(), "files": 0})
            for k, n in b["agg"].items():
                o["agg"][k] = o["agg"].get(k, 0) + n
            dnc_agg.merge_quality(o["quality"], b["quality"])
            o["files"] += 1
    return out
