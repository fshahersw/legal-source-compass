"""Fetch the ftc.gov data files and listing pages this stream uses (one request every 5 s, the robots.txt Crawl-delay).

  python3 -I -B fetch_ftc_site.py

Data files are the downloads linked from https://www.ftc.gov/policy-notices/open-government/data-sets (stored as served); listing
pages are the pages of the Data Spotlight and policy-report indexes. Everything is recorded in _manifest.jsonl; files already
fetched are skipped.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_pages as fp  # noqa: E402
import ftc_http as fh  # noqa: E402

D = "https://www.ftc.gov/system/files/ftc_gov/data/"
FILES = [
    ("HSR-Merger-Transactions-by-Month.csv", D + "HSR-Merger-Transactions-by-Month.csv"),
    ("HSR-Merger-Transactions-by-Month-dictionary.csv", D + "HSR-Merger-Transactions-by-Month-dictionary.csv"),
    ("HSR-Transactions-Filings-Second-Requests-by-FY.csv", D + "HSR-Transactions-Filings-Second-Requests-by-FY.csv"),
    ("HSR-Transactions-Filings-Second-Requests-by-FY-dictionary.csv", D + "HSR-Transactions-Filings-Second-Requests-by-FY-dictionary.csv"),
    ("FTC-Merger-Enforcement-Actions.csv", D + "FTC-Merger-Enforcement-Actions.csv"),
    ("FTC-Merger-Enforcement-Actions-dictionary.csv", D + "FTC-Merger-Enforcement-Actions-dictionary.csv"),
    ("FTC-Nonmerger-Enforcement-Actions.csv", D + "FTC-Nonmerger-Enforcement-Actions.csv"),
    ("FTC-NonMerger-Enforcement-Actions-dictionary.csv", D + "FTC-NonMerger-Enforcement-Actions-dictionary.csv"),
    ("FTC-BC-Civil-Penalty-Actions.csv", D + "FTC-BC-Civil-Penalty-Actions.csv"),
    ("FTC-BC-Civil-Penalty-Actions-dictionary.csv", D + "FTC-BC-Civil-Penalty-Actions-dictionary.csv"),
    ("civil_penalty_cases_fy2000-2026.xlsx", "https://www.ftc.gov/system/files/ftc_gov/documents/civil_penalty_cases_fy2000-2026.xlsx"),
    ("ftc_civil_penalty_actions_dictionary_bcp.xlsx", "https://www.ftc.gov/system/files/ftc_gov/documents/ftc_civil_penalty_actions_dictionary_bcp.xlsx"),
]
LISTINGS = [
    ("rep_commission_staff", "https://www.ftc.gov/policy/reports/commission-staff-reports", 28),
    ("rep_economic_reports", "https://www.ftc.gov/policy/reports/economic-reports", 7),
]


def main():
    fetcher = fh.Fetcher()
    for name, url in FILES:
        try:
            fp.fetch(fetcher, name, url)
        except fh.FetchError as err:
            print("FAILED", url, err, flush=True)
    for stem, url, pages in LISTINGS:
        for page in range(1, pages):
            try:
                fp.fetch(fetcher, f"{stem}_p{page}.html", f"{url}?page={page}")
            except fh.FetchError as err:
                print("FAILED", url, page, err, flush=True)


if __name__ == "__main__":
    main()
