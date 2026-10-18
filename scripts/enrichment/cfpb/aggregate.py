"""One streaming pass over the CFPB Consumer Complaint Database bulk CSV (read from the zip, never extracted).

Produces exact counts keyed by recorded field values (no normalisation of names or categories). Keys are tuples joined
with SEP for JSON caching. Period flag `w` per complaint (by Date received, both bounds inclusive, matching the search
API's date_received_min / date_received_max semantics verified by live probe):
  2 = 2023-10-18 .. 2026-10-18 (the 3-year window of the search URL)
  1 = 2020-10-18 .. 2023-10-17 (the preceding 3-year window, for comparison)
  0 = earlier

Usage (diagnostic): python3 -I -B scripts/enrichment/cfpb/aggregate.py   -> writes/refreshes the cache and prints totals
"""
import collections
import csv
import hashlib
import io
import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "cfpb")
ZIP = os.path.join(ACQ, "bulk", "complaints.csv.zip")
CACHE_DIR = os.path.join(ROOT, "private", "build", "cfpb", "cache")
SEP = "\x1f"
MEMBER = "complaints.csv"

WINDOW = ("2023-10-18", "2026-10-18")
PRIOR_WINDOW = ("2020-10-18", "2023-10-17")

EXPECTED_HEADER = [
    "Date received", "Product", "Sub-product", "Issue", "Sub-issue", "Company public response", "Company", "State",
    "ZIP code", "Tags", "Submitted via", "Date sent to company", "Company response to consumer", "Timely response?",
    "Complaint ID",
]

COUNTERS = ("day", "nat", "natm", "natx", "st", "stx", "sti", "co", "cox", "cov", "cos", "coi")


def window_flag(day):
    if WINDOW[0] <= day <= WINDOW[1]:
        return "2"
    if PRIOR_WINDOW[0] <= day <= PRIOR_WINDOW[1]:
        return "1"
    return "0"


def valid_day(day):
    return len(day) == 10 and day[4] == "-" and day[7] == "-" and day[:4].isdigit() and day[5:7].isdigit() and day[8:].isdigit()


def new_state():
    return {name: collections.Counter() for name in COUNTERS} | {
        "rows": 0,
        "blank": collections.Counter(),
        "untrimmed": collections.Counter(),
        "bad_dates": 0,
        "min_day": None,
        "max_day": None,
        "duplicate_ids": 0,
        "bad_ids": 0,
        "max_id": 0,
    }


def add_row(acc, row, bitmap):
    """Count one CSV row (list in EXPECTED_HEADER order) into the accumulators. Returns the (possibly grown) bitmap."""
    (day, product, sub_product, issue, _sub_issue, public, company, state, _zip, tags, via, _sent, response, timely, cid) = row
    acc["rows"] += 1
    for name, value in (("Sub-product", sub_product), ("Issue", issue), ("Company public response", public),
                        ("Company", company), ("State", state), ("Tags", tags), ("Submitted via", via),
                        ("Company response to consumer", response), ("Timely response?", timely), ("Product", product)):
        if value == "":
            acc["blank"][name] += 1
        elif value != value.strip():
            acc["untrimmed"][name] += 1
    if not valid_day(day):
        acc["bad_dates"] += 1
        return bitmap
    if acc["min_day"] is None or day < acc["min_day"]:
        acc["min_day"] = day
    if acc["max_day"] is None or day > acc["max_day"]:
        acc["max_day"] = day
    year, ym = day[:4], day[:7]
    w = window_flag(day)
    acc["day"][day] += 1
    acc["nat"][SEP.join((year, w, product, sub_product, issue))] += 1
    acc["natm"][SEP.join((ym, product))] += 1
    acc["natx"][SEP.join((year, w, product, via, response, timely, tags, public))] += 1
    acc["st"][SEP.join((state, year, w, product, timely))] += 1
    acc["stx"][SEP.join((state, year, w, response))] += 1
    acc["sti"][SEP.join((state, w, product, issue))] += 1
    acc["co"][SEP.join((company, year, w, product))] += 1
    acc["cox"][SEP.join((company, year, w, response, timely))] += 1
    acc["cov"][SEP.join((company, via))] += 1
    acc["cos"][SEP.join((company, state, w))] += 1
    acc["coi"][SEP.join((company, w, product, issue))] += 1
    if cid.isdigit():
        n = int(cid)
        if n > acc["max_id"]:
            acc["max_id"] = n
        byte = n >> 3
        if byte >= len(bitmap):
            bitmap.extend(bytes(max(byte + 1 - len(bitmap), 1 << 20)))
        mask = 1 << (n & 7)
        if bitmap[byte] & mask:
            acc["duplicate_ids"] += 1
        else:
            bitmap[byte] |= mask
    else:
        acc["bad_ids"] += 1
    return bitmap


def iter_rows(handle):
    reader = csv.reader(handle)
    header = next(reader)
    if header != EXPECTED_HEADER:
        raise ValueError(f"unexpected CSV header: {header}")
    for row in reader:
        if len(row) != len(EXPECTED_HEADER):
            raise ValueError(f"row with {len(row)} fields: {row[:3]}")
        yield row


def aggregate_handle(handle, progress=False):
    acc = new_state()
    bitmap = bytearray()
    started = time.time()
    for row in iter_rows(handle):
        bitmap = add_row(acc, row, bitmap)
        if progress and acc["rows"] % 1_000_000 == 0:
            print(f"{acc['rows']:,} rows {time.time() - started:.0f}s", file=sys.stderr, flush=True)
    return acc


def finalize(acc, **extra_meta):
    """Plain-dict form of the accumulators (the cached JSON shape the builder reads)."""
    out = {name: dict(acc[name]) for name in COUNTERS}
    out["meta"] = {
        "rows": acc["rows"], "blank": dict(acc["blank"]), "untrimmed": dict(acc["untrimmed"]), "bad_dates": acc["bad_dates"],
        "min_day": acc["min_day"], "max_day": acc["max_day"], "duplicate_ids": acc["duplicate_ids"], "bad_ids": acc["bad_ids"],
        "max_id": acc["max_id"], **extra_meta,
    }
    return out


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def zip_member_info(path=ZIP):
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo(MEMBER)
        return {"member": MEMBER, "file_size": info.file_size, "compress_size": info.compress_size,
                "member_date": "%04d-%02d-%02d %02d:%02d" % info.date_time[:5], "crc": "%08x" % info.CRC}


def aggregate_zip(path=ZIP, use_cache=True):
    """Aggregate the bulk CSV inside the zip; cached by the zip's sha256 under private/build/cfpb/cache/."""
    digest = sha256_file(path)
    cache = os.path.join(CACHE_DIR, f"aggregates-{digest[:16]}.json")
    if use_cache and os.path.exists(cache):
        with open(cache, encoding="utf-8") as handle:
            return json.load(handle)
    started = time.time()
    with zipfile.ZipFile(path) as archive, archive.open(MEMBER) as raw:
        acc = aggregate_handle(io.TextIOWrapper(raw, encoding="utf-8", newline=""), progress=True)
    out = finalize(acc, zip_sha256=digest, zip=zip_member_info(path), seconds=round(time.time() - started, 1))
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = cache + ".part"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(out, handle, sort_keys=True)
    os.replace(tmp, cache)
    return out


if __name__ == "__main__":
    data = aggregate_zip(use_cache="--refresh" not in sys.argv)
    print(json.dumps(data["meta"], indent=1))
    print({name: len(data[name]) for name in COUNTERS})
