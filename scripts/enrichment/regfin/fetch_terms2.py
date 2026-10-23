"""Step 0, second batch: remaining policy / terms pages found while reading the first batch."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

PAGES = {
    "terms/frb_website_policies.htm": "https://www.federalreserve.gov/website-linking-policies.htm",
    "terms/frb_data_download_program.htm": "https://www.federalreserve.gov/datadownload/",
    "terms/finra_terms_of_use.html": "https://www.finra.org/terms-of-use",
    "terms/finra_dev_terms.html": "https://developer.finra.org/terms-of-use",
    "terms/finra_dev_home.html": "https://developer.finra.org/",
    "terms/finra_dev_catalog.html": "https://developer.finra.org/catalog",
    "terms/finra_about_data.html": "https://www.finra.org/finra-data/about",
    "terms/cassidi_about.html": "https://cassidi.stlouisfed.org/about",
    "terms/cassidi_terms.html": "https://cassidi.stlouisfed.org/terms",
    "terms/frb_nic_home.html": "https://www.ffiec.gov/npw/",
    "terms/ffiec_nic_data_download.html": "https://www.ffiec.gov/npw/FinancialReport/DataDownload",
    "terms/stlouisfed_copyright.html": "https://www.stlouisfed.org/terms-of-use/copyright",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:
            print("ERR", type(err).__name__, url, str(err)[:120])
