"""Build clb_appellate_timing and clb_appellate_panels from CourtListener's originating-court and panel tables.

clb_appellate_timing: appellate dockets that carry originating-court information (docket.originating_court_information_id ->
originating-court-information row, exact id). Intervals between the recorded lower-court and appellate dates; the lower court
(docket.appeal_from_id) and the lower-court judge (originating assigned_to_id, a CourtListener person id) exactly as recorded.
clb_appellate_panels: the judges CourtListener lists on the panel of each opinion cluster (search_opinioncluster_panel, exact person
ids), attributed to the court of the cluster's docket: panel sizes, the judges who sat most, the pairs who sat together most, and one
record per judge with their co-panelists. Nothing is matched by name.
"""
from __future__ import annotations

import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

TIMING = "clb_appellate_timing"
PANELS = "clb_appellate_panels"
MIN_TIMING = 100  # appeals with originating information before a court gets a timing record
MIN_PANEL_CLUSTERS = 50  # clusters with a panel before a court gets a panel record
MIN_JUDGE_PANELS = 5  # panels before a person gets a judge record
MIN_MEDIAN = 30
INTERVALS = [
    ("low_filed_to_judgment", "Lower-court case filed to lower-court judgment"),
    ("judgment_to_noa", "Lower-court judgment to notice of appeal"),
    ("noa_to_received", "Notice of appeal to receipt by the appellate court"),
    ("app_filed_to_term", "Appellate docket opened to appellate termination"),
    ("judgment_to_app_term", "Lower-court judgment to appellate termination"),
]


def grouped(con, sql, key="court_id"):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    out: dict = defaultdict(list)
    for r in cur.fetchall():
        rec = dict(zip(cols, r))
        out[rec[key]].append(rec)
    return out


def day(d):
    return str(d) if d else None


def build() -> dict:
    con = duckdb.connect(os.path.join(rc.DB, "rest_work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(rc.DB, "small.duckdb"), read_only=True)
    spine = rc.spine_ids()
    judge_ids = rc.published_ids("clb_judge_dockets")
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    persons = {int(r[0]): cc.full_name(r[1], r[2], r[3], r[4]) for r in sm.execute("SELECT id, name_first, name_middle, name_last, name_suffix FROM person").fetchall()}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def cname(cid):
        return courts.get(cid, {}).get("name", cid)

    def person(pid, extra=None):
        pid = int(pid)
        d = {"person_id": pid, "name": persons.get(pid, "Name not recorded"), "stats_record": rc.judge_record_link(pid, judge_ids)}
        d.update(extra or {})
        return d

    # ---------------- timing ----------------
    oc = {r["court_id"]: r for v in grouped(con, "SELECT * FROM r_oc_court").values() for r in v}
    ints = grouped(con, "SELECT * FROM r_oc_int")
    years = grouped(con, "SELECT * FROM r_oc_year ORDER BY court_id, yr")
    froms = grouped(con, "SELECT * FROM r_oc_from ORDER BY court_id, n DESC, from_court")
    ljudges = grouped(con, "SELECT * FROM r_oc_judge ORDER BY court_id, n DESC, pid")
    dockets = {r["court_id"]: r["dockets"] for v in grouped(con, "SELECT * FROM r_oc_dockets").values() for r in v}
    t_rows = []
    lower_judge_total: Counter = Counter()
    for cid in sorted(k for k in oc if k):
        b = oc[cid]
        n = b["n"]
        if n < MIN_TIMING:
            continue
        iv = {r["k"]: r for r in ints.get(cid, [])}
        intervals = []
        for key, label in INTERVALS:
            r = iv.get(key)
            q = rc.quantiles(r["q"]) if r and r["n"] >= MIN_MEDIAN else None
            intervals.append({"key": key, "label": label, "n": r["n"] if r else 0, "negative_set_aside": r["negative"] if r else 0, **({k: v for k, v in q.items()} if q else {})})
        series = [{"yr": int(y["yr"]), "appeals": y["n"], "terminated": y["terminated"], "median_days": cc.r1(y["p50_days"]) if y["n_dur"] >= MIN_MEDIAN else None,
                   "median_days_to_notice": cc.r1(y["p50_noa_days"]) if y["n_noa"] >= MIN_MEDIAN else None} for y in years.get(cid, []) if y["yr"] is not None]
        from_rows = [{"court_id": f["from_court"], "name": cname(f["from_court"]), "appeals": f["n"], "share_pct": cc.share(f["n"], b["with_from"]),
                      "median_days": cc.r1(f["p50_days"]) if f["n_dur"] >= MIN_MEDIAN else None, "link": rc.court_link(f["from_court"], spine)} for f in froms.get(cid, [])[:10]]
        jl = []
        for j in ljudges.get(cid, [])[:15]:
            jl.append(person(j["pid"], {"appeals": j["n"], "first_filed": day(j["first_filed"]), "last_filed": day(j["last_filed"]), "main_from_court": j["main_from"],
                                         "main_from_name": cname(j["main_from"]) if j["main_from"] else None}))
        for j in ljudges.get(cid, []):
            lower_judge_total[int(j["pid"])] += j["n"]
        main = {i["key"]: i for i in intervals}
        a2t = main["app_filed_to_term"]
        j2n = main["judgment_to_noa"]
        profile = {"court_id": cid, "name": cname(cid), "appeals": n, "court_dockets": dockets.get(cid), "appeals_pct_of_dockets": cc.share(n, dockets.get(cid) or 0),
                   "first_filed": day(b["first_filed"]), "last_filed": day(b["last_filed"]),
                   "fields": {"lower_court": b["with_from"], "lower_court_filed": b["with_low_filed"], "judgment": b["with_judgment"], "notice_of_appeal": b["with_noa"],
                              "received": b["with_received"], "appellate_filed": b["with_app_filed"], "appellate_terminated": b["with_app_term"], "lower_judge_id": b["with_judge_id"],
                              "lower_judge_name_only": b["judge_name_only"], "ordering_judge_id": b["with_ordering_id"]},
                   "intervals": intervals, "by_year": series, "from_courts": from_rows, "lower_judges": jl, "lower_judges_with_id": len(ljudges.get(cid, []))}
        sub = f"{n:,} appeals with lower-court information" + (f" · median {a2t['p50']:,.0f} days opened to terminated" if "p50" in a2t else "") + (f" · median {j2n['p50']:,.0f} days judgment to notice" if "p50" in j2n else "")
        t_rows.append(writer.record(
            TIMING, cid, f"{cname(cid)}: appeal timing and lower courts in CourtListener", source_url=rc.ORIGIN_URL, subtitle=sub,
            cells={"court": cname(cid), "appeals": n, "median_days_appellate": a2t.get("p50"), "median_days_to_notice": j2n.get("p50"),
                   "median_days_to_received": main["noa_to_received"].get("p50"), "lower_courts": len(froms.get(cid, [])), "lower_judge_pct": cc.share(b["with_judge_id"], n)},
            badges=["CourtListener bulk data", "Recorded dates only"],
            facts=rc.facts([("Court (CourtListener id)", f"{cname(cid)} ({cid})"), ("Appellate dockets with originating-court information", f"{n:,}" + (f" of {dockets[cid]:,} dockets ({cc.share(n, dockets[cid])}%)" if dockets.get(cid) else "")),
                            *[(i["label"], f"median {i['p50']:,.0f} days (middle half {i['p25']:,.0f}–{i['p75']:,.0f}), n = {i['n']:,}" + (f"; {i['negative_set_aside']:,} with the dates in reverse order set aside" if i["negative_set_aside"] else "")
                               if "p50" in i else (f"fewer than {MIN_MEDIAN} appeals with both dates ({i['n']:,})")) for i in intervals],
                            ("Lower courts most appealed from", "; ".join(f"{f['name']} ({f['appeals']:,})" for f in from_rows[:4]) or None),
                            ("Lower-court judge recorded as a person id", f"{b['with_judge_id']:,} ({cc.share(b['with_judge_id'], n)}%)"),
                            ("Counting", "Intervals use appeals with both dates recorded and the later date not before the earlier one; dates outside 1700 to 2026-09-30 are not used.")]),
            text=f"appeal timing lower court {cname(cid)} {cid}", filters={"court": [cid]},
            links=[{"label": "Originating-court information bulk file", "url": rc.ORIGIN_URL}] + ([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine else []),
            extra={"profile": profile}))
    t_rows.sort(key=lambda r: -r["item"]["cells"]["appeals"])
    t_summary = {
        "source": "CourtListener bulk data: dockets and originating-court-information (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"courts": len(t_rows), "appeals": sum(r["item"]["cells"]["appeals"] for r in t_rows), "min_appeals_for_record": MIN_TIMING},
        "definitions": {"appeal": "an appellate docket whose originating_court_information_id points at a row of the originating-court-information file",
                        "intervals": "; ".join(f"{k}: {v}" for k, v in INTERVALS) + ". Each uses appeals with both dates recorded and the later one not before the earlier; quartiles shown when n >= 30",
                        "lower court": "docket.appeal_from_id as recorded", "lower-court judge": "originating assigned_to_id, a CourtListener person id, exactly as recorded; names recorded without an id are counted, not linked"},
        "caveats": ["Only appeals CourtListener holds with originating-court information are counted; most come from RECAP appellate dockets, so coverage varies by court and year.",
                    "Dates are as recorded on the appellate docket; a missing date leaves that appeal out of the interval it would enter.",
                    "Counts describe the collection, not a court's full appellate caseload."],
        "grain": f"one record per appellate court with at least {MIN_TIMING} appeals carrying originating-court information"}

    # ---------------- panels ----------------
    pc = {r["court_id"]: r for v in grouped(con, "SELECT * FROM r_pn_court").values() for r in v}
    sizes = grouped(con, "SELECT * FROM r_pn_sizes ORDER BY court_id, size")
    pyears = grouped(con, "SELECT * FROM r_pn_year ORDER BY court_id, yr")
    pjudges = grouped(con, "SELECT * FROM r_pn_judge ORDER BY court_id, n DESC, pid")
    pairs = grouped(con, "SELECT * FROM r_pn_pair ORDER BY court_id, n DESC, p1, p2")
    pyear = grouped(con, "SELECT * FROM r_pn_person_year ORDER BY pid, yr", "pid")
    jb = {r["pid"]: r for v in grouped(con, "SELECT * FROM r_jb", "pid").values() for r in v}
    p_rows = []
    for cid in sorted(k for k in pc if k):
        b = pc[cid]
        if b["clusters"] < MIN_PANEL_CLUSTERS:
            continue
        sz = [{"size": int(s["size"]), "clusters": s["n"], "share_pct": cc.share(s["n"], b["clusters"])} for s in sizes.get(cid, [])]
        series = [{"yr": int(y["yr"]), "clusters": y["clusters"], "median_size": cc.r1(y["p50_size"]), "size4plus": y["size4plus"]} for y in pyears.get(cid, []) if y["yr"] is not None]
        top = [person(j["pid"], {"panels": j["n"], "share_pct": cc.share(j["n"], b["clusters"]), "first_filed": day(j["first_filed"]), "last_filed": day(j["last_filed"])}) for j in pjudges.get(cid, [])[:15]]
        prs = []
        for p in pairs.get(cid, [])[:15]:
            prs.append({"a": person(p["p1"]), "b": person(p["p2"]), "panels": p["n"], "first_filed": day(p["first_filed"]), "last_filed": day(p["last_filed"])})
        profile = {"court_id": cid, "name": cname(cid), "clusters_with_panel": b["clusters"], "court_clusters": b["court_clusters"], "panel_pct_of_clusters": cc.share(b["clusters"], b["court_clusters"] or 0),
                   "first_filed": day(b["first_filed"]), "last_filed": day(b["last_filed"]), "median_size": cc.r1(b["p50_size"]), "seats": b["seats"], "sizes": sz, "by_year": series,
                   "judges": top, "judges_count": len(pjudges.get(cid, [])), "pairs": prs, "pairs_count": len(pairs.get(cid, []))}
        p_rows.append(writer.record(
            PANELS, f"court:{cid}", f"{cname(cid)}: panels recorded on opinion clusters in CourtListener", source_url=rc.PANEL_URL,
            subtitle=f"{b['clusters']:,} clusters with a recorded panel · {len(pjudges.get(cid, []))} judges · median panel {cc.r1(b['p50_size'])}",
            cells={"kind": "court", "name": cname(cid), "panels": b["clusters"], "judges": len(pjudges.get(cid, [])), "median_size": cc.r1(b["p50_size"]),
                   "first_year": b["first_filed"].year if b["first_filed"] else None, "last_year": b["last_filed"].year if b["last_filed"] else None, "courts": None},
            badges=["CourtListener bulk data", "Panels as recorded"],
            facts=rc.facts([("Court (CourtListener id)", f"{cname(cid)} ({cid})"),
                            ("Opinion clusters with a recorded panel", f"{b['clusters']:,}" + (f" of {b['court_clusters']:,} clusters ({cc.share(b['clusters'], b['court_clusters'])}%)" if b["court_clusters"] else "")),
                            ("Filing dates of those clusters", f"{b['first_filed']} to {b['last_filed']}" if b["first_filed"] else None),
                            ("Panel sizes", "; ".join(f"{s['size']} judges: {s['clusters']:,}" for s in sz[:5])),
                            ("Sat on the most recorded panels", "; ".join(f"{j['name']} ({j['panels']:,})" for j in top[:5]) or None),
                            ("Sat together most often", "; ".join(f"{p['a']['name']} and {p['b']['name']} ({p['panels']:,})" for p in prs[:3]) or None),
                            ("Counting", "Panels are CourtListener's panel list on each opinion cluster (person ids); a cluster is attributed to the court of its docket.")]),
            text=f"appellate panels co-sitting {cname(cid)} {cid}", filters={"kind": ["court"], "court": [cid]},
            links=[{"label": "Cluster panel bulk file", "url": rc.PANEL_URL}] + ([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine else []),
            extra={"profile": profile}))
    p_rows.sort(key=lambda r: -r["item"]["cells"]["panels"])
    # judge records: co-panelists across courts (pairs are per court; both directions are summed per person)
    by_person = defaultdict(lambda: {"panels": 0, "courts": Counter(), "first": None, "last": None})
    for cid, lst in pjudges.items():
        for j in lst:
            d = by_person[int(j["pid"])]
            d["panels"] += j["n"]
            d["courts"][cid] += j["n"]
            d["first"] = min(x for x in (d["first"], j["first_filed"]) if x) if (d["first"] or j["first_filed"]) else None
            d["last"] = max(x for x in (d["last"], j["last_filed"]) if x) if (d["last"] or j["last_filed"]) else None
    co = defaultdict(Counter)
    for cid, lst in pairs.items():
        for p in lst:
            co[int(p["p1"])][int(p["p2"])] += p["n"]
            co[int(p["p2"])][int(p["p1"])] += p["n"]
    j_count = 0
    for pid in sorted(by_person):
        d = by_person[pid]
        if d["panels"] < MIN_JUDGE_PANELS:
            continue
        j_count += 1
        name = persons.get(pid, "Name not recorded")
        crt = [{"court_id": c, "name": cname(c), "panels": n, "link": rc.court_link(c, spine)} for c, n in sorted(d["courts"].items(), key=lambda kv: (-kv[1], str(kv[0])))[:6] if c]
        cop = [person(o, {"panels": n}) for o, n in sorted(co[pid].items(), key=lambda kv: (-kv[1], kv[0]))[:12]]
        yrs = [{"yr": int(y["yr"]), "panels": y["n"]} for y in pyear.get(pid, []) if y["yr"] is not None]
        jbr = jb.get(pid)
        profile = {"person_id": pid, "name": name, "panels": d["panels"], "first_filed": day(d["first"]), "last_filed": day(d["last"]), "courts": crt, "by_year": yrs,
                   "co_panelists": cop, "co_panelists_count": len(co[pid]), "joined_by_opinions": jbr["opinions"] if jbr else 0, "stats_record": rc.judge_record_link(pid, judge_ids)}
        links = [{"label": "CourtListener person page", "url": f"https://www.courtlistener.com/person/{pid}/"}]
        if profile["stats_record"]:
            links.insert(0, {"label": "Dockets and opinions record", "url": profile["stats_record"]})
        p_rows.append(writer.record(
            PANELS, f"judge:{pid}", f"{name}: panel service recorded on opinion clusters", source_url=rc.PANEL_URL,
            subtitle=f"{d['panels']:,} panels · {len(co[pid])} co-panelists" + (f" · mainly {crt[0]['name']}" if crt else ""),
            cells={"kind": "judge", "name": name, "panels": d["panels"], "judges": len(co[pid]), "median_size": None,
                   "first_year": d["first"].year if d["first"] else None, "last_year": d["last"].year if d["last"] else None, "courts": len(d["courts"])},
            badges=["CourtListener bulk data", "Panels as recorded"],
            facts=rc.facts([("Judge (CourtListener person id)", f"{name} ({pid})"), ("Recorded panels", f"{d['panels']:,}"),
                            ("Courts", "; ".join(f"{c['name']} ({c['panels']:,})" for c in crt) or None),
                            ("Sat most often with", "; ".join(f"{c['name']} ({c['panels']:,})" for c in cop[:5]) or None),
                            ("Opinions this person is recorded as joining", f"{jbr['opinions']:,}" if jbr else "0 (the joined-by table is sparse)")]),
            text=f"panel service co-panelists {name} {pid}", filters={"kind": ["judge"], "court": [crt[0]["court_id"]] if crt else ["unknown"]}, links=links, extra={"profile": profile}))
    p_summary = {
        "source": "CourtListener bulk data: search_opinioncluster_panel, search_opinion_joined_by, opinion clusters, dockets, people (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"panel_rows": con.execute("SELECT count(*) FROM r_pn_base").fetchone()[0], "clusters_with_panel": con.execute("SELECT count(*) FROM r_pn_size").fetchone()[0],
                   "courts": sum(1 for r in p_rows if r["id"].startswith("court:")), "judges": j_count, "joined_by_rows": con.execute("SELECT sum(n) FROM r_jb").fetchone()[0]},
        "definitions": {"panel": "the person ids CourtListener lists on an opinion cluster's panel", "co-sitting": "two people listed on the same cluster's panel; counts are clusters",
                        "court": "court of the cluster's docket", "judge records": f"people on at least {MIN_JUDGE_PANELS} recorded panels"},
        "caveats": ["Panels are recorded for a minority of clusters, mostly federal appellate opinions; a cluster without a panel list says nothing about who sat.",
                    "Counts are opinion clusters, not oral arguments or cases heard.", "The joined-by table holds only about a thousand rows and is reported, not analysed."],
        "grain": f"one record per court with at least {MIN_PANEL_CLUSTERS} clusters carrying a panel, and one per judge with at least {MIN_JUDGE_PANELS} panels"}
    t_inputs = [{"url": u, "path": "slim tables in private/acq/courtlistener/db", "sha256": None} for u in (rc.ORIGIN_URL, rc.DOCKETS_URL, rc.COURTS_URL, rc.PEOPLE_URL)]
    p_inputs = [{"url": u, "path": "slim tables in private/acq/courtlistener/db", "sha256": None} for u in (rc.PANEL_URL, rc.JOINED_URL, rc.CLUSTERS_URL, rc.DOCKETS_URL, rc.PEOPLE_URL)]
    return {
        TIMING: {"dataset": TIMING, "label": "Appeal timing, lower courts and lower-court judges from CourtListener's originating-court information (Sept 30, 2026)",
                 "listing_block": writer.listing([("court", "Court"), ("appeals", "Appeals"), ("median_days_appellate", "Median days opened to terminated"), ("median_days_to_notice", "Median days judgment to notice"),
                                                  ("median_days_to_received", "Median days notice to receipt"), ("lower_courts", "Lower courts"), ("lower_judge_pct", "Lower-court judge id %")], []),
                 "summary": t_summary, "rows": t_rows, "built_at": built_at, "inputs": t_inputs},
        PANELS: {"dataset": PANELS, "label": "Appellate panels and co-sitting judges recorded on CourtListener opinion clusters (Sept 30, 2026)",
                 "listing_block": writer.listing([("kind", "Type"), ("name", "Name"), ("panels", "Panels"), ("judges", "Judges or co-panelists"), ("median_size", "Median panel size"),
                                                  ("first_year", "First year"), ("last_year", "Last year"), ("courts", "Courts")], [("kind", "Type", {"court": "Court", "judge": "Judge"})]),
                 "summary": p_summary, "rows": p_rows, "built_at": built_at, "inputs": p_inputs},
    }


if __name__ == "__main__":
    rc.write(build())
