"""Build the FJC Integrated Database civil-case datasets (official file, 1988 forward, current to June 30, 2026).

Datasets (ids): fjc_civil_districts, fjc_civil_states, fjc_civil_national, fjc_civil_nos, fjc_civil_mdls.
Input: private/acq/fjc_idb/fjc_civil.duckdb (load_civil.py), codebook text, saved lookups. No network, no writes outside
private/build/fjc_idb/. See civil_agg.py for the counting rules; every formula is repeated in each dataset's summary.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import civil_agg as ca  # noqa: E402
import corpus_writer as writer  # noqa: E402
import idb_codes as ic  # noqa: E402
from fjc_common import (  # noqa: E402
    LATEST_FY, PARTIAL_FY, WIN, days_label, facts, metric_ranks, n, pct, pct_label, rank_desc, series_for, window_profile,
)

OUT = os.path.join(ROOT, "private", "build", "fjc_idb")
LOOK = os.path.join(OUT, "lookups")
PAGE = "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"
FILE = "https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip"
CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Civil%20Codebook%201988%20Forward%2010252023.pdf"
STATES_WITH_PAGE = set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
CIRCUIT_ID = {"0": "cadc", **{str(i): f"ca{i}" for i in range(1, 12)}}
CIRCUIT_NAME = {"cadc": "D.C. Circuit", **{f"ca{i}": f"{['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh'][i-1]} Circuit" for i in range(1, 12)}}
FIPS_NOTE = "Fiscal years run Oct 1 - Sep 30 and are labelled by the year they end; FY2026 covers Oct 1, 2025 - Jun 30, 2026 only."


def load(name: str):
    return json.load(open(os.path.join(LOOK, name + ".json")))


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def build(quiet: bool = False) -> dict[str, dict]:
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    con = ca.connect()
    codes = ca.prepare(con)
    nos_names = codes["nos"]
    quality = ca.quality(con)
    done = json.load(open(os.path.join(ROOT, "private", "acq", "fjc_idb", "fjc_civil.done.json")))
    quality["csv_records_rejected_by_reader"] = done["rejected_records"]
    quality["csv_records_loaded"] = done["rows"]
    spine = set(load("court_spine")["ids"])
    mdls_corpus = set(load("mdls")["ids"])
    mdl_analytics = set(load("mdl_analytics")["ids"])
    fcms = set(load("fcms_court_profiles")["ids"])
    cjra = set(load("court_cjra_districts")["ids"])
    jb = set(load("court_jb_districts")["ids"])
    cl_courts = load("cl_courts")  # court_id -> {"full_name", "short_name", "citation_string"}
    dist_rows = con.execute("SELECT district, court_id, label, state FROM dist ORDER BY court_id").fetchall()
    circ = dict(con.execute("SELECT district, mode(circuit) FROM civil GROUP BY 1").fetchall())
    district_info = {cid: {"code": code, "label": label, "state": st, "circuit": CIRCUIT_ID.get(circ.get(code) or "", None)} for code, cid, label, st in dist_rows}
    inputs = [{"url": FILE, "path": "private/acq/fjc_idb/cv88on.zip", "sha256": sha256(os.path.join(ROOT, "private", "acq", "fjc_idb", "cv88on.zip"))},
              {"url": CODEBOOK, "path": "private/acq/courtlistener/idb_civil_codebook_1988_forward.pdf",
               "sha256": sha256(os.path.join(ROOT, "private", "acq", "courtlistener", "idb_civil_codebook_1988_forward.pdf"))}]
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if not quiet:
        print("prepared", round(time.time() - t0, 1), "s", flush=True)

    aggs = {s: ca.run(con, s) for s in ("court_id", "state", "us", "nos", "grp")}
    if not quiet:
        print("aggregated", round(time.time() - t0, 1), "s", flush=True)
    mixes = {s: ca.window_mix(con, {"court_id": "court_id", "state": "state", "us": "'US'", "nos": "CAST(nos AS VARCHAR)", "grp": "grp"}[s]) for s in ("court_id", "state", "us", "nos", "grp")}
    mdl = ca.mdl_cases(con)
    # per-FY national group mix and top NOS (national rows), top districts per NOS in the window
    fy_groups = con.execute("SELECT fy_f, grp, count(*) FROM cv WHERE fy_f BETWEEN 1988 AND 2026 GROUP BY 1, 2 ORDER BY 1, 3 DESC").fetchall()
    fy_nos = con.execute(
        """SELECT fy_f, nos, n FROM (SELECT fy_f, nos, count(*) AS n, row_number() OVER (PARTITION BY fy_f ORDER BY count(*) DESC, nos) AS r
           FROM cv WHERE fy_f BETWEEN 1988 AND 2026 AND nos IS NOT NULL GROUP BY 1, 2) WHERE r <= 10 ORDER BY fy_f, n DESC""").fetchall()
    nos_districts = con.execute(
        f"""SELECT nos, court_id, n FROM (SELECT nos, court_id, count(*) AS n, row_number() OVER (PARTITION BY nos ORDER BY count(*) DESC, court_id) AS r
            FROM cv WHERE fy_f BETWEEN {WIN[0]} AND {WIN[1]} AND nos IS NOT NULL GROUP BY 1, 2) WHERE r <= 10 ORDER BY nos, n DESC""").fetchall()
    grp_districts = con.execute(
        f"""SELECT grp, court_id, n FROM (SELECT grp, court_id, count(*) AS n, row_number() OVER (PARTITION BY grp ORDER BY count(*) DESC, court_id) AS r
            FROM cv WHERE fy_f BETWEEN {WIN[0]} AND {WIN[1]} GROUP BY 1, 2) WHERE r <= 10 ORDER BY grp, n DESC""").fetchall()
    if not quiet:
        print("mixes", round(time.time() - t0, 1), "s", flush=True)

    out: dict[str, dict] = {}
    common_summary = {
        "source": "Federal Judicial Center, Integrated Database (IDB), civil cases filed, terminated and pending, statistical year 1988 to present",
        "source_page": PAGE, "source_file": FILE, "codebook": CODEBOOK,
        "snapshot": "cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30",
        "terms": "Public data published by the Federal Judicial Center; the IDB page states no use restriction. The FJC and the AO do not vouch for analyses built from it.",
        "counting_rules": [
            "A case belongs to the statistical (fiscal) year of its FDATEUSE (filing) or TDATEUSE (termination), the dates the AO used in published tables.",
            "Pending records (status S, tape year 2099) carry the placeholder termination date 1900-01-01 and are counted as open, never as terminated.",
            "Days to termination = TERMDATE - FILEDATE for terminated cases; pairs with TERMDATE before FILEDATE (none in this file) would be excluded.",
            "Pending at fiscal-year end = cases with a filing year on or before that year minus cases with a termination year on or before it.",
            "Percent shares use as denominator only the cases for which the field is recorded; -8 and blank are missing, never a category.",
            FIPS_NOTE,
        ],
        "quality": quality,
        "grouping_note": "NOS groups are this project's grouping of the codebook's nature-of-suit codes (listed on each group record), not FJC categories.",
        "ranks_note": "Ranks are competition ranks among the 94 districts for FY2025 (1 = highest, ties share the lowest number).",
    }

    # ------------------------------------------------------------------ districts
    d_series = {cid: series_for(aggs["court_id"], cid) for cid in district_info}
    latest = {cid: next((s for s in ser if s["fy"] == LATEST_FY), None) for cid, ser in d_series.items()}
    latest = {k: v for k, v in latest.items() if v}
    ranks = metric_ranks(latest)
    rows = []
    for cid, info in sorted(district_info.items()):
        ser = d_series[cid]
        cur = latest.get(cid)
        prev = next((s for s in ser if s["fy"] == LATEST_FY - 1), None)
        win = window_profile(mixes["court_id"], cid, nos_names)
        name = (cl_courts.get(cid) or {}).get("full_name") or f"U.S. District Court, {info['label']}"
        usps = info["state"]
        links = []
        if cid in spine:
            links.append({"label": "Court profile", "url": f"/courts/{cid}"})
        if usps in STATES_WITH_PAGE:
            links.append({"label": f"{usps} place profile", "url": f"/places/{usps}"})
        if f"{cid}:2026-06-30" in fcms:
            links.append({"label": "AO caseload profile, June 2026 (FCMS)", "url": f"/records/fcms_court_profiles/{cid}:2026-06-30"})
        if cid in cjra:
            links.append({"label": "Civil Justice Reform Act delay reports", "url": f"/records/court_cjra_districts/{cid}"})
        if cid in jb:
            links.append({"label": "Judicial Business caseload tables", "url": f"/records/court_jb_districts/{cid}"})
        links += [{"label": "FJC IDB civil data (source)", "url": PAGE}, {"label": "IDB civil codebook", "url": CODEBOOK}]
        profile = {
            "court_id": cid, "name": name, "label": info["label"], "state": usps, "circuit": info["circuit"], "fjc_district_code": info["code"],
            "latest_fy": LATEST_FY, "series": ser, "window": win,
            "ranks": {m: [r.get(cid), len(r)] for m, r in ranks.items()},
            "change_vs_prior_fy": None if not (cur and prev) else {
                "filings_pct": pct(cur["filings"] - prev["filings"], prev["filings"]) if prev["filings"] else None,
                "pending_pct": pct((cur["pending_end"] or 0) - (prev["pending_end"] or 0), prev["pending_end"]) if prev["pending_end"] else None,
                "median_days_delta": None if cur["median_days"] is None or prev["median_days"] is None else cur["median_days"] - prev["median_days"],
            },
        }
        r5 = {m: ranks[m].get(cid) for m in ranks}
        rows.append(writer.record(
            "fjc_civil_districts", cid, f"{name} — civil cases (FJC IDB, FY1988–FY2026)",
            source_url=PAGE, state=usps,
            subtitle=(f"FY{LATEST_FY}: {n(cur['filings'])} filed, {n(cur['terminations'])} terminated, {n(cur['pending_end'])} pending at year end"
                      f" · median {days_label(cur['median_days'])} to termination" if cur else "No FY2025 cases recorded"),
            cells={
                "court": name, "state": usps, "circuit": CIRCUIT_NAME.get(info["circuit"], "Not recorded"),
                "filings": cur and cur["filings"], "terminations": cur and cur["terminations"], "pending": cur and cur["pending_end"],
                "median_days": cur and cur["median_days"], "class_action_pct": cur and cur["class_action_pct"],
                "pro_se_pct": cur and cur["pro_se_plaintiff_pct"], "product_pct": cur and cur["product_pct"], "trial_pct": cur and cur["trial_pct"],
            },
            badges=["Official FJC data", f"FY{LATEST_FY} complete", f"FY{PARTIAL_FY} partial (to Jun 30)"],
            facts=facts([
                ("Court", name), ("FJC district code", f"{info['code']} ({info['label']})"), ("Circuit", CIRCUIT_NAME.get(info["circuit"], "Not recorded")),
                ("Source", f"FJC Integrated Database civil file (cv88on), {PAGE}"),
                (f"Civil filings FY{LATEST_FY}", n(cur and cur["filings"])), (f"Civil terminations FY{LATEST_FY}", n(cur and cur["terminations"])),
                (f"Pending at Sep 30, {LATEST_FY}", n(cur and cur["pending_end"])),
                (f"Median time to termination, cases terminated in FY{LATEST_FY}", days_label(cur and cur["median_days"])),
                (f"Share of filings that allege a class action FY{LATEST_FY}", pct_label(cur and cur["class_action_pct"])),
                (f"Share with a pro se plaintiff FY{LATEST_FY}", pct_label(cur and cur["pro_se_plaintiff_pct"])),
                (f"Product-liability and health-care/pharma injury share of filings FY{LATEST_FY}", pct_label(cur and cur["product_pct"])),
                (f"Share of terminations by trial judgment FY{LATEST_FY}", pct_label(cur and cur["trial_pct"])),
                (f"Rank among 94 districts FY{LATEST_FY} (filings / pending / median days)",
                 f"{r5['filings']} / {r5['pending_end']} / {r5['median_days']}"),
                ("Counting", "AO statistical years by FDATEUSE/TDATEUSE; pending = filed minus terminated through the year end; see the dataset summary."),
                ("Coverage", f"All civil cases the district reported to the AO, FY1988 to {PARTIAL_FY} (through 2026-06-30). Criminal and bankruptcy cases are not in this file."),
            ]),
            text=f"{name} {info['label']} civil cases FJC IDB",
            filters={"circuit": [info["circuit"] or "unknown"], "state": [usps]}, links=links, extra={"profile": profile},
        ))
    out["fjc_civil_districts"] = {
        "label": "Federal district courts — civil cases filed, terminated and pending, FY1988–FY2026 (FJC Integrated Database)",
        "listing": writer.listing([("court", "Court"), ("state", "State"), ("circuit", "Circuit"), ("filings", f"Filed FY{LATEST_FY}"), ("terminations", f"Terminated FY{LATEST_FY}"),
                                   ("pending", "Pending Sep 30"), ("median_days", "Median days to termination"), ("class_action_pct", "Class action %"),
                                   ("pro_se_pct", "Pro se plaintiff %"), ("product_pct", "Product liability %"), ("trial_pct", "Trial %")],
                                  [("circuit", "Circuit", {c: CIRCUIT_NAME[c] for c in CIRCUIT_NAME})]),
        "summary": {**common_summary, "grain": "one record per district court (94)", "latest_complete_fy": LATEST_FY, "partial_fy": PARTIAL_FY,
                    "window": f"FY{WIN[0]}–FY{WIN[1]}", "formulas": {"pending_end": "filings through the year minus terminations through the year",
                    "median_days": "median of TERMDATE - FILEDATE over cases terminated in the year", "trial_pct": "terminations with disposition 7, 8 or 9 divided by all terminations"}},
        "rows": rows,
    }

    # ------------------------------------------------------------------ states
    state_codes = sorted({i["state"] for i in district_info.values()})
    s_rows = []
    s_series = {s: series_for(aggs["state"], s) for s in state_codes}
    for st in state_codes:
        ser = s_series[st]
        cur = next((s for s in ser if s["fy"] == LATEST_FY), None)
        districts = sorted(cid for cid, i in district_info.items() if i["state"] == st)
        win = window_profile(mixes["state"], st, nos_names)
        links = ([{"label": f"{st} place profile", "url": f"/places/{st}"}] if st in STATES_WITH_PAGE else []) + \
                [{"label": f"{(cl_courts.get(c) or {}).get('short_name') or c} (court)", "url": f"/courts/{c}"} for c in districts if c in spine] + \
                [{"label": "FJC IDB civil data (source)", "url": PAGE}]
        s_rows.append(writer.record(
            "fjc_civil_states", st, f"{st} — federal district courts in the state: civil cases (FJC IDB)",
            source_url=PAGE, state=st,
            subtitle=f"FY{LATEST_FY}: {n(cur and cur['filings'])} filed across {len(districts)} district(s) · median {days_label(cur and cur['median_days'])} to termination",
            cells={"state": st, "districts": len(districts), "filings": cur and cur["filings"], "terminations": cur and cur["terminations"],
                   "pending": cur and cur["pending_end"], "median_days": cur and cur["median_days"], "class_action_pct": cur and cur["class_action_pct"],
                   "pro_se_pct": cur and cur["pro_se_plaintiff_pct"], "product_pct": cur and cur["product_pct"]},
            badges=["Official FJC data", f"{len(districts)} district court(s)"],
            facts=facts([("State or territory", st), ("District courts", ", ".join(districts)), (f"Civil filings FY{LATEST_FY}", n(cur and cur["filings"])),
                         (f"Civil terminations FY{LATEST_FY}", n(cur and cur["terminations"])), (f"Pending at Sep 30, {LATEST_FY}", n(cur and cur["pending_end"])),
                         (f"Median time to termination FY{LATEST_FY}", days_label(cur and cur["median_days"])),
                         ("Counting", "Sum of the state's district courts; a case counts where it was filed; see the dataset summary."),
                         ("Coverage", f"FY1988 to FY{PARTIAL_FY} (through 2026-06-30), civil cases only.")]),
            text=f"{st} federal civil cases FJC IDB", filters={"state": [st]}, links=links,
            extra={"profile": {"state": st, "districts": districts, "series": ser, "window": win, "latest_fy": LATEST_FY}},
        ))
    out["fjc_civil_states"] = {
        "label": "Federal civil cases by state, FY1988–FY2026 (FJC Integrated Database; district courts summed by state)",
        "listing": writer.listing([("state", "State"), ("districts", "Districts"), ("filings", f"Filed FY{LATEST_FY}"), ("terminations", f"Terminated FY{LATEST_FY}"),
                                   ("pending", "Pending Sep 30"), ("median_days", "Median days to termination"), ("class_action_pct", "Class action %"),
                                   ("pro_se_pct", "Pro se plaintiff %"), ("product_pct", "Product liability %")]),
        "summary": {**common_summary, "grain": "one record per state/territory with a district court (54: 50 states, DC, PR, VI, GU, MP)"},
        "rows": s_rows,
    }

    # ------------------------------------------------------------------ national
    us_ser = series_for(aggs["us"], "US")
    fyg: dict[int, list] = defaultdict(list)
    for fy, g, c in fy_groups:
        fyg[fy].append({"group": g, "label": ca.GROUP_LABEL.get(g, g), "filings": c})
    fyn: dict[int, list] = defaultdict(list)
    for fy, no, c in fy_nos:
        fyn[fy].append({"nos": no, "label": nos_names.get(no, f"Code {no}"), "filings": c})
    n_rows = []
    by_fy_district = {}
    for cid, ser in d_series.items():
        for s in ser:
            by_fy_district.setdefault(s["fy"], []).append((cid, s["filings"]))
    for s in us_ser:
        fy = s["fy"]
        gl = fyg.get(fy, [])
        tot = sum(g["filings"] for g in gl)
        for g in gl:
            g["share_pct"] = pct(g["filings"], tot)
        top_d = sorted(by_fy_district.get(fy, []), key=lambda kv: (-kv[1], kv[0]))[:10]
        label = f"FY{fy}" + (" (Oct 1, 2025 – Jun 30, 2026, partial)" if fy == PARTIAL_FY else "")
        n_rows.append(writer.record(
            "fjc_civil_national", f"US:FY{fy}", f"United States — federal civil cases {label}",
            source_url=PAGE,
            subtitle=f"{n(s['filings'])} filed · {n(s['terminations'])} terminated · {n(s['pending_end'])} pending at year end · median {days_label(s['median_days'])}",
            cells={"fy": fy, "filings": s["filings"], "terminations": s["terminations"], "pending": s["pending_end"], "median_days": s["median_days"],
                   "class_action_pct": s["class_action_pct"], "pro_se_pct": s["pro_se_plaintiff_pct"], "product_pct": s["product_pct"],
                   "trial_pct": s["trial_pct"], "settled_pct": s["settled_pct"]},
            badges=["Official FJC data"] + (["Partial year"] if s["partial"] else []),
            facts=facts([("Fiscal year", label), ("Civil filings", n(s["filings"])), ("Civil terminations", n(s["terminations"])), ("Pending at year end", n(s["pending_end"])),
                         ("Median days to termination", days_label(s["median_days"])), ("Class-action allegation share", pct_label(s["class_action_pct"])),
                         ("Pro se plaintiff share", pct_label(s["pro_se_plaintiff_pct"])), ("Settled share of terminations", pct_label(s["settled_pct"])),
                         ("Trial-judgment share of terminations", pct_label(s["trial_pct"])),
                         ("MDL: transferred in / originating in the district", f"{n(s['mdl_transfer_in'])} / {n(s['mdl_originating'])} (IDB origin codes 6 and 13)"),
                         ("Counting", "AO statistical years; see the dataset summary.")]),
            text=f"federal civil cases {label}", filters={"kind": ["year"], "fy": [str(fy)]},
            links=[{"label": "FJC IDB civil data (source)", "url": PAGE}],
            extra={"year": {**s, "groups": gl, "top_nos": fyn.get(fy, []), "top_districts": [{"court_id": c, "filings": f} for c, f in top_d]}},
        ))
    summary_profile = {"series": us_ser, "window": window_profile(mixes["us"], "US", nos_names), "latest_fy": LATEST_FY, "partial_fy": PARTIAL_FY}
    n_rows.append(writer.record(
        "fjc_civil_national", "US:summary", "United States — federal civil case series and mix (FJC IDB)",
        source_url=PAGE,
        subtitle=f"FY1988–FY{PARTIAL_FY} · FY{WIN[0]}–FY{WIN[1]}: {n(summary_profile['window']['filings'])} civil filings",
        cells={"fy": f"FY{WIN[0]}–FY{WIN[1]}", "filings": summary_profile["window"]["filings"], "terminations": None, "pending": None, "median_days": None,
               "class_action_pct": None, "pro_se_pct": None, "product_pct": None, "trial_pct": None, "settled_pct": None},
        badges=["Official FJC data", "Series"],
        facts=facts([("Series", f"FY1988–FY{PARTIAL_FY}, one point per fiscal year"), ("Source", PAGE), ("Quality", json.dumps(quality, sort_keys=True))]),
        text="federal civil case series national mix", filters={"kind": ["summary"], "fy": ["all"]},
        links=[{"label": "FJC IDB civil data (source)", "url": PAGE}, {"label": "IDB civil codebook", "url": CODEBOOK}],
        extra={"profile": summary_profile},
    ))
    out["fjc_civil_national"] = {
        "label": "United States — federal civil cases by fiscal year, FY1988–FY2026 (FJC Integrated Database)",
        "listing": writer.listing([("fy", "Fiscal year"), ("filings", "Filed"), ("terminations", "Terminated"), ("pending", "Pending at year end"), ("median_days", "Median days"),
                                   ("class_action_pct", "Class action %"), ("pro_se_pct", "Pro se plaintiff %"), ("product_pct", "Product liability %"),
                                   ("trial_pct", "Trial %"), ("settled_pct", "Settled %")]),
        "summary": {**common_summary, "grain": "one record per fiscal year plus a series/mix summary record"},
        "rows": n_rows,
    }

    # ------------------------------------------------------------------ nature of suit and groups
    nos_rows = []
    nos_dist = defaultdict(list)
    for no, cid, c in nos_districts:
        nos_dist[str(no)].append({"court_id": cid, "filings": c})
    grp_dist = defaultdict(list)
    for g, cid, c in grp_districts:
        grp_dist[g].append({"court_id": cid, "filings": c})
    keys = sorted({r["k"] for r in aggs["nos"]["filed"]}, key=lambda x: int(x))
    for k in keys:
        no = int(k)
        ser = series_for(aggs["nos"], k)
        cur = next((s for s in ser if s["fy"] == LATEST_FY), None)
        win = window_profile(mixes["nos"], k, nos_names)
        grp = ca.NOS_TO_GROUP.get(no, "unmapped")
        name = nos_names.get(no, f"Code {no} (not in the codebook)")
        nos_rows.append(writer.record(
            "fjc_civil_nos", f"nos:{no}", f"NOS {no} — {name}", source_url=PAGE,
            subtitle=f"{ca.GROUP_LABEL[grp]} · FY{LATEST_FY}: {n(cur and cur['filings'])} filed · median {days_label(cur and cur['median_days'])} to termination",
            cells={"code": no, "name": name, "group": ca.GROUP_LABEL[grp], "filings": cur and cur["filings"], "terminations": cur and cur["terminations"],
                   "median_days": cur and cur["median_days"], "class_action_pct": cur and cur["class_action_pct"], "pro_se_pct": cur and cur["pro_se_plaintiff_pct"],
                   "settled_pct": cur and cur["settled_pct"], "trial_pct": cur and cur["trial_pct"]},
            badges=["Official FJC data", ca.GROUP_LABEL[grp]],
            facts=facts([("Nature of suit", f"{no} {name}"), ("Group used here", ca.GROUP_LABEL[grp] + " (this project's grouping)"), (f"Filings FY{LATEST_FY}", n(cur and cur["filings"])),
                         (f"Terminations FY{LATEST_FY}", n(cur and cur["terminations"])), (f"Median days to termination FY{LATEST_FY}", days_label(cur and cur["median_days"])),
                         ("Top districts by filings, last five complete fiscal years", ", ".join(f"{d['court_id']} ({d['filings']:,})" for d in nos_dist.get(k, [])[:5]) or None),
                         ("Counting", "National, all districts; see the dataset summary.")]),
            text=f"nature of suit {no} {name}", filters={"kind": ["nos"], "group": [grp]},
            links=[{"label": "IDB civil codebook (NOS list)", "url": CODEBOOK}, {"label": "FJC IDB civil data (source)", "url": PAGE}],
            extra={"profile": {"nos": no, "name": name, "group": grp, "series": ser, "window": win, "top_districts": nos_dist.get(k, [])}},
        ))
    for g in [g for g, _, _ in ca.NOS_GROUPS] + ["unmapped"]:
        if not any(r["k"] == g for r in aggs["grp"]["filed"]):
            continue
        ser = series_for(aggs["grp"], g)
        cur = next((s for s in ser if s["fy"] == LATEST_FY), None)
        win = window_profile(mixes["grp"], g, nos_names)
        members = next((codes_ for key, _, codes_ in ca.NOS_GROUPS if key == g), [])
        nos_rows.append(writer.record(
            "fjc_civil_nos", f"group:{g}", f"{ca.GROUP_LABEL[g]} — group of nature-of-suit codes", source_url=PAGE,
            subtitle=f"FY{LATEST_FY}: {n(cur and cur['filings'])} filed · median {days_label(cur and cur['median_days'])} to termination",
            cells={"code": "group", "name": ca.GROUP_LABEL[g], "group": ca.GROUP_LABEL[g], "filings": cur and cur["filings"], "terminations": cur and cur["terminations"],
                   "median_days": cur and cur["median_days"], "class_action_pct": cur and cur["class_action_pct"], "pro_se_pct": cur and cur["pro_se_plaintiff_pct"],
                   "settled_pct": cur and cur["settled_pct"], "trial_pct": cur and cur["trial_pct"]},
            badges=["Official FJC data", "Group (this project's grouping)"],
            facts=facts([("Group", ca.GROUP_LABEL[g]), ("Codes in the group", ", ".join(f"{c} {nos_names.get(c, '')}".strip() for c in members) or "codes not listed in any group"),
                         (f"Filings FY{LATEST_FY}", n(cur and cur["filings"])), (f"Median days to termination FY{LATEST_FY}", days_label(cur and cur["median_days"])),
                         ("Counting", "National, all districts; the grouping is this project's, not an FJC category.")]),
            text=f"nature of suit group {ca.GROUP_LABEL[g]}", filters={"kind": ["group"], "group": [g]},
            links=[{"label": "IDB civil codebook (NOS list)", "url": CODEBOOK}],
            extra={"profile": {"group": g, "label": ca.GROUP_LABEL[g], "members": [{"nos": c, "name": nos_names.get(c)} for c in members], "series": ser, "window": win,
                               "top_districts": grp_dist.get(g, [])}},
        ))
    out["fjc_civil_nos"] = {
        "label": "Federal civil cases by nature of suit and NOS group, FY1988–FY2026 (FJC Integrated Database)",
        "listing": writer.listing([("code", "NOS code"), ("name", "Nature of suit"), ("group", "Group"), ("filings", f"Filed FY{LATEST_FY}"), ("terminations", f"Terminated FY{LATEST_FY}"),
                                   ("median_days", "Median days to termination"), ("class_action_pct", "Class action %"), ("pro_se_pct", "Pro se plaintiff %"),
                                   ("settled_pct", "Settled %"), ("trial_pct", "Trial %")],
                                  [("kind", "Kind", {"nos": "Nature-of-suit code", "group": "Group"}), ("group", "Group", {k: v for k, v in ca.GROUP_LABEL.items()})]),
        "summary": {**common_summary, "grain": "one record per nature-of-suit code that appears in the data plus one per group",
                    "groups": [{"group": k, "label": lbl, "codes": c} for k, lbl, c in ca.NOS_GROUPS]},
        "rows": nos_rows,
    }

    # ------------------------------------------------------------------ MDL association
    by_fy = defaultdict(list)
    for r in mdl["by_fy"]:
        by_fy[r["mdl"]].append({"fy": r["fy"], "cases": r["n"]})
    by_d = defaultdict(list)
    for r in mdl["by_district"]:
        by_d[r["mdl"]].append({"court_id": r["court_id"], "cases": r["n"]})
    by_n = defaultdict(list)
    for r in mdl["by_nos"]:
        by_n[r["mdl"]].append({"nos": r["nos"], "label": nos_names.get(r["nos"], f"Code {r['nos']}"), "cases": r["n"]})
    by_def = defaultdict(list)
    for r in mdl["defendants"]:
        by_def[r["mdl"]].append({"first_listed_defendant": r["def"], "cases": r["n"]})
    m_rows = []
    for t in mdl["totals"]:
        m = t["mdl"]
        sid = str(m)
        links = []
        if sid in mdls_corpus:
            links.append({"label": f"MDL {m} lens", "url": f"/matters/lens/{m}"})
        if sid in mdl_analytics:
            links.append({"label": f"MDL {m} analytics (JPML)", "url": f"/records/mdl_analytics/{m}"})
        if sid in mdls_corpus:
            links.append({"label": f"MDL {m} record", "url": f"/records/mdls/{m}"})
        links += [{"label": "FJC IDB civil data (source)", "url": PAGE}, {"label": "IDB civil codebook (MDLDOCK, ORIGIN)", "url": CODEBOOK}]
        first, last = str(t["first_filed"])[:10], str(t["last_filed"])[:10]
        top_d = by_d.get(m, [])
        top_def = by_def.get(m, [])
        m_rows.append(writer.record(
            "fjc_civil_mdls", f"mdl:{m}", f"MDL {m} — civil cases carrying this MDL docket number (FJC IDB, historical association)", source_url=PAGE,
            subtitle=f"{n(t['cases'])} cases in {t['districts']} district(s) · filed {first} to {last} · {n(t['pending'])} pending",
            cells={"mdl": m, "cases": t["cases"], "pending": t["pending"], "districts": t["districts"], "first_filed": first, "last_filed": last,
                   "median_days": t["median_days"], "settled": t["settled"], "dismissed_other": t["dismissed_other"], "mdl_transfer_out": t["mdl_transfer_out"],
                   "top_district": top_d[0]["court_id"] if top_d else None},
            badges=["FJC IDB association (historical)", "Not current MDL membership"],
            facts=facts([("MDL docket number", str(m)), ("Evidence", "Cases whose IDB record carries MDLDOCK = this number (FJC IDB association, labelled historical; not current JPML membership)"),
                         ("Cases carrying the number", n(t["cases"])), ("Pending in the IDB", n(t["pending"])), ("Districts", n(t["districts"])), ("First / last filing date", f"{first} / {last}"),
                         ("Transferred in (origin 6) / originating in the district (origin 13)", f"{n(t['transferred_in'])} / {n(t['originating'])}"),
                         (f"Median days to termination (among the {t['with_days']:,} terminated cases only; {pct_label(pct(t['with_days'], t['cases']))} of the cases)", days_label(t["median_days"])),
                         ("Terminations coded settled / MDL transfer / dismissed (other, voluntary, jurisdiction, prosecution)", f"{n(t['settled'])} / {n(t['mdl_transfer_out'])} / {n(t['dismissed_other'])}"),
                         ("Largest districts by cases", ", ".join(f"{d['court_id']} ({d['cases']:,})" for d in top_d[:5]) or None),
                         ("First-listed defendants (as recorded, exact text)", "; ".join(f"{d['first_listed_defendant']} ({d['cases']:,})" for d in top_def) or None)]),
            text=f"MDL {m} FJC IDB cases " + " ".join(d["first_listed_defendant"] for d in top_def),
            filters={"kind": ["mdl"], "in_corpus": ["yes" if sid in mdls_corpus else "no"], "status": ["open" if t["pending"] else "closed"]}, links=links,
            extra={"profile": {"mdl": m, "totals": {k: (str(v)[:10] if hasattr(v, "isoformat") else v) for k, v in t.items()}, "by_fy": by_fy.get(m, []),
                               "districts": top_d, "nos": by_n.get(m, []), "defendants": top_def, "in_corpus": sid in mdls_corpus}},
        ))
    out["fjc_civil_mdls"] = {
        "label": "Civil cases carrying an MDL docket number, FY1988–FY2026 (FJC Integrated Database, historical association)",
        "listing": writer.listing([("mdl", "MDL"), ("cases", "Cases"), ("pending", "Pending"), ("districts", "Districts"), ("first_filed", "First filed"), ("last_filed", "Last filed"),
                                   ("median_days", "Median days to termination"), ("settled", "Settled"), ("top_district", "Largest district")],
                                  [("status", "Status", {"open": "Pending cases remain", "closed": "No pending cases"}), ("in_corpus", "In JPML records", {"yes": "Yes", "no": "No"})]),
        "summary": {**common_summary, "grain": "one record per MDL docket number carried by at least one IDB civil case",
                    "evidence_rule": "Association comes from the IDB field MDLDOCK on each case record; it is labelled historical and is not the JPML's current membership list.",
                    "non_numeric_mdl_values_excluded": {"records": mdl["non_numeric"][0], "distinct_values": mdl["non_numeric"][1]}},
        "rows": m_rows,
    }

    for ds, spec in out.items():
        spec.update({"dataset": ds, "built_at": built_at, "inputs": inputs, "listing_block": spec.pop("listing")})
        spec["summary"]["built_at"] = built_at
    if not quiet:
        print("built", round(time.time() - t0, 1), "s", {k: len(v["rows"]) for k, v in out.items()}, flush=True)
    return out


def main() -> None:
    out = build()
    for ds, spec in out.items():
        payload = {"dataset": ds, "label": spec["label"], "listing_block": spec["listing_block"], "summary": spec["summary"], "rows": spec["rows"],
                   "built_at": spec["built_at"], "inputs": spec["inputs"]}
        path = os.path.join(OUT, ds + ".json")
        tmp = path + ".tmp"
        with open(tmp, "w") as h:
            json.dump(payload, h, ensure_ascii=False, sort_keys=True)
        os.replace(tmp, path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
