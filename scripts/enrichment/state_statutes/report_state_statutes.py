"""Write private/build/state_statutes/REPORT.md and per_state.json: the per-state table for the state_statutes stream.

Usage: python3 -I -B report_state_statutes.py <coverage.yml> <build_dir> [--measured '{"SD": {...}}']

Inputs: open-us-law coverage.yml (read for official_source / bulk_source / tier / containers only; none of the
project's bundled data is read), the build files and verify reports in <build_dir>, the projection table below
(read-only query of corpus_ingest.publisher_code_codes_v3 on 2026-10-19: primary codes with
public_projection_allowed), and measured bytes per stored row passed with --measured.
"""
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codebuild  # noqa: E402

# jurisdiction -> (source_system, sections, publisher) from the read-only query named above.
PROJECTION = {
    "AK": ("ak-basis-statutes", 20717, "Alaska State Legislature (BASIS Statutes)"),
    "AL": ("al-code-of-alabama", 48872, "Alabama Legislative Services Agency (ALISON)"),
    "AR": ("ar-historical-rtf-20201106", 37504, "Public.Resource.Org / Internet Archive (third-party historical source)"),
    "AZ": ("az-revised-statutes", 25157, "Arizona Legislature (azleg.gov)"),
    "CA": ("ca-leginfo-pubinfo", 162526, "California Legislature (Legislative Counsel)"),
    "CO": ("co-crs", 35791, "Colorado Office of Legislative Legal Services"),
    "CT": ("ct-general-statutes", 32519, "Connecticut General Assembly, Legislative Commissioners' Office"),
    "DC": ("dc-council-html", 24746, "Council of the District of Columbia (D.C. Law Library)"),
    "DE": ("de-delaware-code", 23444, "Delaware Code Revisors / Division of Legislative Services"),
    "FL": ("fl-statutes", 24993, "The Florida Legislature (Online Sunshine)"),
    "GA": ("ga-georgiacommons-2025", 29682, "Georgia Commons (third-party edition archive)"),
    "HI": ("hi-hrs", 22973, "Hawaii State Legislature"),
    "IA": ("ia-iowa-code-2026", 47239, "Iowa Legislative Services Agency"),
    "ID": ("id-statutes", 22538, "Idaho State Legislature, Legislative Services Office"),
    "IL": ("il-compiled-statutes", 72813, "Illinois General Assembly (ilga.gov)"),
    "IN": ("in-code", 83148, "Indiana General Assembly, Legislative Services Agency"),
    "KS": ("ks-statutes", 47489, "Kansas Office of Revisor of Statutes"),
    "KY": ("ky-revised-statutes", 40462, "Kentucky Legislative Research Commission"),
    "LA": ("la-revised-statutes", 46365, "Louisiana State Legislature (legis.la.gov)"),
    "MA": ("ma-general-laws", 26812, "Massachusetts General Court (malegislature.gov)"),
    "MD": ("md-code", 40347, "Maryland General Assembly"),
    "ME": ("me-mrs-html", 45774, "Maine Legislature, Office of the Revisor of Statutes"),
    "MI": ("mi-compiled-laws", 43891, "Michigan Legislature (legislature.mi.gov)"),
    "MN": ("mn-statutes", 55445, "Minnesota Office of the Revisor of Statutes"),
    "MO": ("mo-revised-statutes", 30472, "Missouri Revisor of Statutes"),
    "MS": ("ms-historical-rtf-20200708", 28913, "Public.Resource.Org / Internet Archive (third-party historical source)"),
    "MT": ("mt-mca", 44917, "Montana Legislature, Legislative Services Division"),
    "NC": ("nc-general-statutes", 39612, "North Carolina General Assembly"),
    "ND": ("nd-cencode-chapter-pdf-html", 17612, "North Dakota Legislative Branch"),
    "NE": ("ne-revised-statutes", 56371, "Nebraska Legislature, Revisor of Statutes"),
    "NH": ("nh-rsa-html", 27737, "New Hampshire General Court"),
    "NJ": ("nj-pub-statutes-bulk", 56333, "New Jersey Legislature, Office of Legislative Services"),
    "NM": ("nm-nmsa-1978", 62972, "New Mexico Compilation Commission"),
    "NV": ("nv-nrs-lcb", 50084, "Nevada Legislature, Legislative Counsel Bureau"),
    "NY": ("ny-consolidated-laws", 37530, "New York State Senate (OpenLegislation)"),
    "OH": ("oh-codes-ohio-gov", 33343, "Ohio Legislative Service Commission"),
    "OK": ("ok-statutes", 48019, "Oklahoma Legislature / Legislative Service Bureau"),
    "OR": ("or-ors", 65750, "Oregon Legislative Assembly"),
    "PA": ("pa-consolidated-statutes", 14741, "Pennsylvania General Assembly (palegis.us)"),
    "RI": ("ri-statutes-web", 32852, "Rhode Island General Assembly"),
    "SC": ("sc-code-of-laws", 30867, "South Carolina Legislature"),
    "SD": ("sd-sdcl-api", 27876, "South Dakota Legislature (Statutes API)"),
    "TN": ("tn-historical-rtf-20210521", 34356, "Public.Resource.Org / Internet Archive (third-party historical source)"),
    "TX": ("tx-texas-legislature-code", 121902, "Texas Legislature (Texas Statutes)"),
    "UT": ("ut-code", 22977, "Utah Office of Legislative Research and General Counsel"),
    "VA": ("va-code", 34442, "Virginia Division of Legislative Services"),
    "VT": ("vt-statutes-online", 26463, "Vermont General Assembly"),
    "WA": ("wa-rcw-archive-2026-pdf", 44096, "Washington State Legislature (Code Reviser)"),
    "WI": ("wi-statutes", 18153, "Wisconsin Legislative Reference Bureau"),
    "WV": ("wv-code", 31246, "West Virginia Legislature"),
    "WY": ("wy-statutes", 21412, "Wyoming Legislative Service Office"),
}

COMMERCIAL_ONLY = {
    "AR": "arkleg.state.ar.us links its 'Arkansas Code' to lexisnexis.com/hottopics/arcode (LexisNexis); no first-party text",
    "GA": "Georgia General Assembly public access is advance.lexis.com, 'contractual arrangement with LexisNexis'",
    "MS": "sos.ms.gov: the searchable code 'is a link to information provided by LexisNexis Publishing, the official publisher'",
    "TN": "Tennessee Code Unannotated free public access is advance.lexis.com (LexisNexis); capitol.tn.gov robots.txt disallows generic crawlers",
}

BUILT = {"SD": ("sd_code.json", "sd_verify.json"), "WA": ("wa_code.json", "wa_verify.json"), "ND": ("nd_code.json", "nd_verify.json")}

PROJECTION_GAPS = {
    "SD": "projection has no letter-suffixed titles (23A, 27A, 27B, 29A, 33A, 34A, 46A, 51A, 57A) or chapters (e.g. 1-1A) and misses sections such as 2-1-1; official sitemap lists 47,676 section numbers",
    "WA": "projection has none of the 18 letter-suffixed or later titles 9A, 23B, 25, 28A, 28B, 28C, 29A, 29B, 30A, 30B, 35A, 50A, 50B, 62A, 70A, 71A, 79A, 82A (official title list has 101)",
    "ND": "projection has none of the decimal titles 4.1, 12.1 (Criminal Code), 15.1, 16.1, 20.1, 23.1, 26.1, 30.1, 62.1; official contents list 29,116 section entries",
}


def load(path):
    for candidate in (Path(path), Path(f"{path}.gz")):
        if candidate.exists():
            return codebuild.read_build(candidate)
    return None


def main(coverage_path, build_dir, measured):
    coverage = {j["code"].upper(): j for j in yaml.safe_load(Path(coverage_path).read_text())["jurisdictions"]}
    build_dir = Path(build_dir)
    rows = []
    for state in sorted(set(PROJECTION) | {"PR"}):
        cov = coverage.get(state, {})
        proj = PROJECTION.get(state)
        entry = {
            "state": state,
            "official_source": cov.get("official_source", "Not recorded"),
            "bulk_source": cov.get("bulk_source", "Not recorded"),
            "tier": cov.get("source_tier", "Not recorded"),
            "oul_containers": cov.get("containers", "Not recorded"),
            "projection": f"{proj[1]:,} sections, {proj[2]}" if proj else "none",
        }
        if state in BUILT:
            build = load(build_dir / BUILT[state][0])
            report = load(build_dir / BUILT[state][1])
            entry["sections_built"] = len(build["rows"]) if build else "not built"
            entry["source_url"] = build["summary"]["full_code"]["source_url"] if build else "Not recorded"
            entry["verification"] = (
                {k: v["failures"] for k, v in report["checks"].items()} | {"total_failures": report["total_failures"]} if report else "not run"
            )
            entry["bytes_per_row"] = measured.get(state, {}).get("bytes_per_row", "not published (compact JSON estimate in build stats)")
            entry["published"] = measured.get(state, {}).get("published", "no (lead publishes after review)")
            entry["reason"] = PROJECTION_GAPS[state]
        elif state in COMMERCIAL_ONLY:
            entry.update(sections_built=0, verification="n/a", bytes_per_row="n/a", published="no",
                         reason=f"skipped: official text only on a commercial host ({COMMERCIAL_ONLY[state]}); app keeps its labelled third-party historical projection")
        elif state == "PR":
            entry.update(sections_built=0, verification="n/a", bytes_per_row="n/a", published="no",
                         reason="skipped: Puerto Rico is not in the app's state list (src/lib/corpus/geo.ts STATES), so /law/codes/PR cannot render it; official source is per-title PDFs (bvirtualogp.pr.gov), Spanish/English")
        else:
            entry.update(sections_built=0, verification="n/a", bytes_per_row="n/a", published="no",
                         reason="skipped: the app already serves a reviewed public full-code projection from this official publisher")
        rows.append(entry)
    (build_dir / "per_state.json").write_text(json.dumps(rows, indent=1))
    lines = ["| State | Source URL / official source | Tier | Sections built | Verification | Bytes/row | Published | Skipped reason / note |",
             "|---|---|---|---|---|---|---|---|"]
    for e in rows:
        ver = e["verification"] if isinstance(e["verification"], str) else ", ".join(f"{k} {v}" for k, v in e["verification"].items())
        lines.append(f"| {e['state']} | {e.get('source_url', e['official_source'])} | {e['tier']} | {e['sections_built']} | {ver} | {e['bytes_per_row']} | {e['published']} | {e['reason']} |")
    (build_dir / "per_state_table.md").write_text("\n".join(lines) + "\n")
    write_report(build_dir, rows, lines, measured)
    print("\n".join(lines[:3]), f"... {len(rows)} rows written")


def write_report(build_dir, rows, table_lines, measured):
    """REPORT.md: sources and terms, coverage, counts, spot checks, exclusions, storage projection, risks."""
    out = ["# state_statutes stream report (2026-10-19)", ""]
    out += ["## Finding that shaped the work", "",
            "All 50 states and DC already have a reviewed, publicly projected full code in the app "
            "(corpus_ingest publisher-code projections; `/law/codes/<state>` renders them and they win over datasets). "
            "47 of them come from the same official publishers the open-us-law scrapers target, so building those again "
            "would duplicate text already stored and stay invisible behind the projection; they are skipped. "
            "Checking the projections against each publisher's own table of contents found three with large holes, "
            "which this stream rebuilt completely from the official publisher:", ""]
    for state in BUILT:
        out.append(f"* {state}: {PROJECTION_GAPS[state]}.")
    out += ["", "AR, GA, MS and TN publish their official code only through LexisNexis (commercial host, never fetched): skipped. "
            "Puerto Rico is not in the app's state list.", ""]
    out += ["## Per-state table", ""] + table_lines + [""]
    out += ["## Datasets built", ""]
    total_rows = 0
    for state, (build_name, report_name) in BUILT.items():
        build = load(build_dir / build_name)
        report = load(build_dir / report_name)
        if not build:
            continue
        total_rows += len(build["rows"])
        s = build["summary"]
        out += [f"### {build['dataset']} ({state})", "",
                f"* Label: {build['label']}; rows {len(build['rows']):,}; titles {s.get('titles')}; retrieved {s.get('retrieved')}",
                f"* Source: {s.get('source')}",
                f"* Terms: {s.get('terms')}",
                f"* Method: {s.get('method')}",
                f"* Build stats: `{json.dumps(s.get('stats'))}`",
                f"* full_code (stored in metadata.summary.full_code): `{json.dumps(s.get('full_code'))}`"]
        excl = (s.get("excluded_appendices") or []) + (s.get("excluded_records") or [])
        if excl:
            out.append(f"* Excluded ({len(excl)}): " + "; ".join(f"{e.get('number') or e.get('title')}: {e.get('reason') or e.get('first')}" for e in excl[:20]))
        if report:
            out.append("* Verification: " + ", ".join(f"{k} failures {v['failures']}" for k, v in report["checks"].items()) + f"; total {report['total_failures']}")
            live = report["checks"].get("live_sample", {})
            out += ["", "Spot checks (live re-fetch, word for word; first 15 of the sample):", "",
                    "| Row id | Words compared | Match |", "|---|---|---|"]
            for r in live.get("results", [])[:15]:
                out.append(f"| {r['id']} | {r.get('words', 'n/a')} | {'yes' if r.get('ok') else 'no'} |")
        m = measured.get(state)
        if m:
            out.append(f"\n* Stored size (pg_column_size, read-only query after publish): {m.get('bytes_per_row')}")
        out.append("")
    avg = [v["avg_row_bytes"] for v in measured.values() if isinstance(v, dict) and v.get("avg_row_bytes")]
    if avg:
        mean = sum(avg) / len(avg)
        others = sum(p[1] for st, p in PROJECTION.items() if st not in BUILT and st not in COMMERCIAL_ONLY)
        all_rows = total_rows + others
        out += ["## Storage projection", "",
                f"Measured average stored row (heap incl. TOAST): {mean:,.0f} bytes (SD and WA). Index overhead is estimated at "
                "about 600-900 bytes per row for these short-title rows (title btree, id/ordinal btrees, search_vector and "
                "filters GIN). The Indiana dataset averages 8,074 bytes per row for comparison.",
                f"* The three rebuilt states: {total_rows:,} rows, about {total_rows * mean / 1e6:,.0f} MB heap + "
                f"{total_rows * 0.75e3 / 1e6:,.0f} MB indexes.",
                f"* If every official state code were also stored this way ({all_rows:,} rows using the projection counts "
                f"for the other {len(PROJECTION) - len(BUILT) - len(COMMERCIAL_ONLY)} jurisdictions): about "
                f"{all_rows * mean / 1e9:,.1f} GB heap + {all_rows * 0.75e3 / 1e9:,.1f} GB indexes. Not recommended: those "
                "codes are already served by reviewed projections.", ""]
    (build_dir / "REPORT.md").write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    measured = json.loads(args[args.index("--measured") + 1]) if "--measured" in args else {}
    main(args[0], args[1], measured)
