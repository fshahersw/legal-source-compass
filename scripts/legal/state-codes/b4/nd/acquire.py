"""Acquire North Dakota Century Code from ndlegis.gov/cencode/ (HTML TOCs + chapter PDFs).

Sequential, >=1s spacing (sc_common.Archive). Resumable.
Usage: python3 acquire.py [--work /tmp/sc4/nd] [--phase all|meta|discover|chapters]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

BASE = "https://ndlegis.gov/cencode/"
INFO = "https://ndlegis.gov/general-information/north-dakota-century-code/index.html"
MAX_TITLE = 65
CHAPTER_ON_TITLE = re.compile(r'href="(t\d+c\d+)\.(?:html|pdf)"', re.I)
CHAPTER_SLUG = re.compile(r"^t(\d+)c(\d+)\.html$", re.I)
INDEX_CHAPTER = re.compile(r"(t\d+c\d+)\.(?:html|pdf)", re.I)


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,application/pdf,*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def discover(arc):
    titles = []
    chapters = set()
    index_rec = grab(arc, BASE + "index.html")
    if index_rec.get("state") == "complete":
        page, _ = decode_html(arc.read(index_rec))
        for slug in INDEX_CHAPTER.findall(page):
            chapters.add(slug.lower() + ".html")
    for n in range(1, MAX_TITLE + 1):
        slug = f"t{n:02d}.html"
        url = BASE + slug
        rec = grab(arc, url)
        if rec["state"] != "complete":
            continue
        titles.append(slug)
        page, _ = decode_html(arc.read(rec))
        for stem in CHAPTER_ON_TITLE.findall(page):
            if stem.lower().startswith(f"t{n:02d}c"):
                chapters.add(stem.lower() + ".html")
    chapters = sorted(chapters)
    inv = {"titles": titles, "chapters": chapters, "title_count": len(titles), "chapter_count": len(chapters)}
    path = os.path.join(arc.work, "inventory.json")
    json.dump(inv, open(path, "w"), indent=2)
    print("inventory", inv["title_count"], "titles", inv["chapter_count"], "chapters", flush=True)
    return inv


def fetch_chapters(arc, chapters):
    failed = []
    pdf_only = []
    for i, slug in enumerate(chapters, 1):
        html_url = BASE + slug
        pdf_url = BASE + slug.replace(".html", ".pdf")
        hrec = grab(arc, html_url, accept_status=(200, 300))
        if hrec.get("http_status") == 300 or hrec.get("state") != "complete":
            pdf_only.append(slug)
        prec = grab(arc, pdf_url)
        if prec["state"] != "complete":
            failed.append({"url": pdf_url, "http_status": prec.get("http_status")})
        if i % 25 == 0:
            print(i, len(chapters), "failed", len(failed), "pdf_only", len(pdf_only), flush=True)
    inv_path = os.path.join(arc.work, "inventory.json")
    inv = json.load(open(inv_path))
    inv["pdf_only_html"] = pdf_only
    json.dump(inv, open(inv_path, "w"), indent=2)
    json.dump(failed, open(os.path.join(arc.work, "acquire_failed.json"), "w"), indent=2)
    print("done chapters; failed", len(failed), "pdf_only", len(pdf_only), flush=True)


def fetch_meta(arc):
    for url in (
        INFO,
        BASE + "index.html",
        "https://ndlegis.gov/robots.txt",
    ):
        grab(arc, url, accept_status=(200, 404) if url.endswith("robots.txt") else (200,))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    ap.add_argument("--phase", default="all", choices=("all", "meta", "discover", "chapters"))
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    if a.phase in ("all", "meta"):
        fetch_meta(arc)
    inv_path = os.path.join(a.work, "inventory.json")
    if a.phase in ("all", "discover"):
        inv = discover(arc)
    elif os.path.exists(inv_path):
        inv = json.load(open(inv_path))
    else:
        raise SystemExit("run discover first")
    if a.phase in ("all", "chapters"):
        fetch_chapters(arc, inv["chapters"])


if __name__ == "__main__":
    main()
