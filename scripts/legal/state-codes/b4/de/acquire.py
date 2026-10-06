"""Acquire the Delaware Code Online (delcode.delaware.gov) verbatim: home, help, robots, 31 title indexes, every chapter page.

Sequential, >=1s spacing (sc_common.Archive). Resumable. Direct route first; Firecrawl fallback only on 403/406 from the official host.
Usage: python3 acquire.py [--work /tmp/sc4/de]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

BASE = "https://delcode.delaware.gov/"
ANCHOR = re.compile(r'<a\s+href="([^"]*)"[^>]*>(.*?)</a>', re.S | re.I)


def clean_href(h):
    return re.sub(r"\s+", "", h.replace("&#xA;", ""))


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    for u in ("robots.txt", "help/default.html", "index.html"):
        grab(arc, BASE + u, accept_status=(200, 404)) if u == "robots.txt" else grab(arc, BASE + u)
    home = decode_html(arc.read(arc.index[BASE + "index.html"]))[0]
    titles = []
    for h, _ in ANCHOR.findall(home):
        m = re.fullmatch(r"title(\d+)/index\.html", clean_href(h))
        if m:
            titles.append(int(m.group(1)))
    titles = sorted(set(titles))
    print("titles", len(titles), flush=True)
    chapters = []
    for t in titles:
        rec = grab(arc, f"{BASE}title{t}/index.html")
        if rec["state"] != "complete":
            print("FAILED title", t, rec["http_status"], flush=True)
            continue
        page = decode_html(arc.read(rec))[0]
        for h, _ in ANCHOR.findall(page):
            m = re.fullmatch(r"\.\./title(\d+)/(c[^/]+)/index\.html", clean_href(h))
            if m and int(m.group(1)) == t:
                chapters.append(f"{BASE}title{t}/{m.group(2)}/index.html")
    chapters = list(dict.fromkeys(chapters))
    print("chapters", len(chapters), flush=True)
    failed = []
    for i, u in enumerate(chapters, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append((u, rec["http_status"]))
        if i % 50 == 0:
            print(i, len(failed), flush=True)
    print("done; failed:", failed, flush=True)
    json.dump(failed, open(os.path.join(a.work, "acquire_failed.json"), "w"))


if __name__ == "__main__":
    main()
