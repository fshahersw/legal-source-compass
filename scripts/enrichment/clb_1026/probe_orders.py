"""Check that the sort orders offered by the assistant's search tool are accepted by the v4 search API (3 requests)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api
c = cl_api.Client(max_requests=4)
for params in ([("type", "o"), ("q", '"qualified immunity"'), ("order_by", "citeCount desc")],
               [("type", "oa"), ("q", '"Daubert"'), ("order_by", "dateArgued desc")],
               [("type", "r"), ("q", '"class certification"'), ("order_by", "dateFiled desc"), ("court", "cand nysd")]):
    r = c.get(cl_api.build_url("search/", params))
    j = r["json"] or {}
    first = (j.get("results") or [{}])[0]
    print(r["status"], dict(params)["type"], dict(params)["order_by"], "count", j.get("count"),
          "first:", first.get("citeCount"), first.get("dateArgued"), first.get("dateFiled"), first.get("court_id"))
