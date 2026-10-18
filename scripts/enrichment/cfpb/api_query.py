"""Query the documented CFPB Consumer Complaint Database search API and keep the response bytes unchanged.

Usage:
  python3 -I -B scripts/enrichment/cfpb/api_query.py <name> "<query string without leading ?>" [endpoint]

Saves private/acq/cfpb/api/<name>.json (manifest line method=api) and prints hits.total plus top-level _meta.
endpoint defaults to the search root; pass e.g. "trends" or "geo/states" for the other documented endpoints.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fetch import ACQ, fetch  # noqa: E402

API = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"


def query(name, qs, endpoint=""):
    url = API + (endpoint.strip("/") + "/" if endpoint else "") + ("?" + qs if qs else "")
    entry = fetch(url, f"api/{name}.json", method="api", timeout=300)
    with open(os.path.join(ACQ, "api", f"{name}.json"), encoding="utf-8") as handle:
        data = json.load(handle)
    return entry, data


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    entry, data = query(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    total = data.get("hits", {}).get("total") if isinstance(data, dict) else None
    print(json.dumps({"url": entry["url"], "sha256": entry["sha256"][:16], "total": total, "_meta": data.get("_meta") if isinstance(data, dict) else None}))
