"""Shared paths, polite HTTP and raw-response storage for the visual registry builders.

Every fetcher stores the response bytes unchanged (gzip-compressed) under private/acq/visual_registry/cache/<host>/
with one manifest line per request: url, path, sha256 of the response bytes, bytes, retrieved_at (UTC), HTTP status,
method. A request already stored with HTTP 200 is not repeated. Requests to one host are sequential and spaced.
"""
import gzip
import hashlib
import http.client
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/user/legal-source-compass")
ACQ = ROOT / "private" / "acq" / "visual_registry"
CACHE = ACQ / "cache"
BUILD = ROOT / "private" / "build" / "visual_registry"
REGISTRY = ACQ / "11cf86c0-image-registry.json"
WORKBOOK = ACQ / "25f2cfcd-Government_Visual_Registry.xlsx"
PROFILES = ACQ / "559516a6-profiles.json"
LOC_RIGHTS_CSV = ACQ / "loc_pp_rights_statements_2026-10-24.csv"
COURT_SPINE = ROOT / "private" / "build" / "court_images" / "lookups" / "court_spine.json"
COURTS_DB = ROOT / "private" / "build" / "court_images" / "lookups" / "courts_db_names.json"
UA = "LegalSourceAtlas/1.0 (research; public image licence and identity check; notreelai@gmail.com) python-urllib/3"
LEAD_NOTE = "Visual registry supplied by the site owner, October 2026"


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def host(url):
    return urllib.parse.urlsplit(url or "").netloc.lower()


def sha256_bytes(body):
    return hashlib.sha256(body).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def http_get(url, accept="*/*", max_bytes=None, timeout=60, retries=3, user_agent=UA):
    """(status, content_type, body, headers). Retries 429/5xx with Retry-After or backoff; never bypasses a refusal."""
    request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept": accept,
                                                   "Accept-Encoding": "gzip"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read() if max_bytes is None else response.read(max_bytes + 1)
                if response.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return response.status, response.headers.get("Content-Type", ""), body, dict(response.headers)
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < retries:
                retry = error.headers.get("Retry-After", "")
                time.sleep(max(int(retry) if retry.isdigit() else 0, 20 * (attempt + 1)))
                continue
            body = error.read()
            if error.headers.get("Content-Encoding") == "gzip":
                try:
                    body = gzip.decompress(body)
                except OSError:
                    pass
            return error.code, error.headers.get("Content-Type", ""), body, dict(error.headers)
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, OSError):
            if attempt < retries:
                time.sleep(10 * (attempt + 1))
                continue
            return None, "", b"", {}
    return None, "", b"", {}


class Store:
    """gzip raw responses + manifest under cache/<name>/; key -> latest manifest entry."""

    def __init__(self, name):
        self.dir = CACHE / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.manifest = self.dir / "_manifest.jsonl"
        self.entries = {}
        if self.manifest.exists():
            for line in open(self.manifest):
                entry = json.loads(line)
                old = self.entries.get(entry["key"])
                if old is None or entry["status"] == 200 or old["status"] != 200:
                    self.entries[entry["key"]] = entry

    def done(self, key):
        entry = self.entries.get(key)
        return bool(entry and entry["status"] == 200)

    def put(self, key, url, status, body, file_name, **extra):
        path = self.dir / file_name
        with gzip.open(path, "wb") as f:
            f.write(body)
        entry = {"key": key, "url": url, "path": str(path), "sha256": sha256_bytes(body), "bytes": len(body),
                 "retrieved_at": now_utc(), "status": status, "method": "GET", **extra}
        with open(self.manifest, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.entries[key] = entry
        return entry

    def read(self, key, verify=True):
        entry = self.entries.get(key)
        if not entry or entry["status"] != 200:
            return None
        body = gzip.open(entry["path"]).read()
        if verify and sha256_bytes(body) != entry["sha256"]:
            raise SystemExit(f"{entry['path']}: stored bytes do not match the manifest")
        return body


class Pacer:
    """At most one request per `spacing` seconds (sequential)."""

    def __init__(self, spacing):
        self.spacing = spacing
        self.last = 0.0

    def wait(self):
        delay = self.spacing - (time.monotonic() - self.last)
        if delay > 0:
            time.sleep(delay)
        self.last = time.monotonic()


TILE_PX = 200


def tile_stem(url):
    """Review tiles are named by the rendition (or mark) URL they were decoded from."""
    return hashlib.sha1(url.encode()).hexdigest()[:20]


def tile_path(url):
    for ext in ("jpg", "png"):
        p = CACHE / "tiles" / f"{tile_stem(url)}.{ext}"
        if p.exists():
            return p
    return None


def save_tile(img, url):
    """Keep a <=200 px copy of a decoded image for the contact sheets (PNG when it has transparency)."""
    from PIL import Image

    tiles = CACHE / "tiles"
    tiles.mkdir(parents=True, exist_ok=True)
    img = img.copy()
    img.thumbnail((TILE_PX, TILE_PX), Image.LANCZOS)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    if has_alpha:
        img.convert("RGBA").save(tiles / f"{tile_stem(url)}.png")
    else:
        img.convert("RGB").save(tiles / f"{tile_stem(url)}.jpg", quality=85)


def load_registry(path=REGISTRY):
    return json.load(open(path))


def load_json(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    return json.load(open(p))


def write_json(path, data, indent=1):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n")
    tmp.replace(p)
