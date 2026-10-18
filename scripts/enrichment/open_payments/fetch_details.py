"""Download the official Open Payments detail-file zips (unchanged) and aggregate each one with archive_aggregate.py.

Run: python3 scripts/enrichment/open_payments/fetch_details.py 2025 2024 ...   (default: every program year)
Zips land in private/acq/open-payments/; aggregates in archive_<year>.json (2017-2018) or detail_<year>.json.
Up to three years aggregate at once (each is one CPU-bound process).
The 2019-2025 zips (~6.6 GB) were deleted after aggregation to protect the shared disk; their values are
re-checkable through the CMS datastore API (verify_published.py) and this script re-downloads them on demand.
The archived 2017-2018 zips are kept because no API serves those years.
"""
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from op_api import UA  # noqa: E402
from op_model import ACQ  # noqa: E402
from op_sources import ARCHIVED_ZIPS, ZIPS  # noqa: E402


def download(year):
    url = ZIPS[year]
    path = os.path.join(ACQ, os.path.basename(url))
    if os.path.exists(path):
        return path
    part = path + ".part"
    head = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    with urllib.request.urlopen(head, timeout=60) as response:
        expected = int(response.headers["Content-Length"])
    for _attempt in range(8):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if have >= expected:
            break
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(req, timeout=90) as response, open(part, "ab") as out:
                if have and response.status != 206:
                    raise RuntimeError(f"{url}: server ignored the Range request")
                while True:
                    chunk = response.read(4 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
        except (TimeoutError, OSError):
            continue  # resume from the bytes already on disk
    if os.path.getsize(part) != expected:
        raise RuntimeError(f"{url}: got {os.path.getsize(part)} bytes, expected {expected}")
    os.replace(part, path)
    return path


def run(year):
    download(year)
    out = os.path.join(ACQ, f"{'archive' if year in ARCHIVED_ZIPS else 'detail'}_{year}.json")
    if os.path.exists(out):
        return year, "cached"
    result = subprocess.run([sys.executable, os.path.join(HERE, "archive_aggregate.py"), year], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{year}: {result.stderr[-2000:]}")
    return year, result.stdout.strip()


def main():
    years = sys.argv[1:] or sorted(ZIPS)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for year, status in pool.map(run, years):
            print(year, status, flush=True)


if __name__ == "__main__":
    main()
