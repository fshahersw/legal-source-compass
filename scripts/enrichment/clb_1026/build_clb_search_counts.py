"""Build clb_search_counts: result counts from CourtListener's search engine for exact advanced queries.

Input: private/acq/clb_1026/search_counts.jsonl (fetch_search_counts.py: one archived API response per query). Every
count is the `count` the v4 search API returned for that query at that time; each data point keeps its query, API URL,
the equivalent CourtListener search page URL, the retrieval time and the sha256 of the archived response.
Derivations (stated in the summary and tested): share = topic count / all-opinions count of the same year (or court and
window) x 100; the pooled appellate share = sum of the 14 courts' topic counts / sum of their totals x 100; a court's rank
among the 14 by share (competition ranking). Nothing is estimated; a count the API did not return is left out.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import clb1026_common as cm  # noqa: E402
import cl_api  # noqa: E402
import corpus_writer as writer  # noqa: E402
import search_plan as sp  # noqa: E402

DATASET = "clb_search_counts"
INPUT = os.path.join(cm.ACQ, "search_counts.jsonl")
FRONT = "https://www.courtlistener.com/"
HELP = "https://wiki.free.law/c/courtlistener/help/search/advanced-search-and-query-techniques"
API_HELP = "https://wiki.free.law/c/courtlistener/help/api/rest/v4/search"
TOPIC_LABEL = {slug: label for slug, label, _ in sp.TOPICS}
TOPIC_QUERY = {slug: q for slug, _, q in sp.TOPICS}


def front_url(api_url: str) -> str:
    """The CourtListener search page for the same GET parameters (the API takes the front end's parameters)."""
    return FRONT + "?" + api_url.split("?", 1)[1]


def share(part, whole, digits: int = 3):
    return None if part is None or not whole else round(100.0 * part / whole, digits)


def point(row: dict) -> dict:
    return {"q": row["q"], "type": row["type"], "count": row["count"], "retrieved_at": row["retrieved_at"], "api_url": row["url"],
            "search_url": front_url(row["url"]), "sha256": row["sha256"]}


def competition_rank(values: dict[str, float | None]) -> dict[str, int]:
    ordered = sorted(((k, v) for k, v in values.items() if v is not None), key=lambda kv: (-kv[1], kv[0]))
    out, prev, prev_rank = {}, None, 0
    for i, (k, v) in enumerate(ordered, 1):
        rank = prev_rank if v == prev else i
        out[k] = rank
        prev, prev_rank = v, rank
    return out


def load_rows(path: str = INPUT) -> dict[str, dict]:
    rows = {}
    for line in open(path):
        r = json.loads(line)
        if r["http_status"] == 200 and isinstance(r["count"], int):
            # the archived response must still match its hash and report the same count
            body = json.loads(cl_api.read_raw(r["sha256"]))
            if body.get("count") != r["count"]:
                raise SystemExit(f"{r['key']}: archived response count differs")
            rows[r["key"]] = r
    return rows


def build(rows: dict[str, dict] | None = None) -> dict:
    rows = rows if rows is not None else load_rows()
    plan = sp.plan()
    missing = [p["key"] for p in plan if p["key"] not in rows]
    spine = cm.spine_ids()
    courts = {r["id"]: cm.blank(r["full_name"]) for r in cm.pg_rows(cm.bulk_path("courts-2026-09-30.csv.bz2"))}
    out = []
    totals = {y: rows.get(f"national:all:{y}") for y in sp.YEARS}
    retrieved = sorted(r["retrieved_at"] for r in rows.values())
    common = {"statuses": "Published and Unpublished (stat_Published=on, stat_Unpublished=on)", "unit": "opinion clusters (cases)"}
    # the denominator series
    out.append(writer.record(
        DATASET, "year:all", "Opinions (cases) in CourtListener's search index by year filed, published and unpublished", source_url=front_url(totals[2020]["url"]) if totals.get(2020) else FRONT,
        subtitle=f"{sum(1 for v in totals.values() if v)} years · counts from CourtListener's search engine",
        cells={"kind": "year", "name": "All opinions", "court": None, "window": f"{sp.YEARS[0]}–{sp.YEARS[-1]}", "count": None, "share_pct": None},
        badges=["CourtListener search counts", "Query on every point"],
        facts=cm.facts([("What is counted", "opinion clusters (cases) whose filing date falls in the year, status Published or Unpublished"),
                        ("Query form", "dateFiled:[YYYY-01-01 TO YYYY-12-31]"), ("Partial year", f"{sp.PARTIAL_YEAR}: counted to the retrieval date"),
                        ("Retrieved", f"{retrieved[0]} to {retrieved[-1]}" if retrieved else None)]),
        text="opinions per year courtlistener search counts", filters={"kind": ["year"]},
        links=[{"label": "Advanced search help", "url": HELP}],
        extra={"profile": {"kind": "year", **common, "points": [{"year": y, "partial": y == sp.PARTIAL_YEAR, **point(totals[y])} for y in sp.YEARS if totals.get(y)]}}))
    for slug, label, tq in sp.TOPICS:
        pts = []
        for y in sp.YEARS:
            r = rows.get(f"national:{slug}:{y}")
            t = totals.get(y)
            if not r:
                continue
            pts.append({"year": y, "partial": y == sp.PARTIAL_YEAR, **point(r), "total": t["count"] if t else None,
                        "total_q": t["q"] if t else None, "share_pct": share(r["count"], t["count"] if t else None)})
        if not pts:
            continue
        full = [p for p in pts if not p["partial"]]
        last = full[-1] if full else None
        out.append(writer.record(
            DATASET, f"topic:{slug}", f"Opinions mentioning {label.lower()}: by year filed, all courts (CourtListener search counts)", source_url=pts[-1]["search_url"],
            subtitle=f"Query {tq} · {len(pts)} years" + (f" · {last['count']:,} in {last['year']} ({last['share_pct']}% of that year's opinions)" if last and last["share_pct"] is not None else ""),
            cells={"kind": "topic", "name": label, "court": "All courts", "window": f"{pts[0]['year']}–{pts[-1]['year']}", "count": sum(p["count"] for p in full),
                   "share_pct": share(sum(p["count"] for p in full), sum(p["total"] or 0 for p in full) if all(p["total"] for p in full) else None)},
            badges=["CourtListener search counts", "Advanced query"],
            facts=cm.facts([("Topic query", tq), ("Full query for a year", f"{tq} AND dateFiled:[YYYY-01-01 TO YYYY-12-31]"), ("Statuses", common["statuses"]),
                            ("Share", "topic count ÷ all opinions filed that year (same statuses) × 100"),
                            (f"{last['year']}" if last else "Latest full year", f"{last['count']:,} of {last['total']:,} opinions ({last['share_pct']}%)" if last and last["total"] else None),
                            ("Partial year", f"{sp.PARTIAL_YEAR} counted to the retrieval date")]),
            text=f"{label} opinions per year search count {tq}", filters={"kind": ["topic"]},
            links=[{"label": "Advanced search help", "url": HELP}, {"label": "This search on CourtListener", "url": pts[-1]["search_url"]}],
            extra={"profile": {"kind": "topic", "slug": slug, "label": label, "topic_query": tq, **common, "points": pts}}))
    court_shares: dict[str, dict[str, float | None]] = {slug: {} for slug, _, _ in sp.TOPICS}
    court_rows = {}
    for c in sp.APPELLATE:
        tot = rows.get(f"court:{c}:all")
        if not tot:
            continue
        topics = []
        for slug, label, tq in sp.TOPICS:
            r = rows.get(f"court:{c}:{slug}")
            if not r:
                continue
            s = share(r["count"], tot["count"])
            court_shares[slug][c] = s
            topics.append({"slug": slug, "label": label, "topic_query": tq, **point(r), "share_pct": s})
        court_rows[c] = (tot, topics)
    pooled = {}
    for slug, _, _ in sp.TOPICS:
        cs = [c for c in court_rows if any(t["slug"] == slug for t in court_rows[c][1])]
        if len(cs) == len(sp.APPELLATE):  # pooled only over all 14 courts, never over the ones that happen to be present
            num = sum(next(t["count"] for t in court_rows[c][1] if t["slug"] == slug) for c in cs)
            den = sum(court_rows[c][0]["count"] for c in cs)
            pooled[slug] = {"count": num, "total": den, "share_pct": share(num, den)}
    ranks = {slug: competition_rank(v) for slug, v in court_shares.items()}
    for c, (tot, topics) in court_rows.items():
        name = courts.get(c) or c
        for t in topics:
            t["rank_of"] = len(court_shares[t["slug"]])
            t["rank"] = ranks[t["slug"]].get(c)
            t["pooled_share_pct"] = pooled.get(t["slug"], {}).get("share_pct")
        top = sorted((t for t in topics if t["share_pct"] is not None), key=lambda t: -t["share_pct"])[:3]
        out.append(writer.record(
            DATASET, f"court:{c}", f"{name}: opinions mentioning selected doctrines, {sp.WINDOW[0][:4]}–{sp.WINDOW[1][:4]} (CourtListener search counts)", source_url=front_url(tot["url"]),
            subtitle=f"{tot['count']:,} opinions filed {sp.WINDOW[0][:4]}–{sp.WINDOW[1][:4]} · " + "; ".join(f"{t['label']} {t['share_pct']}%" for t in top),
            cells={"kind": "court", "name": name, "court": name, "window": f"{sp.WINDOW[0][:4]}–{sp.WINDOW[1][:4]}", "count": tot["count"], "share_pct": None},
            badges=["CourtListener search counts", "Advanced query"],
            facts=cm.facts([("Court (id)", f"{name} ({c})"), ("All opinions, query", tot["q"]), ("All opinions, count", f"{tot['count']:,}"), ("Statuses", common["statuses"]),
                            *[(t["label"], f"{t['count']:,} ({t['share_pct']}%; rank {t['rank']} of {t['rank_of']})") for t in topics],
                            ("Rank", "among the Supreme Court and the 13 federal courts of appeals by share (competition ranking)")]),
            text=f"{name} {c} doctrines search counts opinions", filters={"kind": ["court"], "court": [c]},
            links=[x for x in ({"label": name, "url": cm.court_link(c, spine)}, {"label": "Advanced search help", "url": HELP}) if x["url"]],
            extra={"profile": {"kind": "court", "court_id": c, "court": name, "court_link": cm.court_link(c, spine), "window": list(sp.WINDOW), **common,
                               "total": point(tot), "topics": topics}}))
    st_pts = []
    for y in sp.YEARS:
        pub, unp, tot = rows.get(f"status:published:{y}"), rows.get(f"status:unpublished:{y}"), totals.get(y)
        if not pub or not unp:
            continue
        st_pts.append({"year": y, "partial": y == sp.PARTIAL_YEAR, "published": point(pub), "unpublished": point(unp),
                       "combined": point(tot) if tot else None, "unpublished_share_pct": share(unp["count"], pub["count"] + unp["count"]),
                       "sum_equals_combined": (pub["count"] + unp["count"] == tot["count"]) if tot else None})
    if st_pts:
        full = [p for p in st_pts if not p["partial"]]
        mism = [p["year"] for p in st_pts if p["sum_equals_combined"] is False]
        last = full[-1] if full else st_pts[-1]
        out.append(writer.record(
            DATASET, "status:by_year", "Published and unpublished opinions in CourtListener's search index, by year filed", source_url=last["unpublished"]["search_url"],
            subtitle=f"{len(st_pts)} years · {last['year']}: {last['published']['count']:,} published, {last['unpublished']['count']:,} unpublished ({last['unpublished_share_pct']}% unpublished)",
            cells={"kind": "status", "name": "Precedential status", "court": "All courts", "window": f"{st_pts[0]['year']}–{st_pts[-1]['year']}", "count": None, "share_pct": last["unpublished_share_pct"]},
            badges=["CourtListener search counts", "Precedential status"],
            facts=cm.facts([("Published, query", "dateFiled:[YYYY-01-01 TO YYYY-12-31] with stat_Published=on only"),
                            ("Unpublished, query", "the same with stat_Unpublished=on only"),
                            ("Unpublished share", "unpublished ÷ (published + unpublished) × 100"),
                            ("Check", "published + unpublished equals the combined count (both switches on) in " + (f"every year except {', '.join(map(str, mism))}" if mism else "every year")),
                            ("Partial year", f"{sp.PARTIAL_YEAR} counted to the retrieval date")]),
            text="published unpublished opinions per year precedential status search counts", filters={"kind": ["status"]},
            links=[{"label": "Search API help (statuses)", "url": API_HELP}],
            extra={"profile": {"kind": "status", "points": st_pts, "years_sum_not_equal": mism}}))
    oral_tot = rows.get("oral:all")
    if oral_tot:
        topics = [{"slug": slug, "label": label, "topic_query": tq, **point(rows[f"oral:{slug}"]), "share_pct": share(rows[f"oral:{slug}"]["count"], oral_tot["count"])}
                  for slug, label, tq in sp.TOPICS if f"oral:{slug}" in rows]
        out.append(writer.record(
            DATASET, "oral:all", "Oral-argument recordings whose text matches selected doctrines (CourtListener search counts)", source_url=front_url(oral_tot["url"]),
            subtitle=f"{oral_tot['count']:,} recordings in the oral-argument search index",
            cells={"kind": "oral", "name": "Oral arguments", "court": "All courts", "window": "all years", "count": oral_tot["count"], "share_pct": None},
            badges=["CourtListener search counts", "Oral arguments"],
            facts=cm.facts([("All recordings, query", "type=oa with no query"), ("All recordings, count", f"{oral_tot['count']:,}"),
                            *[(t["label"], f"{t['count']:,} ({t['share_pct']}%)") for t in topics],
                            ("Reading", "A recording matches when its searchable text (transcript where one exists, or case metadata) contains the query.")]),
            text="oral arguments doctrines search counts", filters={"kind": ["oral"]}, links=[{"label": "Advanced search help", "url": HELP}],
            extra={"profile": {"kind": "oral", "total": point(oral_tot), "topics": topics}}))
    summary = {
        "source": "CourtListener v4 search API (Free Law Project): the count returned for each exact query", "terms": cm.TERMS,
        "retrieved": f"{retrieved[0]} to {retrieved[-1]}" if retrieved else None,
        "queries": {"topics": [{"slug": s, "label": l, "query": q} for s, l, q in sp.TOPICS], "years": f"{sp.YEARS[0]}-{sp.YEARS[-1]}", "court_window": list(sp.WINDOW),
                    "courts": sp.APPELLATE, "statuses": common["statuses"], "planned": len(plan), "returned": len(plan) - len(missing), "missing": missing},
        "definitions": {"count": "the number of results the search engine reported for the query; case-law results are opinion clusters (one per case)",
                        "share": "topic count ÷ all opinions in the same year (or same court and window), same statuses, × 100",
                        "pooled appellate share": "sum of the 14 courts' topic counts ÷ sum of their all-opinion counts × 100",
                        "rank": "position among the 14 courts by share, highest first; ties share a rank",
                        "syntax": "phrases in quotes (no stemming or synonyms), OR within parentheses, \"...\"~10 proximity, court_id: and dateFiled:[A TO B] fielded filters, as documented in CourtListener's advanced search help"},
        "caveats": ["Counts describe CourtListener's collection, which is more complete for some courts and years than others.",
                    "An opinion cluster is any decision CourtListener holds; for some courts (the Supreme Court especially) most clusters are orders and summary dispositions, so a court's share is of all its clusters, not of its signed opinions.",
                    "A mention is any occurrence of the words in the opinion text; it says nothing about how the doctrine was applied.",
                    "The search index changes as CourtListener adds and corrects opinions; each count holds at its retrieval time.",
                    f"{sp.PARTIAL_YEAR} is a partial year, counted to the retrieval date."],
        "help": [HELP, API_HELP],
        "grain": "one record per topic (national series), the denominator series, one per court, and oral arguments",
    }
    return {"dataset": DATASET, "label": "Opinions and oral arguments mentioning selected doctrines: CourtListener search counts by year and court (retrieved Oct 2026)",
            "listing_block": writer.listing([("kind", "Type"), ("name", "Topic or court"), ("court", "Court"), ("window", "Years"), ("count", "Count"), ("share_pct", "Share %")],
                                            [("kind", "Type", {"year": "All opinions", "topic": "Topic by year", "court": "Court", "status": "Precedential status", "oral": "Oral arguments"})]),
            "summary": summary, "rows": out, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputs": [{"url": cl_api.API + "search/", "path": os.path.relpath(INPUT, cm.ROOT), "sha256": None, "requests": len(rows)},
                       {"url": HELP, "path": "private/acq/clb_1026/docs/adv-search-wiki.html", "sha256": None}]}


if __name__ == "__main__":
    cm.write_build(build())
