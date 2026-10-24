"""Write private/build/jpml_reports/REPORT.md from the wave-1026 build files (run after build_jpml_series.py and
verify_series.py). Deterministic; reads only the build directory.

  python3 -I -B scripts/enrichment/jpml_history/make_series_report.py
"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
B = ROOT / "private" / "build" / "jpml_reports"
DATASETS = ["jpml_pending_snapshots", "jpml_mdl_pending_series", "jpml_transferee_series", "jpml_quarterly_caseload", "jpml_series_index"]
GRAIN = {
    "jpml_pending_snapshots": "one row per held report date (`report:<YYYY-MM-DD>`, monthly and quarter-end) + `summary:overview` with the national series",
    "jpml_mdl_pending_series": "one row per MDL number (`mdl:<n>`) with every held report point, title/district/judge runs as printed, peak, changes",
    "jpml_transferee_series": "one row per transferee district code (`district:<code>`) and per judge name as printed (`judge:<slug>-<hash>`), series per monthly report",
    "jpml_quarterly_caseload": "one row per quarter-end report (`quarter:<date>`) and per circuit (`circuit:<slug>`)",
    "jpml_series_index": "one row per series (`series:<id>`) and per report file on the four pages or found unlisted (`report:<sha256 prefix>`)",
}


def load(name):
    return json.loads((B / name).read_text())


def main():
    builds = {d: load(f"{d}.json") for d in DATASETS}
    ver = load("verification.json")
    inv = load("report_inventory.json")
    snap = builds["jpml_pending_snapshots"]
    ov = next(r for r in snap["rows"] if r["id"] == "summary:overview")["item"]["overview"]
    trans = builds["jpml_transferee_series"]["rows"]
    dist = [r for r in trans if r["id"].startswith("district:")]
    judges = [r for r in trans if r["id"].startswith("judge:")]
    status = Counter(f["status"] for f in inv)
    lines = ["# jpml_reports: JPML statistics as continuing series (wave 1026)", "",
             f"Built {snap['built_at']} by `scripts/enrichment/jpml_history/build_jpml_series.py`; verified by `verify_series.py`. Nothing was published or written to any remote service.", "",
             "## Datasets", "", "| dataset | rows | grain | build file |", "|---|---:|---|---|"]
    for d in DATASETS:
        lines.append(f"| `{d}` | {len(builds[d]['rows'])} | {GRAIN[d]} | `private/build/jpml_reports/{d}.json` |")
    lines += ["", "All five ids are new (checked against `public.corpus_datasets` on 2026-10-24). The 2026-10-18 datasets `jpml_pending_history_mdls`, `jpml_pending_history_months` and `jpml_statistics_extra` are unchanged: the builder rebuilds them in memory and they equal the published rows (manifest sha256 equal).", "",
              "## Sources and terms", "", snap["summary"]["terms"], "",
              "Sources: https://www.jpml.uscourts.gov/pending-mdls-0, https://www.jpml.uscourts.gov/pending-mdl-reports-archive, https://www.jpml.uscourts.gov/mdl-quarterly-caseload-summary, https://www.jpml.uscourts.gov/statistics-info and 83 older official report files on jpml.uscourts.gov found by site search (fetched directly; listed in `private/acq/jpml_reports/discovered_urls.json`). robots.txt Crawl-delay 10 s honoured.", "",
              "## Coverage", "",
              f"- Monthly reports held and validated: {len(ov['monthly'])} ({ov['monthly'][0]['date']} to {ov['monthly'][-1]['date']}); gaps: {len(ov['monthly_gaps'])}; quarter-end reports: {len(ov['quarter_end'])}.",
              f"- MDL numbers with a series: {len(builds['jpml_mdl_pending_series']['rows'])}; transferee districts: {len(dist)}; judge names as printed: {len(judges)}.",
              f"- Report files inventoried: {len(inv)} ({', '.join(f'{k} {v}' for k, v in sorted(status.items()))}).", "",
              "## Validation and verification", ""]
    for k, v in ver.items():
        if k == "spot":
            lines.append(f"- spot checks: {v['checked']} figures located on their PDF page, mismatches {v['mismatches']}")
        else:
            lines.append(f"- {k}: {v['checked']} checks, {v['failed']} failed")
    lines += ["", "### Spot checks (figure, PDF page, excerpt of the single-page text)", "", "| report | date | figure | values | page | excerpt | match |", "|---|---|---|---|---:|---|---|"]
    for s in ver["spot"]["items"]:
        ex = (s.get("excerpt") or "").replace("|", "/")[:110]
        lines.append(f"| {s['report']} | {s['date']} | {s['figure']} | {', '.join(f'{x:,}' for x in s['values'])} | {s.get('page')} | `{ex}` | {'yes' if s['match'] else 'NO'} |")
    held = [f for f in inv if f["status"] == "held"]
    lines += ["", "## Held reports", ""] + [f"- {f['url']} ({f.get('type') or 'type not recognised'}): " + "; ".join(str(c.get("check")) for c in f["failed_checks"][:3]) for f in held]
    lines += ["", "## Cross-reference rates", "",
              f"- `/courts/<id>`: {sum(1 for r in dist if r['item']['court'].get('court_id'))} of {len(dist)} JPML district codes matched exactly to court_spine titles (unmatched and ambiguous: 0 links).",
              "- `/matters/lens/<n>`: every MDL row links by its exact printed number.",
              f"- `/records/jpml_pending_history_mdls/<n>`: {sum(1 for r in builds['jpml_mdl_pending_series']['rows'] if any(l['url'].startswith('/records/jpml_pending_history_mdls/') for l in r['item']['links']))} MDL rows; `/records/jpml_statistics_extra/mdl:<n>`: {sum(1 for r in builds['jpml_mdl_pending_series']['rows'] if any(l['url'].startswith('/records/jpml_statistics_extra/') for l in r['item']['links']))} rows (links only where the target id exists).",
              f"- Judges: no person links; {sum(1 for r in judges if r['item']['same_letters_rows'])} judge rows point to another printed spelling with the same letters (kept separate).", "",
              "## Open risks", "",
              "- Months with no held report are gaps (31); five reports of Sept 2022 to Jan 2023 have an unreadable text layer and are held.",
              "- Older reports print judge names without periods; names are not merged, so a judge's series can start where the spelling changed.",
              "- 2014-07-15 prints different report filters (only 'Limited to Active Litigations'); flagged on the snapshot.",
              "- 2020-08-17: the actions-pending and district reports differ by 23 actions for MDL 2885; both kept as printed, actions-pending primary.",
              "- The JPML may remove older unlinked files from its server; the acquired bytes and sha256 are kept in `private/acq/jpml_reports/`.", ""]
    (B / "REPORT.md").write_text("\n".join(lines))
    print(f"wrote {B / 'REPORT.md'} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
