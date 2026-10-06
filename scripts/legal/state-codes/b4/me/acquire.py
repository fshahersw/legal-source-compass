"""Acquire Maine Revised Statutes HTML from legislature.maine.gov (official).

Phases: inventory (homepage + title/chapter TOCs → inventory.json), fetch (all URLs in inventory via Archive).
Usage: python3 acquire.py [--work /tmp/sc4/me] [--phase all|inventory|fetch]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html, worker_slice  # noqa: E402

BASE = "https://legislature.maine.gov/statutes/"
HOME = BASE + "homepage.html"

TITLE_RE = re.compile(r'href="(\d+(?:-[A-Z])?)/title[^"]+ch0sec0\.html"', re.I)
CHAPTER_RE = re.compile(r'href="\./(title[^"]+ch[^"]+sec0\.html)"', re.I)
SECTION_RE = re.compile(r'href="\./(title[^"]+sec(?!0)[^"]*\.html)"', re.I)
CURRENCY_RE = re.compile(
    r'<div class="status">\s*<p>\s*(.*?)\s*</p>\s*</div>', re.S | re.I
)


def clean_href(h):
    return re.sub(r"\s+", "", h.replace("&#xA;", "").replace("\\", "/"))


def norm_ws(s):
    return re.sub(r"\s+", " ", html_mod.unescape(s or "")).strip()


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def page_text(arc, rec):
    return decode_html(arc.read(rec))[0]


def part_before(page, pos):
    before = page[:pos]
    parts = list(re.finditer(r'<h2 class="heading_part">(.*?)</h2>', before, re.S))
    return norm_ws(parts[-1].group(1)) if parts else None


def chapter_heading_from_title(page, ch_file):
    m = re.search(rf'<a href="\./{re.escape(ch_file)}">(.*?)</a>', page, re.S)
    return norm_ws(m.group(1)) if m else None


def build_inventory(arc):
    grab(arc, HOME)
    home = page_text(arc, arc.index[HOME])
    currency_blocks = [norm_ws(m.group(1)) for m in CURRENCY_RE.finditer(home) if norm_ws(m.group(1))]

    titles = []
    for m in TITLE_RE.finditer(home):
        slug = m.group(1)
        titles.append({"slug": slug, "title_url": f"{BASE}{slug}/title{slug}ch0sec0.html"})
    titles = list({t["slug"]: t for t in titles}.values())
    titles.sort(key=lambda x: (len(x["slug"]), x["slug"]))

    chapters = []
    for t in titles:
        slug = t["slug"]
        turl = t["title_url"]
        rec = grab(arc, turl)
        if rec["state"] != "complete":
            t["fetch_error"] = rec.get("http_status")
            continue
        tpage = page_text(arc, rec)
        tm = re.search(r'<div class="title_heading">\s*<div>(.*?)</div>', tpage, re.S)
        t["heading"] = norm_ws(tm.group(1)) if tm else None
        for ch_m in CHAPTER_RE.finditer(tpage):
            ch_file = clean_href(ch_m.group(1))
            ch_url = f"{BASE}{slug}/{ch_file}"
            ch_heading = chapter_heading_from_title(tpage, ch_file)
            chapters.append(
                {
                    "slug": slug,
                    "title_heading": t.get("heading"),
                    "part_heading": part_before(tpage, ch_m.start()),
                    "chapter_file": ch_file,
                    "chapter_url": ch_url,
                    "chapter_heading": ch_heading,
                    "repealed_in_heading": "REPEALED" in (ch_heading or "").upper(),
                }
            )

    sections = []
    for ch in chapters:
        rec = grab(arc, ch["chapter_url"])
        if rec["state"] != "complete":
            ch["fetch_error"] = rec.get("http_status")
            continue
        cpage = page_text(arc, rec)
        ch_m = re.search(r'<div class="ch_heading">\s*<div>(.*?)</div>', cpage, re.S)
        if ch_m:
            ch["chapter_heading"] = norm_ws(ch_m.group(1))
        sec_links = []
        for sm in SECTION_RE.finditer(cpage):
            sec_file = clean_href(sm.group(1))
            sec_url = f"{BASE}{ch['slug']}/{sec_file}"
            label_m = re.search(rf'<a href="\./{re.escape(sec_file)}">(.*?)</a>', cpage, re.S)
            sec_links.append(
                {
                    "file": sec_file,
                    "url": sec_url,
                    "toc_label": norm_ws(label_m.group(1)) if label_m else None,
                }
            )
        ch["sections"] = sec_links
        for s in sec_links:
            sections.append({**ch, **s})

    inv = {
        "source": HOME,
        "currency_blocks": currency_blocks,
        "titles": titles,
        "chapters": chapters,
        "section_count": len(sections),
        "chapter_count": len(chapters),
        "title_count": len(titles),
    }
    path = os.path.join(arc.work, "inventory.json")
    with open(path, "w") as f:
        json.dump(inv, f, indent=1)
    with open(os.path.join(arc.work, "section_urls.jsonl"), "w") as f:
        for s in sections:
            f.write(json.dumps({"url": s["url"], "chapter_url": s["chapter_url"]}) + "\n")
    return inv


def all_fetch_urls(work):
    inv_path = os.path.join(work, "inventory.json")
    inv = json.load(open(inv_path))
    urls = {HOME}
    for t in inv["titles"]:
        urls.add(t["title_url"])
    for ch in inv["chapters"]:
        urls.add(ch["chapter_url"])
        for s in ch.get("sections") or []:
            urls.add(s["url"])
    return sorted(urls)


def fetch_all(arc):
    inv_path = os.path.join(arc.work, "inventory.json")
    if not os.path.exists(inv_path):
        raise SystemExit("run inventory first")
    urls = all_fetch_urls(arc.work)
    failed = []
    for i, u in enumerate(urls, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append({"url": u, "http_status": rec.get("http_status"), "route": rec.get("route")})
        if i % 100 == 0:
            print(i, len(urls), len(failed), flush=True)
    out = os.path.join(arc.work, "acquire_failed.json")
    json.dump(failed, open(out, "w"), indent=1)
    print("fetch done", len(urls), "failed", len(failed), flush=True)


def fetch_parallel(arc, worker, workers):
    pending = [u for u in all_fetch_urls(arc.work) if arc.index.get(u, {}).get("state") != "complete"]
    chunk = worker_slice(pending, worker, workers)
    failed = []
    print(f"me worker {worker}/{workers} chunk {len(chunk)} of {len(pending)} pending", flush=True)
    for i, u in enumerate(chunk, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append({"url": u, "http_status": rec.get("http_status"), "route": rec.get("route")})
        if i % 100 == 0:
            print(f"me w{worker}", i, len(chunk), len(failed), flush=True)
    out = os.path.join(arc.work, f"acquire_failed_w{worker}.json")
    json.dump(failed, open(out, "w"), indent=1)
    print(f"me w{worker} done chunk {len(chunk)} failed {len(failed)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/me")
    ap.add_argument("--phase", default="all", choices=("all", "inventory", "fetch", "fetch-parallel"))
    ap.add_argument("--worker", type=int, default=0, help="parallel fetch worker index (0 .. workers-1)")
    ap.add_argument("--workers", type=int, default=4, help="parallel fetch worker count")
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    if a.phase in ("all", "inventory"):
        inv = build_inventory(arc)
        print(
            "inventory",
            inv["title_count"],
            inv["chapter_count"],
            inv["section_count"],
            flush=True,
        )
    if a.phase == "fetch":
        fetch_all(arc)
    elif a.phase == "fetch-parallel":
        fetch_parallel(arc, a.worker, a.workers)
    elif a.phase == "all":
        fetch_all(arc)


if __name__ == "__main__":
    main()
