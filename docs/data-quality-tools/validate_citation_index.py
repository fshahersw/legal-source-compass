"""Validate every citation_index row with eyecite + reporters-db + courts-db. Read-only; writes results/*.jsonl|json."""
import collections
import json
import os
import re
import sys
from urllib.parse import unquote

import courts_db
from eyecite import get_citations
from eyecite.models import (FullCaseCitation, FullCitation, FullJournalCitation, FullLawCitation,
                            UnknownCitation)

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = sys.argv[1] if len(sys.argv) > 1 else "after"
SRC = os.path.join(HERE, "data", "before" if TAG == "before" else "", "citation_index_full.jsonl")
OUT = os.path.join(HERE, "results", TAG)
os.makedirs(OUT, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8")

COURT_IDS = {c["id"] for c in courts_db.courts}
KIND_TO_CLASS = {
    "Case": FullCaseCitation,
    "Law journal article": FullJournalCitation,
    "Statute or regulation": FullLawCitation,
}
WS_RE = re.compile(r"\s+")
TRAIL_RE = re.compile(r"[,;:]+$")


def collapse(s):
    return WS_RE.sub(" ", s.replace(" ", " ")).strip()


def squash(s):
    """Spacing/punctuation/case-insensitive comparison key."""
    return re.sub(r"[\s.,]", "", s).lower()


def squash2(s):
    return re.sub(r"[^0-9A-Za-z]", "", s).lower()


def facts_dict(facts):
    out = {}
    for pair in facts or []:
        if isinstance(pair, list) and len(pair) >= 2:
            out[str(pair[0])] = pair[1]
    return out


rows = [json.loads(line) for line in open(SRC, encoding="utf-8")]
results = []
status_counts = collections.Counter()
by_kind_status = collections.Counter()
issue_counts = collections.Counter()
norm_groups = collections.defaultdict(list)

for row in rows:
    s = row["title"]
    cells = row.get("cells") or {}
    kind = cells.get("kind")
    where = cells.get("where")
    facts = facts_dict(row.get("facts"))
    issues = []

    # raw-string hygiene
    if s != s.strip():
        issues.append("edge_whitespace")
    if re.search(r"\s{2,}|[\t\r\n ]", s):
        issues.append("inner_whitespace")
    if TRAIL_RE.search(s.strip()):
        issues.append("trailing_punctuation")
    if "�" in s:
        issues.append("replacement_char")

    cleaned = collapse(s)
    cleaned_nopunct = TRAIL_RE.sub("", cleaned).strip()
    cites = get_citations(s)
    full = [c for c in cites if isinstance(c, FullCitation)]
    status = None
    cite = None
    corrected = None
    if len(cites) == 0:
        status = "no_citation"
    elif len(full) == 0:
        status = "unknown_only"
    elif len(full) > 1 or len(cites) > 1:
        status = "multiple"
        cite = full[0]
    else:
        cite = full[0]
        matched = cite.matched_text()
        try:
            corrected = cite.corrected_citation()
        except Exception:  # noqa
            corrected = None
        if matched == s and corrected == s:
            status = "exact"
        elif matched == s:
            status = "reporter_variation" if squash(corrected or "") == squash(s) else "corrected_differs"
        elif TRAIL_RE.sub("", s.strip()) == matched:
            status = "trailing_punct_only"
        else:
            status = "partial_match"

    # if the raw string fails but the whitespace/punctuation-cleaned one parses exactly, record it
    cleaned_status = None
    cleaned_cite = None
    if status in ("no_citation", "unknown_only", "partial_match", "multiple", "trailing_punct_only") or issues:
        c2 = get_citations(cleaned_nopunct)
        f2 = [c for c in c2 if isinstance(c, FullCitation)]
        if len(c2) == 1 and len(f2) == 1 and f2[0].matched_text() == cleaned_nopunct:
            cleaned_cite = f2[0]
            try:
                cc = cleaned_cite.corrected_citation()
            except Exception:  # noqa
                cc = None
            cleaned_status = "clean_parses_exact" if cc == cleaned_nopunct else (
                "clean_parses_reporter_variation" if squash(cc or "") == squash(cleaned_nopunct) else "clean_parses_corrected_differs")

    # structure checks on the full citation
    groups = dict(cite.groups) if cite is not None else {}
    cls = type(cite).__name__ if cite is not None else None
    expected_cls = KIND_TO_CLASS.get(kind)
    if cite is not None and expected_cls is not None and not isinstance(cite, expected_cls):
        issues.append(f"kind_mismatch:{kind}->{cls}")
    if isinstance(cite, FullCaseCitation) and groups.get("page") is not None and not re.fullmatch(r"\d+", str(groups["page"])):
        if not re.fullmatch(r"[\d,]+", str(groups["page"])):
            issues.append("non_numeric_page")
    if isinstance(cite, FullCaseCitation) and groups.get("volume") is not None and not re.fullmatch(r"\d+", str(groups["volume"])):
        issues.append("non_numeric_volume")

    # edition / year plausibility (year parsed by the library from the saved text)
    year = facts.get("Year as parsed from the text")
    year_int = int(year) if isinstance(year, str) and re.fullmatch(r"\d{4}", year) else (year if isinstance(year, int) else None)
    if cite is not None and year_int is not None:
        editions = getattr(cite, "all_editions", None) or []
        if editions and not any(e.includes_year(year_int) for e in editions):
            issues.append("year_outside_reporter_range")

    # court id (CourtListener id) validity
    court = facts.get("Court as parsed (CourtListener id)")
    if court not in (None, ""):
        if str(court) not in COURT_IDS:
            issues.append(f"court_id_unknown:{court}")

    # link consistency for CourtListener lookup links
    links = row.get("links") or []
    if where == "CourtListener link":
        url = links[0]["url"] if links else None
        if not url:
            issues.append("missing_link")
        elif isinstance(cite, FullCaseCitation):
            rep = groups.get("reporter")
            vol = groups.get("volume")
            page = groups.get("page")
            exp = f"https://www.courtlistener.com/c/{rep}/{vol}/{page}/"
            if unquote(url) != exp:
                issues.append("link_mismatch")
        # facet reporter must match the parsed reporter
    flt = row.get("filters") or {}
    frep = flt.get("reporter")
    if isinstance(cite, FullCitation) and isinstance(frep, list) and frep:
        grp_rep = (groups.get("reporter") or "").strip()
        if grp_rep and grp_rep not in frep:
            if squash2(grp_rep) == squash2(frep[0]):
                issues.append("facet_spelling_variant_of_title_reporter")
            else:
                issues.append("facet_alt_abbreviation_of_title_reporter")

    # statute structure
    if isinstance(cite, FullLawCitation):
        if not (groups.get("section") or groups.get("page") or groups.get("title") or groups.get("chapter")):
            issues.append("law_citation_without_locator")

    key = squash(cleaned_nopunct)
    norm_groups[key].append(row["id"])

    rec = {
        "id": row["id"], "title": s, "kind": kind, "where": where, "status": status, "cls": cls,
        "groups": groups, "corrected": corrected, "cleaned_status": cleaned_status,
        "cleaned": cleaned_nopunct if cleaned_nopunct != s else None, "issues": issues,
        "court": court, "year": year,
    }
    results.append(rec)
    status_counts[status] += 1
    by_kind_status[(kind, where, status)] += 1
    for i in issues:
        issue_counts[i.split(":")[0]] += 1

# normalised duplicates
dups = {k: v for k, v in norm_groups.items() if len(v) > 1}
dup_ids = {i for v in dups.values() for i in v}
for rec in results:
    if rec["id"] in dup_ids:
        rec["issues"].append("normalized_duplicate")
        issue_counts["normalized_duplicate"] += 1

with open(os.path.join(OUT, "citation_index_results.jsonl"), "w", encoding="utf-8") as fh:
    for rec in results:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

summary = {
    "rows": len(rows),
    "status_counts": dict(status_counts),
    "by_kind_where_status": {f"{k[0]} | {k[1]} | {k[2]}": v for k, v in sorted(by_kind_status.items(), key=lambda kv: (-kv[1], str(kv[0])))},
    "issue_counts": dict(issue_counts),
    "normalized_duplicate_groups": len(dups),
    "normalized_duplicate_rows": len(dup_ids),
}
with open(os.path.join(OUT, "citation_index_summary.json"), "w", encoding="utf-8") as fh:
    json.dump(summary, fh, ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False)[:6000])
