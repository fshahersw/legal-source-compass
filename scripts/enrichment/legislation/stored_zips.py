"""Read the Bill Status zips back from the private `corpus-originals` bucket (the local copies are deleted after upload).

  python3 -I -B stored_zips.py --reparse 117-hr 113-hr      re-parse units from their stored zip (parser changes)

fetch(unit) streams the stored object to private/acq/legislation/billstatus_zips/, checks its SHA-256 and size against the
download record in billstatus_state.json, and returns the path; the caller deletes it. Credentials are read by
scripts/enrichment/caselaw/store.py from private/scratch/env.sh into this process only; nothing is printed.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import urllib.parse
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire_billstatus as ab  # noqa: E402
import common as cm  # noqa: E402
from billstatus_parse import parse_bill  # noqa: E402


def fetch(unit: dict) -> Path:
    store = ab.storage()
    st = store.Storage()
    key = unit["storage"]["object"]
    url = f"{st.url}/storage/v1/object/authenticated/{st.bucket}/{urllib.parse.quote(key, safe='/')}"
    dest = ab.ZIPS / unit["zip_name"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    n = 0
    r = st.s.get(url, headers=st.h, params={"readback": hashlib.md5(key.encode()).hexdigest()}, stream=True, timeout=600)
    if r.status_code != 200:
        raise SystemExit(f"{key}: storage read HTTP {r.status_code}")
    with dest.open("wb") as out:
        for block in r.iter_content(1 << 20):
            h.update(block)
            n += len(block)
            out.write(block)
    r.close()
    if h.hexdigest() != unit["zip_sha256"] or n != unit["zip_bytes"]:
        dest.unlink()
        raise SystemExit(f"{key}: stored bytes differ from the download record")
    return dest


def reparse(key: str) -> dict:
    state = ab.load_state()
    unit = state[key]
    path = fetch(unit)
    out_path = cm.ROOT / unit["parsed_file"]
    tmp = out_path.with_suffix(".part")
    rows = 0
    errors = []
    with zipfile.ZipFile(path) as zf, gzip.open(tmp, "wt", encoding="utf-8") as out:
        for info in zf.infolist():
            base = info.filename.rsplit("/", 1)[-1]
            if info.is_dir() or not base.endswith(".xml"):
                continue
            data = zf.read(info)
            try:
                rec = parse_bill(data)
            except Exception as exc:
                errors.append({"member": base, "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
                continue
            rec["member"] = base
            rec["memberSha256"] = hashlib.sha256(data).hexdigest()
            rec["memberBytes"] = len(data)
            out.write(json.dumps(rec, sort_keys=True, ensure_ascii=False) + "\n")
            rows += 1
    tmp.replace(out_path)
    path.unlink()
    unit["parsed"] = rows
    unit["parse_errors"] = errors
    unit["reparsed_at"] = cm.now_utc()
    state[key] = unit
    ab.save_state(state)
    return {"unit": key, "parsed": rows, "errors": len(errors)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reparse", nargs="+", required=True)
    for k in ap.parse_args().reparse:
        print(json.dumps(reparse(k)), flush=True)
