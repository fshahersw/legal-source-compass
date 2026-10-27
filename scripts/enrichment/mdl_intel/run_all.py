"""Re-runnable pipeline for the mdl-intel lane.

  python3 download_jpml.py          # JPML statistics + hearing PDFs (raw)
  python3 download_govinfo.py       # GovInfo JPML MODS (raw)
  python3 fetch_court_pages.py      # official court MDL pages (raw + extraction)
  python3 run_all.py [--dry]        # parse, build and publish the four mdl_intel_ datasets
  python3 run_all.py --courts-only  # rebuild and republish only mdl_intel_court_pages and mdl_intel_summary

Before any publish (corpus_writer.publish replaces a dataset's rows), the live rows and catalog entry of every dataset about
to be replaced are saved to private/acq/mdl-intel/backups/<dataset>.<UTC time>.json.gz (never overwritten), so a republish can
be undone by restoring that file instead of re-running old code.
"""
import gzip
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_courts_summary  # noqa: E402
import build_hearings  # noqa: E402
import build_stats  # noqa: E402
from common import ACQ, cw, pdftotext  # noqa: E402

TXT = ACQ / "txt"
BACKUPS = ACQ / "backups"


def backup(dataset):
    """Save the live rows and catalog entry of `dataset` to a new, run-unique gzip file before it is replaced; returns the path."""
    BACKUPS.mkdir(parents=True, exist_ok=True)
    path = BACKUPS / f"{dataset}.{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json.gz"
    if path.exists():
        raise SystemExit(f"{path} exists; not overwriting a backup")
    rows = cw.fetch_all(dataset, select="dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters")
    meta = cw._call("GET", f"corpus_datasets?id=eq.{dataset}&select=*")
    with gzip.open(path, "wt", encoding="utf-8") as h:
        json.dump({"dataset": dataset, "catalog": meta, "rows": rows}, h, ensure_ascii=False)
    print(json.dumps({"backup": str(path), "dataset": dataset, "rows": len(rows)}))
    return path


def ensure_reports():
    TXT.mkdir(exist_ok=True)
    for name, pattern in (("by_type.txt", "*Pending_MDL_Dockets_By_MDL_Type-October-1-2026.pdf"), ("by_district.txt", "*Pending_MDL_Dockets_By_District-October-1-2026.pdf")):
        src = sorted((ACQ / "jpml").glob(pattern))
        if src:
            (TXT / name).write_text(pdftotext(src[0]))


def main(dry=False, courts_only=False):
    ensure_reports()
    if courts_only:
        _, stats = build_stats.build()
        hrows, hov, matters, _ = build_hearings.build()
        hov["_matters"] = matters
        if dry:
            print("stats years", len(stats["series"]), "hearing rows", len(hrows), "(courts-only: nothing published)")
            return
        for ds in (build_courts_summary.COURT_DATASET, build_courts_summary.SUMMARY_DATASET):
            backup(ds)
        build_courts_summary.publish(stats, hov, hov["panel_page_orders"])
        return
    if dry:
        _, stats = build_stats.build()
        hrows, hov, matters, _ = build_hearings.build()
        print("stats years", len(stats["series"]), "hearing rows", len(hrows))
        return
    for ds in (build_stats.DATASET, build_hearings.DATASET,
               build_courts_summary.COURT_DATASET, build_courts_summary.SUMMARY_DATASET):
        backup(ds)
    build_stats.publish()
    _, stats = build_stats.build()
    build_hearings.publish()
    hrows, hov, matters, _ = build_hearings.build()
    hov["_matters"] = matters
    build_courts_summary.publish(stats, hov, hov["panel_page_orders"])


if __name__ == "__main__":
    main(dry="--dry" in sys.argv, courts_only="--courts-only" in sys.argv)
