"""Compare staged section count to official HTML chapter TOC row counts."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from parse import parse_toc  # noqa: E402


def run(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    toc_total = 0
    chapters_with_html = 0
    for slug in inv["chapters"]:
        url = "https://ndlegis.gov/cencode/" + slug
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            continue
        html, _ = decode_html(arc.read(rec))
        _, _, rows = parse_toc(html)
        toc_total += len(rows)
        chapters_with_html += 1
    staged = 0
    pkt = os.path.join(work, "packet", "sections.jsonl")
    if os.path.exists(pkt):
        staged = sum(1 for _ in open(pkt, encoding="utf-8"))
    man = json.load(open(os.path.join(work, "packet", "manifest.json")))
    report_path = os.path.join(work, "REPORT.json")
    documented_gaps = 0
    gap_reasons = {}
    if os.path.exists(report_path):
        rep = json.load(open(report_path))
        gaps = rep.get("empty_section_gaps") or []
        documented_gaps = len(gaps)
        gap_reasons = {g.get("reason"): sum(1 for x in gaps if x.get("reason") == g.get("reason")) for g in gaps}
        gap_reasons = {k: v for k, v in sorted(gap_reasons.items()) if v}
    expected_staged = toc_total - documented_gaps
    out = {
        "official_toc_sections": toc_total,
        "documented_non_staged_toc_rows": documented_gaps,
        "documented_gap_reasons": gap_reasons,
        "expected_staged_from_toc": expected_staged,
        "staged_sections": staged,
        "manifest_sections": man.get("sections"),
        "chapters_with_html_toc": chapters_with_html,
        "match_raw_toc": toc_total == staged == man.get("sections"),
        "match": expected_staged == staged == man.get("sections"),
    }
    path = os.path.join(work, "toc_count_compare.json")
    json.dump(out, open(path, "w"), indent=2)
    print(json.dumps(out, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
