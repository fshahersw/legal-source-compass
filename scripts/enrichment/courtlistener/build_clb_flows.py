"""Build clb_court_flows: court-to-court citation flows from the CourtListener citation map and appeal flows from docket.appeal_from_id.

A citation edge is one row of CourtListener's citation map (a citing opinion cites a cited opinion), attributed to the court of each
opinion's docket. The map is what CourtListener extracted from opinion text: it is not a complete census of citations and its coverage
depends on the corpus (older and unpublished opinions cite less reliably). Appeal flows count dockets that carry an appeal_from court.
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

import build_clb_courts as bc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DB = bc.DB
OUT = bc.OUT
DATASET = "clb_court_flows"
MIN_EDGE = 100
MAX_EDGES = 1500
MIN_APPEAL_EDGE = 25
CIRCUITS = ["ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"]


def group(jur):
    return "Federal" if jur in cc.FEDERAL_JURISDICTIONS else "State" if jur in cc.STATE_JURISDICTIONS else "Other"


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine = bc.lookup("court_spine")
    spine_ids = set(spine["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2], "short": r[3]} for r in sm.execute("SELECT id, full_name, jurisdiction, short_name FROM courts").fetchall()}
    flow = [(a, b, n) for a, b, n in con.execute("SELECT citing_court, cited_court, n FROM w_cite_flow").fetchall()]
    matched = [(a, b, n) for a, b, n in flow if a and b]
    unresolved = sum(n for a, b, n in flow if not a or not b)
    out_tot, in_tot = Counter(), Counter()
    for a, b, n in matched:
        out_tot[a] += n
        in_tot[b] += n
    lag = bc.one(con, "SELECT * FROM w_cite_lag")
    lvl_year = bc.by(con, "SELECT * FROM w_cite_level_year", "yr")
    appeals = [(r[0], r[1], r[2]) for r in con.execute("SELECT court_id, from_court, n FROM w_appeal").fetchall()]
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (slim tables in private/acq/courtlistener/db)", "sha256": None}
              for u in (cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2", cc.BULK_BASE + "opinions-2026-09-30.csv.bz2", bc.DOCKETS_URL, bc.CLUSTERS_URL)]
    rows = []

    def cname(cid):
        return courts.get(cid, {}).get("name", cid)

    def link(cid):
        return f"/courts/{cid}" if cid in spine_ids else None

    total = sum(n for _, _, n in matched)
    same = sum(n for a, b, n in matched if a == b)
    # ---------------------------------------------------------------- cross-court citation edges
    cross = sorted(((a, b, n) for a, b, n in matched if a != b and n >= MIN_EDGE), key=lambda t: (-t[2], t[0], t[1]))[:MAX_EDGES]
    for a, b, n in cross:
        rows.append(writer.record(
            DATASET, f"cite:{a}>{b}", f"{cname(a)} citing {cname(b)}: citation edges in CourtListener's citation map", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
            subtitle=f"{n:,} citations · {cc.share(n, out_tot[a])}% of {cname(a)}'s citations that resolve to a court",
            cells={"kind": "citation", "from": cname(a), "to": cname(b), "count": n, "share_of_from_pct": cc.share(n, out_tot[a]), "share_of_to_pct": cc.share(n, in_tot[b]),
                   "from_level": cc.JURISDICTION_LABEL.get(courts.get(a, {}).get("jur"), "Not recorded"), "to_level": cc.JURISDICTION_LABEL.get(courts.get(b, {}).get("jur"), "Not recorded"), "median_lag_years": None},
            badges=["CourtListener bulk data", "Citation map is extracted from text"],
            facts=bc.facts([("Citing court", cname(a)), ("Cited court", cname(b)), ("Citations (opinion-to-opinion links)", f"{n:,}"),
                            ("Share of the citing court's citations with a resolved court", f"{cc.share(n, out_tot[a])}% of {out_tot[a]:,}"),
                            ("Share of the cited court's incoming citations", f"{cc.share(n, in_tot[b])}% of {in_tot[b]:,}"),
                            ("Counting", "One link per citing opinion and cited opinion pair in CourtListener's citation map, attributed to the court of each opinion's docket. Not a complete census of citations.")]),
            text=f"citations {cname(a)} {cname(b)} {a} {b}", filters={"kind": ["citation"]}, links=[x for x in ({"label": f"{cname(a)}", "url": link(a)} if link(a) else None, {"label": f"{cname(b)}", "url": link(b)} if link(b) else None) if x],
            extra={"profile": {"citing_court": a, "cited_court": b, "count": n, "share_of_citing_pct": cc.share(n, out_tot[a]), "share_of_cited_pct": cc.share(n, in_tot[b])}}))
    # ---------------------------------------------------------------- per-court citing behaviour
    by_from = defaultdict(list)
    for a, b, n in matched:
        by_from[a].append((b, n))
    for a, lst in sorted(by_from.items(), key=lambda kv: -out_tot[kv[0]]):
        if out_tot[a] < 5000:
            continue
        lg = lag.get(a)
        top = bc.shares([(b, n) for b, n in lst], out_tot[a], 8, None, cname)
        self_pct = cc.share(sum(n for b, n in lst if b == a), out_tot[a])
        groups = Counter()
        for b, n in lst:
            groups[group(courts.get(b, {}).get("jur"))] += n
        scotus = sum(n for b, n in lst if b == "scotus")
        rows.append(writer.record(
            DATASET, f"citing:{a}", f"{cname(a)}: whom it cites (CourtListener citation map)", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
            subtitle=f"{out_tot[a]:,} citations made · {self_pct}% to its own opinions" + (f" · median age of cited opinion {lg['median_years']:.1f} years" if lg and lg["median_years"] is not None else ""),
            cells={"kind": "citing court", "from": cname(a), "to": None, "count": out_tot[a], "share_of_from_pct": self_pct, "share_of_to_pct": cc.share(scotus, out_tot[a]),
                   "from_level": cc.JURISDICTION_LABEL.get(courts.get(a, {}).get("jur"), "Not recorded"), "to_level": None, "median_lag_years": cc.r1(lg["median_years"]) if lg else None},
            badges=["CourtListener bulk data", "Citation map is extracted from text"],
            facts=bc.facts([("Citing court", cname(a)), ("Citations made that resolve to a court", f"{out_tot[a]:,}"), ("To its own opinions", f"{self_pct}%"), ("To the U.S. Supreme Court", f"{cc.share(scotus, out_tot[a])}%"),
                            ("To federal / state / other courts", " / ".join(f"{cc.share(groups.get(g, 0), out_tot[a])}%" for g in ("Federal", "State", "Other"))),
                            ("Median years between the cited opinion and the citing opinion", f"{lg['median_years']:.1f} (n = {lg['n']:,}; 90th percentile {lg['p90_years']:.1f})" if lg else None),
                            ("Most-cited courts", "; ".join(f"{t['label']} {t['share_pct']}%" for t in top[:5]))]),
            text=f"citing court {cname(a)} {a}", filters={"kind": ["citing court"]}, links=[{"label": "Court profile", "url": link(a)}] if link(a) else [],
            extra={"profile": {"court_id": a, "total": out_tot[a], "self_pct": self_pct, "scotus_pct": cc.share(scotus, out_tot[a]), "groups": dict(groups), "top": [{"court_id": t["value"], "name": t["label"], "count": t["count"], "share_pct": t["share_pct"], "link": link(t["value"])} for t in top],
                               "lag": ({"n": lg["n"], "median_years": cc.r1(lg["median_years"]), "p90_years": cc.r1(lg["p90_years"]), "mean_years": cc.r1(lg["mean_years"])} if lg else None)}}))
    # ---------------------------------------------------------------- circuits matrix and level matrix
    cmat = {a: {b: 0 for b in CIRCUITS + ["scotus"]} for a in CIRCUITS}
    for a, b, n in matched:
        if a in cmat and b in cmat[a]:
            cmat[a][b] += n
    rows.append(writer.record(
        DATASET, "matrix:circuits", "Federal courts of appeals citing each other and the Supreme Court (CourtListener citation map)", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
        subtitle="13 courts of appeals × 13 courts of appeals + the U.S. Supreme Court", cells={"kind": "matrix", "from": "Courts of appeals", "to": "Courts of appeals and Supreme Court", "count": sum(sum(r.values()) for r in cmat.values()),
                                                                                              "share_of_from_pct": None, "share_of_to_pct": None, "from_level": None, "to_level": None, "median_lag_years": None},
        badges=["CourtListener bulk data", "Citation map is extracted from text"],
        facts=bc.facts([("Rows", "citing court"), ("Columns", "cited court"), ("Cells", "citation links in CourtListener's citation map"),
                        ("Courts", ", ".join(CIRCUITS) + ", scotus"), ("Counting", "Links attributed to the court of each opinion's docket; self-citation is the diagonal.")]),
        text="circuit citation matrix courts of appeals", filters={"kind": ["matrix"]}, links=[],
        extra={"profile": {"rows": CIRCUITS, "columns": CIRCUITS + ["scotus"], "names": {c: cname(c) for c in CIRCUITS + ["scotus"]}, "cells": [[cmat[a][b] for b in CIRCUITS + ["scotus"]] for a in CIRCUITS]}}))
    lm = defaultdict(Counter)
    for a, b, n in matched:
        la, lb = courts.get(a, {}).get("jur"), courts.get(b, {}).get("jur")
        lm[cc.JURISDICTION_LABEL.get(la, f"Code {la}")][cc.JURISDICTION_LABEL.get(lb, f"Code {lb}")] += n
    labels = [l for l, _ in Counter({k: sum(v.values()) for k, v in lm.items()}).most_common(10)]
    rows.append(writer.record(
        DATASET, "matrix:levels", "Court levels citing each other (CourtListener citation map)", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
        subtitle="Citing court level × cited court level", cells={"kind": "matrix", "from": "Court levels", "to": "Court levels", "count": total, "share_of_from_pct": cc.share(same, total), "share_of_to_pct": None,
                                                              "from_level": None, "to_level": None, "median_lag_years": None},
        badges=["CourtListener bulk data", "Citation map is extracted from text"],
        facts=bc.facts([("Citations that resolve to a court on both sides", f"{total:,}"), ("Within the same court", f"{cc.share(same, total)}%"), ("Levels shown", ", ".join(labels)),
                        ("Not resolved to a court", f"{unresolved:,} links where either opinion has no matching docket court")]),
        text="court level citation matrix", filters={"kind": ["matrix"]}, links=[],
        extra={"profile": {"levels": labels, "cells": [[lm[a].get(b, 0) for b in labels] for a in labels]}}))
    # ---------------------------------------------------------------- who cites SCOTUS
    sc_in = sorted(((a, n) for a, b, n in matched if b == "scotus"), key=lambda t: (-t[1], t[0]))
    sc_total = sum(n for _, n in sc_in)
    rows.append(writer.record(
        DATASET, "scotus:citers", "Courts citing the U.S. Supreme Court most (CourtListener citation map)", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
        subtitle=f"{sc_total:,} citation links to Supreme Court opinions", cells={"kind": "scotus", "from": "All courts", "to": cname("scotus"), "count": sc_total, "share_of_from_pct": None, "share_of_to_pct": None,
                                                                                "from_level": None, "to_level": None, "median_lag_years": None},
        badges=["CourtListener bulk data", "Citation map is extracted from text"],
        facts=bc.facts([("Citation links to Supreme Court opinions", f"{sc_total:,}"), ("Largest citing courts", "; ".join(f"{cname(a)} {n:,}" for a, n in sc_in[:6]))]),
        text="courts citing supreme court", filters={"kind": ["scotus"]}, links=[],
        extra={"profile": {"total": sc_total, "citers": [{"court_id": a, "name": cname(a), "count": n, "share_pct": cc.share(n, sc_total), "link": link(a)} for a, n in sc_in[:40]]}}))
    # ---------------------------------------------------------------- per year
    for yr, lst in sorted(lvl_year.items()):
        if yr is None or not (1800 <= yr <= 2026):
            continue
        n = sum(r["n"] for r in lst)
        g = Counter()
        for r in lst:
            g[group(courts.get(r["citing_court"], {}).get("jur"))] += r["n"]
        s = sum(r["same_court"] for r in lst)
        if n < 1000:
            continue
        rows.append(writer.record(
            DATASET, f"year:{yr}", f"Citations made by opinions filed in {yr} (CourtListener citation map)", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
            subtitle=f"{n:,} citation links · {cc.share(s, n)}% within the same court", cells={"kind": "year", "from": str(yr), "to": None, "count": n, "share_of_from_pct": cc.share(s, n), "share_of_to_pct": None,
                                                                                         "from_level": None, "to_level": None, "median_lag_years": None},
            badges=["CourtListener bulk data", "Citation map is extracted from text"],
            facts=bc.facts([("Year of the citing opinion", yr), ("Citation links made", f"{n:,}"), ("Within the same court", f"{cc.share(s, n)}%"),
                            ("From federal / state / other courts", " / ".join(f"{g.get(k, 0):,}" for k in ("Federal", "State", "Other")))]),
            text=f"citations year {yr}", filters={"kind": ["year"]}, links=[], extra={"profile": {"year": yr, "citations": n, "same_court": s, "by_group": dict(g)}}))
    # ---------------------------------------------------------------- appeal flows
    ap_tot = Counter()
    for c, f, n in appeals:
        ap_tot[c] += n
    for c, f, n in sorted(((c, f, n) for c, f, n in appeals if n >= MIN_APPEAL_EDGE), key=lambda t: (-t[2], t[0], str(t[1])))[:MAX_EDGES]:
        rows.append(writer.record(
            DATASET, f"appeal:{f}>{c}", f"Appeals to {cname(c)} from {cname(f) if f in courts else f}: dockets in CourtListener's collection", source_url=bc.DOCKETS_URL,
            subtitle=f"{n:,} dockets · {cc.share(n, ap_tot[c])}% of dockets with an appeal-from court at {cname(c)}",
            cells={"kind": "appeal", "from": cname(f) if f in courts else f, "to": cname(c), "count": n, "share_of_from_pct": None, "share_of_to_pct": cc.share(n, ap_tot[c]),
                   "from_level": cc.JURISDICTION_LABEL.get(courts.get(f, {}).get("jur"), "Not recorded"), "to_level": cc.JURISDICTION_LABEL.get(courts.get(c, {}).get("jur"), "Not recorded"), "median_lag_years": None},
            badges=["CourtListener bulk data", "Collection, not complete court totals"],
            facts=bc.facts([("Appellate (receiving) court", cname(c)), ("Court appealed from (as recorded)", cname(f) if f in courts else f), ("Dockets", f"{n:,}"),
                            ("Share of the receiving court's dockets with an appeal-from court", f"{cc.share(n, ap_tot[c])}% of {ap_tot[c]:,}"),
                            ("Counting", "Dockets whose appeal_from court is recorded; many appellate dockets in the collection have none.")]),
            text=f"appeals {cname(c)} from {cname(f) if f in courts else f}", filters={"kind": ["appeal"]}, links=[x for x in ({"label": cname(c), "url": link(c)} if link(c) else None, {"label": cname(f), "url": link(f)} if f in courts and link(f) else None) if x],
            extra={"profile": {"appellate_court": c, "from_court": f, "dockets": n, "share_pct": cc.share(n, ap_tot[c])}}))
    rows.append(writer.record(
        DATASET, "overview:all", "Court flows in CourtListener: overview", source_url=cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2",
        subtitle=f"{total:,} citation links resolved to courts · {sum(ap_tot.values()):,} dockets with an appeal-from court",
        cells={"kind": "overview", "from": "All courts", "to": "All courts", "count": total, "share_of_from_pct": cc.share(same, total), "share_of_to_pct": None, "from_level": None, "to_level": None, "median_lag_years": None},
        badges=["CourtListener bulk data"],
        facts=bc.facts([("Citation links with a court on both sides", f"{total:,}"), ("Within the same court", f"{cc.share(same, total)}%"), ("Links where a court could not be resolved", f"{unresolved:,}"),
                        ("Dockets with an appeal-from court", f"{sum(ap_tot.values()):,}"), ("Edges published", f"cross-court citation edges with at least {MIN_EDGE:,} links (top {MAX_EDGES:,}); appeal edges with at least {MIN_APPEAL_EDGE}")]),
        text="court flows overview citation appeal", filters={"kind": ["overview"]}, links=[],
        extra={"profile": {"citations": total, "same_court": same, "unresolved": unresolved, "appeal_dockets": sum(ap_tot.values())}}))
    summary = {
        "source": "CourtListener bulk data: citation-map, opinions, dockets, opinion-clusters, courts (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"citation_links_resolved": total, "same_court": same, "unresolved": unresolved, "appeal_dockets": sum(ap_tot.values())},
        "definitions": {"citation link": "one row of the citation map: a citing opinion and a cited opinion", "attribution": "each opinion is attributed to the court of its cluster's docket; links where either opinion has no matching docket court are counted as unresolved",
                        "median age": "median years between the cited opinion's cluster filing date and the citing opinion's, for links where both dates are plausible and the citing opinion is not older",
                        "appeal flow": "dockets whose appeal_from_id names a court, counted by the court that holds the docket"},
        "caveats": ["The citation map is CourtListener's extraction from opinion text, not a complete census of citations.", "Coverage depends on the opinions in the collection; older and unpublished opinions are less complete.", "Appeal-from courts are recorded for a minority of appellate dockets."],
        "grain": "cross-court citation edges, citing-court profiles, matrices, years, appeal edges and an overview"}
    return {DATASET: {
        "dataset": DATASET, "label": "Court-to-court citation and appeal flows (CourtListener citation map and dockets, Sept 30, 2026)",
        "listing_block": writer.listing([("kind", "Type"), ("from", "From / citing"), ("to", "To / cited"), ("count", "Links or dockets"), ("share_of_from_pct", "% of citing court"), ("share_of_to_pct", "% of cited court"),
                                         ("from_level", "Citing level"), ("to_level", "Cited level"), ("median_lag_years", "Median age of cited, years")],
                                        [("kind", "Type", {"citation": "Citation edge", "citing court": "Citing court profile", "matrix": "Matrix", "scotus": "Supreme Court citers", "year": "Year", "appeal": "Appeal edge", "overview": "Overview"})]),
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
