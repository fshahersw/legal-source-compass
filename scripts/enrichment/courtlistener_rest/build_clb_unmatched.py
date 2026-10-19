"""Build clb_unmatched_citations: the citations CourtListener found in opinion text but could not match to an opinion cluster.

Source: unmatched-citations-2026-09-30.csv.bz2 (17.8 million rows: volume, reporter, page, citation type, status, the court and year
written with the citation, and the citing opinion id), streamed by ingest_rest.py and aggregated by build_rest_work.py (r_um_*). The
citing opinion is joined by exact id to the opinion table and its cluster's docket court (work.duckdb w_op). Status and type codes are
labelled with the names CourtListener's source code gives them. Records: an overview, one per reporter with at least MIN_REPORTER rows,
and one per citing court with at least MIN_COURT rows. Whether CourtListener's citation table holds the reporter at all is counted from
the citations file (citation.duckdb).
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402

DATASET = "clb_unmatched_citations"
MIN_REPORTER = 1000
MIN_COURT = 500
CITATIONS_URL = rc.BULK + "citations-2026-09-30.csv.bz2"


def reporter_slug(rep: str, taken: dict) -> str:
    """Stable URL-safe id part for a reporter string; a slug already used by another reporter gets a short hash suffix."""
    base = re.sub(r"[^a-z0-9]+", "-", rep.lower()).strip("-") or "blank"
    slug = base
    if slug in taken and taken[slug] != rep:
        slug = f"{base}-{hashlib.md5(rep.encode()).hexdigest()[:6]}"
    taken[slug] = rep
    return slug


def statuses(row) -> list[dict]:
    total = sum(row[f"s{i}"] for i in range(1, 6))
    return [{"code": i, "label": rc.UNMATCHED_STATUS_LABEL[i], "n": row[f"s{i}"], "share_pct": cc.share(row[f"s{i}"], total)} for i in range(1, 6)]


def unresolved(row) -> int:
    return sum(row[f"s{i}"] for i in rc.UNRESOLVED_STATUSES)


def grouped(con, sql, key):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    out = defaultdict(list)
    for r in cur.fetchall():
        rec = dict(zip(cols, r))
        out[rec[key]].append(rec)
    return out


def build() -> dict:
    import duckdb  # only the build reads the bulk tables; the pure helpers above are tested without it

    con = duckdb.connect(os.path.join(rc.DB, "rest_work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(rc.DB, "small.duckdb"), read_only=True)
    ci = duckdb.connect(os.path.join(rc.DB, "citation.duckdb"), read_only=True)
    spine = rc.spine_ids()
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    matched = {r[0]: (r[1], r[2]) for r in ci.execute("SELECT reporter, count(*), count(DISTINCT cluster_id) FROM citation GROUP BY 1").fetchall()}
    done = __import__("json").load(open(os.path.join(rc.DB, "unmatched_citation.done.json")))

    def cname(c):
        return courts.get(c, {}).get("name", c)

    reps = {r["reporter"]: r for v in grouped(con, "SELECT * FROM r_um_rep", "reporter").values() for r in v}
    rep_top = grouped(con, "SELECT * FROM r_um_rep_top ORDER BY reporter, rn", "reporter")
    rep_court = grouped(con, "SELECT * FROM r_um_rep_court ORDER BY reporter, rn", "reporter")
    rep_dec = grouped(con, "SELECT * FROM r_um_rep_decade ORDER BY reporter, decade", "reporter")
    crt = {r["court_id"]: r for v in grouped(con, "SELECT * FROM r_um_court", "court_id").values() for r in v}
    crt_rep = grouped(con, "SELECT * FROM r_um_court_rep ORDER BY court_id, rn", "court_id")
    crt_type = grouped(con, "SELECT * FROM r_um_court_type ORDER BY court_id, n DESC, type", "court_id")
    crt_year = grouped(con, "SELECT * FROM r_um_court_year ORDER BY court_id, yr", "court_id")
    crt_ops = {r[0]: r[1] for r in con.execute("SELECT court_id, opinions FROM r_um_court_ops").fetchall()}
    totals = con.execute("SELECT status, type, n, opinions, citing_not_in_opinion_table FROM r_um_total").fetchall()
    years = con.execute("SELECT yr, n, opinions FROM r_um_year ORDER BY yr").fetchall()
    cited_court = con.execute("SELECT cited_court, n FROM r_um_cited_court ORDER BY n DESC").fetchall()
    total = sum(t[2] for t in totals)
    assert total == done["rows"], f"aggregates cover {total} rows, the file has {done['rows']}"
    by_status = defaultdict(int)
    by_type = defaultdict(int)
    for st, ty, n, _ops, _x in totals:
        by_status[st] += n
        by_type[ty] += n
    citing_ops = con.execute("SELECT count(*) FROM (SELECT DISTINCT 1)").fetchone()  # placeholder to keep the connection warm
    del citing_ops
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    taken: dict = {}
    rep_rows = []
    for rep, r in sorted(reps.items(), key=lambda kv: (-kv[1]["n"], kv[0] or "")):
        if r["n"] < MIN_REPORTER or not rep:
            continue
        slug = reporter_slug(rep, taken)
        unres = unresolved(r)
        m = matched.get(rep)
        tl = rc.CITATION_TYPE_LABEL.get(r["type"], f"Type {r['type']}")
        profile = {"reporter": rep, "type_code": r["type"], "type": tl, "citations": r["n"], "distinct_citations": r["strings"], "citing_opinions": r["opinions"],
                   "unresolved": unres, "unresolved_pct": cc.share(unres, r["n"]), "statuses": statuses(r), "first_citing_year": r["first_citing_year"], "last_citing_year": r["last_citing_year"],
                   # status: the most frequent status of that citation's rows (ties: lowest code); statuses > 1 means its rows differ
                   "top_citations": [{"citation": t["cs"], "n": t["n"], "status_code": t["status"], "status": rc.UNMATCHED_STATUS_LABEL.get(t["status"]), "statuses": t["statuses"]}
                                     for t in rep_top.get(rep, [])],
                   "citing_courts": [{"court_id": c["citing_court"], "name": cname(c["citing_court"]), "n": c["n"], "share_pct": cc.share(c["n"], r["with_citing_court"]), "link": rc.court_link(c["citing_court"], spine)} for c in rep_court.get(rep, [])],
                   "with_citing_court": r["with_citing_court"], "by_decade": [{"decade": int(d["decade"]), "n": d["n"]} for d in rep_dec.get(rep, []) if d["decade"] is not None],
                   "in_citation_table": {"citations": m[0], "clusters": m[1]} if m else None}
        rep_rows.append(writer.record(
            DATASET, f"reporter:{slug}", f"Unmatched {rep} citations in CourtListener opinions", source_url=rc.UNMATCHED_URL,
            subtitle=f"{r['n']:,} citations ({r['strings']:,} distinct) in {r['opinions']:,} opinions · {cc.share(unres, r['n'])}% still unresolved · {tl}",
            cells={"kind": "reporter", "name": rep, "citations": r["n"], "distinct": r["strings"], "opinions": r["opinions"], "unresolved_pct": cc.share(unres, r["n"]), "type": tl,
                   "in_citation_table": "Yes" if m else "No"},
            badges=["CourtListener bulk data", tl],
            facts=rc.facts([("Reporter (as parsed)", rep), ("Citation type (CourtListener's code name)", f"{tl} ({r['type']})"),
                            ("Unmatched citations", f"{r['n']:,}, {r['strings']:,} distinct, in {r['opinions']:,} citing opinions"),
                            ("Status", "; ".join(f"{s['label']}: {s['n']:,}" for s in statuses(r) if s["n"])),
                            ("Most often cited without a match", "; ".join(f"{t['cs']} ({t['n']:,})" for t in rep_top.get(rep, [])[:5]) or None),
                            ("Reporter in CourtListener's citation table", f"yes: {m[0]:,} citations on {m[1]:,} clusters" if m else "no citation with this reporter string"),
                            ("Citing years", f"{r['first_citing_year']}–{r['last_citing_year']}" if r["first_citing_year"] else None)]),
            text=f"unmatched citations reporter {rep}", filters={"kind": ["reporter"]}, links=[{"label": "Unmatched-citations bulk file", "url": rc.UNMATCHED_URL}],
            extra={"profile": profile}))
    court_rows = []
    for cid, r in sorted(crt.items(), key=lambda kv: (-kv[1]["n"], kv[0])):
        if r["n"] < MIN_COURT or cid not in courts:
            continue
        unres = unresolved(r)
        ops = crt_ops.get(cid)
        types = [{"code": t["type"], "label": rc.CITATION_TYPE_LABEL.get(t["type"], f"Type {t['type']}"), "n": t["n"], "share_pct": cc.share(t["n"], r["n"])} for t in crt_type.get(cid, [])]
        profile = {"court_id": cid, "name": cname(cid), "citations": r["n"], "distinct_citations": r["strings"], "citing_opinions": r["opinions"], "court_opinions": ops,
                   "opinions_with_unmatched_pct": cc.share(r["opinions"], ops or 0), "unresolved": unres, "unresolved_pct": cc.share(unres, r["n"]), "statuses": statuses(r),
                   "reporters": [{"reporter": x["reporter"], "n": x["n"], "share_pct": cc.share(x["n"], r["n"])} for x in crt_rep.get(cid, [])], "types": types,
                   "by_year": [{"yr": int(y["yr"]), "citations": y["n"], "opinions": y["opinions"]} for y in crt_year.get(cid, [])]}
        court_rows.append(writer.record(
            DATASET, f"court:{cid}", f"{cname(cid)}: citations in its opinions that CourtListener could not match", source_url=rc.UNMATCHED_URL,
            subtitle=f"{r['n']:,} unmatched citations in {r['opinions']:,} opinions" + (f" ({cc.share(r['opinions'], ops)}% of its {ops:,} opinions)" if ops else "") + f" · {cc.share(unres, r['n'])}% still unresolved",
            cells={"kind": "court", "name": cname(cid), "citations": r["n"], "distinct": r["strings"], "opinions": r["opinions"], "unresolved_pct": cc.share(unres, r["n"]),
                   "type": types[0]["label"] if types else None, "in_citation_table": None},
            badges=["CourtListener bulk data"],
            facts=rc.facts([("Citing court", f"{cname(cid)} ({cid})"), ("Unmatched citations in its opinions", f"{r['n']:,} ({r['strings']:,} distinct)"),
                            ("Opinions with at least one", f"{r['opinions']:,}" + (f" of {ops:,} ({cc.share(r['opinions'], ops)}%)" if ops else "")),
                            ("Status", "; ".join(f"{s['label']}: {s['n']:,}" for s in statuses(r) if s["n"])),
                            ("Reporters most often unmatched", "; ".join(f"{x['reporter']} ({x['n']:,})" for x in crt_rep.get(cid, [])[:5]) or None),
                            ("Counting", "A citation is attributed to the court of its citing opinion's cluster docket.")]),
            text=f"unmatched citations court {cname(cid)} {cid}", filters={"kind": ["court"]},
            links=[{"label": "Unmatched-citations bulk file", "url": rc.UNMATCHED_URL}] + ([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine else []),
            extra={"profile": profile}))
    unres_all = sum(by_status[s] for s in rc.UNRESOLVED_STATUSES)
    no_court = sum(t[4] for t in totals)
    ov = {"citations": total, "skipped_invalid_rows": done["skipped_invalid_rows"],
          "statuses": [{"code": s, "label": rc.UNMATCHED_STATUS_LABEL.get(s, f"Status {s}"), "n": by_status[s], "share_pct": cc.share(by_status[s], total)} for s in sorted(by_status)],
          "types": [{"code": t, "label": rc.CITATION_TYPE_LABEL.get(t, f"Type {t}"), "n": by_type[t], "share_pct": cc.share(by_type[t], total)} for t in sorted(by_type, key=lambda t: -by_type[t])],
          "unresolved": unres_all, "unresolved_pct": cc.share(unres_all, total), "citing_opinion_not_in_opinion_table": no_court,
          "by_decade": [], "reporters": [{"reporter": r["item"]["profile"]["reporter"], "id": r["id"], "n": r["item"]["cells"]["citations"], "unresolved_pct": r["item"]["cells"]["unresolved_pct"]} for r in rep_rows[:25]],
          "courts": [{"court_id": r["item"]["profile"]["court_id"], "id": r["id"], "name": r["item"]["cells"]["name"], "n": r["item"]["cells"]["citations"],
                      "opinions_with_unmatched_pct": r["item"]["profile"]["opinions_with_unmatched_pct"]} for r in court_rows[:25]],
          "cited_court_written": [{"court_id": c, "name": cname(c) if c else None, "n": n} for c, n in cited_court[:12]],
          "reporters_total": len(reps), "reporters_listed": len(rep_rows), "courts_listed": len(court_rows), "min_reporter": MIN_REPORTER, "min_court": MIN_COURT}
    dec = defaultdict(lambda: [0, 0])
    for yr, n, ops in years:
        if yr is not None:
            dec[int(yr) // 10 * 10][0] += n
    ov["by_decade"] = [{"decade": d, "n": v[0]} for d, v in sorted(dec.items())]
    ov["citing_year_unknown"] = sum(n for yr, n, _ in years if yr is None)
    rows.append(writer.record(
        DATASET, "overview:all", "Citations CourtListener could not match: overview", source_url=rc.UNMATCHED_URL,
        subtitle=f"{total:,} citations · {cc.share(unres_all, total)}% still unresolved · {len(reps):,} reporters",
        cells={"kind": "overview", "name": "All unmatched citations", "citations": total, "distinct": None, "opinions": None, "unresolved_pct": cc.share(unres_all, total), "type": None, "in_citation_table": None},
        badges=["CourtListener bulk data"],
        facts=rc.facts([("Unmatched citations", f"{total:,}"), ("Status", "; ".join(f"{s['label']}: {s['n']:,} ({s['share_pct']}%)" for s in ov["statuses"])),
                        ("By citation type", "; ".join(f"{t['label']}: {t['n']:,}" for t in ov["types"][:6])),
                        ("Rows whose citing opinion is not in the opinion file", f"{no_court:,}"), ("Rows skipped because their column count was wrong", f"{done['skipped_invalid_rows']:,}")]),
        text="unmatched citations overview", filters={"kind": ["overview"]}, links=[{"label": "Unmatched-citations bulk file", "url": rc.UNMATCHED_URL}], extra={"profile": ov}))
    rows += rep_rows + court_rows
    summary = {
        "source": "CourtListener bulk data: unmatched-citations, citations, opinions, opinion clusters, dockets (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"citations": total, "reporters": len(reps), "reporter_records": len(rep_rows), "court_records": len(court_rows), "unresolved": unres_all},
        "definitions": {"unmatched citation": "a citation CourtListener found in an opinion's text that did not match an opinion cluster when it was processed (one row per citing opinion and citation)",
                        "status": "; ".join(f"{k} {v}" for k, v in rc.UNMATCHED_STATUS_LABEL.items()) + "; codes and meanings as named in CourtListener's source code (cl/citations/models.py)",
                        "unresolved": "status 1, 4 or 5", "citation type": "; ".join(f"{k} {v}" for k, v in rc.CITATION_TYPE_LABEL.items()) + " (CourtListener's citation type constants)",
                        "citing court": "court of the citing opinion's cluster docket", "court written with the citation": "the court_id field of the row, parsed from the citation itself, not the citing court",
                        "reporter in citation table": "rows of the citations file (matched reporter citations of clusters) with exactly this reporter string"},
        "caveats": ["Unmatched does not mean wrong: many are Westlaw or LEXIS numbers, slip opinions, or reporters CourtListener does not hold.",
                    "Reporter strings are as parsed; the same reporter can appear under variant spellings.",
                    f"Reporters with fewer than {MIN_REPORTER:,} rows and courts with fewer than {MIN_COURT:,} are counted in the overview only."],
        "grain": "overview, one record per reporter with enough rows, one per citing court with enough rows"}
    return {DATASET: {
        "dataset": DATASET, "label": "Citations CourtListener could not match to a case, by reporter and citing court (Sept 30, 2026)",
        "listing_block": writer.listing([("kind", "Type"), ("name", "Reporter or court"), ("citations", "Unmatched citations"), ("distinct", "Distinct"), ("opinions", "Citing opinions"),
                                         ("unresolved_pct", "Still unresolved %"), ("type", "Citation type"), ("in_citation_table", "Reporter in citation table")],
                                        [("kind", "Type", {"overview": "Overview", "reporter": "Reporter", "court": "Citing court"})]),
        "summary": summary, "rows": rows, "built_at": built_at,
        "inputs": [{"url": rc.UNMATCHED_URL, "path": "streamed, not stored; slim table private/acq/courtlistener/db/unmatched_citation.duckdb", "sha256": None},
                   {"url": CITATIONS_URL, "path": "citation.duckdb", "sha256": None}, {"url": rc.OPINIONS_URL, "path": "work.duckdb w_op", "sha256": None}]}}


if __name__ == "__main__":
    rc.write(build())
