"""Diagnostic: summarise a saved CFPB search API response (aggregation names and bucket heads)."""
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
print("total", data.get("hits", {}).get("total"))
aggs = data.get("aggregations", {})
for name, agg in aggs.items():
    inner = agg.get(name, agg)
    buckets = inner.get("buckets", [])
    print(name, "doc_count", agg.get("doc_count"), "buckets", len(buckets), "other", inner.get("sum_other_doc_count"))
    for bucket in buckets[: int(sys.argv[2]) if len(sys.argv) > 2 else 5]:
        print("   ", bucket.get("key"), bucket.get("doc_count"))
for key in data:
    if key not in ("hits", "aggregations"):
        print("top-level", key, str(data[key])[:200])
