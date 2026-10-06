"""Acquire Alaska Statutes from akleg.gov BASIS (statutes.asp) verbatim.

Fetches the home page (edition/currency statements), builds a full TOC inventory
(title → chapter → section ids), then downloads one print HTML artifact per chapter
(media=print&secStart=…&secEnd=…).

Sequential, >=1s spacing (sc_common.Archive). Resumable.
Usage: python3 acquire.py [--work /tmp/sc4/ak] [--inventory-only] [--download-only]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

BASE = "https://www.akleg.gov/basis/statutes.asp"
CHAPTER_RE = re.compile(r"^\d{2}\.\d{2}$")
PART_RE = re.compile(r"^\d{2}\.\d{2}p\d+$", re.I)
SEC_HREF = re.compile(r'href=[^>]+#([\d.]+)\s*>Sec\.\s*([\d.]+)', re.I)
SEC_FALLBACK = re.compile(r"Sec\.\s*([\d.]+)")


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def toc_html(arc, title_param):
    rec = grab(arc, f"{BASE}?media=js&type=TOC&title={title_param}")
    if rec["state"] != "complete":
        raise RuntimeError(f"TOC failed title={title_param} status={rec['http_status']}")
    return decode_html(arc.read(rec))[0]


def parse_sections(ch_html):
    secs = []
    for m in SEC_HREF.finditer(ch_html):
        sid = m.group(2).rstrip(".")
        secs.append(sid)
    if not secs:
        for m in SEC_FALLBACK.finditer(ch_html):
            secs.append(m.group(1).rstrip("."))
    return list(dict.fromkeys(secs))


def child_tocs(html):
    return list(dict.fromkeys(re.findall(r'loadTOC\("([^"]+)"\)', html)))


def chapters_for_title(arc, title_num):
    html = toc_html(arc, title_num)
    kids = child_tocs(html)
    chapters = [k for k in kids if CHAPTER_RE.match(k)]
    if chapters:
        return chapters
    # Titles organized by part (e.g. Title 7): recurse parts → chapters
    out = []
    for p in [k for k in kids if PART_RE.match(k)]:
        ph = toc_html(arc, p)
        out.extend(k for k in child_tocs(ph) if CHAPTER_RE.match(k))
    return sorted(set(out))


def build_inventory(arc):
    home_rec = grab(arc, BASE)
    home = decode_html(arc.read(home_rec))[0]
    titles = sorted(set(int(x) for x in re.findall(r"loadTOC\(\s*(\d+)\s*\)", home)))
    edition_bits = []
    for pat in (
        r"<h3[^>]*id=['\"]maintitle['\"][^>]*>([^<]+)</h3>",
        r"id=['\"]maintitle['\"][^>]*>([^<]+)<",
        r"Alaska Statutes\s+\d{4}",
    ):
        m = re.search(pat, home, re.I)
        if m:
            edition_bits.append(m.group(1) if m.lastindex else m.group(0))
    legislature = re.search(r"(\d+th Legislature\s*\([^)]+\))", home, re.I)
    meta = {
        "home_url": BASE,
        "home_receipt_sha256": home_rec["sha256"],
        "edition_heading": edition_bits[0] if edition_bits else None,
        "legislature_line": legislature.group(1) if legislature else None,
        "title_count": len(titles),
    }
    chapters = []
    for t in titles:
        for ch in chapters_for_title(arc, t):
            ch_html = toc_html(arc, ch)
            secs = parse_sections(ch_html)
            chapters.append({"title": t, "chapter": ch, "sections": secs})
        print(f"title {t}: inventory", flush=True)
    inv = {"meta": meta, "titles": titles, "chapters": chapters}
    path = os.path.join(arc.work, "inventory.json")
    with open(path, "w") as f:
        json.dump(inv, f, indent=1)
    return inv


def download_chapters(arc, inv):
    failed = []
    for i, row in enumerate(inv["chapters"], 1):
        ch = row["chapter"]
        secs = row["sections"]
        if secs:
            url = f"{BASE}?media=print&secStart={secs[0]}&secEnd={secs[-1]}"
        else:
            # Official TOC lists "No Sections" (repealed/empty chapter stubs).
            url = f"{BASE}?media=print&secStart={ch}&secEnd={ch}"
        rel = f"chapter/{ch.replace('.', '_')}.html"
        rec = grab(arc, url, rel=rel)
        if rec["state"] != "complete":
            failed.append({"chapter": ch, "url": url, "http_status": rec["http_status"]})
        if i % 25 == 0:
            print(i, len(inv["chapters"]), "failed", len(failed), flush=True)
    with open(os.path.join(arc.work, "acquire_failed.json"), "w") as f:
        json.dump(failed, f, indent=1)
    print("download done; failed", len(failed), flush=True)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ak")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--download-only", action="store_true")
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    inv_path = os.path.join(a.work, "inventory.json")
    if a.download_only and os.path.exists(inv_path):
        inv = json.load(open(inv_path))
    else:
        inv = build_inventory(arc)
    if not a.inventory_only:
        download_chapters(arc, inv)


if __name__ == "__main__":
    main()
