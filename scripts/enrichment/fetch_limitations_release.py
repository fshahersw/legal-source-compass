"""Download the active limitations release files listed in the live manifest, verifying each SHA-256.

Writes to private/lim/current/<manifest path>. Credentials come only from the environment.
"""
import hashlib
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "src" / "lib" / "private-data" / "manifest.server.json"
OUT = ROOT / "private" / "lim" / "current"


def fetch(item):
    name, entry = item
    target = OUT / name
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == entry["sha256"]:
        return name, "cached"
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/storage/v1/object/corpus-originals/" + entry["storage_key"]
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    request = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != entry["sha256"] or len(data) != entry["bytes"]:
        raise RuntimeError(f"{name}: checksum mismatch")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return name, "downloaded"


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else "limitations/"
    files = {k: v for k, v in json.loads(MANIFEST.read_text())["files"].items() if k.startswith(prefix)}
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(fetch, files.items()))
    print(json.dumps({"files": len(results), "downloaded": sum(1 for _, s in results if s == "downloaded")}))


if __name__ == "__main__":
    main()
