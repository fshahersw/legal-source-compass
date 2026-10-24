"""Measure the true pixel size of each rendition the build may use, by downloading and decoding it once.

Usage: python3 -I -B measure_renditions.py <urls.json> <out_dir>

Writes one manifest line per URL (url, HTTP status, content type, bytes, sha256 of the bytes, decoded width and height,
retrieved_at) to <out_dir>/_manifest.jsonl. Image bytes are not stored. A URL already measured with HTTP 200 is not
fetched again. One request every SPACING seconds; Retry-After is honoured on 429.
"""
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

UA = "LegalSourceAtlas/1.0 (research; court building photo size check; notreelai@gmail.com) python-urllib/3"
SPACING = 2.0
MAX_BYTES = 8 * 1024 * 1024


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read(MAX_BYTES + 1)
                return response.status, response.headers.get("Content-Type", ""), body
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                retry = error.headers.get("Retry-After", "")
                time.sleep(max(int(retry) if retry.isdigit() else 0, 20 * (attempt + 1)))
                continue
            return error.code, error.headers.get("Content-Type", ""), b""
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            return None, "", b""
    return None, "", b""


def main(urls_path, out_dir):
    urls = json.load(open(urls_path))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "_manifest.jsonl"
    done = set()
    if manifest_path.exists():
        for line in open(manifest_path):
            entry = json.loads(line)
            if entry["status"] == 200 and entry.get("width"):
                done.add(entry["url"])
    todo = [u for u in urls if u not in done]
    print(f"{len(urls)} urls, {len(done)} already measured, {len(todo)} to fetch", flush=True)
    last = 0.0
    with open(manifest_path, "a") as manifest:
        for url in todo:
            wait = SPACING - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            status, ctype, body = fetch(url)
            last = time.monotonic()
            entry = {"url": url, "status": status, "content_type": ctype, "bytes": len(body),
                     "sha256": hashlib.sha256(body).hexdigest() if body else None, "width": None, "height": None,
                     "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
            if status == 200 and body and len(body) <= MAX_BYTES and ctype.startswith("image/"):
                try:
                    with Image.open(io.BytesIO(body)) as img:
                        entry["width"], entry["height"] = img.size
                        entry["format"] = img.format
                except Exception as error:  # noqa: BLE001 - recorded, never guessed
                    entry["decode_error"] = str(error)[:200]
            manifest.write(json.dumps(entry) + "\n")
            manifest.flush()
            print(status, entry["width"], entry["height"], url[-60:], flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
