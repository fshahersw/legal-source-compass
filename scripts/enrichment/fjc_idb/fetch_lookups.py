"""Save read-only corpus lookups (ids only) the FJC IDB / CourtListener builders need for exact-key cross-references.

Run once with the environment sourced (read-only GETs through corpus_writer.fetch_all):
    python3 -I -B fetch_lookups.py
Writes private/build/fjc_idb/lookups/<name>.json with {"query": ..., "retrieved_at": ..., "ids": [...]}.
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402

OUT = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups")
DATASETS = {
    "court_spine": "court_spine",
    "mdls": "mdls",
    "mdl_analytics": "mdl_analytics",
    "fcms_court_profiles": "fcms_court_profiles",
    "court_cjra_districts": "court_cjra_districts",
    "court_jb_districts": "court_jb_districts",
    "cl_people": "cl_people",
}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, dataset in DATASETS.items():
        rows = writer.fetch_all(dataset, select="id,title,state")
        ids = sorted(r["id"] for r in rows)
        states = {r["id"]: r.get("state") for r in rows if r.get("state")}
        titles = {r["id"]: r.get("title") for r in rows} if name == "court_spine" else {}
        with open(os.path.join(OUT, name + ".json"), "w") as h:
            json.dump({"dataset": dataset, "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "count": len(ids), "ids": ids,
                       "state": states if name == "court_spine" else {}, "title": titles}, h)
        print(name, len(ids))


if __name__ == "__main__":
    main()
