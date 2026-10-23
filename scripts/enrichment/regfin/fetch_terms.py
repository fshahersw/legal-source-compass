"""Step 0: fetch the terms / policy pages that decide eligibility (stored unchanged for the licence table)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

PAGES = {
    "terms/sec_privacy.html": "https://www.sec.gov/about/privacy-information",
    "terms/sec_webmaster_faq.html": "https://www.sec.gov/about/webmaster-frequently-asked-questions",
    "terms/sec_robots.txt": "https://www.sec.gov/robots.txt",
    "terms/sec_structured.html": "https://www.sec.gov/data-research/structured-data",
    "terms/sec_investment_mgmt.html": "https://www.sec.gov/data-research/investment-management-data",
    "terms/sec_markets_data.html": "https://www.sec.gov/data-research/sec-markets-data",
    "terms/sec_statistics.html": "https://www.sec.gov/data-research/statistics-data-visualizations",
    "terms/sec_bd_page.html": "https://www.sec.gov/foia/frequently-requested-documents/company-information-about-active-broker-dealers",
    "terms/frb_enforcement.html": "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",
    "terms/frb_sitemap.html": "https://www.federalreserve.gov/sitemap.htm",
    "terms/frb_privacy.html": "https://www.federalreserve.gov/privacy.htm",
    "terms/frb_data.html": "https://www.federalreserve.gov/data.htm",
    "terms/finra_data.html": "https://www.finra.org/finra-data",
    "terms/finra_dev_docs.html": "https://developer.finra.org/docs",
    "terms/finra_terms.html": "https://www.finra.org/terms-conditions",
    "terms/cassidi_home.html": "https://cassidi.stlouisfed.org/",
    "terms/stlouisfed_terms.html": "https://www.stlouisfed.org/terms-of-use",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:  # report and keep going
            print("ERR", type(err).__name__, url, str(err)[:120])
