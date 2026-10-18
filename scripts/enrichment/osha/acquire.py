"""Acquire OSHA public bulk files unchanged into private/acq/osha/ with a manifest.

Usage:
  python3 -I -B scripts/enrichment/osha/acquire.py head <url> [<url> ...]
  python3 -I -B scripts/enrichment/osha/acquire.py get <url> <relative path under private/acq/osha> [method]
  python3 -I -B scripts/enrichment/osha/acquire.py dol <name> [<name> ...]     (data.dol.gov OSHA_<name>.zip)

Every download appends one line to private/acq/osha/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at, status, method}
Rate limit: at most one request per second per host; retries with backoff on 429/5xx/network errors.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "osha")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
DOL_URL = "https://data.dol.gov/data-catalog/OSHA/{0}/OSHA_{0}.zip"
_last = {}


def _wait(url):
    host = urllib.parse.urlparse(url).netloc
    gap = time.time() - _last.get(host, 0)
    if gap < 1.0:
        time.sleep(1.0 - gap)
    _last[host] = time.time()


def head(url):
    for attempt in range(4):
        _wait(url)
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return {"url": url, "status": response.status, "bytes": response.headers.get("Content-Length"),
                        "last_modified": response.headers.get("Last-Modified"), "type": response.headers.get("Content-Type"),
                        "final_url": response.geturl()}
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            return {"url": url, "status": error.code}
        except urllib.error.URLError as error:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            return {"url": url, "status": None, "error": str(error.reason)}


def get(url, rel, method="direct HTTPS GET (official bulk file)"):
    path = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    for attempt in range(5):
        _wait(url)
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(request, timeout=300) as response, open(tmp, "wb") as out:
                status = response.status
                last_modified = response.headers.get("Last-Modified")
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    digest.update(chunk)
                    out.write(chunk)
                    size += len(chunk)
            os.replace(tmp, path)
            entry = {"url": url, "path": os.path.relpath(path, ROOT), "sha256": digest.hexdigest(), "bytes": size,
                     "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": status,
                     "method": method, "last_modified": last_modified}
            with open(MANIFEST, "a") as manifest:
                manifest.write(json.dumps(entry) + "\n")
            return entry
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            return {"url": url, "status": error.code, "error": "http"}
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            if attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            return {"url": url, "status": None, "error": str(error)}


def dol_members_gz(name):
    """Copy every member of a large stored (uncompressed) DOL bulk zip into private/acq/osha/dol/<name>/<member>.gz.

    Bytes are read with HTTP Range requests (zipfile CRC-checks each member) and written losslessly gzip-compressed so
    the raw-storage budget holds; sha256/bytes in the manifest are of the member bytes exactly as served, gz_* of the file
    on disk. The archive's Content-Length and Last-Modified are recorded with every member."""
    import gzip
    import zipfile
    from remote_zip import RangeFile

    url = DOL_URL.format(name)
    remote = RangeFile(url, block=32 << 20)
    archive = zipfile.ZipFile(remote)
    folder = os.path.join(ACQ, "dol", name)
    os.makedirs(folder, exist_ok=True)
    done = set()
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST):
            entry = json.loads(line)
            if entry.get("url") == url and entry.get("member") and entry.get("archive_last_modified") == remote.last_modified:
                done.add(entry["member"])
    for info in archive.infolist():
        if info.filename in done:
            print(json.dumps({"skip": info.filename}))
            continue
        path = os.path.join(folder, info.filename + ".gz")
        digest = hashlib.sha256()
        size = 0
        with archive.open(info) as member, gzip.open(path + ".part", "wb", compresslevel=6) as out:
            while True:
                chunk = member.read(1 << 20)
                if not chunk:
                    break
                digest.update(chunk)
                out.write(chunk)
                size += len(chunk)
        os.replace(path + ".part", path)
        gz_digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                gz_digest.update(chunk)
        entry = {"url": url, "member": info.filename, "member_crc32": "%08x" % info.CRC, "archive_bytes": remote.size,
                 "archive_last_modified": remote.last_modified, "path": os.path.relpath(path, ROOT), "sha256": digest.hexdigest(),
                 "bytes": size, "gz_sha256": gz_digest.hexdigest(), "gz_bytes": os.path.getsize(path),
                 "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": 206,
                 "method": "HTTP Range reads of one member of the official stored zip (CRC-verified), kept byte-identical inside gzip"}
        with open(MANIFEST, "a") as manifest:
            manifest.write(json.dumps(entry) + "\n")
        print(json.dumps(entry), flush=True)


def main(argv):
    command = argv[0]
    if command == "dolgz":
        sys.path.insert(0, HERE)
        for name in argv[1:]:
            dol_members_gz(name)
        return
    if command == "head":
        for url in argv[1:]:
            print(json.dumps(head(url)))
    elif command == "get":
        print(json.dumps(get(argv[1], argv[2], *(argv[3:4]))))
    elif command == "dol":
        for name in argv[1:]:
            print(json.dumps(get(DOL_URL.format(name), os.path.join("dol", f"OSHA_{name}.zip"))))
    elif command == "dolhead":
        for name in argv[1:]:
            print(json.dumps(head(DOL_URL.format(name))))


if __name__ == "__main__":
    main(sys.argv[1:])
