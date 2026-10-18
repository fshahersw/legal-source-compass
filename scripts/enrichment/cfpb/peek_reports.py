"""Diagnostic: parse all saved catalog pages and print counts, category/topic distributions and anomalies."""
import collections
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from reports import parse_page  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
entries, totals = [], set()
for path in sorted(glob.glob(os.path.join(ROOT, "private", "acq", "cfpb", "reports", "page-*.html"))):
    with open(path, encoding="utf-8") as handle:
        page, total, pages = parse_page(handle.read())
    totals.add((total, pages))
    print(os.path.basename(path), len(page))
    entries.extend(page)
print("entries", len(entries), "declared", totals)
urls = collections.Counter(e["url"] for e in entries)
print("unique urls", len(urls), "dupes", [u for u, n in urls.items() if n > 1][:10])
print("categories", collections.Counter(c for e in entries for c in e["categories"]).most_common())
print("n categories per entry", collections.Counter(len(e["categories"]) for e in entries))
print("no description", sum(1 for e in entries if not e["description"]), "no date", sum(1 for e in entries if not e["date"]))
print("topics", len({t["slug"] for e in entries for t in e["topics"]}))
print("hosts", collections.Counter(e["url"].split("/")[2] for e in entries))
print("years", sorted(collections.Counter(e["date"][:4] for e in entries if e["date"]).items()))
print("non research-reports paths", [e["url"] for e in entries if "/data-research/research-reports/" not in e["url"]][:15])
for e in entries[:2] + entries[-2:]:
    print(e)
