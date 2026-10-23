"""Build the ftc_data datasets from the stored FTC downloads and write one build file per dataset.

  python3 -I -B scripts/enrichment/ftc_data/build_ftc_data.py [hsr] [dnc] [index]

Writes private/build/ftc_data/<dataset>.json (the shape corpus_writer.publish receives) and build_log.json.
Nothing is published here.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bcommon as B  # noqa: E402
import build_dnc as D  # noqa: E402
import build_hsr as HSR  # noqa: E402
import build_index as IX  # noqa: E402


def month_counts():
    path = os.path.join(B.ACQ, "dnc", "month_counts.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf-8"))["months"]


def main(argv):
    which = set(argv) or {"hsr", "dnc", "index"}
    log = {"built_at": B.now_utc(), "counts": {}}
    entries = B.current_entries()
    if "hsr" in which:
        f_rows, f_summary, f_inputs, f_meta = HSR.build_filings(entries)
        B.write_build("ftc_hsr_filings", "FTC HSR merger filings, second requests and early terminations", HSR.filings_listing(), f_summary, f_rows, f_inputs)
        n_rows, n_summary, n_inputs, n_meta = HSR.build_notices(entries=entries, filing_fy_rows=f_meta["fys"])
        n_summary["crosscheck_vs_ftc_fy_table"] = n_meta["crosscheck"]
        B.write_build("ftc_hsr_early_terminations", "FTC HSR early termination notices", HSR.notices_listing(), n_summary, n_rows, n_inputs)
        log["counts"].update({"ftc_hsr_filings": len(f_rows), "ftc_hsr_early_terminations": len(n_rows)})
        log["hsr"] = {"passes": n_summary["passes"], "calendar": n_meta["calendar"], "fiscal": n_meta["fiscal"], "undated": n_meta["undated"], "title_differs": len(n_meta["differs"]), "empty_records": len(n_summary["empty_records"]), "filings_problems": f_meta["problems"], "filings_mismatches": f_meta["mismatches"], "crosscheck": n_meta["crosscheck"]}
    if "dnc" in which:
        rows, months_meta, overlap, per_file, official, pop_doc = D.build(month_counts=month_counts(), entries=entries)
        summary = D.build_summary(rows, months_meta, overlap, per_file, official, pop_doc)
        inputs = [B.input_ref(e) for u, e in sorted(entries.items()) if "/DNC_Complaint_Numbers_" in u or u.endswith("DoNotCallComplaints/MonthlyComparison.csv?:showVizHome=no")]
        B.write_build("ftc_dnc_reported_calls", "FTC Do Not Call reported calls by month, state and subject", D.dnc_listing(), summary, rows, inputs)
        log["counts"]["ftc_dnc_reported_calls"] = len(rows)
        log["dnc"] = {"months": months_meta, "overlap": overlap, "validation": summary["validation"], "quality": summary["quality_of_published_records"]}
    if "index" in which:
        rows, summary, inputs = IX.build_publications(entries)
        B.write_build("ftc_publications_index", "FTC Data Spotlight posts and policy reports", IX.publications_listing(), summary, rows, inputs)
        log["counts"]["ftc_publications_index"] = len(rows)
        rows, summary, inputs = IX.build_contributors(entries)
        B.write_build("ftc_sentinel_contributors", "Consumer Sentinel Network data contributors", IX.contributors_listing(), summary, rows, inputs)
        log["counts"]["ftc_sentinel_contributors"] = len(rows)
        rows, summary, inputs = IX.build_catalog(entries)
        B.write_build("ftc_open_data_catalog", "FTC open data: downloads, APIs and dashboards", IX.catalog_listing(), summary, rows, inputs)
        log["counts"]["ftc_open_data_catalog"] = len(rows)
        log["dashboards"] = summary["dashboards"]
    path = os.path.join(B.BUILD, "build_log.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(log)
    old["counts"] = {**old.get("counts", {}), **log["counts"]}
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(old, handle, indent=1, ensure_ascii=False)
    print(json.dumps(log["counts"]))


if __name__ == "__main__":
    main(sys.argv[1:])
