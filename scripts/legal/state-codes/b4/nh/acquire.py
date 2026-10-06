"""Acquire New Hampshire RSA HTML verbatim: TOC, per-title TOC, per-chapter TOC, merged chapter bodies.

Sequential >=1s (sc_common.Archive). Resumable. Usage: python3 acquire.py [--work /tmp/sc4/nh] [--phase all|meta|titles|chapters|mrg]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from nh_lib import (  # noqa: E402
    BASE,
    CHAPTER_TOC,
    TITLE_TOC,
    abs_url,
    grab,
    mrg_path_from_chapter_toc_html,
)


def load_list(work, name):
    p = os.path.join(work, name)
    return json.load(open(p)) if os.path.exists(p) else None


def save_list(work, name, rows):
    tmp = os.path.join(work, name + ".tmp")
    json.dump(rows, open(tmp, "w"), indent=0)
    os.replace(tmp, os.path.join(work, name))


def phase_meta(arc):
    for path in ("robots.txt", "NHTOC.htm"):
        grab(arc, BASE + path, accept_status=(200, 404) if path == "robots.txt" else (200,))


def phase_titles(arc, work):
    rec = arc.index.get(BASE + "NHTOC.htm")
    if not rec or rec.get("state") != "complete":
        phase_meta(arc)
        rec = arc.index[BASE + "NHTOC.htm"]
    html = decode_html(arc.read(rec))[0]
    titles = sorted(set(TITLE_TOC.findall(html)))
    save_list(work, "title_toc_paths.json", titles)
    failed = []
    for i, rel in enumerate(titles, 1):
        url = BASE + rel
        r = grab(arc, url)
        if r.get("state") != "complete":
            failed.append({"url": url, "status": r.get("http_status")})
        if i % 10 == 0:
            print("titles", i, len(titles), "failed", len(failed), flush=True)
    save_list(work, "acquire_title_failed.json", failed)
    return titles


def phase_chapters(arc, work):
    titles = load_list(work, "title_toc_paths.json")
    if not titles:
        titles = phase_titles(arc, work)
    chapter_paths = load_list(work, "chapter_toc_paths.json")
    if chapter_paths is None:
        chapter_paths = []
        seen = set()
        for tl in titles:
            url = BASE + tl
            rec = arc.index.get(url)
            if not rec or rec.get("state") != "complete":
                rec = grab(arc, url)
            if rec.get("state") != "complete":
                continue
            html = decode_html(arc.read(rec))[0]
            for cl in CHAPTER_TOC.findall(html):
                p = cl if cl.startswith("NHTOC/") else "NHTOC/" + cl
                if p not in seen:
                    seen.add(p)
                    chapter_paths.append(p)
        chapter_paths.sort()
        save_list(work, "chapter_toc_paths.json", chapter_paths)
    failed = load_list(work, "acquire_chapter_failed.json") or []
    failed_urls = {x["url"] for x in failed}
    for i, rel in enumerate(chapter_paths, 1):
        url = BASE + rel
        if url in arc.index and arc.index[url].get("state") == "complete":
            continue
        r = grab(arc, url)
        if r.get("state") != "complete" and url not in failed_urls:
            failed.append({"url": url, "status": r.get("http_status")})
            failed_urls.add(url)
        if i % 100 == 0:
            print("chapter toc", i, len(chapter_paths), "failed", len(failed), flush=True)
    save_list(work, "acquire_chapter_failed.json", failed)
    return chapter_paths


def phase_mrg(arc, work):
    chapter_paths = load_list(work, "chapter_toc_paths.json")
    if not chapter_paths:
        chapter_paths = phase_chapters(arc, work)
    mrg_paths = load_list(work, "mrg_paths.json")
    if mrg_paths is None:
        mrg_paths = []
        missing = []
        for rel in chapter_paths:
            url = BASE + rel
            rec = arc.index.get(url)
            if not rec or rec.get("state") != "complete":
                continue
            html = decode_html(arc.read(rec))[0]
            mp = mrg_path_from_chapter_toc_html(html)
            if mp:
                mrg_paths.append(mp)
            else:
                missing.append(rel)
        mrg_paths = sorted(set(mrg_paths))
        save_list(work, "mrg_paths.json", mrg_paths)
        save_list(work, "chapters_without_mrg.json", missing)
    failed = load_list(work, "acquire_mrg_failed.json") or []
    failed_urls = {x["url"] for x in failed}
    for i, path in enumerate(mrg_paths, 1):
        url = BASE + path
        if url in arc.index and arc.index[url].get("state") == "complete":
            continue
        r = grab(arc, url)
        if r.get("state") != "complete" and url not in failed_urls:
            failed.append({"url": url, "status": r.get("http_status")})
            failed_urls.add(url)
        if i % 100 == 0:
            print("mrg", i, len(mrg_paths), "failed", len(failed), flush=True)
    save_list(work, "acquire_mrg_failed.json", failed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nh")
    ap.add_argument("--phase", default="all", choices=("all", "meta", "titles", "chapters", "mrg"))
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    if a.phase in ("all", "meta"):
        phase_meta(arc)
    if a.phase in ("all", "titles"):
        phase_titles(arc, a.work)
    if a.phase in ("all", "chapters"):
        phase_chapters(arc, a.work)
    if a.phase in ("all", "mrg"):
        phase_mrg(arc, a.work)
    print("acquire done", a.phase, flush=True)


if __name__ == "__main__":
    main()
