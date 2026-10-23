"""Acquire the two official U.S. government domain registries, bytes unchanged.

  python3 -I -B scripts/enrichment/gov_domains/acquire_gov_domains.py            fetch pinned files
  python3 -I -B scripts/enrichment/gov_domains/acquire_gov_domains.py --verify   re-hash stored files against the manifest

Sources (both published by U.S. government agencies):
  GSA govt-urls       https://github.com/GSA/govt-urls          domains outside .gov/.mil that governments use
  CISA dotgov-data    https://github.com/cisagov/dotgov-data    every domain registered in the .gov zone (CC0 1.0 licence file)

Each file is fetched from raw.githubusercontent.com at a pinned commit, so the bytes can be re-fetched and re-verified
later. Files are stored unchanged under private/acq/gov_domains/raw/<owner>__<repo>/<path>; every fetch is appended to
private/acq/gov_domains/_manifest.jsonl (url, repo, commit, path, sha256, bytes, retrieved_at UTC, http status, method).
One request per second at most; identifying User-Agent with the owner-supplied contact address.
"""
from __future__ import annotations

import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "gov_domains")
RAW = os.path.join(ACQ, "raw")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 1.0

# Commits observed on 2026-10-23 (main branch heads). The CISA zone export in gov.txt is stamped 2026-10-22 12:54:30.
REPOS = {
    "GSA/govt-urls": {
        "commit": "f843a6b7cdfad0c3a53f7d32fd2e458f67383d64",
        "page": "https://github.com/GSA/govt-urls",
        "files": [
            "1_govt_urls_full.csv",
            "2_govt_urls_federal_only.csv",
            "3_govt_urls_state_only.csv",
            "4_govt_urls_regional_only.csv",
            "5_govt_urls_county_only.csv",
            "6_govt_urls_local_only.csv",
            "7_govt_urls_native_sovereign_nations_only.csv",
            "8_govt_urls_quasigovernmental_only.csv",
            "9_govt_urls_not_used.csv",
            "README.md",
        ],
    },
    "cisagov/dotgov-data": {
        "commit": "000237f4777395ae1282f596dd96b9815749f52f",
        "page": "https://github.com/cisagov/dotgov-data",
        "files": ["current-full.csv", "current-federal.csv", "gov.txt", "README.md", "LICENSE"],
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _context() -> ssl.SSLContext:
    bundle = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"
    return ssl.create_default_context(cafile=bundle) if os.path.exists(bundle) else ssl.create_default_context()


def raw_url(repo: str, commit: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"


def local_path(repo: str, path: str) -> str:
    return os.path.join(RAW, repo.replace("/", "__"), path)


def fetch(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120, context=_context()) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise
        except urllib.error.URLError:
            if attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("unreachable")


def read_manifest() -> list[dict]:
    if not os.path.exists(MANIFEST):
        return []
    with open(MANIFEST, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def acquire() -> None:
    os.makedirs(ACQ, exist_ok=True)
    have = {(e["repo"], e["commit"], e["file"]): e for e in read_manifest()}
    for repo, spec in REPOS.items():
        for name in spec["files"]:
            key = (repo, spec["commit"], name)
            target = local_path(repo, name)
            if key in have and os.path.exists(target):
                with open(target, "rb") as handle:
                    if hashlib.sha256(handle.read()).hexdigest() == have[key]["sha256"]:
                        print("kept", repo, name)
                        continue
            url = raw_url(repo, spec["commit"], name)
            status, body = fetch(url)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as handle:
                handle.write(body)
            entry = {
                "url": url,
                "repo": repo,
                "repo_page": spec["page"],
                "commit": spec["commit"],
                "file": name,
                "path": os.path.relpath(target, ROOT),
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "retrieved_at": utc_now(),
                "http_status": status,
                "method": "HTTPS GET raw.githubusercontent.com at pinned commit",
            }
            with open(MANIFEST, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, sort_keys=True) + "\n")
            print("fetched", repo, name, len(body), entry["sha256"][:16])
            time.sleep(MIN_INTERVAL)


def verify() -> int:
    bad = 0
    for entry in read_manifest():
        path = os.path.join(ROOT, entry["path"])
        if not os.path.exists(path):
            print("missing", entry["path"])
            bad += 1
            continue
        with open(path, "rb") as handle:
            body = handle.read()
        if hashlib.sha256(body).hexdigest() != entry["sha256"] or len(body) != entry["bytes"]:
            print("MISMATCH", entry["path"])
            bad += 1
    print("manifest entries:", len(read_manifest()), "problems:", bad)
    return bad


if __name__ == "__main__":
    if "--verify" in sys.argv[1:]:
        raise SystemExit(1 if verify() else 0)
    acquire()
