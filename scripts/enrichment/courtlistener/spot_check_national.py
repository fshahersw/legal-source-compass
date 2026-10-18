"""Independent spot check of clb_docket_master and clb_judge_dockets against the slim tables with plain SQL (not the work aggregates).

Writes private/build/courtlistener/spot_checks_national.json.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402
import idb_codes  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
LO, HI = "DATE '1700-01-01'", "DATE '2026-09-30'"
CV = "(regexp_matches(lower(d.docket_number), '[0-9]{2}-cv-[0-9]') OR (NOT regexp_matches(lower(d.docket_number), '[0-9]{2}-[a-z]{2}-[0-9]') AND d.federal_dn_case_type = 'cv'))"


def main() -> int:
    con = duckdb.connect(":memory:")
    con.execute("PRAGMA memory_limit='3GB'")
    con.execute("PRAGMA threads=2")
    for alias, f in (("dk", "docket"), ("cl", "cluster"), ("sm", "small")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    master = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_docket_master.json")))["rows"]}
    judges = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_judge_dockets.json")))["rows"]}
    spine = json.load(open(os.path.join(ROOT, "private", "build", "fjc_idb", "lookups", "court_spine.json")))["state"]
    checks = []

    def check(what, where, mine, shown):
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(mine == shown)})

    ov = master["overview:all"]["totals"]
    check("dockets", "overview", con.execute("SELECT count(*) FROM dk.docket").fetchone()[0], ov["dockets"])
    check("dockets with an assigned judge", "overview", con.execute("SELECT count(assigned_to_id) FROM dk.docket").fetchone()[0], ov["with_assigned_judge"])
    check("dockets with nature-of-suit text", "overview", con.execute("SELECT count(*) FROM dk.docket WHERE nature_of_suit IS NOT NULL").fetchone()[0], ov["with_nature_of_suit"])
    check("dockets linked to an FJC IDB record", "overview", con.execute("SELECT count(*) FROM dk.docket WHERE idb_data_id IS NOT NULL").fetchone()[0], ov["with_fjc_record"])
    check("RECAP dockets", "overview", con.execute("SELECT count(*) FROM dk.docket WHERE source % 2 = 1").fetchone()[0], ov["recap_dockets"])
    check("opinion clusters", "overview", con.execute("SELECT count(*) FROM cl.cluster").fetchone()[0], ov["clusters"])
    check("dockets with no filing date", "overview", con.execute("SELECT count(*) FROM dk.docket WHERE date_filed IS NULL").fetchone()[0], ov["no_filing_date"])
    check("dockets with filing date outside 1700-2026-09-30", "overview", con.execute(f"SELECT count(*) FROM dk.docket WHERE date_filed IS NOT NULL AND NOT (date_filed BETWEEN {LO} AND {HI})").fetchone()[0], ov["implausible_filing_dates"])
    for y in (1950, 1990, 2005, 2015, 2024, 2026):
        row = master.get(f"year:{y}")
        if not row:
            continue
        n = con.execute(f"SELECT count(*) FROM dk.docket WHERE date_filed BETWEEN DATE '{y}-01-01' AND DATE '{y}-12-31'").fetchone()[0]
        check(f"dockets filed in {y}", f"year:{y}", n, row["dockets"])
        civ = con.execute(f"SELECT count(*) FROM dk.docket d WHERE d.date_filed BETWEEN DATE '{y}-01-01' AND DATE '{y}-12-31' AND {CV}").fetchone()[0]
        check(f"civil-numbered dockets filed in {y}", f"year:{y}", civ, row["civil"])
        ncl = con.execute(f"SELECT count(*) FROM cl.cluster k WHERE k.date_filed BETWEEN DATE '{y}-01-01' AND DATE '{y}-12-31' AND k.date_filed <= {HI}").fetchone()[0]
        check(f"opinion clusters filed in {y} (all clusters, including the few without a matching docket)", f"year:{y}", ncl, row["clusters"])
    for code in ("FD", "F", "FB", "ST", "S"):
        row = master.get(f"level:{code}")
        if not row:
            continue
        n = con.execute(f"SELECT count(*) FROM dk.docket d JOIN sm.courts c ON c.id = d.court_id WHERE c.jurisdiction = '{code}'").fetchone()[0]
        check(f"dockets in {code} courts", f"level:{code}", n, row["dockets"])
        nc = con.execute(f"SELECT count(*) FROM cl.cluster k JOIN dk.docket d ON d.id = k.docket_id JOIN sm.courts c ON c.id = d.court_id WHERE c.jurisdiction = '{code}'").fetchone()[0]
        check(f"clusters in {code} courts", f"level:{code}", nc, row["clusters"])
    for st in ("CA", "TX", "NY", "WY", "DC"):
        row = master.get(f"state:{st}")
        if not row:
            continue
        ids = [k for k, v in spine.items() if v == st]
        lst = ", ".join(f"'{i}'" for i in ids)
        n = con.execute(f"SELECT count(*) FROM dk.docket WHERE court_id IN ({lst})").fetchone()[0]
        check(f"dockets in {st} courts", f"state:{st}", n, row["dockets"])
    ct = master["casetype:all"]["case_types"]
    cvn = con.execute(
        """SELECT count(*) FROM dk.docket d WHERE coalesce(nullif(regexp_extract(lower(d.docket_number), '[0-9]{2}-([a-z]{2})-[0-9]', 1), ''), d.federal_dn_case_type) = 'cv'""").fetchone()[0]
    check("dockets with case type cv", "casetype:all", cvn, next(c["count"] for c in ct if c["value"] == "cv"))
    for code in (365, 442, 530, 190):
        row = master.get(f"nos:{code}")
        if not row:
            continue
        n = con.execute(f"SELECT count(*) FROM dk.docket WHERE regexp_matches(nature_of_suit, '^\\s*{code}(\\s|$)')").fetchone()[0]
        check(f"dockets with nature of suit {code}", f"nos:{code}", n, row["dockets"])
    for grp in ("product", "civil_rights", "prisoner"):
        row = master.get(f"group:{grp}")
        codes = [c for c, g in idb_codes.NOS_TO_GROUP.items() if g == grp]
        pat = "|".join(str(c) for c in codes)
        n = con.execute(f"SELECT count(*) FROM dk.docket WHERE regexp_matches(nature_of_suit, '^\\s*({pat})(\\s|$)')").fetchone()[0]
        check(f"dockets in nature-of-suit group {grp}", f"group:{grp}", n, row["dockets"])
    for rank in ("001", "002", "010", "100"):
        row = master.get(f"cause:{rank}")
        if row:
            n = con.execute("SELECT count(*) FROM dk.docket WHERE cause = ?", [row["cause"]]).fetchone()[0]
            check("dockets with this exact cause", f"cause:{rank}", n, row["dockets"])
    # judges
    sample = sorted((k for k in judges if judges[k]["dockets"]), key=lambda k: -judges[k]["dockets"]["assigned"])  # judges with assigned dockets (others are authorship-only)
    pick = sample[:12] + sample[len(sample) // 2 - 6: len(sample) // 2 + 6] + sample[-12:]
    for jid in pick:
        p = judges[jid]
        d = p["dockets"]
        w = f"clb_judge_dockets {jid}"
        if not d:
            continue
        n, term, first, last = con.execute(
            f"""SELECT count(*), count(CASE WHEN date_terminated BETWEEN {LO} AND {HI} THEN 1 END), min(CASE WHEN date_filed BETWEEN {LO} AND {HI} THEN year(date_filed) END),
                       max(CASE WHEN date_filed BETWEEN {LO} AND {HI} THEN year(date_filed) END) FROM dk.docket WHERE assigned_to_id = {int(jid)}""").fetchone()
        check("assigned dockets", w, n, d["assigned"])
        check("assigned dockets terminated", w, term, d["terminated"])
        check("first / last filing year", w, [first, last], [d["first_year"], d["last_year"]])
        civ = con.execute(f"SELECT count(*) FROM dk.docket d WHERE assigned_to_id = {int(jid)} AND {CV}").fetchone()[0]
        check("civil-numbered assigned dockets", w, civ, d["civil_numbered"])
        refd = con.execute(f"SELECT count(*) FROM dk.docket WHERE referred_to_id = {int(jid)}").fetchone()[0]
        check("referred dockets", w, refd, (p["referred"] or {}).get("dockets", 0))
        top = con.execute(f"SELECT court_id, count(*) c FROM dk.docket WHERE assigned_to_id = {int(jid)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1").fetchone()
        check("most frequent court (id, dockets)", w, [top[0], top[1]], [d["courts"][0]["court_id"], d["courts"][0]["dockets"]])
        med = con.execute(
            f"""SELECT median(date_diff('day', d.date_filed, d.date_terminated)), count(*) FROM dk.docket d WHERE d.assigned_to_id = {int(jid)}
                 AND d.date_filed BETWEEN {LO} AND {HI} AND d.date_terminated BETWEEN {LO} AND {HI} AND d.date_terminated >= d.date_filed AND {CV}""").fetchone()
        if med[1] >= 30:
            shown = (d["duration_civil"] or {}).get("median_days")
            check("median days to termination (civil, n >= 30)", w, round(float(med[0]), 1), shown)
        else:
            check("no duration when n < 30", w, True, d["duration_civil"] is None)
    check("every judge listed has an id present in the people table", "clb_judge_dockets", 0,
          con.execute(f"SELECT count(*) FROM (SELECT unnest([{', '.join(str(int(j)) for j in judges)}]) AS id) t WHERE CAST(id AS VARCHAR) NOT IN (SELECT id FROM sm.person)").fetchone()[0])
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks_national.json"), "w") as h:
        json.dump({"method": "plain SQL on the slim tables, independent of the work aggregates", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:20]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
