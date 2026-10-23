"""CFPB Consumer Complaint Database → safety.cfpb_monthly (every complaint, as company × product × issue × state × month
counts) and safety.cfpb_complaints (record level for the most recent window), streamed from the bulk CSV.

  python3 -I scripts/safety_v2/cfpb_build.py [--zip PATH | --url URL] [--records-months 24]
         [--records-scope non_credit|all] [--limit N] [--outdir DIR]

Source: https://files.consumerfinance.gov/ccdb/complaints.csv.zip (daily). --zip reads a local copy (the shared
private/acq/cfpb/bulk/complaints.csv.zip, 2026-10-18, is the default); --url streams the current file without storing it.
Record scope: complaints received in the last --records-months months before the file's latest receipt date;
non_credit (default) leaves out the product "Credit reporting or other personal consumer reports" (about 90% of recent
complaints, aggregated in cfpb_monthly but not stored row by row: see the RUNBOOK size table); all keeps every product.
The bulk file carries no complaint narratives; none are stored. Empty fields stay empty ('' terms show as Not recorded).
"""
import argparse
import csv
import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
from nhtsa_complaints import stream_zip_member  # noqa: E402

DEFAULT_ZIP = c.ROOT / "private" / "acq" / "cfpb" / "bulk" / "complaints.csv.zip"
URL = "https://files.consumerfinance.gov/ccdb/complaints.csv.zip"
CREDIT = "Credit reporting or other personal consumer reports"
COLUMNS = ["Date received", "Product", "Sub-product", "Issue", "Sub-issue", "Company public response", "Company", "State",
           "ZIP code", "Tags", "Submitted via", "Date sent to company", "Company response to consumer", "Timely response?",
           "Complaint ID"]


def text_stream(args):
    if args.url:
        def gen():
            pending = b""
            for chunk in stream_zip_member(args.url):
                pending += chunk
                cut = pending.rfind(b"\n")
                if cut >= 0:
                    yield pending[:cut + 1].decode("utf-8")
                    pending = pending[cut + 1:]
            if pending:
                yield pending.decode("utf-8")

        class Reader(io.TextIOBase):
            def __init__(self):
                self.it, self.buf = gen(), ""

            def readline(self):
                while "\n" not in self.buf:
                    try:
                        self.buf += next(self.it)
                    except StopIteration:
                        out, self.buf = self.buf, ""
                        return out
                i = self.buf.index("\n") + 1
                out, self.buf = self.buf[:i], self.buf[i:]
                return out

            def __iter__(self):
                while True:
                    line = self.readline()
                    if not line:
                        return
                    yield line
        return Reader(), {"url": URL}
    z = zipfile.ZipFile(args.zip)
    info = z.infolist()[0]
    return io.TextIOWrapper(z.open(info), encoding="utf-8", newline=""), {
        "path": str(Path(args.zip).relative_to(c.ROOT)) if str(args.zip).startswith(str(c.ROOT)) else str(args.zip),
        "sha256": c.sha256_file(args.zip), "member": info.filename, "member_bytes": info.file_size, "url": URL}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=str(DEFAULT_ZIP))
    ap.add_argument("--url", default="")
    ap.add_argument("--records-months", type=int, default=24)
    ap.add_argument("--records-scope", choices=["non_credit", "all"], default="non_credit")
    ap.add_argument("--limit", type=int, default=0, help="validation sample: keep only aggregates/records of these companies")
    ap.add_argument("--companies", default="", help="validation sample: '|'-separated exact company names to keep")
    ap.add_argument("--outdir", default=str(c.BUILD / "cfpb"))
    ap.add_argument("--chunk-rows", type=int, default=5000)
    args = ap.parse_args()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    keep = set(x for x in args.companies.split("|") if x) or None

    # pass 1: aggregates and the latest receipt date
    stream, src = text_stream(args)
    reader = csv.reader(stream)
    header = next(reader)
    if header[:len(COLUMNS)] != COLUMNS:
        raise SystemExit(f"unexpected header: {header}")
    agg, latest, rows_read = Counter(), "", 0
    records = []
    for row in reader:
        rows_read += 1
        d = row[0]
        if len(d) < 10:
            continue
        if keep and row[6] not in keep:
            continue
        agg[(row[6], row[1], row[3], row[7] if len(row[7]) == 2 and row[7].isalpha() and row[7].isupper() else "", d[:7])] += 1
        latest = max(latest, d[:10])
        records.append(row) if (args.records_scope == "all" or row[1] != CREDIT) else None
        if len(records) > 3_000_000:  # bound memory: keep only rows that can fall inside any 24-month window seen so far
            floor = c.month_add(latest[:7], -args.records_months)
            records = [r for r in records if r[0][:7] > floor]
    floor = c.month_add(latest[:7], -args.records_months)  # e.g. latest 2026-10 → records from 2024-11 (24 whole months + current)
    records = [r for r in records if r[0][:7] > floor]
    tag = c.sha256_bytes(c.utc_now().encode())[:6]
    wa = c.ChunkWriter(out / "chunks", f"cfpb_monthly-{tag}", max_rows=args.chunk_rows, source="cfpb_complaints")
    for (company, product, issue, state, month), n in sorted(agg.items()):
        wa.add({"company": company, "product": product, "issue": issue, "state": state, "month": month, "complaints": n})
    wr = c.ChunkWriter(out / "chunks", f"cfpb_complaints-{tag}", max_rows=args.chunk_rows, source="cfpb_complaints")
    for r in sorted(records, key=lambda r: int(r[14]) if r[14].isdigit() else 0):
        if not r[14].isdigit():
            continue
        wr.add({"complaint_id": int(r[14]), "date_received": r[0][:10], "product": r[1], "sub_product": r[2], "issue": r[3],
                "sub_issue": r[4], "public_response": r[5] or None, "company": r[6], "state": r[7] or None, "zip": r[8] or None,
                "tags": r[9] or None, "submitted_via": r[10] or None, "date_sent": r[11][:10] or None,
                "company_response": r[12] or None, "timely": True if r[13] == "Yes" else False if r[13] == "No" else None})
    outputs = []
    for w, target in ((wa, "cfpb_monthly"), (wr, "cfpb_complaints")):
        res = w.close()
        res["target"] = target
        outputs.append(res)
    with open(out / "chunks" / "index.jsonl", "a") as f:
        for res in outputs:
            for ch in res["chunks"]:
                f.write(json.dumps({**ch, "target": res["target"]}) + "\n")
    c.write_manifest(out, "cfpb", outputs, {**src, "rows_read": rows_read, "latest_received": latest},
                     {"records_from_month": c.month_add(floor, 1), "records_scope": args.records_scope,
                      "companies_filter": sorted(keep) if keep else None, "aggregate_rows": len(agg), "records": len(records)})
    print(json.dumps({"rows_read": rows_read, "latest": latest, "aggregate_rows": len(agg), "records": len(records),
                      "records_from": c.month_add(floor, 1)}))


if __name__ == "__main__":
    main()
