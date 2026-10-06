"""Build official sub-page inventory from acquired chapter HTML (BFS for nested levels)."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from de_site import (  # noqa: E402
    BASE,
    CHAPTER_INDEX_RE,
    UNIT_URL_RE,
    child_page_urls,
    is_chapter_index,
    section_head_count,
)


def discover(arc):
    chapter_urls = sorted(
        u
        for u, r in arc.index.items()
        if CHAPTER_INDEX_RE.match(u) and r.get("state") == "complete"
    )
    chapter_indexes = []
    chapter_content = []
    all_sub = set()
    for url in chapter_urls:
        html = decode_html(arc.read(arc.index[url]))[0]
        m = CHAPTER_INDEX_RE.match(url)
        t, c = m.group(1), m.group(2)
        kids = child_page_urls(html, t, c)
        heads = section_head_count(html)
        row = {"url": url, "title": t, "chapter_slug": c, "section_heads": heads, "child_urls": kids}
        if kids and heads == 0:
            chapter_indexes.append(row)
            all_sub.update(kids)
        else:
            chapter_content.append(row)

    def deeper_children(html, parent_url):
        meta = UNIT_URL_RE.match(parent_url)
        if not meta:
            return []
        t, c = meta.group(1), meta.group(2)
        depth = parent_url.count("/")
        out = []
        for u in child_page_urls(html, t, c):
            if u != parent_url and u.count("/") > depth:
                out.append(u)
        return out

    queue = sorted(all_sub)
    discovered = set(queue)
    nested = []
    while queue:
        url = queue.pop(0)
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            continue
        html = decode_html(arc.read(rec))[0]
        for u in deeper_children(html, url):
            if u not in discovered:
                discovered.add(u)
                queue.append(u)
                nested.append({"parent": url, "child": u})

    inv = {
        "base": BASE,
        "chapter_pages": len(chapter_urls),
        "chapter_index_only": len(chapter_indexes),
        "chapter_with_inline_sections": len(chapter_content),
        "subpage_urls": sorted(discovered),
        "subpage_count": len(discovered),
        "nested_discoveries": nested,
        "chapter_indexes": chapter_indexes,
        "chapter_content": chapter_content,
    }
    return inv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    a = ap.parse_args()
    arc = Archive(a.work)
    inv = discover(arc)
    path = os.path.join(a.work, "url_inventory.json")
    json.dump(inv, open(path, "w"), indent=1)
    print(json.dumps({k: inv[k] for k in ("chapter_pages", "chapter_index_only", "subpage_count", "nested_discoveries")}, indent=1))


if __name__ == "__main__":
    main()
