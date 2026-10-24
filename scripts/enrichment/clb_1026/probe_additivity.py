"""Additivity check of search counts: published-only + unpublished-only against both switches on, for small and
mid-size counts (6 requests; the combined counts are already archived)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api, search_plan as sp
c = cl_api.Client(max_requests=10)
cases = [
    'court_id:cafc AND "Daubert" AND dateFiled:[2000-01-01 TO 2025-12-31]',
    'court_id:ca9 AND "Daubert" AND dateFiled:[2000-01-01 TO 2025-12-31]',
    '"class certification" AND dateFiled:[2020-01-01 TO 2020-12-31]',
    'court_id:ca9 AND dateFiled:[2020-01-01 TO 2020-12-31]',
    '"summary judgment" AND dateFiled:[2020-01-01 TO 2020-12-31]',
    '"summary judgment" AND dateFiled:[2019-01-01 TO 2020-12-31]',
]
out = []
for q in cases:
    both = c.get(sp.opinion_url(q))["json"]["count"]
    pub = c.get(sp.opinion_url(q, [("stat_Published", "on")]))["json"]["count"]
    unp = c.get(sp.opinion_url(q, [("stat_Unpublished", "on")]))["json"]["count"]
    out.append({"q": q, "combined": both, "published": pub, "unpublished": unp, "sum": pub + unp, "difference": pub + unp - both})
    print(json.dumps(out[-1]))
json.dump(out, open(os.path.join(cl_api.ROOT, "private", "build", "clb_1026", "additivity_check.json"), "w"), indent=1)
