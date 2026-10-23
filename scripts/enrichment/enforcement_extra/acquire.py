"""Acquire the small official files for the enforcement_extra datasets (one deliberate request each).

  python3 -I -B acquire.py sam [YYDDD]   SAM.gov public exclusions extract (daily ZIP, no login); default: newest of the
                                         last 5 days that the extract service serves
  python3 -I -B acquire.py leie          HHS-OIG LEIE UPDATED.csv (monthly), stored gzip-compressed
  python3 -I -B acquire.py eousa         EOUSA National Caseload Data FY2025 "ANNUAL DATA.ZIP" (about 5 MB)

Every file is recorded in private/acq/enforcement_extra/_manifest.jsonl (url, sha256 of the bytes received, size,
time, status, method).
"""
from __future__ import annotations

import datetime as dt
import sys
import urllib.error

from common import ACQ, EmptyResponse, download

SAM_URL = "https://sam.gov/api/prod/fileextractservices/v1/api/download/Exclusions/Public%20V2/SAM_Exclusions_Public_Extract_V2_{code}.ZIP?privacy=Public"
LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv"
EOUSA_ANNUAL_URL = "https://media.justice.gov/video/usao/data/YearPrevious2025/ANNUAL%20DATA.ZIP"
EOUSA_LOOKUP_URL = "https://media.justice.gov/video/usao/data/YearPrevious2025/DISK28.ZIP"


def sam(code: str | None) -> None:
    today = dt.date.today()
    codes = [code] if code else [(today - dt.timedelta(days=d)).strftime("%y%j") for d in range(0, 6)]
    for c in codes:
        url = SAM_URL.format(code=c)
        try:
            entry = download(url, f"{ACQ}/sam/SAM_Exclusions_Public_Extract_V2_{c}.ZIP", method="direct GET (303 to presigned S3)", min_interval=2.0)
        except urllib.error.HTTPError as err:
            print(f"{c}: HTTP {err.code}")
            continue
        except EmptyResponse as err:
            print(f"{c}: {err}")
            continue
        print(entry)
        return
    raise SystemExit("no SAM extract found in the last 6 days")


def leie() -> None:
    print(download(LEIE_URL, f"{ACQ}/leie/UPDATED.csv.gz", gzip_store=True, method="direct GET"))


def eousa() -> None:
    print(download(EOUSA_ANNUAL_URL, f"{ACQ}/eousa/FY2025_ANNUAL_DATA.ZIP", method="direct GET"))


def eousa_lookups() -> None:
    """DISK28 of the FY2025 annual set holds the LIONS code tables (about 5.8 MB): labels for program categories,
    districts and charges. No case table is downloaded."""
    print(download(EOUSA_LOOKUP_URL, f"{ACQ}/eousa/FY2025_DISK28.ZIP", method="direct GET"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    what = sys.argv[1]
    if what == "sam":
        sam(sys.argv[2] if len(sys.argv) > 2 else None)
    elif what == "leie":
        leie()
    elif what == "eousa":
        eousa()
    elif what == "eousa-lookups":
        eousa_lookups()
    else:
        raise SystemExit(__doc__)
