"""Write private/build/ecfr_full/REPORT.md from the build, verification, spot-check and publish outputs.

  python3 -I -B scripts/enrichment/ecfr_full/write_report.py [published_size_note]
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_ecfr_full import BUILD  # noqa: E402


def load(name: str):
    path = os.path.join(BUILD, name)
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else None


def main(argv: list[str]) -> None:
    full = load("ecfr_sections_full.meta.json")
    ver = load("ecfr_section_versions.meta.json")
    vr = load("verify_report.json")
    sc = load("spot_checks.json")
    align = load("ecfr_sections_full.alignment.json")
    r_full = load("ecfr_sections_full.publish_receipt.json")
    r_ver = load("ecfr_section_versions.publish_receipt.json")
    size_note = " ".join(argv) or "Not recorded"
    s = full["summary"]
    vs = ver["summary"]
    bc = s["build_counts"]
    sp = vr["second_path"]
    h = vr["hierarchy"]
    lines = [
        "# ecfr_full — full current eCFR text and change history",
        "",
        f"Built {full['built_at']} (text) and {ver['built_at']} (history).",
        "",
        "## Sources and terms",
        "- GovInfo eCFR bulk XML, one file per title: https://www.govinfo.gov/bulkdata/ECFR/title-{n}/ECFR-title{n}.xml "
        "(49 titles; title 35 is reserved). GPO states these files are not subject to copyright (17 U.S.C. 105); public domain. "
        "robots.txt allows /bulkdata.",
        "- eCFR API (keyless, public domain): titles.json (\"up to date as of\" per title), structure/{date}/title-{n}.json "
        "(identity and hierarchy; at the text date and at 2026-09-30 for the ecfr_hierarchy check), versions/title-{n}.json "
        "(every page; 1,000 rows per page). The eCFR is authoritative but unofficial; the official edition is the annual CFR.",
        "- eCFR API full/{date}/title-{n}.xml?part=&section= only for the 300-section second-path sample and the site's live "
        "\"as of\" view. robots.txt asks crawlers not to index /api/versioner/v1/full/ (\"Don't index developer tool links\"); "
        "the bulk text never uses it.",
        "- Federal Register API (keyless): every RULE document published 2015-07 to 2026-10 (fields document_number, citation, "
        "volume, start/end page, publication date, effective_on, cfr_references). Terms: no NARA/OFR logos; FR API text is "
        "unofficial (only citations and dates are used).",
        "- api.data.gov key: not used (0 requests). Every raw response is stored gzip-compressed under private/acq/ecfr_full/ "
        "with url, sha256 of the uncompressed body, size, status and time in _manifest.jsonl.",
        "",
        "## Datasets",
        f"- `ecfr_sections_full` — {full['rows']:,} rows: {s['sections']:,} sections, {s['appendices']:,} appendices, "
        f"{s['parts']:,} parts; {s['characters']:,} characters of body text; {s['tables']:,} tables; {s['graphics']:,} graphics "
        f"referenced; text up to date as of {', '.join(s['up_to_date_as_of'])}. Row ids cfr:<title>:<identifier> "
        "(appendix identifiers printed in several parts get @part-<part>; parts cfr:<title>:part-<part>).",
        f"- `ecfr_section_versions` — {ver['rows']:,} rows (one per section/appendix the versioner lists, {vs['rows_removed_in_latest_version']:,} "
        f"removed in their latest version), {vs['versions']:,} versions; {vs['rows_in_current_text']:,} rows join a current-text row.",
        "",
        "## Coverage and counts (verify_ecfr_full.py)",
        f"- Counts vs the eCFR structure API at the same date: sections {vr['count_totals']['sections']:,} / "
        f"{vr['count_totals']['sections_api']:,}; appendices {vr['count_totals']['appendices']:,} / {vr['count_totals']['appendices_api']:,}; "
        f"parts {vr['count_totals']['parts']:,} / {vr['count_totals']['parts_api']:,}; per-title section, appendix, part and reserved-section "
        "counts all equal (49 titles).",
        f"- ecfr_hierarchy (2026-09-30 snapshot) equals the eCFR structure for 2026-09-30 (per-title count and md5 of native ids, "
        f"read-only corpus query). Of its {h['nodes']:,} section/appendix nodes, {h['with_text']:,} have text here; the rest are explained: "
        + "; ".join(f"{k} {v:,}" for k, v in h["explained"].items())
        + f". Unexplained: {len(h['unexplained'])}.",
        f"- Second fetch path: {sp['compared']} sections/appendices ({sp['sample_size']} random, seed {sp['seed']}, plus the two the GovInfo "
        f"XML prints twice) re-read from the eCFR API at the same date: body identical word for word in {sp['identical_body']}, notes "
        f"identical in {sp['identical_notes']}. Remaining differences: "
        + ("; ".join(f"{m['id']} at word {m.get('body_diff', {}).get('at_word')}: stored “{m.get('body_diff', {}).get('stored', '')[:60]}” vs API "
                     f"“{m.get('body_diff', {}).get('api', '')[:60]}”" for m in sp["mismatches"]) or "none")
        + ".",
        f"- Verification failures: {vr['failure_count']}.",
        "",
        "## Build notes and exclusions",
        f"- Alignment: every structure section/appendix matched to an XML item ({sum(a['xml_matched'] for a in align.values()):,}). "
        f"XML items with no structure node: {bc.get('xml_unmatched', 0)} — sections the GovInfo XML prints twice (48 CFR 849.504 and "
        "849.504-70: identical copies; 7 CFR 1221.128: a second, shorter copy; the first, full copy is stored and matches the eCFR "
        "structure size).",
        f"- Sections printed across volumes and continued under the same number (“(Continued)”) are joined: {bc.get('continuation_pieces_joined', 0)} pieces.",
        f"- Part-level notes stored on part rows: {bc.get('part_notes', 0):,}; content printed directly in parts/subparts: "
        f"{bc.get('part_body_lines', 0):,} lines. Not stored (above the part level, out of scope): {bc.get('notes_above_part', 0)} chapter/subchapter "
        f"notes, {bc.get('body_above_part', 0)} chapter/subchapter text blocks, {bc.get('part_notes_unplaced', 0)} lines under the "
        "“PARTS 1240-1259—REPORTS” heading in 49 CFR, which has no eCFR structure node.",
        f"- Reserved sections {s['reserved_sections']:,}; sections with no body {s['sections_without_body']:,} (reserved, editorial-note-only "
        "or heading-only in the source); graphics-only appendices are counted apart.",
        f"- Accent codes: {s['accent_codes']}. Codes 1-4, 6-9 from the eCFR XML User Guide; b, g, i, j as the eCFR renders them "
        "(40 CFR 1065.650, 10 CFR 429.35); unmapped codes (prefixed unmapped:) are not reproduced.",
        "- Emphasis codes: 51/53 superscript, 52/54 and 0732 subscript (0732 rendered as <sub> by the eCFR API in 5/5 sampled cells); "
        "other four-digit typesetting codes stay plain text.",
        f"- Unknown elements kept as paragraphs: {s['unknown_elements_kept_as_paragraphs']} (CFRTOC tables of contents are not text).",
        "",
        "## Federal Register links (ecfr_section_versions)",
        "- The eCFR API does not name the rule behind a change. A version links to Federal Register RULE documents only on exact keys: "
        "the document lists the CFR title and part, its effective date equals the version's amendment date, and it was published by "
        "the eCFR issue date. Basis recorded per version: source_note (a candidate whose page range holds a citation printed in the "
        "section's own source note), only_rule_for_part_on_date, rules_for_part_on_date (all candidates listed), none.",
        f"- Counts: {vs['fr_link_basis_counts']}. FR documents loaded {vs['fr_documents_loaded']:,}, linked {vs['fr_documents_linked']:,}.",
        "",
        "## Spot checks",
    ]
    if sc:
        lines.append(f"- Text vs raw GovInfo XML: {sc['text_matches']}/15 match.")
        for c in sc["text"]:
            lines.append(f"  - {c['citation']}: start “{c['stored_start'][:50]}…” — {c['where']} — {'match' if c['match'] else 'NO MATCH'}")
        lines.append(f"- Federal Register links (basis source_note): {sc['fr_matches']}/15 match (effective date = amendment date, part listed, "
                     "source-note citation inside the rule's pages).")
        for c in sc["federal_register_links"]:
            lines.append(f"  - {c['section']} {c['version_date']}: {c['fr_citation']} ({c['fr_document']}, effective {c['fr_effective_on']}, pages "
                         f"{c['fr_pages'][0]}-{c['fr_pages'][1]}; source note {', '.join(c['source_note_citation'])}) — {'match' if c['match'] else 'NO MATCH'}")
    lines += [
        "",
        "## Publish",
        f"- ecfr_sections_full: {json.dumps(r_full) if r_full else 'not published'}",
        f"- ecfr_section_versions: {json.dumps(r_ver) if r_ver else 'not published'}",
        f"- Database size: {size_note}",
        "",
        "## Open risks",
        "- The eCFR changes daily; this is a snapshot as of the dates above. Rebuild: acquire.py titles/govinfo/structure/versions/fr, "
        "build_ecfr_full.py, build_ecfr_versions.py, verify_ecfr_full.py, publish_stream.py.",
        "- Federal Register links are candidates on exact keys, not the eCFR's own attribution; rules with several effective dates or "
        "no effective_on in the FR API are not linked (Not recorded).",
        "- Four-digit GPO emphasis codes other than 0732 have no published rendering; their text is kept without sub/superscript.",
        "- Graphics are linked to https://www.ecfr.gov/graphics/<file> (not fetched or reproduced here).",
    ]
    with open(os.path.join(BUILD, "REPORT.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(os.path.join(BUILD, "REPORT.md"))


if __name__ == "__main__":
    main(sys.argv[1:])
