"""Publish reviewed exposure-geography packets to the corpus. LEAD ONLY: workers never run this with --publish.

Each packet is re-verified against its manifest (record count and sha256) before anything is sent; then
corpus_writer.publish creates or updates the catalog entry, replaces the dataset's records and checks the stored count.
Credentials come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment.

Usage:
  python -B publish_packets.py --acq <dir> exposure_places_county            # verify only (default)
  python -B publish_packets.py --acq <dir> --publish exposure_places_county  # verify, then publish
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exposure_common as X  # noqa: E402

DATASETS = ("exposure_partd_mdl_drugs", "exposure_places_county", "exposure_ucmr5_pfas_states", "exposure_ucmr5_pfas_systems")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=X.DEFAULT_ACQ)
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("datasets", nargs="+", choices=DATASETS)
    args = ap.parse_args(argv)
    for dataset in args.datasets:
        meta, rows, manifest = X.read_packet(os.path.join(args.acq, "packets", dataset))
        print(f"{dataset}: {manifest['records']} records, sha256 {manifest['sha256']} (verified)")
        if args.publish:
            X.corpus_writer.publish(dataset, meta["label"], rows, listing_block=meta["listing_block"], summary=meta["summary"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
