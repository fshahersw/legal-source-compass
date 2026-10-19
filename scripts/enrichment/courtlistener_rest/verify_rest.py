"""Independent verification of the courtlistener_rest datasets, written separately from the builders.

Second path: plain row fetches from the slim tables (not the rest_work aggregates) and Python arithmetic (statistics.median, Counter),
compared with what each build file displays. Also integrity checks over every row: link shapes, ids, and the disclosure attribution
rule (no listed item may come from a report that fails the surname check or from a person marked as a conflict).

    python3 -I -B verify_rest.py            -> private/build/courtlistener_rest/verify_rest.json, exit 1 on any mismatch
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import duckdb  # noqa: E402

LO, HI = dt.date(1700, 1, 1), dt.date(2026, 9, 30)
LINK_OK = re.compile(r"^(/courts/[A-Za-z0-9]{2,24}|/records/[a-z0-9_]+/[A-Za-z0-9:._-]+|https://(www\.courtlistener\.com|storage\.courtlistener\.com|com-courtlistener-storage\.s3-us-west-2\.amazonaws\.com)/.+)$")
checks: list[dict] = []


def check(ds, fig, where, mine, shown):
    if isinstance(mine, float) or isinstance(shown, float):
        ok = mine is not None and shown is not None and abs(float(mine) - float(shown)) <= 0.051
    else:
        ok = mine == shown
    checks.append({"dataset": ds, "figure": fig, "where": where, "recomputed": mine, "displayed": shown, "match": bool(ok)})


def load(ds):
    return {r["id"]: r for r in rc.read_build(ds)["rows"]}


def ok_date(d):
    return d if d is not None and LO <= d <= HI else None


def links_ok(ds, rows):
    bad = 0
    for rid, r in rows.items():
        for l in r["item"]["links"]:
            if not LINK_OK.match(l["url"]):
                bad += 1
        if r["dataset"] != ds or r["id"] != rid or not r["source_url"].startswith("https://"):
            bad += 1
    check(ds, "malformed links or ids", "all rows", 0, bad)


def oral(db):
    rows = load("clb_oral_arguments")
    links_ok("clb_oral_arguments", rows)
    data = db.execute("SELECT d.court_id, o.duration, o.has_transcript, o.judges, d.date_argued FROM oa.oral_argument o JOIN dk.docket d ON d.id = o.docket_id").fetchall()
    by = defaultdict(list)
    for r in data:
        by[r[0]].append(r)
    for cid in ("ca9", "cafc", "illappct", "scotus", "ca1", "cadc"):
        p = rows[cid]["item"]["profile"]
        lst = by[cid]
        check("clb_oral_arguments", "recordings", cid, len(lst), p["recordings"])
        secs = [r[1] for r in lst if r[1] and r[1] > 0]
        check("clb_oral_arguments", "median minutes", cid, round(statistics.median(secs) / 60.0, 1), p["duration_minutes"]["p50"])
        check("clb_oral_arguments", "with transcript", cid, sum(1 for r in lst if r[2]), p["with_transcript"])
        yrs = Counter(r[4].year for r in lst if ok_date(r[4]))
        for y in (2010, 2019, 2024):
            shown = next((x["recordings"] for x in p["by_year"] if x["yr"] == y), 0)
            check("clb_oral_arguments", f"recordings argued {y}", cid, yrs.get(y, 0), shown)
        names = Counter()
        for r in lst:
            for nm in rc.split_names(r[3]):
                names[nm.lower()] += 1
        for x in p["names"][:3]:
            check("clb_oral_arguments", f"named {x['name']}", cid, names[x["name"].lower()], x["recordings"])


def appellate(db):
    rows = load("clb_appellate_timing")
    links_ok("clb_appellate_timing", rows)
    data = db.execute("""SELECT d.court_id, d.appeal_from_id, d.date_filed, d.date_terminated, o.date_judgment, o.date_filed_noa, o.date_received_coa, o.assigned_to_id
                         FROM dk.docket d JOIN sm.originating_court o ON TRY_CAST(o.id AS BIGINT) = d.originating_court_information_id
                         WHERE d.court_id IN ('ca9', 'ca2', 'ca5', 'cadc', 'ca11', 'texapp')""").fetchall()
    by = defaultdict(list)
    for r in data:
        by[r[0]].append(r)

    def pd(s):
        try:
            return ok_date(dt.date.fromisoformat(str(s)[:10])) if s else None
        except ValueError:
            return None

    for cid in ("ca9", "ca2", "ca5", "cadc", "ca11"):
        if cid not in rows:
            continue
        p = rows[cid]["item"]["profile"]
        lst = by[cid]
        check("clb_appellate_timing", "appeals", cid, len(lst), p["appeals"])
        iv = {i["key"]: i for i in p["intervals"]}
        pairs = {"judgment_to_noa": [(pd(r[4]), pd(r[5])) for r in lst], "noa_to_received": [(pd(r[5]), pd(r[6])) for r in lst],
                 "app_filed_to_term": [(ok_date(r[2]), ok_date(r[3])) for r in lst]}
        for k, prs in pairs.items():
            days = [(b - a).days for a, b in prs if rc.interval_ok(a, b)]
            check("clb_appellate_timing", f"{k} n", cid, len(days), iv[k]["n"])
            if "p50" in iv[k]:
                check("clb_appellate_timing", f"{k} median", cid, float(statistics.median(days)), iv[k]["p50"])
        fr = Counter(r[1] for r in lst if r[1])
        if p["from_courts"]:
            top = p["from_courts"][0]
            check("clb_appellate_timing", f"appeals from {top['court_id']}", cid, fr[top["court_id"]], top["appeals"])
        jd = Counter(int(r[7]) for r in lst if r[7] and str(r[7]).isdigit())
        for j in p["lower_judges"][:2]:
            check("clb_appellate_timing", f"appeals from judge {j['person_id']}", cid, jd[j["person_id"]], j["appeals"])

    prows = load("clb_appellate_panels")
    links_ok("clb_appellate_panels", prows)
    panel = db.execute("""SELECT DISTINCT TRY_CAST(p.opinioncluster_id AS BIGINT), TRY_CAST(p.person_id AS BIGINT), d.court_id
                          FROM sm.cluster_panel p JOIN cl.cluster c ON c.id = TRY_CAST(p.opinioncluster_id AS BIGINT) JOIN dk.docket d ON d.id = c.docket_id""").fetchall()
    members = defaultdict(set)
    court_of = {}
    for cid_, pid, court in panel:
        members[cid_].add(pid)
        court_of[cid_] = court
    per_court = defaultdict(list)
    for k, v in members.items():
        per_court[court_of[k]].append(v)
    person_total = Counter(p for v in members.values() for p in v)
    for rid in [r for r in prows if r.startswith("court:")][:6]:
        court = rid.split(":", 1)[1]
        p = prows[rid]["item"]["profile"]
        sets = per_court[court]
        check("clb_appellate_panels", "clusters with panel", rid, len(sets), p["clusters_with_panel"])
        check("clb_appellate_panels", "median size", rid, float(statistics.median(len(s) for s in sets)), p["median_size"])
        sat = Counter(x for s in sets for x in s)
        j = p["judges"][0]
        check("clb_appellate_panels", f"panels of {j['person_id']}", rid, sat[j["person_id"]], j["panels"])
        if p["pairs"]:
            pr = p["pairs"][0]
            a, b = pr["a"]["person_id"], pr["b"]["person_id"]
            check("clb_appellate_panels", f"pair {a}-{b}", rid, sum(1 for s in sets if a in s and b in s), pr["panels"])
    for rid in [r for r in prows if r.startswith("judge:")][:10]:
        pid = int(rid.split(":", 1)[1])
        check("clb_appellate_panels", "panels", rid, person_total[pid], prows[rid]["item"]["profile"]["panels"])


def disclosures(db):
    rows = load("clb_judge_disclosures")
    links_ok("clb_judge_disclosures", rows)
    rep = Counter(int(r[0]) for r in db.execute("SELECT person_id FROM sm.fd").fetchall())
    gifts = Counter(int(r[0]) for r in db.execute("SELECT f.person_id FROM sm.fd_gift g JOIN sm.fd f ON f.id = g.financial_disclosure_id").fetchall())
    reimb = Counter(int(r[0]) for r in db.execute("SELECT f.person_id FROM sm.fd_reimbursement g JOIN sm.fd f ON f.id = g.financial_disclosure_id").fetchall())
    inv = Counter(int(r[0]) for r in db.execute("SELECT f.person_id FROM sm.fd_investment g JOIN sm.fd f ON f.id = g.financial_disclosure_id").fetchall())
    check("clb_judge_disclosures", "people", "all", len(rep), len(rows))
    for rid in list(rows)[:25] + ["1780", "1652", "2330"]:
        if rid not in rows:
            continue
        p = rows[rid]["item"]["profile"]
        pid = int(rid)
        check("clb_judge_disclosures", "reports", rid, rep[pid], p["reports"])
        check("clb_judge_disclosures", "gifts", rid, gifts[pid], p["items_total"]["gifts"])
        check("clb_judge_disclosures", "reimbursements", rid, reimb[pid], p["items_total"]["reimbursements"])
        check("clb_judge_disclosures", "investments", rid, inv[pid], p["items_total"]["investments"])
    # attribution rule over every row: listed items only from 'match' reports, none for conflicts, and listed + withheld = total
    viol = 0
    for rid, r in rows.items():
        p = r["item"]["profile"]
        good = {x["id"] for x in p["report_list"] if x["file_check"] == "match"}
        conflict = p["attribution"]["status"] == "conflict"
        for k in ("gifts", "agreements", "reimbursements"):
            for it in p[k]:
                if conflict or it["report_id"] not in good:
                    viol += 1
        for k in ("gifts", "agreements"):
            if len(p[k]) + p["items_withheld"][k] != p["items_total"][k]:
                viol += 1
        if p["reimbursements_listed"] + p["items_withheld"]["reimbursements"] > p["items_total"]["reimbursements"]:
            viol += 1
        for x in p["report_list"]:
            if x["pdf"] and not x["pdf"].startswith(f"https://storage.courtlistener.com/us/federal/judicial/financial-disclosures/{rid}/"):
                viol += 1
            # a report-type tag from the file name (SR, SPE, SIA...) is never shown as part of the filer's court code
            if x["filer_code"] and x["filer_code"].split()[-1] in {"SR", "SPE", "SIA", "RES", "RESP", "FIN"}:
                viol += 1
    check("clb_judge_disclosures", "attribution-rule violations", "all rows", 0, viol)
    check("clb_judge_disclosures", "person 1780 marked as conflict (reports of two circuits)", "1780", "conflict", rows["1780"]["item"]["profile"]["attribution"]["status"])


def parentheticals(db):
    rows = load("clb_top_cited_parentheticals")
    links_ok("clb_top_cited_parentheticals", rows)
    # second path: the first stream's full parenthetical table (no text) joined to opinion ids of each cluster
    got = dict(db.execute("""SELECT o.cluster_id, count(*) FROM pr.parenthetical p JOIN op.opinion o ON o.id = p.described_opinion_id
                             WHERE o.cluster_id IN (SELECT cid FROM wk.w_cl_top_national) GROUP BY 1""").fetchall())
    bad = 0
    for rid, r in rows.items():
        cid = int(rid.split(":", 1)[1])
        if got.get(cid, 0) != r["item"]["profile"]["parentheticals"]:
            bad += 1
            if bad <= 5:
                check("clb_top_cited_parentheticals", "parentheticals", rid, got.get(cid, 0), r["item"]["profile"]["parentheticals"])
    check("clb_top_cited_parentheticals", "clusters whose count differs from the full parenthetical table", "all 1000", 0, bad)
    texts = dict(db.execute("SELECT id, text FROM pt.paren_top").fetchall())
    tb = 0
    for r in rows.values():
        ex = r["item"]["profile"]["examples"]
        if [e["score"] for e in ex] != sorted([e["score"] for e in ex], reverse=True):
            tb += 1
        if len({e["group_id"] for e in ex}) != len(ex):
            tb += 1
        for e in ex:
            full = " ".join((texts.get(e["parenthetical_id"]) or "").split())
            if not (full == e["text"] or (e["truncated"] and full.startswith(e["text"].rstrip("…").rstrip()))):
                tb += 1
    check("clb_top_cited_parentheticals", "examples not verbatim, not ordered or repeating a group", "all rows", 0, tb)


def unmatched_courts(db):
    rows = load("clb_unmatched_citations")
    links_ok("clb_unmatched_citations", rows)
    for rid in [r for r in rows if r.startswith("court:")][:6]:
        court = rid.split(":", 1)[1]
        p = rows[rid]["item"]["profile"]
        n, ops = db.execute(f"""SELECT count(*), count(DISTINCT u.citing_opinion_id) FROM um.unmatched_citation u
                                WHERE u.citing_opinion_id IN (SELECT oid FROM wk.w_op WHERE court_id = '{court}')""").fetchone()
        check("clb_unmatched_citations", "citations", rid, n, p["citations"])
        check("clb_unmatched_citations", "citing opinions", rid, ops, p["citing_opinions"])


def bankruptcy_docket(db):
    rows = load("clb_bankruptcy_courts")
    links_ok("clb_bankruptcy_courts", rows)
    for cid in ("cacb", "nysb", "deb", "txsb"):
        if cid not in rows:
            continue
        p = rows[cid]["item"]["profile"]
        n = db.execute(f"SELECT count(*) FROM dk.docket WHERE id IN (SELECT id FROM bk.bankruptcy WHERE court_id = '{cid}')").fetchone()[0]
        check("clb_bankruptcy_courts", "same id in 2026 docket file", cid, n, p["in_2026_docket_file"]["in_docket_file"])
        ap = db.execute(f"SELECT count(*) FROM bk.bankruptcy WHERE court_id = '{cid}' AND dn_type = 'ap'").fetchone()[0]
        check("clb_bankruptcy_courts", "adversary proceedings", cid, ap, next((t["dockets"] for t in p["case_types"] if t["code"] == "ap"), 0))


def schema():
    rows = load("clb_bulk_schema")
    for table, done in (("citations_unmatchedcitation", "unmatched_citation"), ("search_parenthetical", "parenthetical")):
        d = json.load(open(os.path.join(rc.DB, done + ".done.json")))
        check("clb_bulk_schema", "rows loaded", table, d["rows"], rows[f"table:{table}"]["item"]["cells"]["rows_loaded"])


def main() -> int:
    db = duckdb.connect()
    db.execute("PRAGMA threads=3")
    for alias, f in (("oa", "oral_argument"), ("dk", "docket"), ("sm", "small"), ("cl", "cluster"), ("pr", "parenthetical"), ("op", "opinion"),
                     ("wk", "work"), ("pt", "paren_top"), ("um", "unmatched_citation"), ("bk", "bankruptcy")):
        db.execute(f"ATTACH '{os.path.join(rc.DB, f + '.duckdb')}' AS {alias} (READ_ONLY)")
    for step in (oral, appellate, disclosures, parentheticals, unmatched_courts, bankruptcy_docket):
        step(db)
        print(step.__name__, "done", flush=True)
    schema()
    bad = [c for c in checks if not c["match"]]
    by_ds = Counter(c["dataset"] for c in checks)
    bad_ds = Counter(c["dataset"] for c in bad)
    with open(os.path.join(rc.OUT, "verify_rest.json"), "w") as h:
        json.dump({"method": "second path over slim tables and Python arithmetic; integrity rules over all rows", "checks": len(checks), "mismatches": len(bad),
                   "by_dataset": {k: {"checks": v, "mismatches": bad_ds.get(k, 0)} for k, v in by_ds.items()}, "details": checks}, h, indent=1, default=str)
    print(len(checks), "checks;", len(bad), "mismatches", dict(bad_ds))
    for c in bad[:30]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
