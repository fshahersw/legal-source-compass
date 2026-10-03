"""Rare tokens in court titles that sit within edit distance 2 of a frequent token (likely misspellings). Read-only."""
import json
import os
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(os.path.join(HERE, "court_map.jsonl"), encoding="utf-8") if l.strip()]
cl_ids = {json.loads(l)["cells"]["native_id"] for l in open(os.path.join(HERE, "cl_courts.jsonl"), encoding="utf-8") if l.strip()}


def toks(s):
    return [t for t in re.split(r"[\s,;:()/&]+", s.replace("’", "'").strip()) if t]


cnt = Counter()
where = {}
for r in rows:
    for t in set(toks(r["title"])):
        t2 = t.strip(".'\"")
        if t2.isalpha() and len(t2) >= 5:
            cnt[t2.lower()] += 1
            where.setdefault(t2.lower(), []).append(r["court_id"])


def lev(a, b):
    if abs(len(a) - len(b)) > 2:
        return 9
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


freq = [t for t, n in cnt.items() if n >= 8]
rare = [t for t, n in cnt.items() if n <= 2]
print("freq", len(freq), "rare", len(rare))
out = []
for t in rare:
    best = None
    for f in freq:
        d = lev(t, f)
        if 0 < d <= 2 and (best is None or cnt[f] > cnt[best[0]]):
            best = (f, d)
    if best:
        out.append((t, cnt[t], best[0], cnt[best[0]], where[t][:3]))
out.sort(key=lambda x: -x[3])
print(len(out))
for x in out:
    print(x)
