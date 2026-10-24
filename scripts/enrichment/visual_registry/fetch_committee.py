"""Fetch each committee lead's copyright-policy page and its mark file from the committee's own https site.

  python3 -I -B fetch_committee.py

Each URL is fetched once (sequential, one request every 2 seconds), robots.txt of each host read first and obeyed.
Bytes are stored unchanged (gzip) under cache/committee/ with a manifest.
"""
import json
import sys
import urllib.parse
import urllib.robotparser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD, UA, Pacer, Store, http_get, sha256_bytes  # noqa: E402

SPACING = 2.0


def main():
    leads = json.load(open(BUILD / "leads.json"))["committee"]["leads"]
    urls = []
    for lead in leads:
        for u in lead["policy_urls"] + [lead["url"]]:
            if u and u not in urls:
                urls.append(u)
    store = Store("committee")
    pacer = Pacer(SPACING)
    robots = {}
    for url in urls:
        if store.done(url):
            continue
        h = urllib.parse.urlsplit(url).netloc
        if h not in robots:
            pacer.wait()
            status, _, body, _ = http_get(f"https://{h}/robots.txt", accept="text/plain")
            rp = urllib.robotparser.RobotFileParser()
            rp.parse(body.decode("utf-8", "replace").splitlines() if status == 200 else [])
            robots[h] = rp
            store.put(f"robots:{h}", f"https://{h}/robots.txt", status, body,
                      f"robots_{h.replace('.', '_')}.txt.gz")
        if not robots[h].can_fetch(UA, url):
            print("robots.txt disallows", url)
            continue
        pacer.wait()
        status, ctype, body, _ = http_get(url)
        name = sha256_bytes(url.encode())[:16]
        store.put(url, url, status, body, f"{name}.gz", content_type=ctype)
        print(status, ctype, len(body), url, flush=True)


if __name__ == "__main__":
    main()
