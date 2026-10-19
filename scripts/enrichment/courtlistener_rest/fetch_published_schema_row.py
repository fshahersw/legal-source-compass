"""Save the published clb_bulk_schema record of recap_fjcintegrateddatabase (read-only GETs; nothing is written to the corpus).

The project's local copy of that table (private/acq/courtlistener/db/idb.duckdb) was removed to save disk, so its column profile can
no longer be recomputed. build_clb_schema_rest.py carries this published record over unchanged instead.

    node --env-file=private/scratch/env.sh scratch.local/run_with_env.mjs python3 -I -B scripts/enrichment/courtlistener_rest/fetch_published_schema_row.py
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import corpus_writer as cw  # noqa: E402

DATASET = "clb_bulk_schema"
RID = "table:recap_fjcintegrateddatabase"
FULL = "dataset,id,category,state,title,source_url,item,detail,text,filters"
OUT = os.path.join(rc.LOOK, "clb_bulk_schema_published_idb.json")


def main() -> None:
    cat = cw._call("GET", f"corpus_datasets?id=eq.{DATASET}&select=id,ready,imported_records,manifest_sha256")
    if not cat or not cat[0]["ready"]:
        raise SystemExit(f"{DATASET}: not published or not ready")
    rows = [r for r in cw.fetch_all(DATASET, select=FULL) if r["id"] == RID]
    if len(rows) != 1:
        raise SystemExit(f"{DATASET}: {len(rows)} records with id {RID}")
    os.makedirs(rc.LOOK, exist_ok=True)
    out = {"dataset": DATASET, "id": RID, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "manifest_sha256": cat[0]["manifest_sha256"],
           "imported_records": cat[0]["imported_records"], "row": rows[0]}
    with open(OUT, "w") as h:
        json.dump(out, h, ensure_ascii=False, sort_keys=True)
    print(json.dumps({"saved": OUT, "manifest_sha256": cat[0]["manifest_sha256"], "imported_records": cat[0]["imported_records"], "cells": rows[0]["item"]["cells"]}))


if __name__ == "__main__":
    main()
