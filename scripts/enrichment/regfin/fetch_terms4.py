"""Step 0, fourth batch: Federal Reserve Board disclaimer / release pages (reuse of Board content)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

PAGES = {
    "terms/frb_disclaimer.htm": "https://www.federalreserve.gov/disclaimer.htm",
    "terms/frb_release.htm": "https://www.federalreserve.gov/release.htm",
    "terms/frb_iq_guidelines.htm": "https://www.federalreserve.gov/iq_guidelines.htm",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:
            print("ERR", type(err).__name__, url, str(err)[:120])
