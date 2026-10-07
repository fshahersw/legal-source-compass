#!/usr/bin/env python3
"""Re-fetch Vermont fullchapter pages and land corrected section text (projection off via land gates).

Usage:
  resync_chapters.py --work /tmp/vt-resync --chapters 12/143,24/035 [--execute]
  resync_chapters.py --work /tmp/vt-resync --all-from-corpus --batch-size 25 [--execute]

Re-lands every chapter listed (or all corpus units) with current parser spans and section keys.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sc_common as sc  # noqa: E402
from acquire import parse_chapter_toc  # noqa: E402
from parse import parse_fullchapter, parse_title_chapter_heads  # noqa: E402
from sc_common import Archive, collapse, decode_html  # noqa: E402

STATUTES = "https://legislature.vermont.gov/statutes/"
HERE = os.path.dirname(os.path.abspath(__file__))
LAND_CFG = os.path.join(HERE, "landing.json")
LAND_SCRIPT = os.path.join(HERE, "..", "..", "common", "land_publisher_code_v2.py")
TOC_SCRIPT = os.path.join(HERE, "build_toc_proof.py")
TITLE_LINK = re.compile(
    r'href="/statutes/title/([^"]+)"[^>]*>.*?<span class="dirty">\s*([^<]+?)\s*</span>',
    re.S | re.I,
)
FULLCHAPTER_PATH = re.compile(r"/fullchapter/([^/]+)/([^/?#]+)")


def unit_key(native_chapter_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._:-]+", "_", native_chapter_id)[:300]


def fullchapter_url(title_slug: str, chapter: str) -> str:
    return f"{STATUTES}fullchapter/{urllib.parse.quote(title_slug, safe='')}/{urllib.parse.quote(chapter, safe='')}"


def chapter_native_id(display_title: str, chapter: str) -> str:
    return f"{display_title}/{chapter}"


def corpus_client():
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
    key = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    return url, headers


def title_slug_map(arc: Archive) -> dict[str, str]:
    rec = arc.fetch(STATUTES, accept="text/html,*/*")
    if rec.get("state") != "complete":
        raise SystemExit("failed to fetch Vermont statutes landing for title slug map")
    html = decode_html(arc.read(rec))[0]
    out: dict[str, str] = {}
    for m in TITLE_LINK.finditer(html):
        slug, display = m.group(1), collapse(m.group(2))
        out[display] = slug
        out[slug] = slug
    return out


def outline_groups(path: list[dict]) -> list[dict]:
    url, headers = corpus_client()
    r = requests.post(
        f"{url}/rest/v1/rpc/corpus_publisher_code_projected_outline_v2",
        headers=headers,
        json={"p_jurisdiction": "VT", "p_path": path},
        timeout=180,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("available"):
        return []
    return data.get("groups") or []


def iter_corpus_chapters():
    for title in outline_groups([]):
        tnum = title["number"]
        path = [{"level": "title", "number": tnum}]
        for ch in outline_groups(path):
            yield tnum, ch["number"]


def chapter_toc_keys(arc: Archive, title_slug: str, chapter: str) -> list[str]:
    url = f"{STATUTES}chapter/{urllib.parse.quote(title_slug, safe='')}/{urllib.parse.quote(chapter, safe='')}"
    rec = arc.fetch(url, accept="text/html,*/*")
    if rec.get("state") != "complete":
        return []
    html = decode_html(arc.read(rec))[0]
    rows = [r for r in parse_chapter_toc(html) if r["chapter"] == chapter]
    if not rows:
        rows = parse_chapter_toc(html)
    return [r["section_key"] for r in rows if r["chapter"] == chapter]


def fetch_chapters(arc: Archive, chapters: list[tuple[str, str, str]]):
    for display_title, title_slug, chapter in chapters:
        chapter_toc_keys(arc, title_slug, chapter)
        url = fullchapter_url(title_slug, chapter)
        rec = arc.fetch(url, accept="text/html,*/*")
        if rec.get("state") != "complete":
            raise SystemExit(f"fetch failed {url}: {rec}")


def build_staged(work: str, arc: Archive, chapters: list[tuple[str, str, str]]):
    chapters_out, sections_out = [], []
    for display_title, title_slug, chapter in chapters:
        url = fullchapter_url(title_slug, chapter)
        rec = arc.index[url]
        html = decode_html(arc.read(rec))[0]
        tnum, _, cnum, _ = parse_title_chapter_heads(html)
        display_title = tnum or display_title
        toc_keys = chapter_toc_keys(arc, title_slug, chapter)
        parsed = parse_fullchapter(
            html,
            title=title_slug,
            chapter=chapter,
            source_url=url,
            receipt_sha=rec["sha256"],
            toc_keys=toc_keys or None,
        )
        if not parsed:
            raise SystemExit(f"no sections parsed for {display_title}/{chapter} ({url})")
        chapter_text = ""
        span_rows = []
        for i, s in enumerate(parsed):
            key = (toc_keys[i] if toc_keys and i < len(toc_keys) else None) or s.get("inventory_key") or s["number"]
            citation_path = f"{display_title}/{chapter}/{key}"
            if chapter_text:
                chapter_text += "\n\n"
            start = len(chapter_text)
            chapter_text += s["text"]
            end = len(chapter_text)
            span_rows.append((s, start, end, citation_path))
        nid = chapter_native_id(display_title, chapter)
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


def land_batch(work: str, execute: bool, attempt: int):
    subprocess.run(
        [sys.executable, os.path.join(HERE, "..", "to_landing.py"), "--work", work, "--config", LAND_CFG],
        check=True,
    )
    subprocess.run([sys.executable, TOC_SCRIPT, work], check=True)
    landing = os.path.join(work, "landing")
    cmd = [sys.executable, LAND_SCRIPT, landing]
    if execute:
        cmd += ["--execute", "--attempt", str(attempt)]
    subprocess.run(cmd, check=True)
    return landing


def parse_chapter_arg(part: str, slug_map: dict[str, str]) -> tuple[str, str, str]:
    title, chapter = part.strip().split("/", 1)
    slug = slug_map.get(title, title)
    return title, slug, chapter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/vt-resync")
    ap.add_argument("--chapters", help="comma-separated title/chapter ids, e.g. 12/143,24/035")
    ap.add_argument("--all-from-corpus", action="store_true", help="re-land every VT fullchapter unit in corpus order")
    ap.add_argument("--batch-size", type=int, default=25)
    ap.add_argument("--offset", type=int, default=0, help="skip first N corpus chapters (resume)")
    ap.add_argument("--limit", type=int, default=0, help="max corpus chapters after offset (0 = all)")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--attempt", type=int, default=1)
    ap.add_argument("--continue-on-error", action="store_true")
    a = ap.parse_args()
    if not a.chapters and not a.all_from_corpus:
        raise SystemExit("pass --chapters or --all-from-corpus")
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=1.0)
    slug_map = title_slug_map(arc)
    if a.all_from_corpus:
        all_ch = list(iter_corpus_chapters())
        if a.offset:
            all_ch = all_ch[a.offset :]
        if a.limit:
            all_ch = all_ch[: a.limit]
        batches = [all_ch[i : i + a.batch_size] for i in range(0, len(all_ch), a.batch_size)]
        failed = []
        landed = 0
        for bi, batch in enumerate(batches):
            triples = [(d, slug_map.get(d, d), c) for d, c in batch]
            batch_work = os.path.join(a.work, f"batch-{a.offset + bi:04d}")
            os.makedirs(batch_work, exist_ok=True)
            barc = Archive(batch_work, min_interval=1.0)
            try:
                fetch_chapters(barc, triples)
                build_staged(batch_work, barc, triples)
                land_batch(batch_work, a.execute, a.attempt)
                landed += len(triples)
                print(json.dumps({"batch": bi, "chapters": len(triples), "landed_total": landed}), flush=True)
            except SystemExit as exc:
                failed.append({"batch": bi, "chapters": [f"{d}/{c}" for d, c in batch], "error": str(exc)})
                if not a.continue_on_error:
                    raise
        print(json.dumps({"all_from_corpus": True, "landed": landed, "failed_batches": failed, "execute": a.execute}))
        return
    chapters = [parse_chapter_arg(part, slug_map) for part in a.chapters.split(",")]
    fetch_chapters(arc, chapters)
    build_staged(a.work, arc, chapters)
    landing = land_batch(a.work, a.execute, a.attempt)
    print(json.dumps({"chapters": len(chapters), "landing": landing, "execute": a.execute}))


if __name__ == "__main__":
    main()
