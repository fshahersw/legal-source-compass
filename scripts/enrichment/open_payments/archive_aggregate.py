"""Aggregate one Open Payments program year from the official CMS detail-file zip (unchanged on disk).

CMS publishes no per-entity recipient-state or product breakdowns, and serves archived years (2017, 2018) only as
detail-file zips (https://openpaymentsdata.cms.gov/datasets/archived). This script reads the General and Research
payment CSVs straight out of the zip in private/acq/open-payments/ (pandas C parser, only the needed columns) and
sums Total_Amount_of_Payment_USDollars in integer cents by the keys the CMS summary files use: making-payment
reporting entity ID, nature of payment, recipient state, recipient type, first-listed product. Record counts are
counts of published payment records. Rows whose amount is not a number are counted in "skipped", never guessed.

Run: python3 scripts/enrichment/open_payments/archive_aggregate.py <year> [--out path]
Writes private/acq/open-payments/archive_<year>.json (2017-2018) or detail_<year>.json (2019 on).
"""
import json
import os
import sys
import zipfile
from collections import defaultdict

import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "open-payments")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op_sources import ARCHIVED_ZIPS, ZIPS  # noqa: E402

ENT_ID = "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_ID"
ENT_NAME = "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_Name"
ENT_STATE = "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_State"
ENT_COUNTRY = "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_Country"
AMOUNT = "Total_Amount_of_Payment_USDollars"
NATURE = "Nature_of_Payment_or_Transfer_of_Value"
R_STATE = "Recipient_State"
R_TYPE = "Covered_Recipient_Type"
PRODUCT = "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_1"
PTYPE = "Indicate_Drug_or_Biological_or_Device_or_Medical_Supply_1"
YEAR = "Program_Year"
CHUNK = 1_000_000


def parse_amount(value):
    """Return the payment amount as cents (int) so sums are exact; None when the field is not a number."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        return int(round(float(text) * 100))
    except ValueError:
        return None


def _chunks(zf, member, columns):
    with zf.open(member) as raw:
        reader = pd.read_csv(raw, usecols=columns, dtype=str, keep_default_na=False, chunksize=CHUNK, encoding="utf-8", encoding_errors="replace")
        for chunk in reader:
            for col in columns:
                chunk[col] = chunk[col].str.strip()
            yield chunk


def _prepare(chunk, year, bad, prefix):
    other = chunk[YEAR] != year
    bad[f"{prefix}_other_year"] += int(other.sum())
    chunk = chunk[~other]
    amount = pd.to_numeric(chunk[AMOUNT].where(chunk[AMOUNT] != ""), errors="coerce")
    missing = amount.isna()
    bad[f"{prefix}_bad_amount"] += int(missing.sum())
    chunk = chunk[~missing].copy()
    chunk["c"] = (amount[~missing] * 100).round().astype("int64")
    return chunk


def _add(acc, chunk, keys):
    if chunk.empty:
        return
    grouped = chunk.groupby(keys, sort=False)["c"].agg(["sum", "count"])
    for key, total, n in zip(grouped.index, grouped["sum"], grouped["count"]):
        bucket = acc[key]
        bucket[0] += int(total)
        bucket[1] += int(n)


def aggregate(year, zip_path, out_path=None):
    zf = zipfile.ZipFile(zip_path)
    members = zf.namelist()
    gnrl = next(m for m in members if "_DTL_GNRL_" in m)
    rsrch = next(m for m in members if "_DTL_RSRCH_" in m)
    out = {"year": year, "zip": os.path.basename(zip_path), "source_url": ZIPS[year], "members": {"general": gnrl, "research": rsrch}}
    bad = defaultdict(int)
    entities = {}
    names = ("ent", "ent_nature", "ent_state", "ent_ptype", "ent_product", "state_type", "state_nature", "nature", "research_ent", "research_state")
    acc = {name: defaultdict(lambda: [0, 0]) for name in names}
    totals = {"general": [0, 0], "research": [0, 0]}

    def remember(chunk):
        firsts = chunk.drop_duplicates(ENT_ID)
        for eid, name, st, country in zip(firsts[ENT_ID], firsts[ENT_NAME], firsts[ENT_STATE], firsts[ENT_COUNTRY]):
            entities.setdefault(eid, {"name": name, "state": st, "country": country})

    general_cols = [ENT_ID, ENT_NAME, ENT_STATE, ENT_COUNTRY, AMOUNT, NATURE, R_STATE, R_TYPE, PRODUCT, PTYPE, YEAR]
    for chunk in _chunks(zf, gnrl, general_cols):
        chunk = _prepare(chunk, year, bad, "general")
        remember(chunk)
        chunk[PRODUCT] = chunk[PRODUCT].str.upper()
        totals["general"][0] += int(chunk["c"].sum())
        totals["general"][1] += len(chunk)
        _add(acc["ent"], chunk, [ENT_ID])
        _add(acc["ent_nature"], chunk, [ENT_ID, NATURE])
        _add(acc["ent_state"], chunk, [ENT_ID, R_STATE])
        _add(acc["ent_ptype"], chunk, [ENT_ID, PTYPE])
        _add(acc["ent_product"], chunk[chunk[PRODUCT] != ""], [ENT_ID, PTYPE, PRODUCT])
        _add(acc["state_type"], chunk, [R_STATE, R_TYPE])
        _add(acc["state_nature"], chunk, [R_STATE, NATURE])
        _add(acc["nature"], chunk, [NATURE])

    research_cols = [ENT_ID, ENT_NAME, ENT_STATE, ENT_COUNTRY, AMOUNT, R_STATE, R_TYPE, YEAR]
    for chunk in _chunks(zf, rsrch, research_cols):
        chunk = _prepare(chunk, year, bad, "research")
        remember(chunk)
        totals["research"][0] += int(chunk["c"].sum())
        totals["research"][1] += len(chunk)
        _add(acc["research_ent"], chunk, [ENT_ID])
        _add(acc["research_state"], chunk, [R_STATE, R_TYPE])

    def pairs(d):
        return [[*k, v[0], v[1]] if isinstance(k, tuple) else [k, v[0], v[1]] for k, v in d.items()]

    # Every (entity, product type, first-listed product) group is kept so multi-year sums stay exact.
    products = defaultdict(list)
    for (eid, ptype, prod), v in acc["ent_product"].items():
        products[eid].append([prod, ptype, v[0], v[1]])
    products = {eid: sorted(v, key=lambda x: (-x[2], x[0], x[1])) for eid, v in products.items()}

    out.update(
        {
            "units": "amounts are integer cents; counts are published payment records",
            "entities": entities,
            "general_by_entity": pairs(acc["ent"]),
            "research_by_entity": pairs(acc["research_ent"]),
            "general_by_entity_nature": pairs(acc["ent_nature"]),
            "general_by_entity_state": pairs(acc["ent_state"]),
            "general_top_products_by_entity": products,
            "general_by_entity_product_type": pairs(acc["ent_ptype"]),
            "general_by_state_recipient_type": pairs(acc["state_type"]),
            "general_by_state_nature": pairs(acc["state_nature"]),
            "research_by_state_recipient_type": pairs(acc["research_state"]),
            "general_by_nature": pairs(acc["nature"]),
            "general_total": totals["general"],
            "research_total": totals["research"],
            "skipped": {k: bad.get(k, 0) for k in ("general_other_year", "general_bad_amount", "research_other_year", "research_bad_amount")},
        }
    )
    path = out_path or os.path.join(ACQ, f"{'archive' if year in ARCHIVED_ZIPS else 'detail'}_{year}.json")
    tmp = path + ".tmp"
    json.dump(out, open(tmp, "w"))
    os.replace(tmp, path)
    print(json.dumps({"year": year, "general_total_usd": totals["general"][0] / 100, "general_records": totals["general"][1], "research_total_usd": totals["research"][0] / 100, "research_records": totals["research"][1], "entities": len(entities), "skipped": out["skipped"]}))


def main():
    args = sys.argv[1:]
    out_path = None
    if "--out" in args:
        i = args.index("--out")
        out_path = args[i + 1]
        args = args[:i] + args[i + 2:]
    for year in args or ["2017", "2018"]:
        aggregate(year, os.path.join(ACQ, os.path.basename(ZIPS[year])), out_path)


if __name__ == "__main__":
    main()
