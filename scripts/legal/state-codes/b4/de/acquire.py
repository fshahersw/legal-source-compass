"""Acquire Delaware Code Online: home, titles, chapters, and all subchapter (nested) pages.

Sequential >=1s via sc_common.Archive (resumable). Direct fetch; Firecrawl only on 403/406 if keyed.
Usage: python3 acquire.py [--work /tmp/sc4/de] [--phase all|bootstrap|subpages|inventory]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from de_site import BASE, CHAPTER_INDEX_RE, child_page_urls  # noqa: E402
from discover import discover  # noqa: E402

ANCHOR = re.compile(r'<a\s+href="([^"]*)"[^>]*>(.*?)</a>', re.S | re.I)


def clean_href(h):
    return re.sub(r"\s+", "", h.replace("&#xA;", ""))


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def bootstrap(arc):
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
            print("chapters", i, len(failed), flush=True)
    return failed


def fetch_subpages(arc, inv):
    urls = inv["subpage_urls"]
    failed = []
    for i, u in enumerate(urls, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append((u, rec["http_status"]))
        if i % 50 == 0:
            print("subpages", i, len(failed), flush=True)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    ap.add_argument("--phase", default="all", choices=("all", "bootstrap", "subpages", "inventory"))
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    failed = []
    if a.phase in ("all", "bootstrap"):
        failed.extend(bootstrap(arc))
    inv_path = os.path.join(a.work, "url_inventory.json")
    if a.phase in ("all", "inventory", "subpages"):
        inv = discover(arc)
        json.dump(inv, open(inv_path, "w"), indent=1)
        print("inventory subpages", inv["subpage_count"], flush=True)
    if a.phase in ("all", "subpages"):
        inv = json.load(open(inv_path))
        failed.extend(fetch_subpages(arc, inv))
    print("done; failed:", failed, flush=True)
    json.dump(failed, open(os.path.join(a.work, "acquire_failed.json"), "w"))


if __name__ == "__main__":
    main()
