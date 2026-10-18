"""Build clb_top_cited: the 1,000 opinion clusters with the highest CourtListener citation_count, with who cites them.

For each cluster: court, filing date, reporter citations, CourtListener's own citation_count, and the citing courts and decades read from
the bulk citation map (opinion-to-opinion links). The two counts are different measures and both are shown: citation_count is a field
CourtListener computes; the citation-map count is the number of links in the bulk map that point at the cluster's opinions.
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
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import build_clb_courts as bc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DB = bc.DB
OUT = bc.OUT
DATASET = "clb_top_cited"


def has_table(con, name):
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[0])


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine_ids = set(bc.lookup("court_spine")["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    top = con.execute("SELECT cid, court_id, docket_id, case_name, filed, cites FROM w_cl_top_national ORDER BY cites DESC, cid").fetchall()
    citers = defaultdict(list)
    for cid, court, yr, n in con.execute("SELECT cited_cid, citing_court, yr, n FROM w_top_citers").fetchall():
        citers[cid].append((court, yr, n))
    all_links = {cid: n for cid, n in con.execute("SELECT cited_cid, links FROM w_top_links").fetchall()}
    reps = defaultdict(list)
    for cid, vol, rep, page, typ in con.execute("SELECT cid, volume, reporter, page, type FROM w_top_reporters").fetchall():
        reps[cid].append((typ, vol, rep, page))
    paren = bc.one(con, "SELECT * FROM w_paren") if has_table(con, "w_paren") else {}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (slim tables in private/acq/courtlistener/db)", "sha256": None}
              for u in (bc.CLUSTERS_URL, cc.BULK_BASE + "citation-map-2026-09-30.csv.bz2", bc.CITATIONS_URL, cc.BULK_BASE + "opinions-2026-09-30.csv.bz2")]
    rows = []
    for rank, (cid, court, docket_id, name, filed, cites) in enumerate(top, 1):
        lst = citers.get(cid, [])
        total_known = sum(n for _, _, n in lst)  # links whose citing opinion is in the opinion table (court and year can be read)
        total_map = all_links.get(cid, 0)  # every row of the citation map that points at the cluster's opinions
        by_court = Counter()
        by_decade = Counter()
        by_group = Counter()
        for c, yr, n in lst:
            by_court[c] += n
            if yr:
                by_decade[yr // 10 * 10] += n
            j = courts.get(c, {}).get("jur")
            by_group["Federal" if j in cc.FEDERAL_JURISDICTIONS else "State" if j in cc.STATE_JURISDICTIONS else "Other"] += n
        citations = sorted(reps.get(cid, []), key=lambda t: (t[0] if t[0] is not None else 99, t[2] or "", t[1] or ""))
        cite_strs = [f"{v} {r} {p}".strip() for _, v, r, p in citations]
        primary = cite_strs[0] if cite_strs else None
        courtname = courts.get(court, {}).get("name", court)
        top_courts = [{"court_id": c, "name": courts.get(c, {}).get("name", c), "count": n, "share_pct": cc.share(n, total_known), "link": f"/courts/{c}" if c in spine_ids else None}
                      for c, n in by_court.most_common(8) if c]
        years = sorted(y for _, y, _ in lst if y)
        pr = paren.get(cid)
        url = f"https://www.courtlistener.com/opinion/{cid}/"
        rows.append(writer.record(
            DATASET, f"cluster:{cid}", f"{name or 'Case name not recorded'}" + (f", {primary}" if primary else ""), source_url=bc.CLUSTERS_URL,
            subtitle=f"{courtname} · {filed.year if filed else 'date not recorded'} · cited {cites:,} times in CourtListener's network (rank {rank})",
            cells={"rank": rank, "case": name, "court": courtname, "year": filed.year if filed else None, "citation": primary, "times_cited": cites, "map_links": total_map or None,
                   "federal_pct": cc.share(by_group.get("Federal", 0), total_known), "state_pct": cc.share(by_group.get("State", 0), total_known)},
            badges=["CourtListener bulk data", "Citation counts are extracted from text"],
            facts=bc.facts([("Case name (as recorded)", name), ("Court", courtname), ("Date filed", str(filed) if filed else None), ("Reporter citations", "; ".join(cite_strs[:6]) or None),
                            ("Times cited (CourtListener citation_count)", f"{cites:,}"), ("Links in the bulk citation map pointing at its opinions", f"{total_map:,}" if total_map else None),
                            ("Cited most by", "; ".join(f"{t['name']} {t['share_pct']}%" for t in top_courts[:4]) or None),
                            ("Cited from federal / state / other courts", " / ".join(f"{cc.share(by_group.get(g, 0), total_known)}%" for g in ("Federal", "State", "Other")) if total_known else None),
                            ("Basis of those shares", f"{total_known:,} of the {total_map:,} map links, those whose citing opinion is in the opinion table" if total_map else None),
                            ("Parenthetical descriptions of its opinions", f"{pr['n']:,}" if pr else None),
                            ("Counting", "Two different measures: CourtListener's citation_count field and the number of links in the bulk citation map; they are not expected to match exactly.")]),
            text=f"most cited opinion {name} {primary or ''} {courtname}", filters={"court": [court or "unknown"]}, links=[{"label": "Opinion on CourtListener", "url": url}] + ([{"label": "Court profile", "url": f"/courts/{court}"}] if court in spine_ids else []),
            extra={"profile": {"rank": rank, "cluster_id": cid, "docket_id": docket_id, "case_name": name, "court_id": court, "court": courtname, "date_filed": str(filed) if filed else None,
                               "citations": [{"volume": v, "reporter": r, "page": p, "type": t} for t, v, r, p in citations], "times_cited": cites, "map_links": total_map, "links_with_known_citing_court": total_known,
                               "citing_courts": top_courts, "citing_groups": dict(by_group), "citing_by_decade": [{"decade": d, "n": n} for d, n in sorted(by_decade.items())],
                               "first_cited_year": years[0] if years else None, "last_cited_year": years[-1] if years else None,
                               "parentheticals": ({"n": pr["n"], "describing_opinions": pr["describing"], "avg_score": cc.r2(pr["avg_score"])} if pr else None), "url": url}}))
    summary = {
        "source": "CourtListener bulk data: opinion-clusters, citation-map, citations, opinions (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"clusters": len(rows), "min_times_cited": min((r["item"]["cells"]["times_cited"] for r in rows), default=None), "max_times_cited": max((r["item"]["cells"]["times_cited"] for r in rows), default=None)},
        "definitions": {"times cited": "CourtListener's citation_count for the cluster", "map links": "rows of the bulk citation map whose cited opinion belongs to the cluster",
                        "citing court": "court of the docket of the citing opinion's cluster"},
        "caveats": ["Citations are extracted from opinion text by CourtListener and are not a complete census.", "Rank reflects the collection; the most cited opinions in other databases can differ.", "Case names are as recorded and can be truncated or reversed."],
        "grain": "one record per opinion cluster among the 1,000 most cited"}
    return {DATASET: {
        "dataset": DATASET, "label": "The 1,000 most-cited opinions in CourtListener's citation network, with citing courts (Sept 30, 2026)",
        "listing_block": writer.listing([("rank", "Rank"), ("case", "Case"), ("court", "Court"), ("year", "Year"), ("citation", "Citation"), ("times_cited", "Times cited"), ("map_links", "Citation-map links"),
                                         ("federal_pct", "Cited from federal courts %"), ("state_pct", "Cited from state courts %")], []),
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
