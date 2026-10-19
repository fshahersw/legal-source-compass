"""Build mdl_hierarchy, judge_flows and mdl_state_scope from the matter registry's member dockets and CourtListener's docket table.

Inputs (read-only): private/build/matter_xanalysis/lookups/sw_matter_dockets.jsonl (extract_dockets.mjs: every record of
sw_matter_dockets_v1 with its evidence basis and CourtListener docket id), sw_matters_v1.json and mdls.json (dump_dataset.mjs),
state_metrics_profiles.json, fjc_civil_states.json, cfpb_complaints_states.json; CourtListener slim tables docket.duckdb and
small.duckdb (snapshot 2026-09-30); court ids and states from private/build/court_locations/lookups/cl_courts.json.

Membership is only what sw_matter_dockets_v1 records, with its evidence. CourtListener rows join only by the docket id the record
carries, and only when CourtListener's court equals the record's court. Originating dockets are the transferor dockets (JPML
schedules and conditional transfer orders) and the FJC-recorded dockets of the same MDL in a court other than the transferee court;
they show where cases started before transfer, not where every plaintiff lives (most member cases are filed directly in the
transferee court and carry no origin here).

    python3 -I -B scripts/enrichment/matter_xanalysis/build_matter_xanalysis.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import xstats  # noqa: E402

LOOK = os.path.join(ROOT, "private", "build", "matter_xanalysis", "lookups")
OUT = os.path.join(ROOT, "private", "build", "matter_xanalysis")
DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
SRC = "https://www.courtlistener.com/"
BASIS_GROUPS = [
    ("fjc_idb", "Historical administrative (FJC IDB"), ("transferee_table", "Transferee court MDL page"), ("jpml_schedule", "JPML order, Schedule A"),
    ("jpml_cto", "JPML conditional transfer order"), ("docketbird", "Provider-reported (DocketBird)"), ("party_list", "Master docket party list"),
    ("firm_crosswalk", "Firm dataset crosswalk"),
]
BASIS_LABEL = {"fjc_idb": "FJC IDB (historical association)", "transferee_table": "Transferee court member-case table", "jpml_schedule": "JPML order, Schedule A",
               "jpml_cto": "JPML conditional transfer order", "docketbird": "DocketBird (provider-reported)", "party_list": "Master docket party list",
               "firm_crosswalk": "Firm dataset crosswalk"}


def load(name):
    with open(os.path.join(LOOK, name)) as h:
        return json.load(h)


def day(s):
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def person_name(row):
    first, middle, last, suffix = row
    s = " ".join(x for x in (first, middle, last) if x)
    return f"{s}, {cc.SUFFIX_LABEL.get(suffix, suffix)}" if suffix and cc.SUFFIX_LABEL.get(suffix, suffix) else s


def main():
    t0 = time.time()
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = [json.loads(l) for l in open(os.path.join(LOOK, "sw_matter_dockets.jsonl"))]
    courts = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "private", "build", "court_locations", "lookups", "cl_courts.json")))["rows"]}
    court_state = {cid: c["states"][0] for cid, c in courts.items() if c["jurisdiction"] in ("FD", "FB") and c["states"] and len(c["states"]) == 1}
    fi = os.path.join(ROOT, "private", "build", "firm_intel", "lookups")
    matters = {str(r["cells"]["mdl_number"]): {"c": {**r["cells"], "title": r["title"]}} for r in json.load(open(os.path.join(fi, "sw_matters.json")))["rows"]}
    mdl_meta = {str(r["mdl_number"]): {"c": r} for r in json.load(open(os.path.join(fi, "mdls.json")))["rows"]}
    judge_records = {str(r["id"]) for r in json.load(open(os.path.join(ROOT, "private", "build", "courtlistener", "clb_judge_dockets.json")))["rows"]}

    # ---- exact CourtListener join by docket id
    con = duckdb.connect(os.path.join(DB, "docket.duckdb"), read_only=True)
    con.execute("SET memory_limit='3GB'; SET threads=2")
    ids = sorted({r["cl_docket_id"] for r in rows if r.get("cl_docket_id")})
    con.execute("CREATE TEMP TABLE want(id BIGINT)")
    con.executemany("INSERT INTO want VALUES (?)", [(i,) for i in ids])
    cl = {r[0]: {"court_id": r[1], "assigned": str(r[2]) if r[2] is not None else None, "referred": str(r[3]) if r[3] is not None else None,
                 "filed": r[4], "terminated": r[5]}
          for r in con.execute("SELECT d.id, d.court_id, d.assigned_to_id, d.referred_to_id, d.date_filed, d.date_terminated FROM docket d JOIN want w ON d.id = w.id").fetchall()}
    collection = dict(con.execute("SELECT court_id, count(*) FROM docket GROUP BY court_id").fetchall())
    con.close()
    join_stats = Counter()
    for r in rows:
        c = cl.get(r.get("cl_docket_id"))
        if not r.get("cl_docket_id"):
            join_stats["no CourtListener docket id on the record"] += 1
            r["_cl"] = None
        elif not c:
            join_stats["docket id not in the bulk snapshot"] += 1
            r["_cl"] = None
        elif c["court_id"] != r["court_id"]:
            join_stats["CourtListener court differs from the record (join refused)"] += 1
            r["_cl"] = None
        else:
            join_stats["joined"] += 1
            r["_cl"] = c
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    pids = sorted({p for r in rows if r["_cl"] for p in (r["_cl"]["assigned"], r["_cl"]["referred"]) if p})
    names = {}
    for i in range(0, len(pids), 500):
        chunk = pids[i: i + 500]
        q = "SELECT id, name_first, name_middle, name_last, name_suffix FROM person WHERE id IN (" + ",".join("?" * len(chunk)) + ")"
        for pid, *n in sm.execute(q, chunk).fetchall():
            names[str(pid)] = person_name(n)
    sm.close()

    def judge(pid):
        if not pid:
            return None
        return {"person_id": int(pid), "name": names.get(pid) or f"CourtListener person {pid}",
                "link": f"/records/clb_judge_dockets/{pid}" if pid in judge_records else None}

    by_mdl = defaultdict(list)
    for r in rows:
        by_mdl[r["mdl"]].append(r)
    masters = {}
    for m, lst in by_mdl.items():
        ms = sorted((r for r in lst if r["role"] == "master"), key=lambda r: r["id"])
        masters[m] = ms[0] if ms else None

    def is_origin(r):
        mst = masters.get(r["mdl"])
        if not mst or r["court_id"] == mst["court_id"]:
            return False
        return r["role"] == "transferor" or (r["role"] == "associated_unspecified" and "FJC IDB" in (r.get("basis") or ""))

    # ---- hierarchy
    rows_h = []
    origin_all = []
    flows = Counter()
    flow_mdls = defaultdict(set)
    transferee_judges = defaultdict(lambda: {"mdls": set(), "members": 0})
    for m in sorted(by_mdl, key=lambda x: int(x)):
        lst = by_mdl[m]
        mst = masters[m]
        tcourt = mst["court_id"] if mst else None
        tjudge = judge(mst["_cl"]["assigned"]) if mst and mst["_cl"] else None
        actions = [r for r in lst if r.get("counts_as_action")]
        basis = Counter()
        for r in actions:
            for key, token in BASIS_GROUPS:
                if token in (r.get("basis") or ""):
                    basis[key] += 1
        members_year = Counter(r["filed"][:4] for r in actions if r.get("filed") and r["court_id"] == tcourt)
        origin = [r for r in lst if is_origin(r)]
        origin_all.extend(origin)
        o_courts = Counter(r["court_id"] for r in origin)
        o_states = Counter(court_state[r["court_id"]] for r in origin if r["court_id"] in court_state)
        to_transfer = [(day(r.get("terminated")) - day(r.get("filed"))).days for r in origin
                       if day(r.get("terminated")) and day(r.get("filed")) and day(r.get("terminated")) >= day(r.get("filed"))]
        member_judges = Counter(r["_cl"]["assigned"] for r in actions if r["_cl"] and r["court_id"] == tcourt and r["_cl"]["assigned"])
        member_joined = sum(1 for r in actions if r["_cl"] and r["court_id"] == tcourt)
        if tjudge:
            transferee_judges[tjudge["person_id"]]["mdls"].add(int(m))
            transferee_judges[tjudge["person_id"]]["members"] += len(actions)
            transferee_judges[tjudge["person_id"]]["judge"] = tjudge
        for r in origin:
            if r["_cl"] and r["_cl"]["assigned"] and tjudge:
                key = (r["_cl"]["assigned"], str(tjudge["person_id"]))
                flows[key] += 1
                flow_mdls[key].add(int(m))
        mt = (matters.get(m) or {}).get("c", {})
        meta = (mdl_meta.get(m) or {}).get("c", {})
        jpml_total = mt.get("jpml_total")
        prof = {
            "mdl": int(m), "title": mt.get("title") or meta.get("title"), "transferee_court": tcourt,
            "transferee_court_name": courts.get(tcourt, {}).get("full_name") if tcourt else None,
            "master_docket": {"docket_number": mst["docket_number"], "cl_docket_id": mst.get("cl_docket_id")} if mst else None,
            "transferee_judge": tjudge, "judge_as_printed": mt.get("judge_as_printed"),
            "records": len(lst), "actions": len(actions), "jpml_total": jpml_total, "jpml_pending": mt.get("jpml_pending"),
            "registry_share_of_jpml_pct": cc.share(len(actions), jpml_total) if isinstance(jpml_total, int) and jpml_total else None,
            "by_basis": [{"basis": k, "label": BASIS_LABEL[k], "actions": basis.get(k, 0)} for k, _ in BASIS_GROUPS if basis.get(k)],
            "roles": dict(Counter(r["role"] for r in lst)),
            "members_by_year": [{"year": int(y), "actions": n} for y, n in sorted(members_year.items()) if y.isdigit()],
            "origin": {"dockets": len(origin), "courts": len(o_courts), "states": len(o_states),
                       "median_days_to_close_in_origin": statistics.median(to_transfer) if to_transfer else None, "n_days": len(to_transfer),
                       "by_court": [{"court_id": c, "court": courts.get(c, {}).get("short_name") or c, "state": court_state.get(c), "dockets": n,
                                     "link": f"/courts/{c}" if c in courts else None} for c, n in o_courts.most_common(25)],
                       "by_state": [{"state": s, "dockets": n} for s, n in o_states.most_common()],
                       "by_year": [{"year": int(y), "dockets": n} for y, n in sorted(Counter(r["filed"][:4] for r in origin if r.get("filed")).items()) if y.isdigit()]},
            "member_judges": {"joined": member_joined, "top": [{**judge(p), "dockets": n, "share_pct": cc.share(n, member_joined)} for p, n in member_judges.most_common(8)]},
        }
        rows_h.append(writer.record(
            "mdl_hierarchy", f"mdl:{m}", f"MDL {m}: master docket, member actions and where cases started", source_url=SRC,
            subtitle=f"{len(actions):,} member actions in the registry" + (f" of {jpml_total:,} reported by the JPML" if isinstance(jpml_total, int) else "")
                     + f" · {len(origin):,} originating dockets in {len(o_courts)} courts",
            cells={"kind": "mdl", "mdl": int(m), "title": prof["title"], "transferee_court": tcourt, "actions": len(actions), "jpml_total": jpml_total,
                   "registry_share_pct": prof["registry_share_of_jpml_pct"], "origin_dockets": len(origin), "origin_courts": len(o_courts),
                   "origin_states": len(o_states), "transferee_judge": tjudge["name"] if tjudge else None},
            badges=["Matter registry", "CourtListener"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("MDL", f"{m} · {prof['title']}"), ("Transferee court", prof["transferee_court_name"]),
                ("Master docket", mst["docket_number"] if mst else None),
                ("Transferee judge (CourtListener, master docket assignment)", tjudge["name"] if tjudge else None),
                ("Member actions in the registry / JPML total", f"{len(actions):,} / {jpml_total:,}" if isinstance(jpml_total, int) else f"{len(actions):,}"),
                ("Evidence for membership", "; ".join(f"{BASIS_LABEL[k]} {basis[k]:,}" for k, _ in BASIS_GROUPS if basis.get(k))),
                ("Originating dockets (transfer schedules and FJC records in other courts)", f"{len(origin):,} in {len(o_courts)} courts, {len(o_states)} states"),
                ("Median days from filing to closing in the originating court", f"{prof['origin']['median_days_to_close_in_origin']:.0f} (n {len(to_transfer)})" if to_transfer else None),
                ("Reading", "Most member cases are filed directly in the transferee court and carry no originating court here; origin counts cover cases filed elsewhere first.")]],
            text=f"mdl {m} hierarchy {prof['title']}", filters={"kind": ["mdl"]},
            links=[x for x in ({"label": "Matter", "url": f"/records/sw_matters_v1/sw-matter:{m}"} if m in matters else None,
                               {"label": "Transferee court", "url": f"/courts/{tcourt}"} if tcourt in courts else None) if x],
            extra={"profile": prof}))

    # ---- originating courts
    by_court = defaultdict(list)
    for r in origin_all:
        by_court[r["court_id"]].append(r)
    for c, lst in sorted(by_court.items(), key=lambda kv: -len(kv[1])):
        mdls_c = Counter(r["mdl"] for r in lst)
        judges_c = Counter(r["_cl"]["assigned"] for r in lst if r["_cl"] and r["_cl"]["assigned"])
        coll = collection.get(c)
        rows_h.append(writer.record(
            "mdl_hierarchy", f"court:{c}", f"{courts.get(c, {}).get('full_name', c)}: cases that started here and went to an MDL", source_url=SRC,
            subtitle=f"{len(lst):,} originating dockets in {len(mdls_c)} MDLs",
            cells={"kind": "court", "court_id": c, "title": courts.get(c, {}).get("full_name", c), "state": court_state.get(c), "origin_dockets": len(lst), "mdls": len(mdls_c)},
            badges=["Matter registry", "CourtListener"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("Court", courts.get(c, {}).get("full_name", c)), ("Originating dockets", f"{len(lst):,}"), ("MDLs", ", ".join(f"{m} ({n})" for m, n in mdls_c.most_common(10))),
                ("Dockets of this court in CourtListener's collection", f"{coll:,}" if coll else None),
                ("Reading", "Counts dockets the registry ties to an MDL by a JPML transfer schedule or an FJC record, in a court other than the transferee court.")]],
            text=f"court {c} mdl originating", filters={"kind": ["court"]},
            links=[{"label": "Court page", "url": f"/courts/{c}"}] if c in courts else [],
            extra={"profile": {"court_id": c, "court": courts.get(c, {}).get("full_name", c), "state": court_state.get(c), "origin_dockets": len(lst),
                               "mdls": [{"mdl": int(m), "dockets": n} for m, n in mdls_c.most_common()],
                               "judges": [{**judge(p), "dockets": n} for p, n in judges_c.most_common(10)], "collection_dockets": coll}}))
    total_actions = sum(1 for r in rows if r.get("counts_as_action"))
    rows_h.append(writer.record(
        "mdl_hierarchy", "overview:all", "MDL hierarchy across the matter registry", source_url=SRC,
        subtitle=f"{len(by_mdl)} MDLs · {total_actions:,} member actions · {len(origin_all):,} originating dockets in {len(by_court)} courts",
        cells={"kind": "overview", "mdls": len(by_mdl), "actions": total_actions, "origin_dockets": len(origin_all), "origin_courts": len(by_court)},
        badges=["Matter registry"],
        facts=[[k, str(v)] for k, v in [("Records", f"{len(rows):,}"), ("Member actions", f"{total_actions:,}"),
                                        ("Originating dockets", f"{len(origin_all):,} in {len(by_court)} courts"),
                                        ("CourtListener join", "; ".join(f"{k}: {v:,}" for k, v in join_stats.most_common()))]],
        text="mdl hierarchy overview", filters={"kind": ["overview"]}, links=[],
        extra={"profile": {"mdls": len(by_mdl), "records": len(rows), "actions": total_actions, "origin_dockets": len(origin_all), "origin_courts": len(by_court),
                           "join": dict(join_stats), "roles": dict(Counter(r["role"] for r in rows))}}))

    # ---- judge flows
    rows_j = []
    for (a, b), n in sorted(flows.items(), key=lambda kv: (-kv[1], kv[0])):
        ja, jb = judge(a), judge(b)
        ms = sorted(flow_mdls[(a, b)])
        rows_j.append(writer.record(
            "judge_flows", f"edge:{a}~{b}", f"{ja['name']} to {jb['name']}: cases transferred into an MDL", source_url=SRC,
            subtitle=f"{n:,} originating docket{'s' if n != 1 else ''} · MDL {', '.join(map(str, ms))}",
            cells={"kind": "edge", "from": ja["name"], "to": jb["name"], "dockets": n, "mdls": len(ms)},
            badges=["CourtListener", "Exact person ids"],
            facts=[["Originating judge (assigned in the originating court)", ja["name"]], ["Transferee judge (master docket)", jb["name"]],
                   ["Originating dockets", f"{n:,}"], ["MDLs", ", ".join(map(str, ms))],
                   ["Reading", "Judges are CourtListener person ids assigned to the dockets; a docket counts when the registry ties it to the MDL as an originating docket."]],
            text=f"judge flow {ja['name']} {jb['name']}", filters={"kind": ["edge"]},
            links=[x for x in ({"label": ja["name"], "url": ja["link"]} if ja["link"] else None, {"label": jb["name"], "url": jb["link"]} if jb["link"] else None) if x],
            extra={"profile": {"from": ja, "to": jb, "dockets": n, "mdls": ms}}))
    for pid, v in sorted(transferee_judges.items(), key=lambda kv: -kv[1]["members"]):
        j = v["judge"]
        senders = Counter()
        for (a, b), n in flows.items():
            if b == str(pid):
                senders[a] += n
        rows_j.append(writer.record(
            "judge_flows", f"judge:{pid}", f"{j['name']}: MDLs as transferee judge in the registry", source_url=SRC,
            subtitle=f"{len(v['mdls'])} MDL{'s' if len(v['mdls']) != 1 else ''} · {v['members']:,} member actions · {sum(senders.values()):,} originating dockets from {len(senders)} judges",
            cells={"kind": "transferee_judge", "judge": j["name"], "mdls": len(v["mdls"]), "actions": v["members"], "senders": len(senders)},
            badges=["CourtListener"],
            facts=[["Judge", j["name"]], ["MDLs", ", ".join(map(str, sorted(v["mdls"])))], ["Member actions", f"{v['members']:,}"],
                   ["Originating judges with exact person ids", f"{len(senders):,}"]],
            text=f"transferee judge {j['name']}", filters={"kind": ["transferee_judge"]},
            links=[{"label": "CourtListener activity", "url": j["link"]}] if j["link"] else [],
            extra={"profile": {"judge": j, "mdls": sorted(v["mdls"]), "actions": v["members"],
                               "senders": [{**judge(a), "dockets": n} for a, n in senders.most_common(15)]}}))

    # ---- state scope and correlations
    rows_s = []
    smp = {r["p"]["usps"]: r["p"] for r in load("state_metrics_profiles.json")["rows"] if r.get("p") and r["p"].get("usps")}
    fjc_states = {r["c"]["state"]: r["c"] for r in load("fjc_civil_states.json")["rows"] if r.get("c") and r["c"].get("state")}
    cfpb = {}
    for r in load("cfpb_complaints_states.json")["rows"]:
        st = (r.get("c") or {}).get("state")
        usps = next((u for u, p in smp.items() if p.get("name") == st), None)
        if usps and (r["c"].get("per_100k_2025") is not None):
            cfpb[usps] = r["c"]["per_100k_2025"]
    st_counts = Counter(court_state[r["court_id"]] for r in origin_all if r["court_id"] in court_state)
    st_mdls = defaultdict(Counter)
    for r in origin_all:
        if r["court_id"] in court_state:
            st_mdls[court_state[r["court_id"]]][r["mdl"]] += 1

    def latest(p, key):
        v = ((p.get("latest") or {}).get(key) or {})
        return (v.get("value"), v.get("year")) if isinstance(v.get("value"), (int, float)) else (None, None)

    metrics = [("overdose_rate", "Drug overdose deaths per 100,000 residents"), ("opioid_rate", "Opioid overdose deaths per 100,000 residents"),
               ("fars_rate", "Traffic deaths per 100,000 residents"), ("gdp_per_capita", "GDP per resident"), ("unemployment", "Unemployment rate"),
               ("fda_recall_rate", "FDA recalls per million residents")]
    per = {}
    for usps, p in smp.items():
        pop, pop_year = latest(p, "population")
        if not pop:
            continue
        n = st_counts.get(usps, 0)
        fjc = fjc_states.get(usps) or {}
        per[usps] = {"name": p.get("name"), "dockets": n, "population": pop, "population_year": pop_year, "per_100k": round(100000 * n / pop, 3),
                     "metrics": {k: latest(p, k)[0] for k, _ in metrics}, "metric_years": {k: latest(p, k)[1] for k, _ in metrics},
                     "cfpb_per_100k": cfpb.get(usps), "fjc_filings_per_100k": round(100000 * fjc["filings"] / pop, 2) if isinstance(fjc.get("filings"), int) else None,
                     "fjc_product_pct": fjc.get("product_pct"), "fjc_class_action_pct": fjc.get("class_action_pct")}
    family = [(k, lbl, lambda s, k=k: s["metrics"].get(k)) for k, lbl in metrics] + [
        ("cfpb_per_100k", "CFPB consumer complaints per 100,000 residents (2025)", lambda s: s["cfpb_per_100k"]),
        ("fjc_filings_per_100k", "Federal civil filings per 100,000 residents (FJC IDB, latest fiscal year)", lambda s: s["fjc_filings_per_100k"]),
        ("fjc_product_pct", "Product-liability share of federal civil filings (FJC IDB)", lambda s: s["fjc_product_pct"]),
        ("fjc_class_action_pct", "Class-action share of federal civil filings (FJC IDB)", lambda s: s["fjc_class_action_pct"])]
    tests = []
    states = sorted(per)
    for key, label, get in family:
        pts = [(u, per[u]["per_100k"], get(per[u])) for u in states if get(per[u]) is not None]
        rho, n = cc.spearman([p[1] for p in pts], [p[2] for p in pts])
        if rho is None or n < 10:
            continue
        ci = cc.fisher_ci(rho, n)
        p = xstats.permutation_p([p[1] for p in pts], [p[2] for p in pts], rho)
        tests.append({"key": key, "label": label, "rho": rho, "n": n, "ci": list(ci) if ci else None, "p": p, "points": [{"state": u, "x": x, "y": y} for u, x, y in pts]})
    adj = xstats.bh_adjust([t["p"] for t in tests])
    for t, a in zip(tests, adj):
        t["p_bh"] = a
        t["survives"] = a < 0.05
    for t in sorted(tests, key=lambda t: t["p"]):
        rows_s.append(writer.record(
            "mdl_state_scope", f"corr:{t['key']}", f"Originating MDL dockets per 100,000 residents and {t['label']} (Spearman, across states)", source_url=SRC,
            subtitle=f"rho {t['rho']:+.2f} · 95% interval {t['ci'][0]:+.2f} to {t['ci'][1]:+.2f} · n = {t['n']} states · permutation p {t['p']:.3f} · "
                     + ("holds after Benjamini-Hochberg" if t["survives"] else "does not hold after Benjamini-Hochberg"),
            cells={"kind": "correlation", "title": t["label"], "rho": round(t["rho"], 3), "n": t["n"], "p": round(t["p"], 4), "p_bh": round(t["p_bh"], 4), "survives": t["survives"]},
            badges=["Association, not cause", "Multiple tests"],
            facts=[["Compared", f"Originating MDL dockets per 100,000 residents with {t['label']}"], ["States", str(t["n"])],
                   ["Spearman rho", f"{t['rho']:+.3f}"], ["95% interval (Fisher z)", f"{t['ci'][0]:+.3f} to {t['ci'][1]:+.3f}"],
                   ["Permutation p (5,000 shuffles, seed 1019)", f"{t['p']:.4f}"], ["Benjamini-Hochberg adjusted p", f"{t['p_bh']:.4f} across {len(tests)} tests"],
                   ["Reading", "An association across states in which tests were run together; it does not show cause. Origin counts depend on which MDLs the registry holds and on where cases were filed before transfer, not on where plaintiffs live."]],
            text=f"state correlation mdl origin {t['label']}", filters={"kind": ["correlation"]}, links=[],
            extra={"profile": {**t, "family_size": len(tests)}}))
    for usps in sorted(per, key=lambda u: -per[u]["dockets"]):
        s = per[usps]
        top = st_mdls[usps].most_common(8)
        rows_s.append(writer.record(
            "mdl_state_scope", f"state:{usps}", f"{s['name']}: cases started here that went to MDLs in the registry", source_url=SRC,
            subtitle=f"{s['dockets']:,} originating dockets · {s['per_100k']} per 100,000 residents ({s['population_year']} population)",
            cells={"kind": "state", "state": usps, "title": s["name"], "dockets": s["dockets"], "per_100k": s["per_100k"], "mdls": len(st_mdls[usps])},
            badges=["Matter registry"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("State", s["name"]), ("Originating dockets", f"{s['dockets']:,}"), ("Per 100,000 residents", f"{s['per_100k']} (population {s['population']:,}, {s['population_year']})"),
                ("MDLs", ", ".join(f"{m} ({n})" for m, n in top) or None),
                ("Reading", "Dockets filed in this state's federal courts and tied by the registry to an MDL as originating dockets.")]],
            text=f"state {s['name']} mdl origin", filters={"kind": ["state"]}, links=[{"label": "State", "url": f"/places/{usps}"}],
            extra={"profile": {**s, "state": usps, "mdls": [{"mdl": int(m), "dockets": n} for m, n in top]}}))
    rows_s.append(writer.record(
        "mdl_state_scope", "overview:all", "Where MDL cases started: states and state metrics", source_url=SRC,
        subtitle=f"{sum(st_counts.values()):,} originating dockets in {len(st_counts)} states · {len(tests)} associations, {sum(t['survives'] for t in tests)} hold after correction",
        cells={"kind": "overview", "dockets": sum(st_counts.values()), "states": len(st_counts), "tests": len(tests)},
        badges=["Matter registry"],
        facts=[["Originating dockets with a state", f"{sum(st_counts.values()):,} of {len(origin_all):,}"],
               ["Tests", f"{len(tests)} Spearman associations, permutation p-values, Benjamini-Hochberg across the family"],
               ["Population", "U.S. Census Bureau (state_metrics_profiles, latest year)"]],
        text="mdl state scope overview", filters={"kind": ["overview"]}, links=[],
        extra={"profile": {"dockets": sum(st_counts.values()), "states": len(st_counts), "tests": [{k: t[k] for k in ("key", "label", "rho", "n", "ci", "p", "p_bh", "survives")} for t in tests]}}))

    # ---- write
    inputs = [{"url": f"corpus:{n[:-5]}", "path": f"private/build/firm_intel/lookups/{n}", "sha256": hashlib.sha256(open(os.path.join(fi, n), "rb").read()).hexdigest()}
              for n in ("sw_matters.json", "mdls.json")] + [{"url": "corpus:sw_matter_dockets_v1", "path": "private/build/matter_xanalysis/lookups/sw_matter_dockets.jsonl",
               "sha256": hashlib.sha256(open(os.path.join(LOOK, "sw_matter_dockets.jsonl"), "rb").read()).hexdigest()},
              {"url": "courtlistener:docket,person (bulk 2026-09-30)", "path": "private/acq/courtlistener/db/docket.duckdb", "sha256": None}]
    for name in ("state_metrics_profiles.json", "fjc_civil_states.json", "cfpb_complaints_states.json"):
        inputs.append({"url": f"corpus:{name[:-5]}", "path": f"private/build/matter_xanalysis/lookups/{name}", "sha256": hashlib.sha256(open(os.path.join(LOOK, name), "rb").read()).hexdigest()})
    summary = {"source": "Matter registry member dockets (sw_matter_dockets_v1) joined to CourtListener's docket and person tables by exact docket id and court",
               "join": dict(join_stats),
               "definitions": {"member action": "a registry docket that counts as an action (counts_as_action)",
                               "originating docket": "a transferor docket (JPML schedule or conditional transfer order) or an FJC-recorded docket of the MDL in a court other than the transferee court",
                               "transferee judge": "the CourtListener person assigned to the MDL's master docket",
                               "originating judge": "the CourtListener person assigned to an originating docket in its own court"},
               "caveats": ["The registry holds 38 MDLs, a selection, not every MDL.", "Most member cases are filed directly in the transferee court and carry no origin.",
                           "FJC IDB association is historical administrative evidence."]}
    specs = {
        "mdl_hierarchy": ("MDL hierarchy: master dockets, member actions by evidence, originating courts and timing (matter registry)", rows_h,
                          writer.listing([("kind", "Type"), ("mdl", "MDL"), ("title", "Title"), ("transferee_court", "Transferee court"), ("actions", "Member actions"),
                                          ("jpml_total", "JPML total"), ("origin_dockets", "Originating dockets"), ("origin_courts", "Originating courts")],
                                         [("kind", "Type", {"mdl": "MDL", "court": "Originating court", "overview": "Overview"})])),
        "judge_flows": ("Judge to judge: originating judges to MDL transferee judges (exact CourtListener person ids)", rows_j,
                        writer.listing([("kind", "Type"), ("from", "Originating judge"), ("to", "Transferee judge"), ("judge", "Judge"), ("dockets", "Dockets"), ("mdls", "MDLs")],
                                       [("kind", "Type", {"edge": "Judge to judge", "transferee_judge": "Transferee judge"})])),
        "mdl_state_scope": ("Where MDL cases started, by state, beside state metrics (associations with multiplicity control)", rows_s,
                            writer.listing([("kind", "Type"), ("title", "State or measure"), ("dockets", "Originating dockets"), ("per_100k", "Per 100,000"),
                                            ("rho", "rho"), ("p_bh", "Adjusted p"), ("n", "n")],
                                           [("kind", "Type", {"state": "State", "correlation": "Association", "overview": "Overview"})])),
    }
    os.makedirs(OUT, exist_ok=True)
    for ds, (label, rws, listing) in specs.items():
        spec = {"dataset": ds, "label": label, "listing_block": listing, "summary": {**summary, "totals": {"records": len(rws)}}, "rows": rws,
                "built_at": built_at, "inputs": inputs}
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(rws), "rows", os.path.getsize(path) // 1024, "KB")
    print("join", dict(join_stats))
    print("origin dockets", len(origin_all), "courts", len(by_court), "states", len(st_counts), "flows", len(flows), "transferee judges", len(transferee_judges))
    for t in sorted(tests, key=lambda t: t["p"]):
        print(f"  {t['label'][:70]:70s} rho={t['rho']:+.3f} n={t['n']} p={t['p']:.4f} bh={t['p_bh']:.4f} {'HOLDS' if t['survives'] else ''}")
    print(f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
