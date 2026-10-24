"""Run every query of search_plan.plan() once (archived; re-runs reuse the archive) and record the count it reports.

    python3 -I -B fetch_search_counts.py [max_requests]

Writes private/acq/clb_1026/search_counts.jsonl: one line per query {key, ..., count, retrieved_at, sha256, http_status}.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api  # noqa: E402
import search_plan  # noqa: E402

OUT = os.path.join(cl_api.ROOT, "private", "acq", "clb_1026", "search_counts.jsonl")


def main() -> None:
    c = cl_api.Client(max_requests=int(sys.argv[1]) if len(sys.argv) > 1 else 700)
    rows = []
    for i, item in enumerate(search_plan.plan(), 1):
        r = c.get(item["url"])
        body = r["json"] or {}
        count = body.get("count") if isinstance(body.get("count"), int) else None
        rows.append({**item, "count": count, "retrieved_at": r["retrieved_at"], "sha256": r["sha256"], "http_status": r["status"]})
        if i % 25 == 0:
            print(i, "queries", c.requests, "requests", flush=True)
    with open(OUT + ".tmp", "w") as h:
        for row in rows:
            h.write(json.dumps(row) + "\n")
    os.replace(OUT + ".tmp", OUT)
    print("done", len(rows), "queries,", c.requests, "requests this run", flush=True)


if __name__ == "__main__":
    main()
