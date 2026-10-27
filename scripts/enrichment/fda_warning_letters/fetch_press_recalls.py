"""Acquire FDA's recall-announcement table (FDA.gov), raw bytes unchanged, to give the press-recall rows their pages.

Usage: python -I -B scripts/enrichment/fda_warning_letters/fetch_press_recalls.py [--acq DIR] [--attempts N]

Same mechanism as fetch_warning_letters.py: the table on PRESS_INDEX names its AJAX view (recall_solr_index); every
page is read 100 rows at a time, once newest first and once oldest first.
Files: <acq>/raw/press_recalls/index.html, page_a<attempt>_<dir>_<start>.json, manifest.json. Only www.fda.gov is
contacted. A previous acquisition in that folder is moved aside to press_recalls_superseded_<UTC stamp>, not deleted.

FDA's recall view has reported different totals on successive requests (1,077 and 1,094 within one minute on
2026-10-27). An attempt counts as a consistent snapshot only when every page of both passes reports the same total
and the union of rows read equals it; otherwise the attempt is recorded and the read is repeated after a pause, up to
--attempts times. The manifest says whether a consistent snapshot was reached; the packet builder words its matching
rule from that (unique in FDA's table, or unique among the rows actually read) and never claims more.
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch_warning_letters as fw  # noqa: E402
import press_recalls as pr  # noqa: E402

ROOT = HERE.parents[2]
RETRY_PAUSE = 60.0


def read_pass(out, ajax, attempt, direction, manifest):
    """One full pass; returns (paths seen, totals reported by its pages)."""
    seen, totals, start, total = set(), [], 0, None
    while total is None or start < total:
        url = fw.page_url(ajax, start, direction)
        status, body = fw.get(url)
        fw.save(out, f"page_a{attempt}_{direction}_{start:05d}.json", url, status, body, manifest)
        if status != 200:
            raise SystemExit(f"HTTP {status} at start={start}")
        doc = json.loads(body)
        reported = doc.get("recordsFiltered")
        totals.append(reported)
        if total is None:
            total = reported if isinstance(reported, int) else 0
        seen |= {row["path"] for row in pr.parse_rows(doc)}
        start += fw.PAGE
        time.sleep(fw.PAUSE)
    return seen, totals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    ap.add_argument("--attempts", type=int, default=4)
    args = ap.parse_args()
    out = Path(args.acq) / "raw" / "press_recalls"
    if out.exists() and any(out.iterdir()):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out.rename(out.with_name(f"press_recalls_superseded_{stamp}"))
    out.mkdir(parents=True, exist_ok=True)
    index_files = []
    status, body = fw.get(pr.PRESS_INDEX)
    fw.save(out, "index.html", pr.PRESS_INDEX, status, body, index_files)
    if status != 200:
        raise SystemExit(f"HTTP {status} for the index page")
    ajax, listed = pr.table_settings(body.decode("utf-8"))
    time.sleep(fw.PAUSE)
    attempts, files, seen, consistent = [], [], set(), False
    for attempt in range(1, max(1, args.attempts) + 1):
        files, seen, totals = [], set(), []
        for direction in ("desc", "asc"):
            pass_seen, pass_totals = read_pass(out, ajax, attempt, direction, files)
            seen |= pass_seen
            totals += pass_totals
        distinct_totals = sorted({t for t in totals if t is not None})
        consistent = len(distinct_totals) == 1 and None not in totals and len(seen) == distinct_totals[0]
        attempts.append({"attempt": attempt, "totals_reported": distinct_totals, "distinct_pages_read": len(seen),
                         "consistent": consistent})
        print(json.dumps(attempts[-1]), file=sys.stderr)
        if consistent:
            break
        if attempt < args.attempts:
            time.sleep(RETRY_PAUSE)
    last = attempts[-1]
    summary = {"schema_version": "fda-recall-announcement-index-acquisition/2", "source": pr.PRESS_INDEX,
               "view_name": ajax["data"].get("view_name"), "page_listed_total": listed,
               "totals_reported": last["totals_reported"], "distinct_pages_read": last["distinct_pages_read"],
               "consistent_snapshot": consistent, "passes": ["desc", "asc"], "attempts": attempts,
               "files": index_files + files}
    (out / "manifest.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "files"}))


if __name__ == "__main__":
    main()
