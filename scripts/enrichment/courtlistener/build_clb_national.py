"""Build clb_docket_master: national, state, court-level, case-type, nature-of-suit and cause rollups of CourtListener's docket collection.

Input: work.duckdb (build_clb_work.py), small.duckdb (courts), FJC civil national/nature-of-suit builds for the coverage comparison.
All counts are rows of CourtListener's collection (snapshot 2026-09-30), not complete court totals. Nature-of-suit groups are this
project's grouping of the FJC codebook codes (idb_codes.NOS_GROUPS); only dockets whose nature_of_suit text starts with a three-digit
code are grouped, the rest (for example 'Habeas Corpus (General)') are counted as text without a code.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import build_clb_courts as bc  # noqa: E402  (shared helpers: by, one, shares, facts)
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import idb_codes  # noqa: E402

DB = bc.DB
OUT = bc.OUT
DATASET = "clb_docket_master"
FIRST_YEAR = 1900
TOPN = 12


def level_group(jur: str | None) -> str:
    if jur in cc.FEDERAL_JURISDICTIONS:
        return "Federal"
    if jur in cc.STATE_JURISDICTIONS:
        return "State"
    return "Other"


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine = bc.lookup("court_spine")
    spine_state, spine_ids = spine["state"], set(spine["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    w_court = bc.one(con, "SELECT * FROM w_court")
    w_year = bc.by(con, "SELECT * FROM w_court_year", "court_id")
    w_ctype = bc.by(con, "SELECT * FROM w_court_casetype", "court_id")
    c_court = bc.one(con, "SELECT * FROM w_cl_court")
    c_year = bc.by(con, "SELECT * FROM w_cl_court_year", "court_id")
    nos_year = bc.by(con, "SELECT * FROM w_nos_year", "nos_code")
    nos_court = bc.by(con, "SELECT * FROM w_nos_court", "nos_code")
    causes = con.execute("SELECT cause, sum(n) AS n FROM w_court_cause GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200").fetchall()
    cause_courts = bc.by(con, "SELECT * FROM w_court_cause WHERE cause IN (SELECT cause FROM (SELECT cause, sum(n) AS n FROM w_court_cause GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200))", "cause")
    cause_years = {}  # per-cause yearly counts are not aggregated by the work step; first/last years come from the court-year tables only for courts
    fjc_nat = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(ROOT, "private", "build", "fjc_idb", "fjc_civil_nos.json")))["rows"]}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (slim tables in private/acq/courtlistener/db)", "sha256": None}
              for u in (bc.DOCKETS_URL, bc.CLUSTERS_URL, bc.COURTS_URL)]
    rows = []

    def cname(cid):
        return courts.get(cid, {}).get("name", cid)

    total_dockets = sum(v["dockets"] for v in w_court.values())
    total_dated = sum(v["dated"] for v in w_court.values())
    total_clusters = sum(v["clusters"] for v in c_court.values())

    # -------------------------------------------------------------- yearly national records
    yr = defaultdict(lambda: {"dockets": 0, "civil": 0, "criminal": 0, "recap": 0, "terminated": 0, "clusters": 0, "cited_clusters": 0, "by_group": Counter()})
    for cid, lst in w_year.items():
        grp = level_group(courts.get(cid, {}).get("jur"))
        for r in lst:
            if r["yr"] is None or not (FIRST_YEAR <= r["yr"] <= 2026):
                continue
            y = yr[int(r["yr"])]
            y["dockets"] += r["dockets"]
            y["civil"] += r["civil"]
            y["criminal"] += r["criminal"]
            y["recap"] += r["recap"]
            y["terminated"] += r["terminated"]
            y["by_group"][grp] += r["dockets"]
    for cid, lst in c_year.items():
        for r in lst:
            if r["yr"] is None or not (FIRST_YEAR <= r["yr"] <= 2026):
                continue
            y = yr[int(r["yr"])]
            y["clusters"] += r["clusters"]
            y["cited_clusters"] += r["cited"]
    years_sorted = sorted(yr)
    for y in years_sorted:
        d = yr[y]
        prev = yr.get(y - 1)
        yoy = cc.r1(100.0 * (d["dockets"] - prev["dockets"]) / prev["dockets"]) if prev and prev["dockets"] >= 1000 and y < 2026 else None
        partial = y == 2026
        rows.append(writer.record(
            DATASET, f"year:{y}", f"CourtListener docket collection: dockets filed in {y}" + (" (through Sept 30)" if partial else ""), source_url=bc.DOCKETS_URL,
            subtitle=f"{d['dockets']:,} dockets · {d['clusters']:,} opinion clusters" + (" · partial year" if partial else ""),
            cells={"kind": "year", "name": str(y), "dockets": d["dockets"], "civil": d["civil"], "criminal": d["criminal"], "recap_pct": cc.share(d["recap"], d["dockets"]),
                   "terminated_pct": cc.share(d["terminated"], d["dockets"]), "clusters": d["clusters"], "yoy_pct": yoy},
            badges=["CourtListener bulk data", "Collection, not complete court totals"] + (["Partial year"] if partial else []),
            facts=bc.facts([("Year (filing date)", f"{y}" + (" (through Sept 30, 2026)" if partial else "")), ("Dockets filed in the collection", f"{d['dockets']:,}"),
                            ("Civil-numbered dockets (docket number contains -cv-)", f"{d['civil']:,}"), ("Criminal-numbered dockets (-cr-)", f"{d['criminal']:,}"),
                            ("From RECAP (PACER) sources", f"{d['recap']:,} ({cc.share(d['recap'], d['dockets'])}%)"),
                            ("With a termination date", f"{d['terminated']:,} ({cc.share(d['terminated'], d['dockets'])}%)"),
                            ("Change from previous year", f"{yoy}%" if yoy is not None else None),
                            ("Opinion clusters filed", f"{d['clusters']:,}"), ("Coverage", "Counts are rows in CourtListener's collection, not complete court totals.")]),
            text=f"courtlistener docket collection year {y}", filters={"kind": ["year"]}, links=[{"label": "CourtListener bulk data", "url": cc.BULK_URL}],
            extra={"profile": {"year": y, "dockets": d["dockets"], "civil": d["civil"], "criminal": d["criminal"], "recap": d["recap"], "terminated": d["terminated"], "clusters": d["clusters"],
                               "cited_clusters": d["cited_clusters"], "by_group": dict(d["by_group"]), "yoy_pct": yoy, "partial": partial}}))

    # -------------------------------------------------------------- level rollups
    levels = defaultdict(lambda: {"courts": 0, "dockets": 0, "clusters": 0, "recap": 0, "terminated": 0, "dated": 0, "ids": []})
    for cid, v in w_court.items():
        jur = courts.get(cid, {}).get("jur")
        L = levels[jur]
        L["courts"] += 1
        L["dockets"] += v["dockets"]
        L["recap"] += v["recap"]
        L["terminated"] += v["terminated"]
        L["dated"] += v["dated"]
        L["ids"].append((cid, v["dockets"]))
    for cid, v in c_court.items():
        levels[courts.get(cid, {}).get("jur")]["clusters"] += v["clusters"]
    for jur, L in sorted(levels.items(), key=lambda kv: -kv[1]["dockets"]):
        label = cc.JURISDICTION_LABEL.get(jur, f"Code {jur}" if jur else "Not recorded")
        top = [{"court_id": cid, "name": cname(cid), "dockets": n, "link": f"/courts/{cid}" if cid in spine_ids else None} for cid, n in sorted(L["ids"], key=lambda t: (-t[1], t[0]))[:TOPN]]
        rows.append(writer.record(
            DATASET, f"level:{jur or 'none'}", f"{label} courts in CourtListener's docket collection", source_url=bc.DOCKETS_URL,
            subtitle=f"{L['courts']:,} courts · {L['dockets']:,} dockets · {L['clusters']:,} opinion clusters",
            cells={"kind": "court level", "name": label, "dockets": L["dockets"], "civil": None, "criminal": None, "recap_pct": cc.share(L["recap"], L["dockets"]),
                   "terminated_pct": cc.share(L["terminated"], L["dockets"]), "clusters": L["clusters"], "yoy_pct": None},
            badges=["CourtListener bulk data", "Collection, not complete court totals"],
            facts=bc.facts([("Court level (as coded)", f"{label} ({jur})"), ("Courts with dockets", f"{L['courts']:,}"), ("Dockets", f"{L['dockets']:,} ({cc.share(L['dockets'], total_dockets, 2)}% of the collection)"),
                            ("Opinion clusters", f"{L['clusters']:,}"), ("From RECAP sources", f"{cc.share(L['recap'], L['dockets'])}%"),
                            ("Largest courts by dockets", "; ".join(f"{t['name']} ({t['dockets']:,})" for t in top[:5]))]),
            text=f"court level {label}", filters={"kind": ["court level"]}, links=[{"label": "CourtListener bulk data", "url": cc.BULK_URL}],
            extra={"profile": {"code": jur, "label": label, "courts": L["courts"], "dockets": L["dockets"], "clusters": L["clusters"], "recap": L["recap"], "terminated": L["terminated"], "top_courts": top}}))

    # -------------------------------------------------------------- state rollups
    by_state = defaultdict(lambda: {"dockets": 0, "clusters": 0, "recap": 0, "courts": 0, "groups": Counter(), "ids": [], "civil": 0})
    for cid, v in w_court.items():
        st = spine_state.get(cid)
        if not st:
            continue
        S = by_state[st]
        S["dockets"] += v["dockets"]
        S["recap"] += v["recap"]
        S["courts"] += 1
        S["groups"][level_group(courts.get(cid, {}).get("jur"))] += v["dockets"]
        S["ids"].append((cid, v["dockets"]))
        S["civil"] += sum(r["n"] for r in w_ctype.get(cid, []) if r["case_type"] == "cv")
    for cid, v in c_court.items():
        st = spine_state.get(cid)
        if st:
            by_state[st]["clusters"] += v["clusters"]
    for st, S in sorted(by_state.items()):
        top = [{"court_id": cid, "name": cname(cid), "dockets": n, "link": f"/courts/{cid}" if cid in spine_ids else None} for cid, n in sorted(S["ids"], key=lambda t: (-t[1], t[0]))[:TOPN]]
        rows.append(writer.record(
            DATASET, f"state:{st}", f"{st}: dockets and opinions in CourtListener's collection, by court location", source_url=bc.DOCKETS_URL, state=st,
            subtitle=f"{S['courts']:,} courts · {S['dockets']:,} dockets · {S['clusters']:,} opinion clusters",
            cells={"kind": "state", "name": st, "dockets": S["dockets"], "civil": S["civil"], "criminal": None, "recap_pct": cc.share(S["recap"], S["dockets"]),
                   "terminated_pct": None, "clusters": S["clusters"], "yoy_pct": None},
            badges=["CourtListener bulk data", "Collection, not complete court totals"],
            facts=bc.facts([("State (court location)", st), ("Courts with dockets", f"{S['courts']:,}"), ("Dockets", f"{S['dockets']:,}"),
                            ("Federal / state / other courts' dockets", " / ".join(f"{S['groups'].get(g, 0):,}" for g in ("Federal", "State", "Other"))), ("Opinion clusters", f"{S['clusters']:,}"),
                            ("Largest courts by dockets", "; ".join(f"{t['name']} ({t['dockets']:,})" for t in top[:5])),
                            ("Counting", "Courts are placed in a state by the project's court spine; multi-state courts and the U.S. Supreme Court are not assigned to a state.")]),
            text=f"state {st} court dockets", filters={"kind": ["state"], "state": [st]},
            links=[{"label": f"{st} place profile", "url": f"/places/{st}"}] if st in bc.STATES_WITH_PAGE else [],
            extra={"profile": {"state": st, "courts": S["courts"], "dockets": S["dockets"], "clusters": S["clusters"], "recap": S["recap"], "civil": S["civil"], "by_group": dict(S["groups"]), "top_courts": top}}))

    # -------------------------------------------------------------- case types
    ct = Counter()
    for cid, lst in w_ctype.items():
        for r in lst:
            ct[r["case_type"]] += r["n"]
    ct_total = sum(ct.values())
    ct_rows = [(k, n) for k, n in ct.items() if k]
    top_ct = bc.shares(ct_rows, ct_total, 25)
    rows.append(writer.record(
        DATASET, "casetype:all", "Docket case types read from federal docket numbers (CourtListener's collection)", source_url=bc.DOCKETS_URL,
        subtitle=f"{sum(n for _, n in ct_rows):,} dockets with a case type · {ct.get(None, 0):,} without",
        cells={"kind": "case type", "name": "All case types", "dockets": ct_total, "civil": ct.get("cv"), "criminal": ct.get("cr"), "recap_pct": None, "terminated_pct": None, "clusters": None, "yoy_pct": None},
        badges=["CourtListener bulk data"],
        facts=bc.facts([("Dockets in the collection", f"{ct_total:,}"), ("With a case type in the docket number", f"{sum(n for _, n in ct_rows):,} ({cc.share(sum(n for _, n in ct_rows), ct_total)}%)"),
                        ("Without one (state-court and older numbers)", f"{ct.get(None, 0):,}"),
                        ("Most frequent", "; ".join(f"{t['value']} {t['count']:,}" for t in top_ct[:8])),
                        ("Definition", "The two-letter code between the year and the sequence in a federal docket number (5:15-cv-02674 is cv); CourtListener's own parsed case type fills in where the number does not match.")]),
        text="docket case types cv cr bk mj mc", filters={"kind": ["case type"]}, links=[{"label": "CourtListener bulk data", "url": cc.BULK_URL}],
        extra={"profile": {"case_types": top_ct, "total": ct_total, "without_case_type": ct.get(None, 0)}}))

    # -------------------------------------------------------------- nature of suit codes and groups
    group_year: dict = defaultdict(Counter)
    group_total: Counter = Counter()
    group_courts: dict = defaultdict(Counter)
    code_rows = []
    for code, lst in nos_court.items():
        if code is None:
            continue
        n = sum(r["n"] for r in lst)
        grp = idb_codes.NOS_TO_GROUP.get(code, "unmapped")
        group_total[grp] += n
        for r in lst:
            group_courts[grp][r["court_id"]] += r["n"]
        code_rows.append((code, grp, n, lst))
    for code, lst in nos_year.items():
        grp = idb_codes.NOS_TO_GROUP.get(code, "unmapped") if code is not None else None
        if grp is None:
            continue
        for r in lst:
            if r["yr"] and FIRST_YEAR <= r["yr"] <= 2026:
                group_year[grp][int(r["yr"])] += r["n"]
    nos_labels = {}
    for code, lst in nos_court.items():
        pass
    sm_text = dict(((r[0], r[1]) for r in con.execute(
        "SELECT nos_code, arg_max(nos_text, n) FROM (SELECT nos_code, nos_text, sum(n) AS n FROM w_court_nos WHERE nos_code IS NOT NULL GROUP BY 1, 2) GROUP BY 1").fetchall()))
    nos_all = sum(n for _, _, n, _ in code_rows)
    for code, grp, n, lst in sorted(code_rows, key=lambda t: (-t[2], t[0])):
        if n < 50:
            continue
        fj = fjc_nat.get(f"nos:{code}")
        series = [{"yr": int(r["yr"]), "n": r["n"], "n_term": r["n_term"]} for r in sorted(nos_year.get(code, []), key=lambda r: r["yr"] or 0) if r["yr"] and 1950 <= r["yr"] <= 2026]
        top_courts = [{"court_id": c, "name": cname(c), "dockets": k, "link": f"/courts/{c}" if c in spine_ids else None}
                      for c, k in Counter({r["court_id"]: r["n"] for r in lst}).most_common(TOPN)]
        fjc_by_fy = {s["fy"]: s["filings"] for s in (fj or {}).get("series", [])} if fj else {}
        dated_n = sum(r["n"] for r in nos_year.get(code, []))
        term_n = sum(r["n_term"] for r in nos_year.get(code, []))
        label = idb_codes.GROUP_LABEL.get(grp, grp)
        text = sm_text.get(code)
        rows.append(writer.record(
            DATASET, f"nos:{code}", f"Nature of suit {code}: dockets in CourtListener's collection", source_url=bc.DOCKETS_URL,
            subtitle=f"{n:,} dockets · group: {label}" + (f" · most common text: {text}" if text else ""),
            cells={"kind": "nature of suit", "name": (text if text and text.lstrip().startswith(str(code)) else f"{code} {text or ''}").strip(), "dockets": n, "civil": None, "criminal": None, "recap_pct": None, "terminated_pct": cc.share(term_n, dated_n),
                   "clusters": None, "yoy_pct": None},
            badges=["CourtListener bulk data", "Collection, not complete court totals", "Group is this project's grouping"],
            facts=bc.facts([("Nature of suit code (first three digits of the recorded text)", code), ("Most common recorded text", text), ("Group (this project's grouping of FJC codebook codes)", label),
                            ("Dockets with this code", f"{n:,} ({cc.share(n, nos_all, 2)}% of dockets with a numeric code)"),
                            ("Largest courts", "; ".join(f"{t['name']} ({t['dockets']:,})" for t in top_courts[:5])),
                            ("Counting", "Dockets whose nature_of_suit text starts with three digits; texts without a code (for example 'Habeas Corpus (General)') are not included.")]),
            text=f"nature of suit {code} {text or ''} {label}", filters={"kind": ["nature of suit"], "group": [grp]},
            links=[{"label": "FJC national record", "url": f"/records/fjc_civil_nos/nos:{code}"}] if fj else [],
            extra={"profile": {"code": code, "group": grp, "group_label": label, "text": text, "dockets": n, "dated_dockets": dated_n, "terminated": term_n, "terminated_pct_of_dated": cc.share(term_n, dated_n), "by_year": series, "top_courts": top_courts,
                               "fjc_filings_by_fy": ({k: v for k, v in fjc_by_fy.items() if k >= 2000} if fjc_by_fy else None)}}))
    for grp, n in sorted(group_total.items(), key=lambda kv: (-kv[1], kv[0])):
        label = idb_codes.GROUP_LABEL.get(grp, grp)
        series = [{"yr": y, "n": c} for y, c in sorted(group_year[grp].items()) if 1950 <= y <= 2026]
        top_courts = [{"court_id": c, "name": cname(c), "dockets": k, "link": f"/courts/{c}" if c in spine_ids else None} for c, k in group_courts[grp].most_common(TOPN)]
        rows.append(writer.record(
            DATASET, f"group:{grp}", f"{label}: dockets in CourtListener's collection (nature-of-suit group)", source_url=bc.DOCKETS_URL,
            subtitle=f"{n:,} dockets with a numeric nature-of-suit code in this group", cells={"kind": "nature-of-suit group", "name": label, "dockets": n, "civil": None, "criminal": None,
                                                                                               "recap_pct": None, "terminated_pct": None, "clusters": None, "yoy_pct": None},
            badges=["CourtListener bulk data", "Group is this project's grouping"],
            facts=bc.facts([("Group", label), ("Dockets", f"{n:,} ({cc.share(n, nos_all, 2)}% of dockets with a numeric code)"), ("Largest courts", "; ".join(f"{t['name']} ({t['dockets']:,})" for t in top_courts[:5])),
                            ("Grouping", "The project's grouping of FJC codebook nature-of-suit codes (idb_codes.NOS_GROUPS), not an FJC or CourtListener category.")]),
            text=f"nature of suit group {label}", filters={"kind": ["nature-of-suit group"], "group": [grp]}, links=[{"label": "FJC national record", "url": f"/records/fjc_civil_nos/group:{grp}"}] if f"group:{grp}" in fjc_nat else [],
            extra={"profile": {"group": grp, "label": label, "dockets": n, "by_year": series, "top_courts": top_courts}}))

    # -------------------------------------------------------------- causes of action
    for i, (cause, n) in enumerate(causes):
        lst = cause_courts.get(cause, [])
        top_courts = [{"court_id": r["court_id"], "name": cname(r["court_id"]), "dockets": r["n"], "link": f"/courts/{r['court_id']}" if r["court_id"] in spine_ids else None}
                      for r in sorted(lst, key=lambda r: (-r["n"], r["court_id"]))[:TOPN]]
        rows.append(writer.record(
            DATASET, f"cause:{i + 1:03d}", f"Cause of action {cause}: dockets in CourtListener's collection", source_url=bc.DOCKETS_URL,
            subtitle=f"{n:,} dockets · rank {i + 1} of the cause strings recorded",
            cells={"kind": "cause", "name": cause, "dockets": n, "civil": None, "criminal": None, "recap_pct": None, "terminated_pct": None, "clusters": None, "yoy_pct": None},
            badges=["CourtListener bulk data", "Collection, not complete court totals"],
            facts=bc.facts([("Cause (as recorded, usually a U.S. Code citation and a short title)", cause), ("Dockets", f"{n:,}"), ("Rank by dockets", i + 1),
                            ("Largest courts", "; ".join(f"{t['name']} ({t['dockets']:,})" for t in top_courts[:5])),
                            ("Counting", "Exact cause strings are counted separately; spelling variants are not merged.")]),
            text=f"cause of action {cause}", filters={"kind": ["cause"]}, links=[],
            extra={"profile": {"cause": cause, "rank": i + 1, "dockets": n, "top_courts": top_courts}}))

    # -------------------------------------------------------------- overview
    src_tot = Counter()
    for r in con.execute("SELECT source, sum(n) FROM w_court_source GROUP BY 1").fetchall():
        src_tot[r[0]] = r[1]
    src_rows = [{"value": v, "flags": cc.source_flags(int(v)), "count": int(n), "share_pct": cc.share(int(n), total_dockets, 2)} for v, n in src_tot.most_common(10) if v is not None]
    recap_total = sum(v["recap"] for v in w_court.values())
    totals = {"dockets": total_dockets, "dockets_with_filing_date": total_dated, "clusters": total_clusters, "courts_with_dockets": len(w_court), "recap_dockets": recap_total,
              "first_filed": str(min(v["first_filed"] for v in w_court.values() if v["first_filed"])), "last_filed": str(max(v["last_filed"] for v in w_court.values() if v["last_filed"])),
              "with_assigned_judge": sum(v["with_assigned"] for v in w_court.values()), "with_nature_of_suit": sum(v["with_nos"] for v in w_court.values()),
              "with_fjc_record": sum(v["with_idb"] for v in w_court.values()), "implausible_filing_dates": sum(v["implausible_filed"] for v in w_court.values()), "no_filing_date": sum(v["no_filed_date"] for v in w_court.values())}
    rows.append(writer.record(
        DATASET, "overview:all", "CourtListener docket collection: overview and field completeness", source_url=bc.DOCKETS_URL,
        subtitle=f"{total_dockets:,} dockets · {total_clusters:,} opinion clusters · {len(w_court):,} courts",
        cells={"kind": "overview", "name": "Whole collection", "dockets": total_dockets, "civil": None, "criminal": None, "recap_pct": cc.share(recap_total, total_dockets), "terminated_pct": None,
               "clusters": total_clusters, "yoy_pct": None},
        badges=["CourtListener bulk data", "Collection, not complete court totals"],
        facts=bc.facts([("Dockets", f"{total_dockets:,}"), ("Courts with dockets", f"{len(w_court):,}"), ("Filing dates on record", f"{totals['first_filed']} to {totals['last_filed']} ({total_dated:,} dated)"),
                        ("Dockets without a filing date / outside 1700–2026", f"{totals['no_filing_date']:,} / {totals['implausible_filing_dates']:,}"), ("From RECAP sources", f"{recap_total:,} ({cc.share(recap_total, total_dockets)}%)"),
                        ("With an assigned judge", f"{totals['with_assigned_judge']:,} ({cc.share(totals['with_assigned_judge'], total_dockets)}%)"),
                        ("With a nature-of-suit text", f"{totals['with_nature_of_suit']:,} ({cc.share(totals['with_nature_of_suit'], total_dockets)}%)"),
                        ("Linked to an FJC Integrated Database record", f"{totals['with_fjc_record']:,} ({cc.share(totals['with_fjc_record'], total_dockets)}%)"),
                        ("Opinion clusters", f"{total_clusters:,}"), ("Not in the bulk files", "attorneys, parties, docket entries and RECAP documents (see clb_bulk_schema)")]),
        text="courtlistener docket collection overview completeness", filters={"kind": ["overview"]}, links=[{"label": "CourtListener bulk data", "url": cc.BULK_URL}],
        extra={"profile": {"totals": totals, "sources": src_rows}}))
    summary = {
        "source": "CourtListener bulk data: dockets, opinion-clusters, courts (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": totals, "sources": src_rows,
        "definitions": {"year": "calendar year of date_filed (1900-2026; dates outside 1700-2026-09-30 are excluded)", "civil / criminal": "docket number contains -cv- / -cr- (case type read from the number; CourtListener's parsed case type fills in where the number does not match)",
                        "court level": "courts.jurisdiction code as stored; federal = F, FD, FB, FBP, FS; state = S, SA, ST, SS, SAG; the rest are listed separately",
                        "state": "state of the court in the project's court spine", "nature-of-suit group": "this project's grouping of FJC codebook codes; only texts that start with a three-digit code are grouped",
                        "cause": "exact cause string as recorded, top 200 by dockets"},
        "caveats": ["The collection is not a census of court filings; coverage differs by court and year.", "Counts are dockets in CourtListener, not cases decided.",
                    "Attorneys, parties and docket entries are not in CourtListener's public bulk files, so no firm or attorney statistics come from this dataset."],
        "grain": "year, court level, state, case type, nature-of-suit code and group, cause and overview records"}
    return {DATASET: {
        "dataset": DATASET, "label": "National docket master statistics: years, court levels, states, case types, nature of suit and causes (CourtListener, Sept 30, 2026)",
        "listing_block": writer.listing([("kind", "Type"), ("name", "Name"), ("dockets", "Dockets"), ("civil", "Civil-numbered"), ("criminal", "Criminal-numbered"), ("recap_pct", "RECAP %"),
                                         ("terminated_pct", "Terminated %"), ("clusters", "Opinion clusters"), ("yoy_pct", "Change vs prior year %")],
                                        [("kind", "Type", {"year": "Year", "court level": "Court level", "state": "State", "case type": "Case type", "nature of suit": "Nature of suit",
                                                           "nature-of-suit group": "Nature-of-suit group", "cause": "Cause of action", "overview": "Overview"})]),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = build()
    for ds, spec in out.items():
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
