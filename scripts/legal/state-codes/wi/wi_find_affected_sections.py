#!/usr/bin/env python3
"""List Wisconsin sections whose parsed text grows under wi_parse v3 (live .txt vs corpus lengths)."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wi_parse  # noqa: E402

BASE = wi_parse.BASE
CHAPTER_RE = re.compile(r"^([0-9]+[A-Za-z]*)\. ")


def chapter_ids() -> list[str]:
    text = urllib.request.urlopen(BASE + "/statutes/prefaces/toc.txt", timeout=120).read().decode("utf-8")
    return [CHAPTER_RE.match(line).group(1) for line in text.splitlines() if CHAPTER_RE.match(line)]


def parse_chapter(chapter: str, content: str) -> dict[str, dict]:
    txt_toc = wi_parse.inventory_from_txt_toc_region(content, chapter)
    try:
        html = urllib.request.urlopen(f"{BASE}/statutes/statutes/{chapter}", timeout=120).read()
        from bs4 import BeautifulSoup

        html_toc, _ = wi_parse.chapter_toc(BeautifulSoup(html, "lxml"))
        toc = (
            wi_parse.merge_toc_sections(html_toc, txt_toc)
            if len(txt_toc) > len(html_toc)
            else html_toc
        )
    except OSError:
        toc = txt_toc
    rows, _, _ = wi_parse.parse_chapter_text(
        content,
        chapter,
        {"heading": chapter, "subject": None},
        toc,
        [],
        "scan",
        {"statement": "", "as_of": None},
        {"url": f"{BASE}/statutes/statutes/{chapter}.txt", "sha256": "scan"},
    )
    return {row["citation"]: row for row in rows}


def scan_chapter(chapter: str, corpus_lens: dict[str, int]) -> list[dict]:
    url = f"{BASE}/statutes/statutes/{chapter}.txt"
    content = urllib.request.urlopen(url, timeout=180).read().decode("utf-8")
    parsed = parse_chapter(chapter, content)
    out = []
    for cite, row in parsed.items():
        old_len = corpus_lens.get(cite)
        new_len = len(row.get("text") or "")
        if old_len is None:
            continue
        if new_len > old_len or (row.get("effective") and new_len >= old_len):
            if new_len > old_len:
                out.append(
                    {
                        "citation": cite,
                        "chapter": chapter,
                        "old_len": old_len,
                        "new_len": new_len,
                        "delta": new_len - old_len,
                        "has_effective": bool(row.get("effective")),
                    }
                )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus-lens", required=True, help="JSON list of {citation_path, text_len}")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="/tmp/wi-affected-sections.json")
    a = ap.parse_args()
    corpus_lens = {row["citation_path"]: int(row["text_len"]) for row in json.load(open(a.corpus_lens, encoding="utf-8"))}
    chapters = chapter_ids()
    affected: list[dict] = []
    with ThreadPoolExecutor(a.workers) as pool:
        futures = {pool.submit(scan_chapter, ch, corpus_lens): ch for ch in chapters}
        for fut in as_completed(futures):
            try:
                affected.extend(fut.result())
            except Exception as exc:  # noqa: BLE001
                print(futures[fut], exc, file=sys.stderr)
    affected.sort(key=lambda row: (-row["delta"], row["citation"]))
    payload = {
        "parser_version": wi_parse.PARSER_VERSION,
        "sections_changed": len(affected),
        "chapters_touched": len({row["chapter"] for row in affected}),
        "rows": affected,
    }
    with open(a.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    print(json.dumps({k: payload[k] for k in ("sections_changed", "chapters_touched", "out") if k != "out"} | {"out": a.out}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
