"""Read-only: derive the deterministic reporter-facet normalization plan for citation_index.

canonical = reporter group eyecite parses out of the (already normalized) title.
rule1: facet equals canonical already -> unchanged
rule2: spacing / punctuation / case / apostrophe-only difference (squash equal) -> canonical
rule3: eyecite itself normalizes the facet spelling (synthetic '1 <facet> 1' parse) to the canonical reporter -> canonical
else : flagged, unchanged
"""
import collections
import json
import os
import re
import sys

from eyecite import get_citations
from eyecite.models import FullCaseCitation, FullCitation

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
rows = {}
order = []
for l in open(os.path.join(HERE, "data", "citation_index_full.jsonl"), encoding="utf-8"):
    r = json.loads(l)
    rows[r["id"]] = r
    order.append(r["id"])
res = {}
for l in open(os.path.join(HERE, "results", "citation_index_results.jsonl"), encoding="utf-8"):
    x = json.loads(l)
    res[x["id"]] = x


def squash2(s):
    return re.sub(r"[^0-9A-Za-z]", "", s).lower()


_syn_cache = {}


def eyecite_reporter_of(facet):
    """Reporter eyecite assigns to a synthetic '1 <facet> 1' case citation (None when it does not parse cleanly)."""
    if facet in _syn_cache:
        return _syn_cache[facet]
    out = None
    s = f"100 {facet} 200"
    cites = [c for c in get_citations(s) if isinstance(c, FullCaseCitation)]
    if len(cites) == 1 and cites[0].matched_text() == s:
        c = cites[0]
        try:
            corr = c.corrected_citation()
            m = re.fullmatch(r"100 (.+) 200", corr)
            out = m.group(1) if m else None
        except Exception:  # noqa
            out = None
    _syn_cache[facet] = out
    return out


plan = []
flag = collections.Counter()
rule_counts = collections.Counter()
flag_samples = collections.defaultdict(list)
for i in order:
    row = rows[i]
    rec = res[i]
    fr = (row.get("filters") or {}).get("reporter")
    if not (isinstance(fr, list) and len(fr) == 1):
        rule_counts["facet_not_single"] += 1
        continue
    v = fr[0]
    g = rec.get("groups") or {}
    c = (g.get("reporter") or "").strip()
    if not c:
        rule_counts["no_parsed_reporter"] += 1
        continue
    if v == c:
        rule_counts["rule1_equal"] += 1
        continue
    if squash2(v) == squash2(c):
        rule_counts["rule2_squash"] += 1
        plan.append({"id": i, "old": v, "new": c, "rule": "squash", "title": rec["title"]})
        continue
    er = eyecite_reporter_of(v)
    if er is not None and (er == c or squash2(er) == squash2(c)):
        rule_counts["rule3_eyecite"] += 1
        plan.append({"id": i, "old": v, "new": c, "rule": "eyecite", "title": rec["title"]})
        continue
    rule_counts["flag"] += 1
    flag[(v, c)] += 1
    if len(flag_samples[(v, c)]) < 2:
        flag_samples[(v, c)].append((i, rec["title"]))

print("rule counts:", dict(rule_counts))
print("plan size:", len(plan), "| by rule:", collections.Counter(p["rule"] for p in plan))
print("distinct (old,new) pairs:", len({(p["old"], p["new"]) for p in plan}))
print("flagged (no change) pairs:", len(flag), "rows:", sum(flag.values()))
for (v, c), n in flag.most_common(60):
    print("   ", n, repr(v), "->title says", repr(c), flag_samples[(v, c)][:1])

# group consistency: within one squash2 group, titles must agree on a single canonical spelling
canon_by_group = collections.defaultdict(collections.Counter)
for i in order:
    c = ((res[i].get("groups") or {}).get("reporter") or "").strip()
    if c:
        canon_by_group[squash2(c)][c] += 1
conf = {k: dict(v) for k, v in canon_by_group.items() if len(v) > 1}
print("squash groups whose titles disagree on spelling:", conf)

# resulting distribution
newvals = collections.Counter()
planned = {p["id"]: p["new"] for p in plan}
for i in order:
    fr = (rows[i].get("filters") or {}).get("reporter")
    v = fr[0] if isinstance(fr, list) and fr else None
    newvals[planned.get(i, v)] += 1
oldvals = collections.Counter((rows[i].get("filters") or {}).get("reporter", [None])[0] for i in order)
print("distinct facet values old/new:", len(oldvals), len(newvals))
print("new top 70:", newvals.most_common(70))
json.dump({"plan": plan, "pairs": [[o, n, c] for (o, n), c in collections.Counter((p["old"], p["new"]) for p in plan).most_common()],
           "flag_pairs": [[v, c, n] for (v, c), n in flag.most_common()],
           "old_counts": oldvals.most_common(), "new_counts": newvals.most_common()},
          open(os.path.join(HERE, "results", "reporter_facet_plan.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
