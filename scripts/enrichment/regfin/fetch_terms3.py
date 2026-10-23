"""Step 0, third batch: legal-information and robots.txt pages for CASSIDI / St. Louis Fed / Federal Reserve / FINRA API."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

PAGES = {
    "terms/stlouisfed_legal_information.html": "https://www.stlouisfed.org/about-us/legal-information",
    "terms/cassidi_robots.txt": "https://cassidi.stlouisfed.org/robots.txt",
    "terms/stlouisfed_robots.txt": "https://www.stlouisfed.org/robots.txt",
    "terms/finra_api_terms.html": "https://developer.finra.org/finra-api-terms-service",
    "terms/frb_robots.txt": "https://www.federalreserve.gov/robots.txt",
    "terms/cassidi_help.html": "https://cassidi.stlouisfed.org/public/help",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:
            print("ERR", type(err).__name__, url, str(err)[:120])
