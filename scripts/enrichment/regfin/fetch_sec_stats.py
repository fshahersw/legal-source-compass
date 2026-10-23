"""Fetch the SEC Division of Investment Management statistics supporting-data workbooks (trend context for the adviser data)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

SEC = "https://www.sec.gov"
FILES = {
    "sec/stats/im-investment-adviser-statistics-support-data-20260805.xlsx": SEC + "/file/im-investment-adviser-statistics-support-data-20260805",
    "sec/stats/im-investment-adviser-statistics-2025.pdf": SEC + "/files/investment/im-investment-adviser-statistics-2025.pdf",
}

if __name__ == "__main__":
    for dest, url in FILES.items():
        status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
        print(status, len(body), body[:8], url)
