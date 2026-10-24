"""Read each lead's Wikimedia Commons file page metadata (imageinfo + extmetadata) and store the raw responses.

Usage: python3 -I -B fetch_commons.py <titles.json> <out_dir>

Two passes over the same titles, 50 titles per request, one request every SPACING seconds (the API's limit for
clients without an account can be as low as 10 per minute), honouring Retry-After on 429. A batch already stored with
HTTP 200 is not fetched again.
  display  iiurlwidth=960  url, size, mime, sha1, timestamp, extmetadata (license, author, credit, terms)
  thumb    iiurlwidth=330  url only (the card thumbnail rendition and its size)
  mid      iiurlwidth=500  url only (the display rendition for originals narrower than 960 px)
Only Wikimedia's standard thumbnail widths are requested (hotlinks at other widths are refused).
Raw response bytes are kept gzip-compressed with a manifest line each (url, path, sha256 of the response bytes,
bytes, retrieved_at, HTTP status, method).
"""
import gzip
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "LegalSourceAtlas/1.0 (research; court building photo licence check; notreelai@gmail.com) python-urllib/3"
FIELDS = "|".join([
    "LicenseShortName", "LicenseUrl", "License", "Artist", "Credit", "AttributionRequired", "UsageTerms",
    "Copyrighted", "Restrictions", "NonFree", "ObjectName", "ImageDescription", "DateTimeOriginal",
])
PASSES = {
    "display": {"iiprop": "url|size|mime|sha1|timestamp|extmetadata", "iiurlwidth": "960",
                "iiextmetadatafilter": FIELDS, "iiextmetadatalanguage": "en"},
    "thumb": {"iiprop": "url|size", "iiurlwidth": "330"},
    "mid": {"iiprop": "url|size", "iiurlwidth": "500"},
}
BATCH = 50
SPACING = 6.5


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                   "Accept-Encoding": "gzip"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return response.status, body
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                retry = error.headers.get("Retry-After", "")
                time.sleep(max(int(retry) if retry.isdigit() else 0, 30 * (attempt + 1)))
                continue
            return error.code, error.read()
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def main(titles_path, out_dir):
    titles = json.load(open(titles_path))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    done = set()
    if (out / "_manifest.jsonl").exists():
        for line in open(out / "_manifest.jsonl"):
            entry = json.loads(line)
            if entry["status"] == 200:
                done.add(entry["path"])
    manifest = open(out / "_manifest.jsonl", "a")
    last = 0.0
    for name, extra in PASSES.items():
        for start in range(0, len(titles), BATCH):
            batch = titles[start:start + BATCH]
            params = {"action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo",
                      "redirects": "1", "titles": "|".join(batch), **extra}
            url = API + "?" + urllib.parse.urlencode(params)
            path = out / f"{name}_{start // BATCH:03d}.json.gz"
            if str(path) in done:
                continue
            wait = SPACING - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.monotonic()
            status, body = fetch(url)
            last = time.monotonic()
            with gzip.open(path, "wb") as f:
                f.write(body)
            manifest.write(json.dumps({
                "url": url, "path": str(path), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": status,
                "method": "GET", "pass": name, "titles": len(batch),
            }) + "\n")
            manifest.flush()
            print(name, start, status, len(body))
    manifest.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
