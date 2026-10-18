"""Download the official source files for the state-metrics lane into private/acq/state-metrics (unchanged).

Writes manifest.json with url, local file, byte size, sha256 and retrieval time for every file so each
published number can be traced back to the exact file that produced it. Re-runnable: existing files are
kept unless --refresh is passed.
"""
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import fars_national_csv_url  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "state-metrics"
UA = {"User-Agent": "SeegerWeiss Research firasshaher99@gmail.com"}

FARS_YEARS = range(2014, 2025)

SOURCES = {
    "census_nst_est2025_alldata.csv": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
    "census_nst_est2020_alldata.csv": "https://www2.census.gov/programs-surveys/popest/datasets/2010-2020/state/totals/nst-est2020-alldata.csv",
    "bea_SAGDP.zip": "https://apps.bea.gov/regional/zip/SAGDP.zip",
    "bea_SAINC.zip": "https://apps.bea.gov/regional/zip/SAINC.zip",
    "bls_la.data.2.AllStatesU.txt": "https://download.bls.gov/pub/time.series/la/la.data.2.AllStatesU",
    "bls_la.series.txt": "https://download.bls.gov/pub/time.series/la/la.series",
    "cdc_bi63-dtpu_leading_causes.csv": "https://data.cdc.gov/api/views/bi63-dtpu/rows.csv?accessType=DOWNLOAD",
    "cdc_xkb8-kh2a_vsrr_overdose.csv": "https://data.cdc.gov/api/views/xkb8-kh2a/rows.csv?accessType=DOWNLOAD",
    "nhtsa_COMPLAINTS_RECEIVED_2020-2024.zip": "https://static.nhtsa.gov/odi/ffdd/cmpl/COMPLAINTS_RECEIVED_2020-2024.zip",
    "nhtsa_COMPLAINTS_RECEIVED_2025-2026.zip": "https://static.nhtsa.gov/odi/ffdd/cmpl/COMPLAINTS_RECEIVED_2025-2026.zip",
    "nhtsa_CMPL.txt": "https://static.nhtsa.gov/odi/ffdd/cmpl/CMPL.txt",
}
for _year in FARS_YEARS:
    SOURCES[f"fars_{_year}_national_csv.zip"] = fars_national_csv_url(_year)


def download(name, url, refresh):
    path = ACQ / name
    if path.exists() and path.stat().st_size > 0 and not refresh:
        return name, url, "cached"
    tmp = path.with_suffix(path.suffix + ".part")
    with requests.get(url, headers=UA, timeout=600, stream=True) as response:
        response.raise_for_status()
        with open(tmp, "wb") as handle:
            for chunk in response.iter_content(1 << 20):
                handle.write(chunk)
    tmp.replace(path)
    return name, url, "downloaded"


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    refresh = "--refresh" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    ACQ.mkdir(parents=True, exist_ok=True)
    manifest_path = ACQ / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    todo = {k: v for k, v in SOURCES.items() if not only or any(o in k for o in only)}
    with cf.ThreadPoolExecutor(4) as pool:
        futures = [pool.submit(download, name, url, refresh) for name, url in todo.items()]
        for future in cf.as_completed(futures):
            try:
                name, url, status = future.result()
            except Exception as error:  # noqa: BLE001 - report and continue with the other files
                print("FAILED", error)
                continue
            path = ACQ / name
            if status == "downloaded" or name not in manifest:
                manifest[name] = {
                    "url": url,
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                    "retrieved": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
            print(status, name, manifest[name]["bytes"])
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=1))


if __name__ == "__main__":
    main()
