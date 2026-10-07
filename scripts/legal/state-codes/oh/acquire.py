#!/usr/bin/env python3
"""Acquire Ohio Revised Code HTML from codes.ohio.gov (official).

Phases: inventory (TOC crawl → inventory.json), fetch (every section page via Archive).
Usage: python3 acquire.py [--work /tmp/sc4/oh] [--phase all|inventory|fetch] [--worker 0] [--workers 1]
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "b4"))
from sc_common import Archive, decode_html, worker_slice  # noqa: E402

HOST = "https://codes.ohio.gov/"
INDEX = "ohio-revised-code"
TITLE_RE = re.compile(r'href="(ohio-revised-code/title-\d+)"', re.I)
CHAPTER_RE = re.compile(r'href="(chapter-\d+)"', re.I)
SECTION_RE = re.compile(r'href="(section-[\d.]+)"', re.I)


def abs_url(path: str) -> str:
    return HOST + path.lstrip("/")


def grab(arc: Archive, url: str):
    rec = arc.fetch(url, accept="text/html,*/*", min_bytes=500)
    return rec


def page_html(arc: Archive, url: str) -> str:
    rec = arc.index[url]
    return decode_html(arc.read(rec))[0]


def build_inventory(arc: Archive) -> dict:
    grab(arc, abs_url(INDEX))
    index_html = page_html(arc, abs_url(INDEX))
    titles = sorted(set(TITLE_RE.findall(index_html)), key=lambda x: int(x.split("-")[-1]))
    chapters = []
    for title_path in titles:
        url = abs_url(title_path)
        grab(arc, url)
        html = page_html(arc, url)
        for ch in sorted(set(CHAPTER_RE.findall(html)), key=lambda x: int(x.split("-")[1])):
            chapters.append({"title_path": title_path, "chapter_href": ch})
    section_urls = []
    seen = set()
    for ch in chapters:
        url = abs_url(f"{INDEX}/{ch['chapter_href']}")
        grab(arc, url)
        html = page_html(arc, url)
        for sec in SECTION_RE.findall(html):
            sec_url = abs_url(f"{INDEX}/{sec}")
            if sec_url not in seen:
                seen.add(sec_url)
                section_urls.append(
                    {
                        "section_href": sec,
                        "section_number": sec.replace("section-", ""),
                        "chapter_href": ch["chapter_href"],
                        "title_path": ch["title_path"],
                        "source_url": sec_url,
                    }
                )
    inv = {
        "schema_version": "ohio-revised-code-inventory/1",
        "publisher": "https://codes.ohio.gov/ohio-revised-code",
        "titles": len(titles),
        "chapters": len(chapters),
        "sections": len(section_urls),
        "section_urls": section_urls,
    }
    return inv


def fetch_sections(arc: Archive, inv: dict, worker: int, workers: int):
    items = worker_slice(inv["section_urls"], worker, workers)
    ok = fail = 0
    for row in items:
        rec = grab(arc, row["source_url"])
        if rec.get("state") == "complete":
            ok += 1
        else:
            fail += 1
    return {"fetched_ok": ok, "fetched_fail": fail, "worker": worker, "workers": workers}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/oh")
    ap.add_argument("--phase", choices=("all", "inventory", "fetch"), default="all")
    ap.add_argument("--worker", type=int, default=0)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--min-interval", type=float, default=0.35)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=a.min_interval, user_agent="browser")
    inv_path = os.path.join(a.work, "inventory.json")
    if a.phase in ("all", "inventory"):
        inv = build_inventory(arc)
        json.dump(inv, open(inv_path, "w"), indent=2)
        print(json.dumps({"inventory": inv_path, "sections": inv["sections"]}))
    if a.phase in ("all", "fetch"):
        inv = json.load(open(inv_path, encoding="utf-8"))
        stats = fetch_sections(arc, inv, a.worker, a.workers)
        print(json.dumps(stats))


if __name__ == "__main__":
    main()
