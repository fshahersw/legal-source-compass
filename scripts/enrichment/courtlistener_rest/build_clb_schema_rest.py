"""Rebuild clb_bulk_schema (an existing dataset id, published by the first CourtListener stream) with this stream's loads counted.

Runs ../courtlistener/build_clb_schema.build() unchanged except for three registries it reads:
* LOADED gains citations_unmatchedcitation (unmatched_citation.duckdb) and search_parenthetical (parenthetical.duckdb, loaded earlier
  but not registered there);
* SMALL gains the eight disclosure tables loaded whole into small.duckdb by load_small.py;
* the summary gains `random_files`: the bulk files outside the schema's load script (randoms/bankruptcy-dockets-2022-09-19) with
  their load status.
The file is written to private/build/courtlistener_rest/clb_bulk_schema.json for the lead to publish (this stream never publishes over
an existing id).

recap_fjcintegrateddatabase: the local copy of that table (idb.duckdb) was removed to save disk on 2026-10-19, so its profile cannot be
recomputed. When the file is missing, the record published earlier (saved read-only by fetch_published_schema_row.py) is carried over
unchanged except for one added fact saying so; the build stops if neither the table nor the saved record is present.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import build_clb_schema as bs  # noqa: E402

EXTRA_LOADED = {"citations_unmatchedcitation": ("unmatched_citation.duckdb", "unmatched_citation"), "search_parenthetical": ("parenthetical.duckdb", "parenthetical")}
EXTRA_SMALL = {"disclosures_financialdisclosure": "fd", "disclosures_investment": "fd_investment", "disclosures_position": "fd_position", "disclosures_agreement": "fd_agreement",
               "disclosures_noninvestmentincome": "fd_non_investment_income", "disclosures_spouseincome": "fd_spousal_income", "disclosures_reimbursement": "fd_reimbursement",
               "disclosures_gift": "fd_gift", "disclosures_debt": "fd_debt"}


def build() -> dict:
    bs.LOADED.update(EXTRA_LOADED)
    bs.SMALL.update(EXTRA_SMALL)
    out = bs.build()
    spec = out["clb_bulk_schema"]
    bk = json.load(open(os.path.join(rc.DB, "bankruptcy.done.json")))
    latest = json.load(open(os.path.join(rc.ROOT, "private", "acq", "courtlistener", "latest_bulk.json")))
    randoms = []
    for key, (date, size, path) in sorted(latest.items()):
        if not key.startswith("randoms/"):
            continue
        loaded = bk if path.endswith(bk["file"]) else None
        randoms.append({"file": path.split("/", 1)[1], "date": date, "compressed_bytes": size, "url": rc.BULK + path.split("/", 1)[1],
                        "loaded": "loaded here (selected columns; debtor names not loaded)" if loaded else "not loaded",
                        "rows": loaded["rows"] if loaded else None, "skipped_invalid_rows": loaded["skipped_invalid_rows"] if loaded else None,
                        "columns_kept": loaded["columns_selected"] if loaded else None, "used_by": "clb_bankruptcy_courts" if loaded else None})
    spec["summary"]["random_files"] = {"statement": "Files under bulk-data/randoms are one-off exports outside the database load script; they are listed here, not as schema tables.", "files": randoms}
    carry_over_idb(spec)
    return out


IDB_ID = "table:recap_fjcintegrateddatabase"
IDB_SAVED = os.path.join(rc.LOOK, "clb_bulk_schema_published_idb.json")


def carry_over_idb(spec: dict) -> None:
    """Replace the recomputed recap_fjcintegrateddatabase row with the published one when the local table is gone."""
    if os.path.exists(os.path.join(rc.DB, "idb.duckdb")):
        return
    if not os.path.exists(IDB_SAVED):
        raise SystemExit("idb.duckdb is missing and the published record was not saved: run fetch_published_schema_row.py first")
    saved = json.load(open(IDB_SAVED))
    row = saved["row"]
    if row["id"] != IDB_ID or row["dataset"] != "clb_bulk_schema":
        raise SystemExit("saved record is not the clb_bulk_schema recap_fjcintegrateddatabase record")
    note = (f"Carried over unchanged from the published clb_bulk_schema record (read {saved['fetched_at'][:10]}, catalog manifest "
            f"{saved['manifest_sha256'][:16]}): this project's local copy of the table was removed to save disk, so the profile was not recomputed")
    row["detail"]["facts"].append(["Profile source", note])
    idx = [i for i, r in enumerate(spec["rows"]) if r["id"] == IDB_ID]
    if len(idx) != 1:
        raise SystemExit(f"{IDB_ID}: {len(idx)} rows in the rebuilt schema")
    spec["rows"][idx[0]] = row
    spec["summary"]["load_status"] = dict(Counter(r["item"]["cells"]["loaded"] for r in spec["rows"]))
    spec["summary"]["carried_over"] = {"records": [IDB_ID], "statement": note, "manifest_sha256": saved["manifest_sha256"], "fetched_at": saved["fetched_at"]}


if __name__ == "__main__":
    out = build()
    rc.write(out)
    print(json.dumps(out["clb_bulk_schema"]["summary"]["load_status"]))
