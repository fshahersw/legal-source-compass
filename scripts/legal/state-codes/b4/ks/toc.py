#!/usr/bin/env python3
"""Kansas recovery, step 2: capture the publisher's table of contents (ksa.html + every ksa_chN.html).

These index pages were not retained by earlier runs (only ksa_ch2.html was), and they are the only
place the Revisor prints chapter and article titles and the full list of section pages. Responses
are kept byte-for-byte in <work>/toc/<sha256> with a sidecar record; restartable.
"""
import argparse, hashlib, json, os, re, sys, time
from datetime import datetime, timezone
import requests

UA = "LegalSourceAtlas-statecodes/1 (+https://firastest1.com)"
BASE = "https://www.ksrevisor.gov"


def fetch(s, url, work):
    log = os.path.join(work, "toc", "fetched.jsonl")
    done = {}
    if os.path.isfile(log):
        for l in open(log):
            r = json.loads(l)
            done[r["source_url"]] = r
    if url in done and os.path.isfile(os.path.join(work, "toc", done[url]["sha256"])):
        return done[url]
    for attempt in range(4):
        r = s.get(url, timeout=60, headers={"User-Agent": UA})
        if r.status_code == 200:
            break
        time.sleep(3 * (attempt + 1))
    if r.status_code != 200:
        raise RuntimeError(f"{url} {r.status_code}")
    sha = hashlib.sha256(r.content).hexdigest()
    with open(os.path.join(work, "toc", sha), "wb") as f:
        f.write(r.content)
    rec = {"source_url": url, "sha256": sha, "bytes": len(r.content), "http_status": 200,
           "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "retrieval_method": "publisher_page", "proxy": None}
    with open(log, "a") as f:
        f.write(json.dumps(rec) + "\n")
    time.sleep(1)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/ks/work")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.work, "toc"), exist_ok=True)
    s = requests.Session()
    root = fetch(s, BASE + "/ksa.html", a.work)
    html = open(os.path.join(a.work, "toc", root["sha256"]), encoding="utf-8", errors="replace").read()
    chapters = list(dict.fromkeys(re.findall(r'href="(/statutes/ksa_ch[0-9a-z]+\.html)"', html)))
    for c in chapters:
        fetch(s, BASE + c, a.work)
    print(json.dumps({"chapters": len(chapters)}))


if __name__ == "__main__":
    sys.exit(main())
