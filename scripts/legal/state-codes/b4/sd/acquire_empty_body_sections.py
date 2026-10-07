"""Fetch per-section Statute JSON for citations parse marks empty body (chapter fragments are often truncated).

Official host only; resumable through Archive. Skips URLs already archived.

Usage:
  python3 acquire_empty_body_sections.py --work /tmp/sc4/sd
  python3 acquire_empty_body_sections.py --work /tmp/sc4/sd --from-report /tmp/sc4/sd/REPORT.json
"""
import argparse
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from acquire_missing_sections import grab, statute_url  # noqa: E402


def citations_from_report(path: str, reason: str = "empty body") -> list[str]:
    rep = json.load(open(path))
    return sorted(
        {
            m["citation"]
            for m in rep.get("missing_body") or []
            if m.get("reason") == reason and m.get("citation")
        }
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--from-report", help="REPORT.json with missing_body rows")
    a = ap.parse_args()
    report = a.from_report or os.path.join(a.work, "REPORT.json")
    if not os.path.exists(report):
        raise SystemExit(f"missing {report}")
    targets = citations_from_report(report)
    arc = Archive(a.work, min_interval=1.0)
    failed = []
    fetched = 0
    skipped = 0
    for i, cit in enumerate(targets, 1):
        url = statute_url(cit)
        old = arc.index.get(url)
        if old and old.get("state") == "complete":
            skipped += 1
            continue
        rec = grab(arc, url, accept="application/json")
        if rec["state"] != "complete":
            failed.append({"citation": cit, "url": url, "http_status": rec.get("http_status")})
        else:
            fetched += 1
        if i % 50 == 0 or i == len(targets):
            print(f"sections {i}/{len(targets)} fetched={fetched} skipped={skipped} failed={len(failed)}", flush=True)

    summary = {
        "reason": "empty body",
        "targets": len(targets),
        "fetched": fetched,
        "skipped_already_archived": skipped,
        "failed": failed,
    }
    out_path = os.path.join(a.work, "section_fetch_empty_body.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
