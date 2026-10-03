"""Read-only: trailing punctuation fix candidates, collisions, and duplicate groups in citation_index."""
import collections
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
rows = {}
order = []
for l in open(os.path.join(HERE, "data", "citation_index_full.jsonl"), encoding="utf-8"):
    r = json.loads(l)
    rows[r["id"]] = r
    order.append(r["id"])
res = {json.loads(l)["id"]: json.loads(l) for l in open(os.path.join(HERE, "results", "citation_index_results.jsonl"), encoding="utf-8")}

TRAIL = re.compile(r"[,;:]+$")
WS = re.compile(r"\s+")
by_title = collections.defaultdict(list)
for i in order:
    by_title[rows[i]["title"]].append(i)

cand = []
for i in order:
    t = rows[i]["title"]
    if TRAIL.search(t.strip()):
        cleaned = TRAIL.sub("", WS.sub(" ", t).strip()).strip()
        others = [j for j in by_title.get(cleaned, []) if j != i]
        cand.append({"id": i, "title": t, "cleaned": cleaned, "collides_with": others,
                     "cleaned_status": res[i]["cleaned_status"], "kind": rows[i]["cells"].get("kind"),
                     "where": rows[i]["cells"].get("where")})
n = len(cand)
coll = [c for c in cand if c["collides_with"]]
by_clean = collections.Counter(c["cleaned"] for c in cand)
multi = {k: v for k, v in by_clean.items() if v > 1}
print("trailing-punct rows:", n, "| collide with an existing exact title:", len(coll), "| clean-target shared by >1 trailing rows:", len(multi))
print("cleaned_status:", collections.Counter(c["cleaned_status"] for c in cand))
print("kind:", collections.Counter(c["kind"] for c in cand))
print("where:", collections.Counter(c["where"] for c in cand))
print("trailing chars:", collections.Counter(re.search(r"[,;:]+$", c["title"].strip()).group(0) for c in cand))
safe = [c for c in cand if not c["collides_with"] and c["cleaned_status"] == "clean_parses_exact" and c["cleaned"] not in multi]
print("SAFE to strip (no collision, cleaned parses exactly, unique target):", len(safe))
unsafe_status = [c for c in cand if not c["collides_with"] and c["cleaned_status"] != "clean_parses_exact"]
print("no collision but cleaned does not parse exactly:", len(unsafe_status))
for c in unsafe_status[:15]:
    print("   ", c["id"], repr(c["title"]), "->", repr(c["cleaned"]), c["cleaned_status"], c["kind"])
print("colliding samples:")
for c in coll[:12]:
    o = c["collides_with"][0]
    print("   ", c["id"], repr(c["title"]), "vs", o, repr(rows[o]["title"]), "| mentions/docs", rows[c["id"]]["cells"].get("mentions"), rows[c["id"]]["cells"].get("documents"), "vs", rows[o]["cells"].get("mentions"), rows[o]["cells"].get("documents"))

# other duplicates (not explained by trailing punctuation): group by squash(corrected or cleaned)
def squash(s):
    return re.sub(r"[\s.,]", "", s).lower()

groups = collections.defaultdict(list)
for i in order:
    rec = res[i]
    key = squash(rec["corrected"] or TRAIL.sub("", WS.sub(" ", rec["title"]).strip()))
    groups[key].append(i)
dups = {k: v for k, v in groups.items() if len(v) > 1}
trailing_ids = {c["id"] for c in cand}
explained = 0
unexplained = []
for k, v in dups.items():
    titles = {rows[i]["title"] for i in v}
    cleaned_titles = {TRAIL.sub("", WS.sub(" ", t).strip()) for t in titles}
    if len(cleaned_titles) == 1 and any(rows[i]["title"] != TRAIL.sub("", WS.sub(" ", rows[i]["title"]).strip()) for i in v):
        explained += 1
    else:
        unexplained.append((k, v))
print("duplicate groups:", len(dups), "rows:", sum(len(v) for v in dups.values()), "| explained by trailing punctuation only:", explained, "| other:", len(unexplained))
for k, v in unexplained[:25]:
    print("   ", [(i, rows[i]["title"], rows[i]["cells"].get("where"), rows[i]["cells"].get("mentions"), rows[i]["cells"].get("documents")) for i in v])
json.dump({"candidates": cand, "safe_ids": [c["id"] for c in safe], "other_dup_groups": [[k, v] for k, v in unexplained]},
          open(os.path.join(HERE, "results", "trailing_and_dups.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
