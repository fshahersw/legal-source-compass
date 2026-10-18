"""Independent check of archived-year values: re-download the CMS archive zip (in memory, not the cached copy)
and recompute general and research totals for a few published entities.

Run: python3 scripts/enrichment/open_payments/verify_archive.py 2017 100000000053 100000010503 100000005674
"""
import io
import os
import sys
import urllib.request
import zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from op_api import UA  # noqa: E402
from op_sources import ARCHIVED_ZIPS  # noqa: E402
from verify_published import published  # noqa: E402

ENT = "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_ID"
AMT = "Total_Amount_of_Payment_USDollars"


def sums(zf, member, ids):
    out = {i: [0, 0] for i in ids}
    with zf.open(member) as raw:
        for chunk in pd.read_csv(raw, usecols=[ENT, AMT], dtype=str, keep_default_na=False, chunksize=1_000_000):
            chunk = chunk[chunk[ENT].str.strip().isin(ids)]
            cents = (pd.to_numeric(chunk[AMT]) * 100).round().astype("int64")
            for eid, c in zip(chunk[ENT].str.strip(), cents):
                out[eid][0] += int(c)
                out[eid][1] += 1
    return out


def main():
    year, ids = sys.argv[1], sys.argv[2:]
    url = ARCHIVED_ZIPS[year]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=900) as r:
        zf = zipfile.ZipFile(io.BytesIO(r.read()))
    names = zf.namelist()
    gen = sums(zf, next(n for n in names if "_DTL_GNRL_" in n), set(ids))
    res = sums(zf, next(n for n in names if "_DTL_RSRCH_" in n), set(ids))
    ok = 0
    for eid in ids:
        item = published("company_payments_manufacturers", f"op-{eid}")
        y = next(v for v in item["payments"]["years"] if v["year"] == int(year))
        for field, value in (("general", gen[eid][0] / 100), ("research", res[eid][0] / 100)):
            match = abs(y[field] - value) <= 0.01
            ok += match
            print(f"{'OK  ' if match else 'DIFF'} company_payments_manufacturers/op-{eid} years[{year}].{field}: published={y[field]} source={round(value, 2)} {url}")
    print(f"{ok} of {2 * len(ids)} checks match")


if __name__ == "__main__":
    main()
