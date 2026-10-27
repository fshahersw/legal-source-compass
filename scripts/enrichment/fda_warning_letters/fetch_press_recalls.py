"""Acquire FDA's recall-announcement table (FDA.gov), raw bytes unchanged, to give the press-recall rows their pages.

Usage: python -I -B scripts/enrichment/fda_warning_letters/fetch_press_recalls.py [--acq DIR]

Same mechanism as fetch_warning_letters.py: the table on PRESS_INDEX names its AJAX view (recall_solr_index) and
total; every page is read 100 rows at a time, newest first, and again oldest first if the first pass leaves a gap.
Files: <acq>/raw/press_recalls/index.html, page_<dir>_<start>.json, manifest.json. Only www.fda.gov is contacted.
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch_warning_letters as fw  # noqa: E402
import press_recalls as pr  # noqa: E402

ROOT = HERE.parents[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    args = ap.parse_args()
    out = Path(args.acq) / "raw" / "press_recalls"
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    status, body = fw.get(pr.PRESS_INDEX)
    fw.save(out, "index.html", pr.PRESS_INDEX, status, body, manifest)
    if status != 200:
        raise SystemExit(f"HTTP {status} for the index page")
    ajax, listed = pr.table_settings(body.decode("utf-8"))
    time.sleep(fw.PAUSE)
    # FDA's recall view reports different totals on successive requests (1,077 and 1,094 within one minute on
    # 2026-10-27), so this read is not a consistent snapshot: both passes run to the largest total reported and every
    # total seen is recorded. It is used only to find the announcement page of rows already in the corpus.
    passes, seen, totals = [], set(), set()
    for direction in ("desc", "asc"):
        start = 0
        while not totals or start < max(totals):
            url = fw.page_url(ajax, start, direction)
            status, body = fw.get(url)
            fw.save(out, f"page_{direction}_{start:05d}.json", url, status, body, manifest)
            if status != 200:
                raise SystemExit(f"HTTP {status} at start={start}")
            doc = json.loads(body)
            totals.add(doc.get("recordsFiltered"))
            start += fw.PAGE
            seen |= {row["path"] for row in pr.parse_rows(doc)}
            time.sleep(fw.PAUSE)
        passes.append(direction)
    summary = {"schema_version": "fda-recall-announcement-index-acquisition/1", "source": pr.PRESS_INDEX,
               "view_name": ajax["data"].get("view_name"), "page_listed_total": listed,
               "totals_reported": sorted(t for t in totals if t is not None), "distinct_pages_read": len(seen),
               "consistent_snapshot": False, "passes": passes, "files": manifest}
    (out / "manifest.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "files"}))


if __name__ == "__main__":
    main()
