"""Validate citation_reference, cl_reporter_citations and cl_citation_edges (read-only). Writes results/*.json."""
import collections
import json
import os
import re

import reporters_db
from eyecite import get_citations
from eyecite.models import FullCaseCitation, FullCitation

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")


def load(name):
    return [json.loads(l) for l in open(os.path.join(D, name + ".jsonl"), encoding="utf-8")]


REPORTERS = reporters_db.REPORTERS
LAWS = reporters_db.LAWS
JOURNALS = reporters_db.JOURNALS

CITE_TYPE_LABEL = {
    "federal": "Federal reporter", "state": "State reporter", "state_regional": "Regional reporter",
    "specialty": "Specialty reporter", "specialty_lexis": "Lexis specialty series",
    "specialty_west": "West specialty series", "neutral": "Neutral (court-assigned) citation",
    "scotus_early": "Early Supreme Court reporter",
}
# CourtListener Citation.type codes
CL_TYPE = {"1": "federal", "2": "state", "3": "state_regional", "4": "specialty", "5": "scotus_early",
           "6": "specialty_lexis", "7": "specialty_west", "8": "neutral", "9": "journal"}


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")


res = {}

# ---------------- citation_reference ----------------
rows = load("citation_reference")
ids = [r["id"] for r in rows]
res["citation_reference"] = {"rows": len(rows), "duplicate_ids": len(ids) - len(set(ids))}
issues = collections.defaultdict(list)
entries = {}
for key, lst in REPORTERS.items():
    for i, e in enumerate(lst):
        entries[(key, i)] = e
# map reporter ids -> (key, entry) by slug
by_slug = collections.defaultdict(list)
for key, lst in REPORTERS.items():
    for i, e in enumerate(lst):
        by_slug[slug(key)].append((key, e))
ym = lambda s: s[:4] if s else None


def years_label(e):
    starts = [ed.get("start") for ed in e["editions"].values() if ed.get("start")]
    ends = [ed.get("end") for ed in e["editions"].values()]
    if not starts:
        return ""
    a = str(min(starts).year)
    if any(x is None for x in ends):
        return f"{a} to present"
    return f"{a} to {max(ends).year}"


for r in rows:
    c = r["cells"]
    kind = r["id"].split(":")[0]
    if kind == "reporter":
        sl = r["id"].split(":", 1)[1].split("~")[0]
        cands = by_slug.get(sl, [])
        match = [x for x in cands if x[0] == c["abbreviation"]]
        if not match:
            issues["reporter_not_in_reporters_db"].append(r["id"])
            continue
        key, e = match[0] if len(match) == 1 else (None, None)
        if len(match) > 1:
            # disambiguate by name
            m2 = [x for x in match if x[1]["name"] == c["name"]]
            if not m2:
                issues["reporter_name_mismatch"].append(r["id"])
                continue
            key, e = m2[0]
        if e["name"] != c["name"]:
            issues["reporter_name_mismatch"].append(r["id"])
        if CITE_TYPE_LABEL.get(e["cite_type"]) != c["type"]:
            issues["reporter_type_mismatch"].append(r["id"])
        if str(len(e["editions"])) != c["editions"]:
            issues["reporter_edition_count_mismatch"].append(r["id"])
        if years_label(e) != c["years"]:
            issues["reporter_years_mismatch"].append((r["id"], years_label(e), c["years"]))
        if c["years"].startswith("1750 "):
            issues["years_start_is_1750_sentinel"].append(r["id"])
        if r["title"] != c["abbreviation"]:
            issues["title_ne_abbreviation"].append(r["id"])
    elif kind == "law":
        ab = c["abbreviation"]
        if ab not in LAWS:
            issues["law_not_in_reporters_db"].append(r["id"])
        else:
            names = [x["name"] for x in LAWS[ab]]
            if c["name"] not in names:
                issues["law_name_mismatch"].append(r["id"])
    elif kind == "journal":
        ab = c["abbreviation"]
        if ab not in JOURNALS:
            issues["journal_not_in_reporters_db"].append(r["id"])
        else:
            names = [x["name"] for x in JOURNALS[ab]]
            if c["name"] not in names:
                issues["journal_name_mismatch"].append(r["id"])
    if r["title"] != r["title"].strip() or "  " in r["title"]:
        issues["title_whitespace"].append(r["id"])
    if not r["title"]:
        issues["title_empty"].append(r["id"])
# reporters-db coverage in the other direction
present = {(r["id"].split(":")[0], r["cells"]["abbreviation"], r["cells"]["name"]) for r in rows}
miss_rep = [(k, e["name"]) for k, lst in REPORTERS.items() for e in lst if ("reporter", k, e["name"]) not in present]
miss_law = [k for k, lst in LAWS.items() for e in lst if ("law", k, e["name"]) not in present]
miss_jou = [k for k, lst in JOURNALS.items() for e in lst if ("journal", k, e["name"]) not in present]
res["citation_reference"].update({
    "issue_counts": {k: len(v) for k, v in issues.items()},
    "issue_samples": {k: v[:6] for k, v in issues.items()},
    "reporters_db_entries_missing_from_dataset": {"reporters": len(miss_rep), "laws": len(miss_law), "journals": len(miss_jou),
                                                   "samples": {"reporters": miss_rep[:5], "laws": miss_law[:5], "journals": miss_jou[:5]}},
    "type_counts": dict(collections.Counter(r["cells"]["type"] for r in rows)),
})

# ---------------- cl_reporter_citations ----------------
rows = load("cl_reporter_citations")
issues = collections.defaultdict(list)
for r in rows:
    c = r["cells"]
    exp = f'{c["volume"]} {c["reporter"]} {c["page"]}'
    if r["title"] != exp:
        issues["title_ne_vol_rep_page"].append((r["id"], r["title"], exp))
    cites = get_citations(r["title"])
    full = [x for x in cites if isinstance(x, FullCitation)]
    if len(full) != 1 or full[0].matched_text() != r["title"]:
        issues["eyecite_no_exact_parse"].append((r["id"], r["title"]))
    else:
        g = full[0].groups
        if g.get("reporter") != c["reporter"] or g.get("volume") != c["volume"] or g.get("page") != c["page"]:
            issues["eyecite_group_mismatch"].append((r["id"], r["title"], dict(g)))
        try:
            if full[0].corrected_citation() != r["title"]:
                issues["eyecite_corrected_differs"].append((r["id"], r["title"], full[0].corrected_citation()))
        except Exception:
            pass
        # reporter known and type code agrees with reporters-db
        types = {e.reporter.cite_type for e in getattr(full[0], "all_editions", [])}
        if types and CL_TYPE.get(c["type"]) not in types:
            issues["cl_type_vs_reporters_db"].append((r["id"], c["type"], sorted(types)))
        if not any(ed.reporter.short_name or True for ed in getattr(full[0], "all_editions", [])):
            issues["no_edition"].append(r["id"])
    if not c["volume"].isdigit() or not c["page"].isdigit():
        issues["non_numeric_volume_or_page"].append(r["id"])
    if c["reporter"] not in {ed for lst in REPORTERS.values() for e in lst for ed in e["editions"]} and \
            c["reporter"] not in {v for lst in REPORTERS.values() for e in lst for v in e.get("variations", {})}:
        issues["reporter_unknown"].append((r["id"], c["reporter"]))
res["cl_reporter_citations"] = {
    "rows": len(rows),
    "issue_counts": {k: len(v) for k, v in issues.items()},
    "issue_samples": {k: v[:6] for k, v in issues.items()},
    "reporters": dict(collections.Counter(r["cells"]["reporter"] for r in rows)),
    "types": dict(collections.Counter(r["cells"]["type"] for r in rows)),
}

# ---------------- cl_citation_edges ----------------
rows = load("cl_citation_edges")
issues = collections.defaultdict(list)
pairs = collections.Counter()
for r in rows:
    c = r["cells"]
    exp = f'Opinion {c["citing_opinion_id"]} cites opinion {c["cited_opinion_id"]}'
    if r["title"] != exp:
        issues["title_ne_cells"].append((r["id"], r["title"], exp))
    for k in ("citing_opinion_id", "cited_opinion_id", "depth"):
        if not str(c.get(k, "")).isdigit():
            issues["non_numeric_" + k].append(r["id"])
    if c["citing_opinion_id"] == c["cited_opinion_id"]:
        issues["self_citation"].append(r["id"])
    pairs[(c["citing_opinion_id"], c["cited_opinion_id"])] += 1
    if int(c.get("depth", 0)) < 1:
        issues["depth_lt_1"].append(r["id"])
res["cl_citation_edges"] = {
    "rows": len(rows),
    "issue_counts": {k: len(v) for k, v in issues.items()},
    "duplicate_pairs": sum(1 for v in pairs.values() if v > 1),
    "distinct_citing": len({k[0] for k in pairs}), "distinct_cited": len({k[1] for k in pairs}),
    "depth_histogram": dict(sorted(collections.Counter(int(r["cells"]["depth"]) for r in rows).items())),
}

with open(os.path.join(OUT, "other_citations_summary.json"), "w", encoding="utf-8") as fh:
    json.dump(res, fh, ensure_ascii=False, indent=2, default=str)
print(json.dumps(res, ensure_ascii=False, indent=1, default=str)[:9000])
