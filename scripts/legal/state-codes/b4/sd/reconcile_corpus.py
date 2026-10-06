"""Compare corpus sd_statutes title-level snapshot with local inventory (no DB writes)."""
import argparse
import json
import os
import re


def count_corpus_rows(detail: dict) -> tuple[int, int]:
    chapters = 0
    section_rows = 0
    for block in detail.get("sections") or []:
        chapters += 1
        for row in block.get("rows") or []:
            section_rows += 1
    return chapters, section_rows


def expand_row_citation(cell: str) -> list[str]:
    """Return individual citations when possible; ranges stay as one pseudo-citation."""
    cell = (cell or "").strip()
    if not cell:
        return []
    if " to " in cell:
        return [cell]
    if "," in cell and re.match(r"[\d]", cell):
        return [c.strip() for c in cell.split(",")]
    return [cell]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="/tmp/sc4/sd/existing_sd_statutes.json")
    ap.add_argument("--inventory", default="/tmp/sc4/sd/inventory.json")
    ap.add_argument("--out", default="/tmp/sc4/sd/reconcile_corpus.json")
    a = ap.parse_args()
    corpus = json.load(open(a.corpus))
    inv = json.load(open(a.inventory)) if os.path.exists(a.inventory) else None
    by_title_inv = {}
    if inv:
        for s in inv.get("sections") or []:
            slug = s.get("title_slug") or str(s.get("title"))
            by_title_inv.setdefault(str(slug), []).append(s)
        ch_by_title = {}
        for c in inv.get("chapters") or []:
            slug = (c.get("statute") or "").split("-")[0] or str(c.get("title"))
            ch_by_title.setdefault(str(slug), []).append(c)

    rows = []
    for entry in corpus:
        title_num = None
        for fact in entry.get("detail", {}).get("facts") or []:
            if fact[0] == "Title number":
                title_num = str(fact[1]).strip()
                break
        if title_num is None:
            m = re.search(r"Title\s+([\dA-Z]+)", entry.get("title", ""), re.I)
            title_num = m.group(1) if m else None
        else:
            title_num = str(title_num)
        cells = entry.get("item", {}).get("cells", {})
        corp_ch = int(cells.get("chapters") or 0)
        corp_sec = int(cells.get("sections") or 0)
        ch_blocks, toc_rows = count_corpus_rows(entry.get("detail") or {})
        inv_secs = by_title_inv.get(title_num, []) if inv else []
        inv_ch = ch_by_title.get(title_num, []) if inv else []
        rows.append(
            {
                "title": title_num,
                "corpus_indexed_chapters": corp_ch,
                "corpus_indexed_sections": corp_sec,
                "corpus_toc_chapter_blocks": ch_blocks,
                "corpus_toc_table_rows": toc_rows,
                "corpus_has_section_body_text": False,
                "corpus_note": "2026-08-20 capture; title-level TOC only (sections[].rows are catchlines, not statute bodies)",
                "acquisition_chapters": len(inv_ch),
                "acquisition_sections_with_json": len(inv_secs),
                "acquisition_has_section_body_text": bool(inv_secs),
            }
        )
    summary = {
        "corpus_titles": len(rows),
        "acquisition_complete": inv is not None and not inv.get("failed"),
        "per_title": rows,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps({"titles": len(rows), "out": a.out}))


if __name__ == "__main__":
    main()
