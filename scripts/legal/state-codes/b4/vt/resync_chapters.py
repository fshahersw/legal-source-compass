#!/usr/bin/env python3
"""Re-fetch Vermont fullchapter pages and land corrected section text (projection off via land gates).

Usage:
  resync_chapters.py --work /tmp/vt-resync --chapters 12/143,24/035 [--execute]

Finds corpus sections whose stored text is a strict prefix of freshly parsed text (truncation), or pass an explicit chapter list.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sc_common as sc  # noqa: E402
from acquire import parse_chapter_toc  # noqa: E402
from parse import parse_fullchapter  # noqa: E402
from sc_common import Archive, decode_html  # noqa: E402

STATUTES = "https://legislature.vermont.gov/statutes/"
HERE = os.path.dirname(os.path.abspath(__file__))
LAND_CFG = os.path.join(HERE, "landing.json")
LAND_SCRIPT = os.path.join(HERE, "..", "..", "common", "land_publisher_code_v2.py")
TOC_SCRIPT = os.path.join(HERE, "build_toc_proof.py")


def unit_key(native_chapter_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._:-]+", "_", native_chapter_id)[:300]


def fullchapter_url(title: str, chapter: str) -> str:
    return f"{STATUTES}fullchapter/{urllib.parse.quote(title, safe='')}/{urllib.parse.quote(chapter, safe='')}"


def chapter_native_id(title: str, chapter: str) -> str:
    return f"{title}/{chapter}"


def chapter_toc_keys(arc: Archive, title: str, chapter: str) -> list[str]:
    url = f"{STATUTES}chapter/{urllib.parse.quote(title, safe='')}/{urllib.parse.quote(chapter, safe='')}"
    rec = arc.fetch(url, accept="text/html,*/*")
    if rec.get("state") != "complete":
        return []
    html = decode_html(arc.read(rec))[0]
    rows = [r for r in parse_chapter_toc(html) if r["title"] == title and r["chapter"] == chapter]
    return [r["section_key"] for r in rows]


def fetch_chapters(arc: Archive, chapters: list[tuple[str, str]]):
    for title, chapter in chapters:
        chapter_toc_keys(arc, title, chapter)
        url = fullchapter_url(title, chapter)
        rec = arc.fetch(url, accept="text/html,*/*")
        if rec.get("state") != "complete":
            raise SystemExit(f"fetch failed {url}: {rec}")


def build_staged(work: str, arc: Archive, chapters: list[tuple[str, str]]):
    chapters_out, sections_out = [], []
    for title, chapter in chapters:
        url = fullchapter_url(title, chapter)
        rec = arc.index[url]
        html = decode_html(arc.read(rec))[0]
        toc_keys = chapter_toc_keys(arc, title, chapter)
        parsed = parse_fullchapter(
            html,
            title=title,
            chapter=chapter,
            source_url=url,
            receipt_sha=rec["sha256"],
            toc_keys=toc_keys or None,
        )
        if not parsed:
            raise SystemExit(f"no sections parsed for {title}/{chapter}")
        chapter_text = ""
        span_rows = []
        for i, s in enumerate(parsed):
            key = (toc_keys[i] if toc_keys and i < len(toc_keys) else None) or s.get("inventory_key") or s["number"]
            citation_path = f"{title}/{chapter}/{key}"
            if chapter_text:
                chapter_text += "\n\n"
            start = len(chapter_text)
            chapter_text += s["text"]
            end = len(chapter_text)
            span_rows.append((s, start, end, citation_path))
        nid = chapter_native_id(title, chapter)
        chapters_out.append(
            {
                "native_id": nid,
                "path": [
                    {"level": "title", "number": parsed[0]["title_num"], "heading": parsed[0]["title_heading"] or None},
                    {"level": "chapter", "number": parsed[0]["chapter_num"], "heading": parsed[0]["chapter_heading"] or None},
                ],
                "heading": parsed[0]["chapter_heading"] or parsed[0]["chapter_num"],
                "text": chapter_text,
                "raw_sha256s": [rec["sha256"]],
                "source_urls": [url],
                "sections_expected": len(parsed),
            }
        )
        for s, start, end, citation_path in span_rows:
            sections_out.append(
                {
                    "chapter_native_id": nid,
                    "state": "VT",
                    "citation_path": citation_path,
                    "citation": s["citation"],
                    "hierarchy": [
                        {"level": "title", "number": s["title_num"], "heading": s["title_heading"] or None},
                        {"level": "chapter", "number": s["chapter_num"], "heading": s["chapter_heading"] or None},
                        {"level": "section", "number": s["number"], "heading": s["heading"]},
                    ],
                    "number": s["number"],
                    "heading": s["heading"],
                    "start": start,
                    "end": end,
                    "history": s["history"],
                    "status_label": s["status_label"],
                    "edition": None,
                    "currency": s["currency"],
                    "effective": None,
                    "source_url": url,
                    "source_receipt_sha256": rec["sha256"],
                }
            )
    sc.write_packet(
        work,
        "VT",
        source={"publisher": "Vermont General Assembly", "base_url": STATUTES, "code": "V.S.A."},
        edition=None,
        chapters=chapters_out,
        sections=sections_out,
    )
    return chapters_out, sections_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/vt-resync")
    ap.add_argument("--chapters", help="comma-separated title/chapter ids, e.g. 12/143,24/035")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--attempt", type=int, default=1)
    a = ap.parse_args()
    if not a.chapters:
        raise SystemExit("--chapters required")
    chapters = []
    for part in a.chapters.split(","):
        title, chapter = part.strip().split("/", 1)
        chapters.append((title, chapter))
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=1.0)
    fetch_chapters(arc, chapters)
    build_staged(a.work, arc, chapters)
    subprocess.run(
        [sys.executable, os.path.join(HERE, "..", "to_landing.py"), "--work", a.work, "--config", LAND_CFG],
        check=True,
    )
    subprocess.run([sys.executable, TOC_SCRIPT, a.work], check=True)
    landing = os.path.join(a.work, "landing")
    cmd = [sys.executable, LAND_SCRIPT, landing]
    if a.execute:
        cmd += ["--execute", "--attempt", str(a.attempt)]
    subprocess.run(cmd, check=True)
    print(json.dumps({"chapters": len(chapters), "landing": landing, "execute": a.execute}))


if __name__ == "__main__":
    main()
