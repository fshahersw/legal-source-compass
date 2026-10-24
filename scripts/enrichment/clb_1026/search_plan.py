"""The exact search-count queries for clb_search_counts (pure: builds query strings and URLs; no network).

Every count comes from one request to CourtListener's v4 search API with `type` and `q` exactly as listed here, plus the
precedential-status switches for case law. Case-law counts are opinion clusters (cases) with status Published or
Unpublished; oral-argument counts are recordings whose transcript (or metadata) matches.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api  # noqa: E402

# slug -> (label, query fragment in CourtListener's advanced syntax). Phrases are quoted so no stemming or synonyms apply;
# one topic uses boolean grouping and one a proximity search, both as documented in the advanced search help.
TOPICS = [
    ("class_certification", "Class certification", '"class certification"'),
    ("multidistrict_litigation", "Multidistrict litigation", '"multidistrict litigation"'),
    ("qualified_immunity", "Qualified immunity", '"qualified immunity"'),
    ("daubert", "Daubert (expert evidence)", '"Daubert"'),
    ("compel_arbitration", "Compel arbitration", '"compel arbitration"'),
    ("class_waiver", "Class waiver near arbitration (within 10 words)", '"class waiver arbitration"~10'),
    ("personal_jurisdiction", "Personal jurisdiction", '"personal jurisdiction"'),
    ("twombly", "Twombly (pleading standard)", '"Twombly"'),
    ("chevron_deference", "Chevron deference", '"Chevron deference"'),
    ("product_liability", "Product or products liability", '("products liability" OR "product liability")'),
    ("securities_fraud", "Securities fraud", '"securities fraud"'),
    ("article_iii_standing", "Article III standing", '"Article III standing"'),
    ("summary_judgment", "Summary judgment", '"summary judgment"'),
]
YEARS = list(range(2000, 2027))  # 2026 is partial: counted to the retrieval date
PARTIAL_YEAR = 2026
WINDOW = ("2000-01-01", "2025-12-31")  # the court-by-court window: full years only
APPELLATE = ["scotus", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"]
STATUS_PARAMS = [("stat_Published", "on"), ("stat_Unpublished", "on")]


def date_range(a: str, b: str) -> str:
    return f"dateFiled:[{a} TO {b}]"


def opinion_query(topic_q: str | None, date_q: str, court: str | None = None) -> str:
    parts = ([f"court_id:{court}"] if court else []) + ([topic_q] if topic_q else []) + [date_q]
    return " AND ".join(parts)


def opinion_url(q: str, statuses: list[tuple[str, str]] | None = None) -> str:
    return cl_api.build_url("search/", [("type", "o"), ("q", q), *(STATUS_PARAMS if statuses is None else statuses)])


def oral_url(q: str | None) -> str:
    return cl_api.build_url("search/", [("type", "oa")] + ([("q", q)] if q else []))


def plan() -> list[dict]:
    """[{key, kind, topic, year, court, type, q, url}] in request order."""
    out = []
    for y in YEARS:
        dq = date_range(f"{y}-01-01", f"{y}-12-31")
        q = opinion_query(None, dq)
        out.append({"key": f"national:all:{y}", "kind": "national", "topic": None, "year": y, "court": None, "type": "o", "q": q, "url": opinion_url(q)})
        for slug, _, tq in TOPICS:
            q = opinion_query(tq, dq)
            out.append({"key": f"national:{slug}:{y}", "kind": "national", "topic": slug, "year": y, "court": None, "type": "o", "q": q, "url": opinion_url(q)})
    dq = date_range(*WINDOW)
    for c in APPELLATE:
        q = opinion_query(None, dq, c)
        out.append({"key": f"court:{c}:all", "kind": "court", "topic": None, "year": None, "court": c, "type": "o", "q": q, "url": opinion_url(q)})
        for slug, _, tq in TOPICS:
            q = opinion_query(tq, dq, c)
            out.append({"key": f"court:{c}:{slug}", "kind": "court", "topic": slug, "year": None, "court": c, "type": "o", "q": q, "url": opinion_url(q)})
    # precedential status by year: published only and unpublished only (their sum is checked against the combined count)
    for y in YEARS:
        q = opinion_query(None, date_range(f"{y}-01-01", f"{y}-12-31"))
        for status, param in (("published", "stat_Published"), ("unpublished", "stat_Unpublished")):
            out.append({"key": f"status:{status}:{y}", "kind": "status", "topic": status, "year": y, "court": None, "type": "o", "q": q,
                        "url": opinion_url(q, [(param, "on")])})
    out.append({"key": "oral:all", "kind": "oral", "topic": None, "year": None, "court": None, "type": "oa", "q": None, "url": oral_url(None)})
    for slug, _, tq in TOPICS:
        out.append({"key": f"oral:{slug}", "kind": "oral", "topic": slug, "year": None, "court": None, "type": "oa", "q": tq, "url": oral_url(tq)})
    return out
