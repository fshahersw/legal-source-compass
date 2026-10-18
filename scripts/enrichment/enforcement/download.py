"""Download raw official files for the enforcement lane into private/acq/enforcement (unchanged bytes).

Usage: python3 scripts/enrichment/enforcement/download.py echo|cpsc
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement")
UA = "SeegerWeiss Research firasshaher99@gmail.com"

ECHO_CASE_ZIP = "https://echo.epa.gov/files/echodownloads/case_downloads.zip"
CPSC_API = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={start}&RecallDateEnd={end}"


def fetch(url, dest, timeout=600):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest + ".part"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response, open(tmp, "wb") as out:
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(tmp, dest)
            return os.path.getsize(dest)
        except Exception as error:  # transient network errors: retry with backoff
            if attempt == 3:
                raise
            print("retry", url, error, flush=True)
            time.sleep(2 ** attempt * 3)


def echo():
    dest = os.path.join(ACQ, "case_downloads.zip")
    size = fetch(ECHO_CASE_ZIP, dest, timeout=1800)
    meta = {"url": ECHO_CASE_ZIP, "bytes": size, "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(ACQ, "case_downloads.meta.json"), "w") as out:
        json.dump(meta, out, indent=2)
    print(json.dumps(meta))


def cpsc():
    out_dir = os.path.join(ACQ, "cpsc")
    os.makedirs(out_dir, exist_ok=True)
    windows = []
    for year in range(1973, int(time.strftime("%Y")) + 1):
        windows.append((year, f"{year}-01-01", f"{year}-12-31"))

    def one(window):
        year, start, end = window
        dest = os.path.join(out_dir, f"recalls_{year}.json")
        url = CPSC_API.format(start=start, end=end)
        size = fetch(url, dest, timeout=300)
        with open(dest, "rb") as handle:
            count = len(json.load(handle))
        return {"year": year, "url": url, "bytes": size, "records": count}

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, windows))
    meta = {"retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "windows": results}
    with open(os.path.join(out_dir, "manifest.json"), "w") as out:
        json.dump(meta, out, indent=2)
    print(json.dumps({"windows": len(results), "records": sum(r["records"] for r in results)}))


CENSUS_STATES = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"


def census():
    dest = os.path.join(ACQ, "NST-EST2025-ALLDATA.csv")
    size = fetch(CENSUS_STATES, dest)
    meta = {"url": CENSUS_STATES, "bytes": size, "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(ACQ, "NST-EST2025-ALLDATA.meta.json"), "w") as out:
        json.dump(meta, out, indent=2)
    print(json.dumps(meta))


if __name__ == "__main__":
    {"echo": echo, "cpsc": cpsc, "census": census}[sys.argv[1]]()
