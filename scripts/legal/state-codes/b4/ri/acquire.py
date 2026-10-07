"""Acquire Rhode Island General Laws from webserver.rilegislature.gov/Statutes/ (verbatim HTML).

Fetches the statutes root, every title/chapter index, and every section page via sc_common.Archive.
Builds inventory.json (TOC hierarchy + section URLs). Resumable; >=1s between requests to the host.

Usage: python3 acquire.py [--work /tmp/sc4/ri] [--inventory-only]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, worker_slice  # noqa: E402

BASE = "https://webserver.rilegislature.gov/Statutes/"
TITLE_HREF = re.compile(r'href="(TITLE[^"]+/INDEX\.HTM)"', re.I)
CHAPTER_HREF = re.compile(r'<a\s+href="([^"]+/INDEX\.htm)"[^>]*>(.*?)</a>', re.S | re.I)
SECTION_HREF = re.compile(r'<a\s+href="([^"]+\.htm)"[^>]*>(.*?)</a>', re.S | re.I)
TITLE_HEAD = re.compile(r"<h1>\s*<center>\s*Title\s+([^<]+)<br\s*/?>\s*([^<]+)", re.S | re.I)
CH_HEAD = re.compile(r"<h2>\s*<center>\s*Chapter\s+([^<]+)<br\s*/?>\s*([^<]+)", re.S | re.I)


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec.get("http_status") in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, accept="text/html,*/*", **kw)
    return rec


def strip_tags(s):
    return collapse(re.sub(r"(?s)<[^>]+>", " ", s))


def parse_title_index(page, title_path):
    m = TITLE_HEAD.search(page)
    num = title_path.split("/")[0].replace("TITLE", "").replace("title", "")
    heading = strip_tags(m.group(2)) if m else None
    chapters = []
    for href, label in CHAPTER_HREF.findall(page):
        ch_key = href.split("/")[0]
        chapters.append(
            {
                "chapter_key": ch_key,
                "index_href": href,
                "toc_label": strip_tags(label),
            }
        )
    return {"title_key": num, "title_path": title_path, "heading": heading, "chapters": chapters}


def parse_chapter_index(page, chapter_key):
    m = CH_HEAD.search(page)
    ch_num = m.group(1).strip() if m else chapter_key.split("-", 1)[-1]
    heading = strip_tags(m.group(2)) if m else None
    sections = []
    for href, label in SECTION_HREF.findall(page):
        if "index" in href.lower():
            continue
        sections.append({"section_href": href, "toc_label": strip_tags(label)})
    return {"chapter_key": chapter_key, "chapter_number": ch_num, "heading": heading, "sections": sections}


def build_inventory(arc):
    root_rec = grab(arc, BASE)
    if root_rec["state"] != "complete":
        raise SystemExit("failed to fetch statutes root: " + str(root_rec))
    root_html = decode_html(arc.read(root_rec))[0]
    title_paths = sorted(set(TITLE_HREF.findall(root_html)), key=lambda x: x.upper())
    inv = {
        "source_root_url": BASE,
        "source_root_receipt_sha256": root_rec["sha256"],
        "titles": [],
        "section_urls": [],
    }
    for tp in title_paths:
        title_url = BASE + tp
        trec = grab(arc, title_url)
        if trec["state"] != "complete":
            print("FAILED title", tp, trec.get("http_status"), flush=True)
            continue
        tpage = decode_html(arc.read(trec))[0]
        title = parse_title_index(tpage, tp)
        title["index_url"] = title_url
        title["index_receipt_sha256"] = trec["sha256"]
        title_dir = tp.rsplit("/", 1)[0] + "/"
        for ch in title["chapters"]:
            ch_url = BASE + title_dir + ch["index_href"]
            crec = grab(arc, ch_url)
            if crec["state"] != "complete":
                print("FAILED chapter", ch_url, crec.get("http_status"), flush=True)
                ch["fetch_failed"] = True
                continue
            cpage = decode_html(arc.read(crec))[0]
            parsed = parse_chapter_index(cpage, ch["chapter_key"])
            ch.update(parsed)
            ch["index_url"] = ch_url
            ch["index_receipt_sha256"] = crec["sha256"]
            sec_base = ch_url.rsplit("/", 1)[0] + "/"
            for sec in ch["sections"]:
                su = sec_base + sec["section_href"]
                sec["section_url"] = su
                inv["section_urls"].append(su)
        inv["titles"].append(title)
        print("title", title["title_key"], "chapters", len(title["chapters"]), "sections", sum(len(c.get("sections", [])) for c in title["chapters"]), flush=True)
    inv["section_urls"] = list(dict.fromkeys(inv["section_urls"]))
    return inv


def fetch_sections(arc, inv):
    failed = []
    urls = inv["section_urls"]
    for i, u in enumerate(urls, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append({"url": u, "http_status": rec.get("http_status")})
        if i % 200 == 0:
            print(i, "/", len(urls), "failed", len(failed), flush=True)
    return failed


def fetch_sections_parallel(arc, inv, worker, workers):
    pending = [u for u in inv["section_urls"] if arc.index.get(u, {}).get("state") != "complete"]
    chunk = worker_slice(pending, worker, workers)
    failed = []
    print(f"ri worker {worker}/{workers} chunk {len(chunk)} of {len(pending)} pending", flush=True)
    for i, u in enumerate(chunk, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append({"url": u, "http_status": rec.get("http_status")})
        if i % 200 == 0:
            print(f"ri w{worker}", i, len(chunk), "failed", len(failed), flush=True)
    out = os.path.join(arc.work, f"acquire_failed_w{worker}.json")
    json.dump(failed, open(out, "w"), indent=1)
    print(f"ri w{worker} done chunk {len(chunk)} failed {len(failed)}", flush=True)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ri")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--fetch-parallel", action="store_true", help="fetch pending section URLs using --worker/--workers")
    ap.add_argument("--worker", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=1.0)
    inv_path = os.path.join(a.work, "inventory.json")
    if os.path.exists(inv_path):
        inv = json.load(open(inv_path))
        print("loaded inventory", len(inv["titles"]), "titles", len(inv["section_urls"]), "sections", flush=True)
    else:
        inv = build_inventory(arc)
        json.dump(inv, open(inv_path, "w"), indent=1)
        print("wrote inventory", inv_path, flush=True)
    if not a.inventory_only:
        if a.fetch_parallel:
            fetch_sections_parallel(arc, inv, a.worker, a.workers)
        else:
            failed = fetch_sections(arc, inv)
            json.dump(failed, open(os.path.join(a.work, "acquire_failed.json"), "w"), indent=1)
            print("section fetch done; failed", len(failed), flush=True)


if __name__ == "__main__":
    main()
