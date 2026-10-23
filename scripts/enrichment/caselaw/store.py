"""Private object storage for case-law shards: upload, whole-object readback, SHA-256 comparison.

Target: Supabase Storage bucket `corpus-originals` (private) under caselaw/courtlistener/<snapshot>/.
Credentials come only from the environment (EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_KEY): either sourced from
private/scratch/env.sh in the command that runs the extractor, or read from that file into this process's environment
by load_env_file() when they are not set; they are never printed, logged or written.

put_verified(key, path, sha256, bytes, may_replace) is the only write path:
  1. upload with x-upsert: false (standard POST up to STANDARD_UPLOAD_LIMIT, resumable TUS above it);
  2. if the object already exists, read it back: identical SHA-256 and size -> "already_present" (nothing written);
     different -> overwritten only when may_replace(existing_sha256) says this pipeline wrote it (e.g. a shard of a
     trial run's partial unit or of an older extractor version) -> "replaced"; otherwise ChecksumConflict;
  3. read the object back in full (authenticated GET) and compare SHA-256 and size with the local file. A mismatch is
     re-uploaded (upsert; the object is ours at that point) up to `attempts` times, then ReadbackMismatch is raised.
     The caller deletes the local file only after a verified receipt.
"""
from __future__ import annotations

import base64
import hashlib
import os
import time
import urllib.parse
import uuid

import requests

BUCKET = "corpus-originals"
PROJECT_HOST = "xosqzzsnhxcyehcnirpa.supabase.co"
STANDARD_UPLOAD_LIMIT = 45 * 1024 * 1024
TUS_CHUNK = 6 * 1024 * 1024  # Supabase's resumable endpoint expects 6 MiB chunks (the last one may be shorter)
CONTENT_TYPE = "application/gzip"
TRANSIENT = {408, 425, 429, 500, 502, 503, 504, 520, 522, 524}


class StoreError(RuntimeError):
    pass


class ChecksumConflict(StoreError):
    """An object we did not write (or may not replace) already holds different bytes at the key."""


class ReadbackMismatch(StoreError):
    """The bytes read back differ from the local file after every retry."""


ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "private", "scratch", "env.sh")
ENV_NAMES = ("EXTERNAL_SUPABASE_URL", "EXTERNAL_SUPABASE_KEY")


def load_env_file(path: str = ENV_FILE, names: tuple[str, ...] = ENV_NAMES) -> None:
    """Equivalent to sourcing env.sh for this process only: `export NAME=value` lines for the named variables are put
    into os.environ when they are not already set. Values are never printed or written anywhere."""
    if all(os.environ.get(n) for n in names) or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as h:
        for line in h:
            line = line.strip()
            if line.startswith("export "):
                line = line[7:].strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k in names and not os.environ.get(k):
                os.environ[k] = v.strip().strip('"').strip("'")


def sha256_file(path: str) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
            n += len(block)
    return h.hexdigest(), n


class Storage:
    def __init__(self, url: str | None = None, key: str | None = None, bucket: str = BUCKET, session: requests.Session | None = None,
                 check_project: bool = True, retries: int = 6, timeout: int = 900, reread_pause: float = 3.0):
        if url is None or key is None:
            load_env_file()
        url = (url if url is not None else os.environ.get("EXTERNAL_SUPABASE_URL", "")).rstrip("/")
        key = key if key is not None else os.environ.get("EXTERNAL_SUPABASE_KEY", "")
        if not url or not key:
            raise StoreError("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set in the environment")
        if check_project and urllib.parse.urlparse(url).hostname != PROJECT_HOST:
            raise StoreError("EXTERNAL_SUPABASE_URL is not the corpus project")
        self.url = url
        self.bucket = bucket
        self.h = {"apikey": key}
        if not key.startswith("sb_"):
            self.h["Authorization"] = "Bearer " + key
        self.s = session or requests.Session()
        self.retries = retries
        self.timeout = timeout
        self.reread_pause = reread_pause

    # ------------------------------------------------------------------------------------------------ http helpers
    def _object_url(self, key: str, authenticated: bool = False) -> str:
        q = urllib.parse.quote(key, safe="/")
        return f"{self.url}/storage/v1/object/{'authenticated/' if authenticated else ''}{self.bucket}/{q}"

    def _retry(self, fn):
        delay = 2.0
        for attempt in range(self.retries + 1):
            try:
                r = fn()
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt >= self.retries:
                    raise StoreError(f"network error: {type(exc).__name__}") from exc
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            if r.status_code in TRANSIENT and attempt < self.retries:
                r.close()
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            return r
        raise StoreError("unreachable")

    # ------------------------------------------------------------------------------------------------ reads
    def readback(self, key: str) -> tuple[int, str | None, int]:
        """(HTTP status, sha256 hex, bytes) of the whole stored object; sha is None unless the status is 200.

        Authenticated object reads are served through a CDN cache that can return an object's previous bytes for a
        while after it is overwritten (observed 2026-10-22: a plain GET returned the old version after an upsert and
        after a delete). Every readback therefore carries a unique query parameter, which makes the cache miss.
        """
        # a connection broken while the body streams (after _retry has returned) is read again from the start
        delay = 2.0
        for attempt in range(self.retries + 1):
            params = {"readback": uuid.uuid4().hex}
            r = self._retry(lambda: self.s.get(self._object_url(key, True), headers=self.h, params=params, timeout=self.timeout, stream=True))
            try:
                if r.status_code != 200:
                    return (404 if _is_not_found(r) else r.status_code), None, 0
                h = hashlib.sha256()
                n = 0
                for block in r.iter_content(1 << 20):
                    h.update(block)
                    n += len(block)
                return 200, h.hexdigest(), n
            except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as exc:
                if attempt >= self.retries:
                    raise StoreError(f"network error while reading back: {type(exc).__name__}") from exc
            finally:
                r.close()
            time.sleep(delay)
            delay = min(delay * 2, 60)
        raise StoreError("unreachable")

    # ------------------------------------------------------------------------------------------------ writes
    def _standard_upload(self, key: str, path: str, upsert: bool) -> tuple[int, str]:
        def go():
            with open(path, "rb") as f:
                return self.s.post(self._object_url(key), data=f, timeout=self.timeout,
                                   headers={**self.h, "Content-Type": CONTENT_TYPE, "x-upsert": "true" if upsert else "false"})

        r = self._retry(go)
        return r.status_code, r.text[:300]

    def _tus_upload(self, key: str, path: str, upsert: bool) -> tuple[int, str]:
        size = os.path.getsize(path)
        meta = ",".join(
            f"{k} {base64.b64encode(v.encode()).decode()}"
            for k, v in (("bucketName", self.bucket), ("objectName", key), ("contentType", CONTENT_TYPE), ("cacheControl", "3600"))
        )
        head = {**self.h, "Tus-Resumable": "1.0.0", "x-upsert": "true" if upsert else "false"}
        r = self._retry(lambda: self.s.post(f"{self.url}/storage/v1/upload/resumable", timeout=120,
                                            headers={**head, "Upload-Length": str(size), "Upload-Metadata": meta}))
        if r.status_code not in (200, 201):
            return r.status_code, r.text[:300]
        location = r.headers["Location"]
        if location.startswith("/"):
            location = self.url + location
        offset = 0
        stalls = 0
        with open(path, "rb") as f:
            while offset < size:
                f.seek(offset)
                chunk = f.read(TUS_CHUNK)
                try:
                    r = self.s.patch(location, data=chunk, timeout=600,
                                     headers={**head, "Content-Type": "application/offset+octet-stream", "Upload-Offset": str(offset)})
                    ok = r.status_code in (200, 204)
                except (requests.ConnectionError, requests.Timeout):
                    ok = False
                    r = None
                if ok:
                    offset = int(r.headers.get("Upload-Offset", offset + len(chunk)))
                    stalls = 0
                    continue
                if r is not None and r.status_code not in TRANSIENT and r.status_code != 409:
                    return r.status_code, r.text[:300]
                stalls += 1
                if stalls > self.retries:
                    return (r.status_code if r is not None else 599), "tus upload stalled"
                time.sleep(min(2 ** stalls, 60))
                # ask the server where it is before resending
                h = self._retry(lambda: self.s.head(location, timeout=60, headers=head))
                if h.status_code in (200, 204) and h.headers.get("Upload-Offset", "").isdigit():
                    offset = int(h.headers["Upload-Offset"])
        return 201, ""

    def upload(self, key: str, path: str, upsert: bool) -> tuple[int, str]:
        if os.path.getsize(path) > STANDARD_UPLOAD_LIMIT:
            return self._tus_upload(key, path, upsert)
        st, msg = self._standard_upload(key, path, upsert)
        if st == 413:
            return self._tus_upload(key, path, upsert)
        return st, msg

    def put_verified(self, key: str, path: str, sha256: str, nbytes: int, may_replace=None, attempts: int = 3) -> dict:
        local_sha, local_n = sha256_file(path)
        if local_sha != sha256 or local_n != nbytes:
            raise StoreError(f"local shard changed since it was written: {os.path.basename(path)}")
        t0 = time.time()
        st, msg = self.upload(key, path, upsert=False)
        upload_s = time.time() - t0
        state = "uploaded"
        replaced = None
        if st not in (200, 201):
            if not _is_duplicate(st, msg):
                raise StoreError(f"upload failed with HTTP {st}: {msg[:160]}")
            rst, rsha, rn = self.readback(key)
            if rst == 200 and rsha == sha256 and rn == nbytes:
                state = "already_present"
            elif rst == 200 and may_replace is not None and may_replace(rsha):
                t0 = time.time()
                st, msg = self.upload(key, path, upsert=True)
                upload_s = time.time() - t0
                if st not in (200, 201):
                    raise StoreError(f"replacement upload failed with HTTP {st}: {msg[:160]}")
                state, replaced = "replaced", rsha
            elif rst == 200:
                raise ChecksumConflict(f"{key} already holds different bytes (sha256 {rsha}) that this pipeline may not replace")
            else:
                raise StoreError(f"upload reported a duplicate but readback returned HTTP {rst}")
        for attempt in range(attempts):
            t1 = time.time()
            rst, rsha, rn = self.readback(key)
            if not (rst == 200 and rsha == sha256 and rn == nbytes):
                # a just-written object can take a moment to be readable everywhere: read once more before re-uploading
                time.sleep(self.reread_pause * (attempt + 1))
                rst, rsha, rn = self.readback(key)
            readback_s = time.time() - t1
            if rst == 200 and rsha == sha256 and rn == nbytes:
                return {"key": key, "bucket": self.bucket, "state": state, "replaced_sha256": replaced, "bytes": nbytes, "sha256": sha256,
                        "readback_sha256": rsha, "readback_bytes": rn, "readback_ok": True, "upload_seconds": round(upload_s, 2),
                        "readback_seconds": round(readback_s, 2), "readback_attempts": attempt + 1,
                        "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            if attempt + 1 < attempts:
                st, msg = self.upload(key, path, upsert=True)
                if st not in (200, 201):
                    raise StoreError(f"re-upload after readback mismatch failed with HTTP {st}: {msg[:160]}")
        raise ReadbackMismatch(f"{key}: readback HTTP {rst}, sha256 {rsha}, {rn} bytes; expected {sha256}, {nbytes} bytes")


def _is_duplicate(status: int, msg: str) -> bool:
    return status == 409 or (status == 400 and ("Duplicate" in msg or "already exists" in msg or '"409"' in msg))


def _is_not_found(r) -> bool:
    if r.status_code == 404:
        return True
    if r.status_code == 400:
        t = r.text[:300]
        return "not_found" in t or "Object not found" in t or '"404"' in t
    return False
