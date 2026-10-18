"""Fetch the robots.txt files and terms/landing pages the cfpb stream relies on, recording each in the manifest.

A robots.txt that answers 404 is recorded in private/build/cfpb/policy_fetch_status.json (no manifest line: nothing was saved) because a missing
robots.txt means the host publishes no crawl restrictions.

Usage: python3 -I -B scripts/enrichment/cfpb/acquire_policy.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fetch import ACQ, UA, fetch  # noqa: E402

PAGES = [
    ("https://www.consumerfinance.gov/robots.txt", "context/robots-consumerfinance.txt"),
    ("https://files.consumerfinance.gov/robots.txt", "context/robots-files-consumerfinance.txt"),
    ("https://www.census.gov/robots.txt", "census/robots-census.txt"),
    ("https://www2.census.gov/robots.txt", "census/robots-www2-census.txt"),
    ("https://www.consumerfinance.gov/privacy/website-privacy-policy/", "context/website-privacy-policy.html"),
    ("https://www.consumerfinance.gov/open-government/information-quality-guidelines/", "context/information-quality-guidelines.html"),
    ("https://www.census.gov/data/datasets/time-series/demo/popest/2020s-state-total.html", "census/popest-2020s-state-total.html"),
    ("https://www.census.gov/data/datasets/time-series/demo/popest/2010s-state-total.html", "census/popest-2010s-state-total.html"),
]


def status_of(url):
    proc = subprocess.run(["curl", "-sS", "-L", "--max-time", "60", "-A", UA, "-o", os.devnull, "-w", "%{http_code}", url],
                          capture_output=True, text=True)
    return int(proc.stdout.strip()) if proc.stdout.strip().isdigit() else 0


def main():
    results = []
    for url, rel in PAGES:
        try:
            entry = fetch(url, rel, method="direct", timeout=120, attempts=3)
            results.append({"url": url, "path": entry["path"], "status": entry["status"], "sha256": entry["sha256"], "bytes": entry["bytes"]})
            print("saved", url, entry["status"], entry["bytes"])
        except RuntimeError as error:
            results.append({"url": url, "path": None, "status": status_of(url), "error": str(error)[:200]})
            print("not saved", url, results[-1]["status"])
    out = os.path.join(os.path.dirname(ACQ).replace("acq", "build"), "cfpb", "policy_fetch_status.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=1)


if __name__ == "__main__":
    main()
