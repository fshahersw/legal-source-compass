"""Acquire GovInfo Bill Status bulk data, one per-type zip at a time, and parse it.

  python3 -I -B acquire_billstatus.py [--congress 118 ...] [--type hr ...] [--no-upload]

For each Congress (108-119) and measure type (hr, s, hjres, sjres, hconres, sconres, hres, sres):
  1. read the bulk listing https://www.govinfo.gov/bulkdata/json/BILLSTATUS/{congress}/{type} (kept gzip-compressed);
  2. stream BILLSTATUS-{congress}-{type}.zip to private/acq/legislation/billstatus_zips/ (URL, bytes, sha256, Last-Modified
     recorded in _manifest.jsonl); refuse to start when free disk would fall below 3 GB;
  3. parse every XML member with billstatus_parse.parse_bill into private/build/legislation/parsed/{congress}-{type}.jsonl.gz
     (one line per measure: the parsed values plus the member name and the member's own sha256), and count independently
     the zip members and the measure numbers in the member names;
  4. upload the zip to the private Storage bucket `corpus-originals` at billstatus/<retrieval date>/<zip name> with the
     verified upload of scripts/enrichment/caselaw/store.py (no overwrite of different bytes; full readback with SHA-256 and
     size), append the receipt to the manifest, and only then delete the local zip.
State per Congress/type is kept in private/acq/legislation/billstatus_state.json, so a re-run skips finished units.
"""
from __future__ import annotations

import argparse
import gzip
import json
import hashlib
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as cm  # noqa: E402
from billstatus_parse import TYPES, parse_bill  # noqa: E402

CONGRESSES = list(range(108, 120))
BULK = "https://www.govinfo.gov/bulkdata"
ZIPS = cm.ACQ / "billstatus_zips"
LISTINGS = cm.ACQ / "billstatus_listings"
PARSED = cm.BUILD / "parsed"
STATE = cm.ACQ / "billstatus_state.json"
RETRIEVAL_DATE = "2026-10-23"
PREFIX = f"billstatus/{RETRIEVAL_DATE}/"
MIN_FREE_GB = 3.0
MEMBER = re.compile(r"^BILLSTATUS-(\d+)([a-z]+)(\d+)\.xml$")

def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}

def save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".part")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(STATE)

def storage():
    caselaw = next(p for p in (cm.ROOT / "scripts" / "enrichment" / "caselaw",
                               Path("/home/user/legal-source-compass/scripts/enrichment/caselaw")) if (p / "store.py").exists())
    sys.path.insert(0, str(caselaw))
    import store  # noqa: E402

    store.CONTENT_TYPE = "application/zip"
    return store

def listing(congress: int, btype: str) -> dict:
    url = f"{BULK}/json/BILLSTATUS/{congress}/{btype}"
    status, body, _ = cm.http_get(url, headers={"Accept": "application/json"})
    if status != 200:
        raise SystemExit(f"listing {congress}/{btype}: HTTP {status}")
    cm.keep_gz(url, body, LISTINGS / f"BILLSTATUS-{congress}-{btype}.json.gz", method="GovInfo bulk data JSON listing")
    files = json.loads(body)["files"]
    zips = [f for f in files if f.get("name", "").endswith(".zip")]
    xmls = sorted(f["name"] for f in files if f.get("name", "").endswith(".xml"))
    if len(zips) != 1:
        raise SystemExit(f"listing {congress}/{btype}: expected one zip, found {len(zips)}")
    return {"zip": zips[0], "xml_names": xmls}

def process(congress: int, btype: str, state: dict, upload: bool, st_mod) -> dict:
    key = f"{congress}-{btype}"
    lst = listing(congress, btype)
    z = lst["zip"]
    url = z["link"]
    need = (z.get("size") or 0) / 1e9
    free = cm.disk_free_gb()
    if free - need < MIN_FREE_GB:
        raise SystemExit(f"{key}: {free:.2f} GB free, zip {need:.2f} GB; stopping above the 3 GB floor")
    dest = ZIPS / z["name"]
    if dest.exists():
        dest.unlink()
    entry = cm.download(url, dest, method="GovInfo bulk data zip (streamed to disk)")
    names = []
    out_rows = 0
    errors = []
    numbers = set()
    PARSED.mkdir(parents=True, exist_ok=True)
    out_path = PARSED / f"{key}.jsonl.gz"
    tmp = out_path.with_suffix(".part")
    with zipfile.ZipFile(dest) as zf, gzip.open(tmp, "wt", encoding="utf-8") as out:
        for info in zf.infolist():
            if info.is_dir():
                continue
            names.append(info.filename)
            base = info.filename.rsplit("/", 1)[-1]
            m = MEMBER.match(base)
            if m:
                numbers.add((int(m.group(1)), m.group(2), m.group(3)))
            if not base.endswith(".xml"):
                continue
            data = zf.read(info)
            try:
                rec = parse_bill(data)
            except Exception as exc:  # recorded and reported; never silently dropped
                errors.append({"member": base, "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
                continue

            rec["member"] = base
            rec["memberSha256"] = hashlib.sha256(data).hexdigest()
            rec["memberBytes"] = len(data)
            out.write(json.dumps(rec, sort_keys=True, ensure_ascii=False) + "\n")
            out_rows += 1
    tmp.replace(out_path)
    result = {
        "congress": congress, "type": btype, "zip_url": url, "zip_name": z["name"], "zip_sha256": entry["sha256"],
        "zip_bytes": entry["bytes"], "zip_last_modified": entry.get("last_modified"),
        "listing_zip_modified": z.get("formattedLastModifiedTime"), "listing_xml_count": len(lst["xml_names"]),
        "zip_members": len(names), "zip_xml_members": sum(1 for n in names if n.endswith(".xml")),
        "member_numbers": len(numbers), "parsed": out_rows, "parse_errors": errors,
        "listing_not_in_zip": sorted(set(lst["xml_names"]) - {n.rsplit("/", 1)[-1] for n in names})[:50],
        "zip_not_in_listing": sorted({n.rsplit("/", 1)[-1] for n in names} - set(lst["xml_names"]))[:50],
        "parsed_file": str(out_path.relative_to(cm.ROOT)), "retrieved_at": entry["retrieved_at"],
    }
    if upload:
        st = st_mod.Storage()
        receipt = st.put_verified(PREFIX + z["name"], str(dest), entry["sha256"], entry["bytes"])
        cm.record({"event": "stored_remote", "path": entry["path"], "bucket": receipt["bucket"], "object": receipt["key"],
                   "state": receipt["state"], "sha256": entry["sha256"], "bytes": entry["bytes"],
                   "readback_sha256": receipt["readback_sha256"], "readback_bytes": receipt["readback_bytes"],
                   "verified_at": receipt["verified_at"], "local_copy": "deleted after verified readback", "recorded_at": cm.now_utc()})
        result["storage"] = {"bucket": receipt["bucket"], "object": receipt["key"], "state": receipt["state"],
                             "readback_sha256": receipt["readback_sha256"]}
        dest.unlink()
    state[key] = result
    save_state(state)
    return result

def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--congress", type=int, nargs="*")
    ap.add_argument("--type", nargs="*")
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--redo", action="store_true", help="re-acquire units already finished")
    args = ap.parse_args(argv)
    state = load_state()
    st_mod = None if args.no_upload else storage()
    for congress in args.congress or CONGRESSES:
        for btype in args.type or TYPES:
            key = f"{congress}-{btype}"
            if key in state and state[key].get("storage") and not args.redo:
                continue
            r = process(congress, btype, state, not args.no_upload, st_mod)
            print(json.dumps({k: r[k] for k in ("congress", "type", "zip_bytes", "listing_xml_count", "zip_xml_members", "parsed")}
                             | {"errors": len(r["parse_errors"]), "stored": (r.get("storage") or {}).get("state"),
                                "free_gb": round(cm.disk_free_gb(), 2)}), flush=True)

if __name__ == "__main__":
    main(sys.argv[1:])
