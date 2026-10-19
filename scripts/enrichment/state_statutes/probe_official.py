"""Fetch official legislature pages (robots.txt first) and record where their statute links point.

Usage: python3 -I -B probe_official.py <out_dir> <url> [<url> ...]

Raw bytes are kept unchanged under <out_dir>/<host>/<sha256>.html with a _manifest.jsonl entry
(url, path, sha256, bytes, retrieved_at, status, method). Prints every anchor whose href or text
mentions code/statute so the reviewer can see whether the official site hosts the text itself or
sends readers to a commercial publisher. Nothing is fetched from a commercial host.
"""
import datetime
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

UA = "legal-source-compass research (contact: notreelai@gmail.com)"
COMMERCIAL = re.compile(r"lexis|westlaw|justia|casetext|findlaw|thomsonreuters|fastcase|vlex", re.I)


def allowed(url):
    parts = urllib.parse.urlsplit(url)
    robots = urllib.robotparser.RobotFileParser()
    robots.set_url(f"{parts.scheme}://{parts.netloc}/robots.txt")
    try:
        robots.read()
    except Exception as error:  # robots unreachable: record and treat as allowed per RFC 9309 5xx/4xx rules
        print(json.dumps({"robots": robots.url, "error": str(error)[:120]}))
        return True
    return robots.can_fetch(UA, url)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.geturl(), response.read()
    except urllib.error.HTTPError as error:
        return error.code, url, error.read()


def main(out_dir, urls):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = out / "_manifest.jsonl"
    for url in urls:
        if COMMERCIAL.search(urllib.parse.urlsplit(url).netloc):
            print(json.dumps({"url": url, "skipped": "commercial host"}))
            continue
        if not allowed(url):
            print(json.dumps({"url": url, "skipped": "robots.txt disallows"}))
            continue
        try:
            status, final, body = fetch(url)
        except urllib.error.URLError as error:  # e.g. a host serving an incomplete TLS chain; never retried insecurely
            print(json.dumps({"url": url, "error": str(error.reason)[:160]}))
            continue
        digest = hashlib.sha256(body).hexdigest()
        host = urllib.parse.urlsplit(final).netloc
        path = out / host / f"{digest}.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        entry = {
            "url": url,
            "final_url": final,
            "path": str(path),
            "sha256": digest,
            "bytes": len(body),
            "retrieved_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": status,
            "method": "urllib GET",
        }
        with manifest.open("a") as handle:
            handle.write(json.dumps(entry) + "\n")
        print(json.dumps({k: entry[k] for k in ("url", "final_url", "status", "bytes")}))
        html = body.decode("utf-8", "replace")
        for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
            label = re.sub(r"<[^>]+>|\s+", " ", text).strip()
            if re.search(r"code|statut|annotated|laws", href + " " + label, re.I):
                flag = "COMMERCIAL" if COMMERCIAL.search(href) else ""
                print(f"   {flag:10} {label[:70]!r} -> {href[:160]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
