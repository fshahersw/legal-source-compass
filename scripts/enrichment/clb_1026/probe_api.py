"""A handful of probe requests: endpoint counts for people-db tables without bulk files, and one search count."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api  # noqa: E402


def main() -> None:
    c = cl_api.Client(max_requests=int(sys.argv[1]) if len(sys.argv) > 1 else 8)
    urls = [
        cl_api.build_url("aba-ratings/", {"count": "on"}),
        cl_api.build_url("retention-events/", {"count": "on"}),
        cl_api.build_url("sources/", {"count": "on"}),
        cl_api.build_url("aba-ratings/", [("order_by", "id")]),
        cl_api.build_url("courts/", [("id", "uscfc"), ("fields", "id,appeals_to,full_name")]),
        cl_api.build_url("search/", [("type", "o"), ("q", "court_id:ca9 AND dateFiled:[2020-01-01 TO 2020-12-31]"), ("stat_Published", "on"), ("stat_Unpublished", "on")]),
    ]
    for u in urls:
        r = c.get(u)
        j = r["json"]
        summary = j if not isinstance(j, dict) or "results" not in j else {"count": j.get("count"), "next": bool(j.get("next")), "keys": sorted(j["results"][0].keys()) if j["results"] else [], "first": j["results"][0] if j["results"] else None}
        print(r["status"], u.replace(cl_api.API, ""), json.dumps(summary)[:900])
    print("requests made:", c.requests)


if __name__ == "__main__":
    main()
