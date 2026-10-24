"""Probe whether case-law search counts above 10,000 are exact (one or two requests)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api
c = cl_api.Client(max_requests=3)
for q in ["dateFiled:[2020-01-01 TO 2020-12-31]", "\"summary judgment\" AND dateFiled:[2020-01-01 TO 2020-12-31]"]:
    r = c.get(cl_api.build_url("search/", [("type", "o"), ("q", q), ("stat_Published", "on"), ("stat_Unpublished", "on")]))
    print(r["status"], q, r["json"].get("count"), len(r["json"].get("results", [])))
