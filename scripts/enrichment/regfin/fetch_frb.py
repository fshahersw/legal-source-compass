"""Acquire the Federal Reserve Board enforcement-actions data the public search page itself loads.

The search page (https://www.federalreserve.gov/supervisionreg/enforcementactions.htm) is a client app that reads
/supervisionreg/files/ea-cms-recent.json, ea-old.json and actiontypes.json, and links the full CSV download
/supervisionreg/files/enforcementactions.csv plus the data definitions page. Raw bytes are kept unchanged.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

BASE = "https://www.federalreserve.gov/supervisionreg/"
FILES = {
    "frb/files/ea-cms-recent.json": BASE + "files/ea-cms-recent.json",
    "frb/files/ea-old.json": BASE + "files/ea-old.json",
    "frb/files/actiontypes.json": BASE + "files/actiontypes.json",
    "frb/files/enforcementactions.csv": BASE + "files/enforcementactions.csv",
    "frb/search-enforcement-actions-data-definitions.htm": BASE + "search-enforcement-actions-data-definitions.htm",
    "frb/enforcement-actions-about.htm": BASE + "enforcement-actions-about.htm",
}

if __name__ == "__main__":
    for dest, url in FILES.items():
        status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
        print(status, len(body), url)
