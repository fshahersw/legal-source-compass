"""Independent check of the courts_db build against Courts-DB itself (no builder helpers are imported).

Re-reads courts.json and court_spine, and for every record checks: the id and name are the Courts-DB entry's; the page flag and the
court-page link exist only for an exact court_spine id; the parent chain walks Courts-DB's parent field; the grouped courts are exactly
the entries naming this court as parent; the appeal route is Courts-DB's appeal_to (or ca<n> for a recorded federal circuit number);
every court that names this court in appeal_to (or is listed in its lower_courts) is listed as appealing here; and the court website
is the recorded http(s) URL. Writes private/build/courts_db/verification.json.

    python3 -I -B scripts/enrichment/courts_db/verify_courts_db.py
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
courts = json.load(open(os.path.join(ROOT, "private", "acq", "courts_db", "courts.json")))
src = {c["id"]: c for c in courts}
spine = {json.loads(line)["id"] for line in open(os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups", "court_spine.jsonl"))}
spec = json.load(open(os.path.join(ROOT, "private", "build", "courts_db", "courts_db.json")))
failures = []


def fail(cid, what):
    failures.append({"id": cid, "check": what})


rows = {r["id"]: r for r in spec["rows"]}
if set(rows) != set(src):
    fail("*", f"record ids differ from Courts-DB ids ({len(rows)} vs {len(src)})")
for cid, row in rows.items():
    c, p = src.get(cid), row["item"]["profile"]
    if c is None:
        continue
    if p["name"] != (c.get("name") or cid):
        fail(cid, "name")
    if p["has_page"] != (cid in spine):
        fail(cid, "page flag")
    page_links = [l for l in row["item"]["links"] if l["url"].startswith("/courts/")]
    if (cid in spine) != bool(page_links) or any(l["url"] != f"/courts/{cid}" for l in page_links):
        fail(cid, "court page link")
    chain, seen, cur = [], {cid}, c.get("parent")
    while cur in src and cur not in seen:
        chain.append(cur)
        seen.add(cur)
        cur = src[cur].get("parent")
    if [r["id"] for r in p["parent_chain"]] != chain:
        fail(cid, "parent chain")
    kids = sorted(k for k, v in src.items() if v.get("parent") == cid and k != cid)
    if [r["id"] for r in p["children"]] != kids:
        fail(cid, "grouped courts")
    for r in p["parent_chain"] + p["children"] + p["appealed_from"] + [x for x in (p["appeal_to"], p["circuit"]) if x]:
        if r["page"] != (r["id"] in spine) or r["name"] != (src[r["id"]].get("name") or r["id"]):
            fail(cid, f"reference {r['id']}")
    target = c.get("appeal_to") if c.get("appeal_to") in src else None
    if (p["appeal_to"] or {}).get("id") != target:
        fail(cid, "appeal_to")
    fc = c.get("federal_circuit")
    expected_circuit = f"ca{fc}" if isinstance(fc, int) and f"ca{fc}" in src and f"ca{fc}" != target else None
    if (p["circuit"] or {}).get("id") != expected_circuit:
        fail(cid, "circuit")
    lower = sorted({k for k, v in src.items() if v.get("appeal_to") == cid and k != cid}
                   | {k for k in (c.get("lower_courts") or []) if k in src and k != cid})
    if [r["id"] for r in p["appealed_from"]] != lower:
        fail(cid, "appealed from")
    url = c.get("court_url")
    ok_url = url.strip() if isinstance(url, str) and url.strip().lower().startswith(("http://", "https://")) else None
    if p["court_url"] != ok_url:
        fail(cid, "court website")
summary = {"records": len(rows), "checked_against": "courts.json + court_spine", "failures": len(failures), "examples": failures[:20]}
with open(os.path.join(ROOT, "private", "build", "courts_db", "verification.json"), "w") as h:
    json.dump(summary, h, indent=1)
print(json.dumps(summary)[:600])
raise SystemExit(1 if failures else 0)
