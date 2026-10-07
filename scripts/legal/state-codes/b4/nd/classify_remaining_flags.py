"""Summarize remaining toc_pdf_citation_mismatch rows from REPORT.json."""
import argparse
import json
import os
from collections import Counter


def run(work: str):
    report = json.load(open(os.path.join(work, "REPORT.json")))
    mm = [m for m in report.get("mismatches", []) if m.get("reason") == "toc_pdf_citation_mismatch"]
    buckets = Counter()
    for m in mm:
        tc, pc = m.get("toc_count", 0), m.get("pdf_count", 0)
        if tc > pc:
            buckets["toc_extra_sections"] += 1
        elif pc > tc:
            buckets["pdf_extra_in_chapter"] += 1
        elif m.get("toc_only") and m.get("pdf_only"):
            buckets["same_count_swap"] += 1
        elif m.get("toc_only"):
            buckets["same_count_toc_only"] += 1
        elif m.get("pdf_only"):
            buckets["same_count_pdf_only"] += 1
        else:
            buckets["other"] += 1
    fc = Counter(r.get("class") for r in report.get("flag_classification", []))
    out = {
        "toc_pdf_citation_mismatch": len(mm),
        "mismatch_buckets": dict(buckets),
        "flag_classification": dict(fc),
        "empty_section_gaps": len(report.get("empty_section_gaps", [])),
    }
    path = os.path.join(work, "remaining_flags_classification.json")
    json.dump(out, open(path, "w"), indent=2)
    print(json.dumps(out, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
