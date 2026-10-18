"""Polite fetcher for the cfpb stream: saves response bytes unchanged under private/acq/cfpb/ and appends a manifest line.

consumerfinance.gov answers Python urllib with 403 (edge bot filter keyed on the client) while the same request from curl
succeeds, so downloads run through the system curl (proxy and CA configuration preset) with an identifying User-Agent.

Usage:
  python3 -I -B scripts/enrichment/cfpb/fetch.py <url> <relative/path/under/private/acq/cfpb> [--method=direct]

Manifest: private/acq/cfpb/_manifest.jsonl with url, path, sha256, bytes, retrieved_at (UTC), status, method.
"""
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "cfpb")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
MIN_INTERVAL = 0.6  # seconds between requests (< 2 req/s per host)
_last = [0.0]


def _sleep_turn():
    wait = MIN_INTERVAL - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(url, rel, method="direct", timeout=1800, attempts=5, manifest=True):
    """Download url to private/acq/cfpb/<rel> with curl; return the manifest entry (raises on a non-2xx status)."""
    path = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    status = None
    for attempt in range(attempts):
        _sleep_turn()
        proc = subprocess.run(
            ["curl", "-sS", "-L", "--max-time", str(timeout), "-A", UA, "-H", "Accept: */*", "-o", tmp, "-w", "%{http_code}", url],
            capture_output=True, text=True,
        )
        status = int(proc.stdout.strip() or 0) if proc.stdout.strip().isdigit() else 0
        if proc.returncode == 0 and 200 <= status < 300:
            break
        if status in (429, 500, 502, 503, 504, 0) and attempt < attempts - 1:
            time.sleep(2 ** (attempt + 1))
            continue
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"GET {url} -> HTTP {status} (curl exit {proc.returncode}): {proc.stderr.strip()[:300]}")
    os.replace(tmp, path)
    entry = {
        "url": url,
        "path": os.path.relpath(path, ROOT),
        "sha256": sha256_file(path),
        "bytes": os.path.getsize(path),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": status,
        "method": method,
    }
    if manifest:
        with open(MANIFEST, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    if len(args) != 2:
        raise SystemExit(__doc__)
    print(json.dumps(fetch(args[0], args[1], method=opts.get("method", "direct"))))
