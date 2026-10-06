"""Acquire Montana Code Annotated HTML from mca.legmt.gov (official).

Phases: inventory (TOC crawl → inventory.json), fetch (every section + index page via Archive).
Usage: python3 acquire.py [--work /tmp/sc4/mt] [--phase all|inventory|fetch]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

BASE = "https://mca.legmt.gov/bills/mca/"
HOME = BASE + "index.html"
HELP = BASE + "help.html"

TITLE_LINK_RE = re.compile(r'href="\./(title_\d+/chapters_index\.html)"', re.I)
SUBUNIT_LINK_RE = re.compile(
    r'href="\./((?:chapter|article)_\w+/parts_index\.html)"', re.I
)
PART_LINK_RE = re.compile(r'href="\./(part_\d+/sections_index\.html)"', re.I)
SECTION_LINK_RE = re.compile(r'href="\./(section_\d+/[^"]+\.html)"', re.I)
RESERVED_RE = re.compile(r'<span[^>]*class="[^"]*reserved[^"]*"[^>]*>(.*?)</span>', re.S | re.I)
CITATION_IN_TOC_RE = re.compile(r'<span class="citation">([^<]+)</span>', re.I)
EDITION_RE = re.compile(
    r"<h1>\s*Montana Code Annotated\s+(\d{4})\s*</h1>\s*<p><strong>(.*?)</strong></p>",
    re.S | re.I,
)


def norm_ws(s):
    return re.sub(r"\s+", " ", html_mod.unescape(s or "")).strip()


def grab(arc, url, **kw):
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get(
        "FIRECRAWL_API_KEY"
    ):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def page_text(arc, rec):
    return decode_html(arc.read(rec))[0]


def join_path(*parts):
    return "/".join(p.strip("/") for p in parts if p)


def parse_edition_from_index(html):
    m = EDITION_RE.search(html)
    if not m:
        return {"edition_year": None, "currency_statement": None}
    return {"edition_year": m.group(1), "currency_statement": norm_ws(m.group(2))}


def build_inventory(arc):
    grab(arc, HOME)
    grab(arc, HELP)
    home = page_text(arc, arc.index[HOME])
    edition = parse_edition_from_index(home)

    titles = []
    for m in TITLE_LINK_RE.finditer(home):
        rel = m.group(1)
        title_dir = rel.split("/")[0]
        titles.append({"title_dir": title_dir, "chapters_index_url": BASE + rel})

    reserved_titles = [norm_ws(m.group(1)) for m in RESERVED_RE.finditer(home)]

    inventory = {
        "source_base": BASE,
        "edition": edition,
        "reserved_on_index": reserved_titles,
        "titles": [],
        "parts": [],
        "sections": [],
        "toc_pages": [],
    }

    for ti, t in enumerate(titles, 1):
        title_dir = t["title_dir"]
        if ti % 5 == 0:
            print(f"inventory title {ti}/{len(titles)} sections {len(inventory['sections'])}", flush=True)
        rec = grab(arc, t["chapters_index_url"])
        toc_url = t["chapters_index_url"]
        inventory["toc_pages"].append(toc_url)
        title_entry = {
            "title_dir": title_dir,
            "chapters_index_url": toc_url,
            "reserved": [],
            "subunits": [],
        }
        if rec["state"] != "complete":
            title_entry["fetch_error"] = rec.get("http_status")
            inventory["titles"].append(title_entry)
            continue
        ch_html = page_text(arc, rec)
        title_entry["reserved"] = [norm_ws(x) for x in RESERVED_RE.findall(ch_html)]
        for sm in SUBUNIT_LINK_RE.finditer(ch_html):
            sub_rel = sm.group(1)
            sub_url = BASE + join_path(title_dir, sub_rel)
            sub_rec = grab(arc, sub_url)
            inventory["toc_pages"].append(sub_url)
            sub_dir = sub_rel.split("/")[0]
            sub_entry = {
                "title_dir": title_dir,
                "subunit_dir": sub_dir,
                "parts_index_url": sub_url,
                "reserved": [],
                "parts": [],
            }
            if sub_rec["state"] != "complete":
                sub_entry["fetch_error"] = sub_rec.get("http_status")
                title_entry["subunits"].append(sub_entry)
                continue
            p_html = page_text(arc, sub_rec)
            sub_entry["reserved"] = [norm_ws(x) for x in RESERVED_RE.findall(p_html)]
            for pm in PART_LINK_RE.finditer(p_html):
                part_rel = pm.group(1)
                part_url = BASE + join_path(title_dir, sub_dir, part_rel)
                part_rec = grab(arc, part_url)
                inventory["toc_pages"].append(part_url)
                part_dir = part_rel.split("/")[0]
                part_entry = {
                    "title_dir": title_dir,
                    "subunit_dir": sub_dir,
                    "part_dir": part_dir,
                    "sections_index_url": part_url,
                    "native_id": join_path(title_dir, sub_dir, part_dir),
                    "reserved": [],
                    "sections": [],
                }
                if part_rec["state"] != "complete":
                    part_entry["fetch_error"] = part_rec.get("http_status")
                    sub_entry["parts"].append(part_entry)
                    inventory["parts"].append(part_entry)
                    continue
                s_html = page_text(arc, part_rec)
                part_entry["reserved"] = [norm_ws(x) for x in RESERVED_RE.findall(s_html)]
                for sec_m in SECTION_LINK_RE.finditer(s_html):
                    sec_rel = sec_m.group(1)
                    sec_url = BASE + join_path(title_dir, sub_dir, part_dir, sec_rel)
                    label_m = re.search(
                        rf'href="\./{re.escape(sec_rel)}"[^>]*>(.*?)</a>',
                        s_html,
                        re.S | re.I,
                    )
                    toc_label = norm_ws(re.sub(r"<[^>]+>", " ", label_m.group(1))) if label_m else None
                    cit_m = CITATION_IN_TOC_RE.search(label_m.group(1) if label_m else "")
                    citation = cit_m.group(1).strip() if cit_m else None
                    sec_row = {
                        "native_id": part_entry["native_id"],
                        "url": sec_url,
                        "citation_toc": citation,
                        "toc_label": toc_label,
                    }
                    part_entry["sections"].append(sec_row)
                    inventory["sections"].append(sec_row)
                sub_entry["parts"].append(part_entry)
                inventory["parts"].append(part_entry)
            title_entry["subunits"].append(sub_entry)
        inventory["titles"].append(title_entry)

    path = os.path.join(arc.work, "inventory.json")
    with open(path, "w") as f:
        json.dump(inventory, f, indent=1)
    print(
        json.dumps(
            {
                "titles": len(inventory["titles"]),
                "parts": len(inventory["parts"]),
                "sections": len(inventory["sections"]),
                "toc_pages": len(inventory["toc_pages"]),
                "edition": edition,
            },
            indent=1,
        ),
        flush=True,
    )
    return inventory


def fetch_sections(arc, inventory=None):
    inv_path = os.path.join(arc.work, "inventory.json")
    if inventory is None:
        inventory = json.load(open(inv_path))
    urls = []
    seen = set()
    for u in inventory.get("toc_pages", []):
        if u not in seen:
            seen.add(u)
            urls.append(u)
    for s in inventory["sections"]:
        if s["url"] not in seen:
            seen.add(s["url"])
            urls.append(s["url"])
    failed = []
    for i, u in enumerate(urls, 1):
        rec = grab(arc, u)
        if rec["state"] != "complete":
            failed.append({"url": u, "http_status": rec.get("http_status")})
        if i % 100 == 0:
            print(i, len(urls), len(failed), flush=True)
    out = os.path.join(arc.work, "acquire_failed.json")
    with open(out, "w") as f:
        json.dump(failed, f, indent=1)
    print("fetch done", len(urls), "failed", len(failed), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/mt")
    ap.add_argument("--phase", default="all", choices=("all", "inventory", "fetch"))
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    if a.phase in ("all", "inventory"):
        build_inventory(arc)
    if a.phase in ("all", "fetch"):
        fetch_sections(arc)


if __name__ == "__main__":
    main()
