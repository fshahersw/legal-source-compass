"""Harvest the justice.gov pages behind the DOJ document indexes, and record every host's robots.txt.

  python3 -I -B scripts/enrichment/oversight/fetch_doj_site.py

justice.gov's robots.txt sets `Crawl-delay: 10` (and disallows `?page=` URLs, which this script never requests), so
requests to www.justice.gov are paced at 10.5 s. Pages read (raw HTML, gzip-compressed, unchanged, in
private/acq/oversight/justice_gov/ and in the manifest):
  * /doj/budget-and-performance                                       budget and performance document index
  * /criminal/criminal-fraud/vsd-resolutions-part-1                    Criminal Division CEP voluntary self-disclosure resolutions
  * /jmd/eeo-program-status-report                                    No FEAR Act / EEO data index
  * /jmd/ls                                                           DOJ Libraries (Law Library) resource guides
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402

JUSTICE = os.path.join(cm.ACQ, "justice_gov")
PAGES = {
    "budget_and_performance": "https://www.justice.gov/doj/budget-and-performance",
    "vsd_resolutions_part_1": "https://www.justice.gov/criminal/criminal-fraud/vsd-resolutions-part-1",
    "eeo_program_status_report": "https://www.justice.gov/jmd/eeo-program-status-report",
    "library_staff": "https://www.justice.gov/jmd/ls",
}
ROBOTS = {
    "www.justice.gov": "https://www.justice.gov/robots.txt",
    "oig.justice.gov": "https://oig.justice.gov/robots.txt",
    "www.oversight.gov": "https://www.oversight.gov/robots.txt",
    "www.osc.gov": "https://www.osc.gov/robots.txt",
    "catalog.archives.gov": "https://catalog.archives.gov/robots.txt",
}


def get(fetcher, url, dest, method):
    if os.path.exists(dest):
        return
    status, body, _, _ = fetcher.get(url)
    cm.write_gz(dest, body)
    cm.record_manifest(url, dest, body, status, method)
    cm.log("fetch_doj_site", f"{url}: HTTP {status}, {len(body)} bytes")


def main():
    fetcher = cm.Fetcher(rates={**cm.RATES, "www.justice.gov": 10.5})
    for name, url in PAGES.items():
        get(fetcher, url, os.path.join(JUSTICE, f"{name}.html.gz"), "direct GET (public page; Crawl-delay 10 honoured)")
    for host, url in ROBOTS.items():
        get(fetcher, url, os.path.join(cm.ACQ, "robots", f"{host}.txt.gz"), "direct GET (robots.txt, recorded for the terms decision)")
    print("done", fetcher.stats)


if __name__ == "__main__":
    main()
