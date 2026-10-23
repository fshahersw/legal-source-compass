"""Build ecfr_parallel_authorities, ecfr_subject_index and ecfr_agencies from the finding aids stored under
private/acq/ecfr_authorities/ (see that folder's _manifest.jsonl for URL, sha256 and retrieval time of every file).

  python3 -I -B build_ecfr_authorities.py [--only=ptoa|subject|agencies]

Reads: GovInfo CFR Index and Finding Aids (package GPO-CFR-INDEX-<year>: granule 4 text for the Parallel Table of
Authorities and Rules, granule 2 PDF for the Subject/Agency Index, granule 3 text for the agency-prepared index list),
the eCFR admin API agencies.json and versioner titles.json, and the cross-link lookups made by make_lookups.py.
Writes: private/build/ecfr_authorities/<dataset>.json ({dataset, label, listing_block, summary, rows, built_at, inputs}),
build_stats.json.
"""
from __future__ import annotations

import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import agencies_parse as A  # noqa: E402
import authorities_common as C  # noqa: E402
import build_agencies as BA  # noqa: E402
import build_ptoa as BP  # noqa: E402
import build_subject as BS  # noqa: E402
import fetchlib as fl  # noqa: E402
import ptoa_parse as P  # noqa: E402
import subject_parse as S  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "ecfr_authorities")
LOOK = os.path.join(OUT, "lookups")
YEAR = "2025"
PKG = C.PACKAGE_FMT.format(year=YEAR)

PUBLISHER_NOTE = (
    "Published by the Office of the Federal Register (National Archives and Records Administration) and the "
    "U.S. Government Publishing Office as the annual CFR Index and Finding Aids; U.S. Government work in the public domain."
)
WALL_NOTE = (
    "The eCFR's own pages for these tables (/parallel-table-of-authorities/current, /subject-index/current, "
    "/agency-indexes) answer programmatic requests with a redirect to a bot-check page that says programmatic access is "
    "limited to the developer APIs, and the eCFR API has no endpoint for them. They were not fetched around that check; the "
    "same finding aids are taken from the Office of the Federal Register's annual edition on GovInfo (documented API)."
)


def manifest_inputs(prefix: str) -> list[dict]:
    man = fl.read_manifest()
    out = []
    for k, e in sorted(man.items()):
        if e.get("kind") == "probe" or not str(e.get("path", "")).startswith(prefix):
            continue
        out.append({"url": e["url"], "path": "private/acq/ecfr_authorities/" + e["path"], "sha256": e["sha256"], "retrieved_at": e["retrieved_at"]})
    return out


def entry(rel: str) -> dict:
    return fl.read_manifest()[rel]


def load_lookups() -> tuple[set[str], set[str], dict[str, str]]:
    with open(os.path.join(LOOK, "us_code_section_ids.json"), encoding="utf-8") as fh:
        sec = json.load(fh)
    with open(os.path.join(LOOK, "ecfr_part_ids.json"), encoding="utf-8") as fh:
        parts = json.load(fh)
    with open(os.path.join(LOOK, "fr_agency_rows.json"), encoding="utf-8") as fh:
        fr = json.load(fh)
    return set(sec["status_by_id"]), set(parts["parts"]), BA.fr_slug_index(fr["rows"]), sec, parts, fr


def write_build(dataset: str, label: str, listing_block: dict, summary: dict, rows: list[dict], inputs: list[dict]) -> str:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{dataset}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(
            {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows, "built_at": fl.utc_now(), "inputs": inputs},
            fh,
            ensure_ascii=False,
            sort_keys=True,
        )
    return path


def build_ptoa(section_ids: set[str], part_ids: set[str], lookup_meta: dict) -> dict:
    rel = f"govinfo/{PKG}/{PKG}-4.htm.htm.gz"
    e = entry(rel)
    raw = fl.load(rel).decode("utf-8")
    result = P.parse(raw)
    rows, stats = BP.build_rows(result, year=YEAR, retrieved_at=e["retrieved_at"], section_ids=section_ids, part_ids=part_ids)
    summary = {
        "source": f"CFR Index and Finding Aids, {YEAR} edition, Parallel Table of Authorities and Rules (GovInfo package {PKG}, granule {PKG}-4)",
        "source_urls": [
            f"https://www.govinfo.gov/app/details/{PKG}/{PKG}-4",
            f"https://www.govinfo.gov/content/pkg/{PKG}/pdf/{PKG}-4.pdf",
        ],
        "publisher": PUBLISHER_NOTE,
        "edition": YEAR,
        "table_revised_as_of": result.revised_as_of,
        "printed_pages": list(result.pages),
        "retrieved_at": e["retrieved_at"],
        "why_not_the_ecfr_page": WALL_NOTE,
        "currentness": f"The table is revised as of {result.revised_as_of}; a CFR part or U.S. Code section added, renumbered or removed since then is not reflected. Links resolve against the Code and eCFR text stored in the Atlas today.",
        "method": (
            "One row per authority and CFR title group exactly as the table prints them: the authority (U.S. Code section, "
            "Statutes at Large page, public law number or Presidential document), the heading it is printed under, the CFR title "
            "and the parts listed, the printed page. Whitespace runs are collapsed to one space; wrapped lines are joined. "
            "U.S. Code authorities are classified as exact (one section), note, et seq., range or other form; only exact and note "
            "carry a section key. A U.S. Code authority links to a stored section only when title and section key equal a stored "
            "us_code_sections id; an “et seq.” or a range is kept as published and never expanded; every other authority is "
            "'Not in the stored Code'. A CFR part links to a stored ecfr_sections_full part only on exact title and part designation; "
            "part ranges (e.g. 1301--1309) are kept as published and not expanded."
        ),
        "qualification": (
            "The table lists rulemaking authority as the agencies cite it in their regulations; the Office of the Federal Register states "
            "that agencies are responsible for keeping these citations current and that the table cannot be considered all-inclusive. "
            "A row says an agency cited the authority for the part; it does not say the part implements every provision of that authority."
        ),
        "row_ids": "usc:<title>[.<variant>]:<authority>:cfr<CFR title>, stat:<volume>:<page>:cfr<n>, publaw:<number>:cfr<n>, pres:<kind>:<authority>:cfr<n>; a repeat of the same id gets ~2, ~3",
        "lookups": {"us_code_sections": {"count": lookup_meta["sec"]["count"], "sha256": lookup_meta["sec"]["sha256"]}, "ecfr_sections_full_parts": {"count": lookup_meta["parts"]["count"], "sha256": lookup_meta["parts"]["sha256"]}},
        "counts": stats,
    }
    path = write_build(C.DATASET, BP.LABEL, BP.listing_block(), summary, rows, manifest_inputs(f"govinfo/{PKG}/{PKG}-4"))
    return {"path": path, "rows": len(rows), "stats": stats}


def build_subject(part_ids: set[str]) -> dict:
    rel = f"govinfo/{PKG}/{PKG}-2.pdf.gz"
    e = entry(rel)
    pdf = fl.load(rel)
    lines = S.pdf_lines(pdf, progress=lambda p: print(f"  subject index: page {p}", flush=True))
    headings, anomalies = S.build(lines)
    revised = "January 1, 2025"
    rows, stats = BS.build_rows(headings, year=YEAR, retrieved_at=e["retrieved_at"], part_ids=part_ids, revised_as_of=revised)
    stats["parse_anomalies"] = anomalies
    summary = {
        "source": f"CFR Index and Finding Aids, {YEAR} edition, Subject/Agency Index (GovInfo package {PKG}, granule {PKG}-2, PDF)",
        "source_urls": [
            f"https://www.govinfo.gov/app/details/{PKG}/{PKG}-2",
            f"https://www.govinfo.gov/content/pkg/{PKG}/pdf/{PKG}-2.pdf",
        ],
        "publisher": PUBLISHER_NOTE,
        "edition": YEAR,
        "index_covers_regulations_as_of": revised,
        "retrieved_at": e["retrieved_at"],
        "why_not_the_ecfr_page": WALL_NOTE,
        "method": (
            "One record per subject heading (bold in the printed index; the PDF's typeface identifies headings, which the text "
            "rendition cannot) with its entries in print order, each with its nesting level (9 pt steps; wrapped lines joined) and the "
            "'<title> CFR <part>' references found in its text. Headings with more than 150 entries are split into consecutive "
            "records. An entry whose text carries no '<title> CFR <designation>' keeps refs empty; nothing is inferred. Diacritics "
            "(letter + spacing macron) are recomposed; en dashes in part designations are written as hyphens in the reference keys only."
        ),
        "qualification": (
            "Subject terms come from the Office of the Federal Register thesaurus; the index directs readers to CFR parts and is not "
            "a list of every provision on a subject. Entries are indexed as of the date above."
        ),
        "row_ids": "subject:<heading with spaces as _>[~n for a repeated heading][:part<k> for a segment]",
        "counts": stats,
    }
    path = write_build(BS.DATASET, BS.LABEL, BS.listing_block(), summary, rows, manifest_inputs(f"govinfo/{PKG}/{PKG}-2"))
    return {"path": path, "rows": len(rows), "stats": stats}


def build_agencies(fr_slugs: dict[str, str]) -> dict:
    ag_rel, ti_rel, pr_rel = "ecfr/agencies.json.gz", "ecfr/titles.json.gz", f"govinfo/{PKG}/{PKG}-3.htm.htm.gz"
    e_ag, e_ti, e_pr = entry(ag_rel), entry(ti_rel), entry(pr_rel)
    agencies = A.parse_agencies(fl.load(ag_rel))
    prepared = A.parse_prepared_indexes(fl.load(pr_rel).decode("utf-8"))
    titles = json.loads(fl.load(ti_rel))
    asof = sorted({t.get("up_to_date_as_of") for t in titles.get("titles", []) if t.get("up_to_date_as_of")})
    rows, stats = BA.build_rows(agencies, prepared, year=YEAR, retrieved_at=e_ag["retrieved_at"], fr_slugs=fr_slugs, titles_asof=asof[-1] if asof else None)
    summary = {
        "source": "eCFR admin API agency list (https://www.ecfr.gov/api/admin/v1/agencies.json) and the printed List of Agency-Prepared Indexes Appearing in Individual CFR Volumes (CFR Index and Finding Aids, " + YEAR + ")",
        "source_urls": [BA.API_URL, f"https://www.govinfo.gov/content/pkg/{PKG}/pdf/{PKG}-3.pdf"],
        "retrieved_at": {"agencies": e_ag["retrieved_at"], "agency_prepared_indexes": e_pr["retrieved_at"]},
        "why_not_the_ecfr_page": WALL_NOTE,
        "method": (
            "One record per agency node exactly as the eCFR lists it: name, short name, display name, sortable name, slug, parent, "
            "child agencies and the title / chapter / subtitle / subchapter / part references it is responsible for (a key the eCFR "
            "omits stays absent). A record links to /agencies/<id> only when its slug equals the Federal Register slug of exactly one "
            "stored agency profile. The six agency-prepared-index rows are linked to an agency only on an exact title + single chapter "
            "match to exactly one agency."
        ),
        "qualification": "The agency list is the eCFR's editorial grouping of CFR chapters; a chapter shared by several agencies appears under each.",
        "row_ids": "agency:<slug>, prepared-index:<CFR title>-<n>",
        "counts": stats,
    }
    path = write_build(BA.DATASET, BA.LABEL, BA.listing_block(), summary, rows, manifest_inputs("ecfr/") + manifest_inputs(f"govinfo/{PKG}/{PKG}-3"))
    return {"path": path, "rows": len(rows), "stats": stats}


def main(argv: list[str]) -> None:
    only = next((a.split("=", 1)[1] for a in argv if a.startswith("--only=")), None)
    section_ids, part_ids, fr_slugs, sec, parts, fr = load_lookups()
    meta = {"sec": sec, "parts": parts}
    result: dict = {}
    if only in (None, "ptoa"):
        result["ptoa"] = build_ptoa(section_ids, part_ids, meta)
    if only in (None, "agencies"):
        result["agencies"] = build_agencies(fr_slugs)
    if only in (None, "subject"):
        result["subject"] = build_subject(part_ids)
    os.makedirs(OUT, exist_ok=True)
    stats_path = os.path.join(OUT, "build_stats.json")
    old = {}
    if os.path.exists(stats_path):
        with open(stats_path, encoding="utf-8") as fh:
            old = json.load(fh)
    old.update({k: {"rows": v["rows"], "stats": v["stats"], "built_at": fl.utc_now()} for k, v in result.items()})
    with open(stats_path, "w", encoding="utf-8") as fh:
        json.dump(old, fh, ensure_ascii=False, indent=1, sort_keys=True)
    for k, v in result.items():
        print(json.dumps({"dataset": k, "rows": v["rows"], "file": os.path.relpath(v["path"], ROOT)}))


if __name__ == "__main__":
    main(sys.argv[1:])
