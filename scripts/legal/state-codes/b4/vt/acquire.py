"""Acquire Vermont Statutes Online (legislature.vermont.gov/statutes) verbatim.

Captures landing (edition/currency statements), robots.txt, constitution page, each title
index, each chapter index (section TOC), and each full-chapter text page. Sequential >=1s
spacing via sc_common.Archive; resumable. Direct fetch first; Firecrawl on 403/406 only.

Usage: python3 acquire.py [--work /tmp/sc4/vt]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

BASE = "https://legislature.vermont.gov"
STATUTES = BASE + "/statutes/"
TITLE_HREF = re.compile(r'href="/statutes/title/([^"]+)"')
CHAPTER_HREF = re.compile(r'href="/statutes/chapter/([^/]+)/([^"]+)"')
SECTION_HREF = re.compile(r'href="/statutes/section/([^/]+)/([^/]+)/([^"]+)"')


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec.get("http_status") in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def parse_titles(html):
    return sorted(set(TITLE_HREF.findall(html)), key=lambda x: (len(x), x))


def parse_chapters(html, title):
    out = []
    for t, ch in CHAPTER_HREF.findall(html):
        if t == title:
            out.append(ch)
    return list(dict.fromkeys(out))


def parse_chapter_toc(html):
    rows = []
    for t, ch, sec in SECTION_HREF.findall(html):
        rows.append({"title": t, "chapter": ch, "section_key": sec})
    return rows


def fullchapter_url(title, chapter):
    return f"{STATUTES}fullchapter/{title}/{chapter}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/vt")
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    grab(arc, BASE + "/robots.txt", accept_status=(200, 404))
    landing = grab(arc, STATUTES)
    if landing["state"] != "complete":
        raise SystemExit("landing fetch failed")
    titles = parse_titles(decode_html(arc.read(landing))[0])
    grab(arc, STATUTES + "constitution-of-the-state-of-vermont")
    inventory_path = os.path.join(a.work, "inventory.jsonl")
    inv = open(inventory_path, "a", encoding="utf-8")
    chapters = []
    for ti, title in enumerate(titles, 1):
        turl = f"{STATUTES}title/{title}"
        trec = grab(arc, turl)
        if trec["state"] != "complete":
            print("FAILED title", title, trec.get("http_status"), flush=True)
            continue
        thtml = decode_html(arc.read(trec))[0]
        for ch in parse_chapters(thtml, title):
            chapters.append((title, ch))
        if ti % 10 == 0:
            print("titles", ti, len(chapters), flush=True)
    chapters = list(dict.fromkeys(chapters))
    print("inventory chapters", len(chapters), flush=True)
    failed = []
    for i, (title, ch) in enumerate(chapters, 1):
        curl = f"{STATUTES}chapter/{title}/{ch}"
        crec = grab(arc, curl)
        if crec["state"] != "complete":
            failed.append({"url": curl, "status": crec.get("http_status"), "kind": "chapter_index"})
            continue
        chhtml = decode_html(arc.read(crec))[0]
        toc = parse_chapter_toc(chhtml)
        inv.write(json.dumps({"title": title, "chapter": ch, "chapter_url": curl, "toc_sections": len(toc), "toc": toc}, separators=(",", ":")) + "\n")
        inv.flush()
        furl = fullchapter_url(title, ch)
        frec = grab(arc, furl)
        if frec["state"] != "complete":
            failed.append({"url": furl, "status": frec.get("http_status"), "kind": "fullchapter"})
        if i % 100 == 0:
            print("chapters", i, len(failed), flush=True)
    inv.close()
    json.dump({"titles": len(titles), "chapters": len(chapters), "failed": failed}, open(os.path.join(a.work, "acquire_summary.json"), "w"), indent=1)
    print("done failed", len(failed), flush=True)


if __name__ == "__main__":
    main()
