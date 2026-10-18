"""Download the official CMS Open Payments summary datasets (program years 2019-2025) through the DKAN API.

Every dataset is paged in full and saved unchanged as private/acq/open-payments/api/<name>.json together with the
query URL and retrieval time, so builder values can be re-checked against the raw responses.

Run: python3 scripts/enrichment/open_payments/fetch_summaries.py
"""
import datetime as dt
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from op_api import datastore_all, query_url  # noqa: E402
from op_sources import BY_ENTITY, DASHBOARD, ENTITY_PROFILE, NATURE_BY_ENTITY, STATE_NATURE, STATE_TOTALS  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "acq", "open-payments", "api")


def jobs():
    yield "by_entity", BY_ENTITY
    yield "entity_profile", ENTITY_PROFILE
    yield "dashboard", DASHBOARD
    yield "state_totals", STATE_TOTALS
    for year, dataset in NATURE_BY_ENTITY.items():
        yield f"nature_by_entity_{year}", dataset
    for year, dataset in STATE_NATURE.items():
        yield f"state_nature_{year}", dataset


def fetch(job):
    name, dataset = job
    path = os.path.join(OUT, f"{name}.json")
    if os.path.exists(path):
        return name, "cached", json.load(open(path))["count"]
    rows = datastore_all(dataset)
    payload = {
        "dataset_id": dataset,
        "query_url": query_url(dataset),
        "dataset_page": f"https://openpaymentsdata.cms.gov/dataset/{dataset}",
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "count": len(rows),
        "rows": rows,
    }
    json.dump(payload, open(path, "w"))
    return name, "fetched", len(rows)


def main():
    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, status, count in pool.map(fetch, list(jobs())):
            print(name, status, count, flush=True)


if __name__ == "__main__":
    main()
