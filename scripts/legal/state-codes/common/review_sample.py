#!/usr/bin/env python3
"""Seeded live-page review of landed sections: citation, heading and text against the publisher's live page.

For N random landed sections (seed fixed and recorded) fetch the section's official URL now (direct,
browser-style UA recorded) and require that the whitespace-collapsed landed text, heading and citation id
appear in the live page's visible text compared on non-whitespace characters (inline-tag spacing differs by renderer). Writes review-sample.json next to the packet; exit 1 on any mismatch.
"""
import argparse
import json
import os
import random
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
ws = lambda s: re.sub(r"\s+", "", s.replace("\u00a0", " "))


def norm_fold(s):
    return ws(s).replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--root")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261006)
    ap.add_argument("--page-url-key", default="url", help="key in parsed sections source for the live page URL")
    a = ap.parse_args()
    root = a.root or f"/tmp/sc/{a.state.upper()}"
    land = [json.loads(l) for l in open(os.path.join(root, "landing/sections.jsonl"), encoding="utf-8")]
    url_by = {}
    for l in open(os.path.join(root, "parsed/sections.jsonl"), encoding="utf-8"):
        r = json.loads(l)
        url_by.setdefault(r["native_id"], r["source"]["url"])
    rnd = random.Random(a.seed)
    pick = rnd.sample(land, min(a.n, len(land)))
    s = requests.Session()
    s.headers["User-Agent"] = UA
    out, bad = [], 0
    for sec in pick:
        cp = sec["citation_path"].split("#")[0]
        url = url_by.get(cp)
        rec = {"citation_path": sec["citation_path"], "live_url": url, "user_agent": UA}
        if not url:
            rec["result"] = "no_url"; bad += 1; out.append(rec); continue
        time.sleep(1.0)
        r = s.get(url, timeout=60)
        rec.update(fetched_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), http_status=r.status_code, bytes=len(r.content))
        page = norm_fold(BeautifulSoup(r.content, "lxml").get_text(""))
        checks = {"citation_id": cp.split("#")[0] in page,
                  "heading": (not sec["heading"]) or norm_fold(sec["heading"]) in page,
                  "text": norm_fold(sec["text"]) in page}
        rec["checks"] = checks
        rec["result"] = "match" if r.status_code == 200 and all(checks.values()) else "MISMATCH"
        bad += rec["result"] != "match"
        out.append(rec)
    rep = {"state": a.state.upper(), "seed": a.seed, "sampled": len(out), "mismatches": bad, "sections": out}
    json.dump(rep, open(os.path.join(root, "landing/review-sample.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: rep[k] for k in ("state", "seed", "sampled", "mismatches")}))
    for r in out:
        if r["result"] != "match":
            print(json.dumps(r)[:400])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
