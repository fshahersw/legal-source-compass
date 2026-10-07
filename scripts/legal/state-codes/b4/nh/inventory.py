"""Build section inventory from archived chapter TOC pages (no network)."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from nh_lib import BASE, SECTION_LINE, chapter_key_from_mrg_path, mrg_path_from_chapter_toc_html  # noqa: E402


def build_inventory(work):
    arc = Archive(work)
    chapter_paths = json.load(open(os.path.join(work, "chapter_toc_paths.json")))
    mrg_by_chapter = {}
    if os.path.exists(os.path.join(work, "mrg_paths.json")):
        for mp in json.load(open(os.path.join(work, "mrg_paths.json"))):
            mrg_by_chapter[chapter_key_from_mrg_path(mp)] = BASE + mp

    rows = []
    chapters = []
    for rel in chapter_paths:
        url = BASE + rel
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            chapters.append({"chapter_toc": rel, "state": "missing_toc"})
            continue
        html = decode_html(arc.read(rec))[0]
        mp = mrg_path_from_chapter_toc_html(html)
        ck = chapter_key_from_mrg_path(mp) if mp else None
        m = re.search(r"CHAPTER\s+([^:<]+):\s*(.+)", html, re.I)
        ch_num = ch_heading = None
        if m:
            ch_num = m.group(1).strip()
            ch_heading = m.group(2).strip()
        title_m = re.search(r"<h2>\s*([^<]+)</h2>", html, re.I)
        sec_count = 0
        for cit, rest in SECTION_LINE.findall(html):
            sec_count += 1
            heading = re.sub(r"\s+", " ", rest).strip()
            rows.append(
                {
                    "chapter_key": ck,
                    "chapter_toc_url": url,
                    "chapter_number": ch_num,
                    "chapter_heading": ch_heading,
                    "citation_path": cit,
                    "heading": heading,
                    "mrg_url": mrg_by_chapter.get(ck),
                }
            )
        chapters.append(
            {
                "chapter_toc": rel,
                "chapter_key": ck,
                "mrg_path": mp,
                "toc_section_count": sec_count,
                "state": "ok" if mp else "no_mrg_link",
            }
        )
    out = os.path.join(work, "inventory.jsonl")
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    json.dump(
        {
            "sections": len(rows),
            "chapters": len(chapters),
            "chapters_missing_mrg_link": sum(1 for c in chapters if c.get("state") == "no_mrg_link"),
        },
        open(os.path.join(work, "inventory_summary.json"), "w"),
        indent=1,
    )
    return rows, chapters


if __name__ == "__main__":
    build_inventory(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nh")
