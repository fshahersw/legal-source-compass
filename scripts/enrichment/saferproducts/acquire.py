"""Acquire the SaferProducts.gov public database export (SPDB.zip) for the saferproducts stream.

Owner authorisation 2026-10-18 (new instruction: "get neiss and saferproducts extensive data analysis").
No web form, no OData API-key registration: the export needs neither. Bytes are kept unchanged.

Each fetch appends one line to private/acq/saferproducts/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at (UTC), http_status, method, ...}

Usage:
  python3 -I -B scripts/enrichment/saferproducts/acquire.py zip              download SPDB.zip (unchanged)
  python3 -I -B scripts/enrichment/saferproducts/acquire.py unzip            gzip each member into members/ (+ manifest lines)
  python3 -I -B scripts/enrichment/saferproducts/acquire.py url <url> <rel>  fetch one public file/page (bytes unchanged)
"""
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "saferproducts")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
ZIP_URL = "https://www.saferproducts.gov/SPDB.zip"
ZIP_REL = "SPDB.zip"


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(entry):
    with open(MANIFEST, "a") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    print(json.dumps(entry), flush=True)


def fetch(url, rel, timeout=1800):
    dest = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    status = None
    for attempt in range(5):
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(request, timeout=timeout) as response, open(tmp, "wb") as out:
                status = response.status
                headers = {k.lower(): v for k, v in response.getheaders()}
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    digest.update(chunk)
                    size += len(chunk)
                    out.write(chunk)
            os.replace(tmp, dest)
            entry = {
                "url": url,
                "path": os.path.relpath(dest, ROOT),
                "sha256": digest.hexdigest(),
                "bytes": size,
                "retrieved_at": _now(),
                "http_status": status,
                "method": "direct HTTPS GET (urllib, User-Agent: %s)" % UA,
                "last_modified": headers.get("last-modified"),
                "content_type": headers.get("content-type"),
                "content_length_header": headers.get("content-length"),
            }
            _log(entry)
            return entry
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            print("retry", url, error.code, flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == 4:
                raise
            print("retry", url, error, flush=True)
        time.sleep(2 ** attempt * 3)


def unzip():
    """Gzip every member of SPDB.zip into members/<name>.gz; the zip itself stays unchanged."""
    src = os.path.join(ACQ, ZIP_REL)
    with open(src, "rb") as fh:
        zip_sha = hashlib.sha256(fh.read()).hexdigest()
    with zipfile.ZipFile(src) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = os.path.join("members", info.filename + ".gz")
            dest = os.path.join(ACQ, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            raw = hashlib.sha256()
            size = 0
            with zf.open(info) as member, open(dest, "wb") as out:
                # mtime=0 keeps the gzip bytes reproducible
                with gzip.GzipFile(filename=info.filename, mode="wb", fileobj=out, mtime=0, compresslevel=6) as gz:
                    while True:
                        chunk = member.read(1 << 20)
                        if not chunk:
                            break
                        raw.update(chunk)
                        size += len(chunk)
                        gz.write(chunk)
            with open(dest, "rb") as fh:
                gz_sha = hashlib.sha256(fh.read()).hexdigest()
            _log({
                "url": ZIP_URL + "#" + info.filename,
                "path": os.path.relpath(dest, ROOT),
                "sha256": gz_sha,
                "bytes": os.path.getsize(dest),
                "retrieved_at": _now(),
                "http_status": 200,
                "method": "local gzip of unzipped member of SPDB.zip (sha256 of zip %s)" % zip_sha,
                "member": info.filename,
                "member_uncompressed_bytes": size,
                "member_uncompressed_sha256": raw.hexdigest(),
                "member_zip_date_time": "%04d-%02d-%02dT%02d:%02d:%02d" % info.date_time,
            })


def probe(url):
    """Record an HTTP status without keeping a body (used for robots.txt, which is expected to be a 404)."""
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    _log({
        "url": url,
        "path": None,
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": _now(),
        "http_status": status,
        "method": "status probe, direct HTTPS GET (urllib, User-Agent: %s); body not kept" % UA,
    })


def main(argv):
    os.makedirs(ACQ, exist_ok=True)
    if argv[:1] == ["probe"]:
        probe(argv[1])
    elif argv[:1] == ["zip"]:
        fetch(ZIP_URL, ZIP_REL)
    elif argv[:1] == ["unzip"]:
        unzip()
    elif argv[:1] == ["url"]:
        fetch(argv[1], argv[2], timeout=300)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
