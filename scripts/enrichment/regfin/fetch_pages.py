"""Fetch SEC / Federal Reserve index pages whose file links drive the acquisition scripts (unchanged, with manifest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

SEC = "https://www.sec.gov"
PAGES = {
    "pages/sec_ria_data.html": SEC + "/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers",
    "pages/sec_fsn_data_sets.html": SEC + "/data-research/sec-markets-data/financial-statement-notes-data-sets",
    "pages/sec_fs_data_sets.html": SEC + "/data-research/sec-markets-data/financial-statement-data-sets",
    "pages/sec_form_d.html": SEC + "/data-research/sec-markets-data/form-d-data-sets",
    "pages/sec_muni_advisors.html": SEC + "/data-research/sec-markets-data/information-about-registered-municipal-advisors",
    "pages/sec_ia_statistics.html": SEC + "/data-research/statistics-data-visualizations/investment-adviser-statistics",
    "pages/sec_ia_statistics_archive.html": SEC + "/data-research/investment-management-data/division-investment-management-investment-adviser-statistics",
    "pages/sec_form_n_cen.html": SEC + "/data-research/sec-markets-data/form-n-cen-data-sets",
    "pages/frb_enforcement_search.html": "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:
            print("ERR", type(err).__name__, url, str(err)[:120])
