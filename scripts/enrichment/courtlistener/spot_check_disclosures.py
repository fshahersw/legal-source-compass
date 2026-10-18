"""Independent spot check of clb_disclosure_coverage: recompute counts with different SQL (IN-subqueries, ids as integers)."""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import duckdb  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
TABLES = {"investments": "fd_investment", "gifts": "fd_gift", "reimbursements": "fd_reimbursement", "outside positions": "fd_position", "debts": "fd_debt",
          "agreements": "fd_agreement", "non-investment income": "fd_non_investment_income", "spousal income": "fd_spousal_income"}


def main() -> int:
    con = duckdb.connect(os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb"), read_only=True)
    rows = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_disclosure_coverage.json")))["rows"]}
    checks = []

    def check(what, where, mine, shown):
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(mine == shown)})

    ov = rows["overview:all"]
    check("reports", "overview", con.execute("SELECT count(*) FROM fd").fetchone()[0], ov["reports"])
    check("people", "overview", con.execute("SELECT count(*) FROM (SELECT DISTINCT person_id FROM fd)").fetchone()[0], ov["persons"])
    for label, table in TABLES.items():
        check(f"{label} line items", "overview", con.execute(f"SELECT count(*) FROM {table}").fetchone()[0], ov["sections"][label])
    for y in (1990, 2003, 2011, 2015, 2019, 2020, 2022):
        p = rows.get(f"year:{y}")
        if not p:
            continue
        w = f"year:{y}"
        check("reports", w, con.execute(f"SELECT count(*) FROM fd WHERE CAST(year AS INTEGER) = {y}").fetchone()[0], p["reports"])
        check("people", w, con.execute(f"SELECT count(DISTINCT person_id) FROM fd WHERE CAST(year AS INTEGER) = {y}").fetchone()[0], p["persons"])
        check("amended", w, con.execute(f"SELECT count(*) FROM fd WHERE CAST(year AS INTEGER) = {y} AND is_amended = 't'").fetchone()[0], p["amended"])
        for label in ("investments", "gifts", "reimbursements"):
            n = con.execute(f"SELECT count(*) FROM {TABLES[label]} WHERE financial_disclosure_id IN (SELECT id FROM fd WHERE CAST(year AS INTEGER) = {y})").fetchone()[0]
            check(f"{label} line items", w, n, p["items"].get(label, 0))
    judicial = ", ".join(f"'{t}'" for t in sorted(cc.JUDICIAL_POSITIONS))
    for cid in [k.split(":", 1)[1] for k in rows if k.startswith("court:")][:12]:
        p = rows[f"court:{cid}"]
        w = f"court:{cid}"
        people = con.execute(f"SELECT count(DISTINCT person_id) FROM position WHERE court_id = '{cid}' AND position_type IN ({judicial})").fetchone()[0]
        withrep = con.execute(
            f"""SELECT count(DISTINCT person_id) FROM position WHERE court_id = '{cid}' AND position_type IN ({judicial}) AND person_id IN (SELECT person_id FROM fd)""").fetchone()[0]
        reports = con.execute(
            f"""SELECT count(*) FROM fd WHERE person_id IN (SELECT person_id FROM position WHERE court_id = '{cid}' AND position_type IN ({judicial}))""").fetchone()[0]
        check("people with a judicial position", w, people, p["people"])
        check("of those, with a report", w, withrep, p["with_report"])
        check("reports by those people", w, reports, p["reports"])
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks_disclosures.json"), "w") as h:
        json.dump({"method": "plain SQL with IN-subqueries on small.duckdb", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:15]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
