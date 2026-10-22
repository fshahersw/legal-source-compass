"""Download the FTC enforcement-action data files (CC0) listed on https://www.ftc.gov/policy-notices/open-government/data-sets.

  python3 -I -B scripts/enrichment/enforcement_actions/fetch_ftc_files.py

ftc.gov robots.txt sets Crawl-delay: 5, so requests start at least 5 s apart. Raw bytes are stored gzip-compressed,
unchanged, under private/acq/enforcement_actions/ftc/files/ with manifest entries.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enf_common as ec  # noqa: E402

BASE = "https://www.ftc.gov"
FILES = [
    "/policy-notices/open-government/data-sets",
    "/system/files/ftc_gov/data/FTC-Merger-Enforcement-Actions.csv",
    "/system/files/ftc_gov/data/FTC-Merger-Enforcement-Actions-dictionary.csv",
    "/system/files/ftc_gov/data/FTC-Nonmerger-Enforcement-Actions.csv",
    "/system/files/ftc_gov/data/FTC-NonMerger-Enforcement-Actions-dictionary.csv",
    "/system/files/ftc_gov/data/FTC-BC-Civil-Penalty-Actions.csv",
    "/system/files/ftc_gov/data/FTC-BC-Civil-Penalty-Actions-dictionary.csv",
    "/system/files/ftc_gov/documents/civil_penalty_cases_fy2000-2026.xlsx",
    "/system/files/ftc_gov/documents/ftc_civil_penalty_actions_dictionary_bcp.xlsx",
    "/robots.txt",
]
OUT = os.path.join(ec.ACQ, "ftc", "files")


def main():
    fetcher = ec.Fetcher(default_interval=5.0)
    for path in FILES:
        url = BASE + path
        name = "data-sets.html" if path.endswith("data-sets") else os.path.basename(path)
        dest = os.path.join(OUT, name + ".gz")
        status, body, final, _ = fetcher.get(url)
        if status != 200:
            print(f"{status} {url}")
            continue
        ec.write_gz(dest, body)
        ec.record_manifest(url, dest, body, status)
        print(f"{status} {len(body)} {url}")


if __name__ == "__main__":
    main()
