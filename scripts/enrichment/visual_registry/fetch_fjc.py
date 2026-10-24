"""Fetch FJC Biographical Directory pages https://www.fjc.gov/history/judges/<slug> for judge leads.

  python3 -I -B fetch_fjc.py <slugs.json>

robots.txt is read first and obeyed: it allows /history/judges/ and sets Crawl-delay: 30, so requests are sequential
and at least the stated crawl delay apart (never less than 2 seconds). Pages are stored unchanged (gzip) under
cache/fjc/ with a manifest; the builder reads each page's own node id (its shortlink).
"""
import json
import re
import sys
import urllib.robotparser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import UA, Pacer, Store, http_get  # noqa: E402


def main(slugs_path):
    slugs = json.load(open(slugs_path))
    store = Store("fjc")
    status, _, body, _ = http_get("https://www.fjc.gov/robots.txt", accept="text/plain")
    store.put("robots", "https://www.fjc.gov/robots.txt", status, body, "robots.txt.gz")
    if status != 200:
        raise SystemExit(f"robots.txt not readable (HTTP {status}); not fetching")
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(body.decode("utf-8", "replace").splitlines())
    delay = max(float(rp.crawl_delay(UA) or 0), 2.0)
    print("crawl delay", delay, flush=True)
    pacer = Pacer(delay)
    pacer.wait()
    for slug in slugs:
        if not re.fullmatch(r"[a-z0-9-]{3,120}", slug) or store.done(slug):
            continue
        url = f"https://www.fjc.gov/history/judges/{slug}"
        if not rp.can_fetch(UA, url):
            print("robots.txt disallows", url, flush=True)
            continue
        pacer.wait()
        status, ctype, body, _ = http_get(url, accept="text/html")
        store.put(slug, url, status, body, f"{slug}.html.gz", content_type=ctype)
        print(slug, status, len(body), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
