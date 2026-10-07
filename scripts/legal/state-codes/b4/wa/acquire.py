#!/usr/bin/env python3
"""Acquire Washington RCW from the official 2026 archive (direct HTTP only).

Flow: leg.wa.gov archive index → title .htm → chapter index .htm → Complete Chapter .pdf.
Writes inventory.json and resumable receipts under --work (default /tmp/sc4/wa).

Usage: python3 acquire.py [--work /tmp/sc4/wa] [--max-titles N] [--max-chapters N]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from wa_html import (  # noqa: E402
    ARCHIVE_INDEX,
    ARCHIVE_YEAR,
    parse_archive_index,
    parse_chapter_index,
    parse_title_page,
)


def grab(arc: Archive, url: str, **kw):
    kw.setdefault("accept", "text/html,application/pdf,*/*")
    kw.setdefault("route", "direct")
    return arc.fetch(url, **kw)


def load_inventory(work: str) -> dict | None:
    p = os.path.join(work, "inventory.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return None


def save_inventory(work: str, inv: dict):
    tmp = os.path.join(work, "inventory.json.tmp")
    json.dump(inv, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, os.path.join(work, "inventory.json"))


def build_inventory(arc: Archive, max_titles: int | None) -> dict:
    rec = grab(arc, ARCHIVE_INDEX)
    if rec.get("state") != "complete":
        raise SystemExit(f"archive index fetch failed: {rec}")
    html = decode_html(arc.read(rec))[0]
    title_rows = parse_archive_index(html)
    if max_titles:
        title_rows = title_rows[:max_titles]
    inv = {
        "schema": "wa-rcw-archive/1",
        "edition": f"{ARCHIVE_YEAR} RCW Archive (official publication on lawfilesext.leg.wa.gov)",
        "archive_index_url": ARCHIVE_INDEX,
        "archive_index_receipt_sha256": rec["sha256"],
        "titles": [],
        "gates": {"title25_row_collision": False, "chapters_without_pdf": [], "fetch_failures": []},
    }
    for row in title_rows:
        trec = grab(arc, row["title_url"])
        if trec.get("state") != "complete":
            inv["gates"]["fetch_failures"].append({"kind": "title", "url": row["title_url"], "receipt": trec})
            continue
        tpage = decode_html(arc.read(trec))[0]
        try:
            parsed = parse_title_page(tpage)
        except ValueError as e:
            inv["gates"]["fetch_failures"].append({"kind": "title_parse", "url": row["title_url"], "error": str(e)})
            continue
        identity_ok = parsed["native_title_id"] == row["row_label"].upper()
        if row["row_label"].upper() == "25" and not identity_ok:
            inv["gates"]["title25_row_collision"] = True
        title = {
            "row_label": row["row_label"],
            "title_url": row["title_url"],
            "native_title_id": parsed["native_title_id"],
            "title_heading": parsed["title_heading"],
            "row_native_match": identity_ok,
            "title_receipt_sha256": trec["sha256"],
            "chapters": [],
        }
        for ch in parsed["chapters"]:
            title["chapters"].append(
                {
                    "chapter_id": ch.get("chapter_id") or ch.get("href_chapter_id"),
                    "chapter_url": ch["chapter_url"],
                    "description": ch.get("description"),
                    "chapter_identity_ok": ch.get("identity_ok"),
                }
            )
        inv["titles"].append(title)
        print("title", row["row_label"], "chapters", len(title["chapters"]), "native", parsed["native_title_id"], flush=True)
    return inv


def enrich_chapters(arc: Archive, inv: dict, max_chapters: int | None):
    n = 0
    for title in inv["titles"]:
        for ch in title["chapters"]:
            if ch.get("chapter_index_receipt_sha256"):
                continue
            if max_chapters is not None and n >= max_chapters:
                return
            crec = grab(arc, ch["chapter_url"])
            n += 1
            if crec.get("state") != "complete":
                ch["fetch_failed"] = True
                inv["gates"]["fetch_failures"].append({"kind": "chapter", "url": ch["chapter_url"], "receipt": crec})
                continue
            ch["chapter_index_receipt_sha256"] = crec["sha256"]
            chtml = decode_html(arc.read(crec))[0]
            try:
                parsed = parse_chapter_index(chtml)
            except ValueError as e:
                ch["parse_failed"] = str(e)
                inv["gates"]["fetch_failures"].append({"kind": "chapter_parse", "url": ch["chapter_url"], "error": str(e)})
                continue
            ch.update(parsed)
            if n % 25 == 0:
                print("chapters", n, flush=True)


def fetch_pdfs(arc: Archive, inv: dict, max_pdfs: int | None):
    n = 0
    for title in inv["titles"]:
        for ch in title["chapters"]:
            url = ch.get("complete_chapter_pdf_url")
            if not url:
                continue
            if ch.get("chapter_pdf_receipt_sha256"):
                continue
            if max_pdfs is not None and n >= max_pdfs:
                return
            prec = grab(arc, url, accept="application/pdf,*/*")
            n += 1
            if prec.get("state") != "complete":
                ch["pdf_fetch_failed"] = True
                inv["gates"]["chapters_without_pdf"].append(ch.get("chapter_id"))
                inv["gates"]["fetch_failures"].append({"kind": "chapter_pdf", "url": url, "receipt": prec})
                continue
            ch["chapter_pdf_receipt_sha256"] = prec["sha256"]
            ch["chapter_pdf_url"] = url
            if n % 25 == 0:
                print("pdfs", n, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wa")
    ap.add_argument("--max-titles", type=int, default=None)
    ap.add_argument("--max-chapters", type=int, default=None)
    ap.add_argument("--max-pdfs", type=int, default=None)
    ap.add_argument("--inventory-only", action="store_true", help="Stop after title pages (no chapter HTML/PDF)")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=1.0)
    inv = load_inventory(a.work)
    if not inv:
        inv = build_inventory(arc, a.max_titles)
        save_inventory(a.work, inv)
    if a.inventory_only:
        print(json.dumps({"titles": len(inv["titles"]), "path": os.path.join(a.work, "inventory.json")}))
        return
    enrich_chapters(arc, inv, a.max_chapters)
    save_inventory(a.work, inv)
    fetch_pdfs(arc, inv, a.max_pdfs)
    save_inventory(a.work, inv)
    ch_count = sum(len(t["chapters"]) for t in inv["titles"])
    sec_count = sum(len(ch.get("sections_toc") or []) for t in inv["titles"] for ch in t["chapters"])
    pdf_ok = sum(1 for t in inv["titles"] for ch in t["chapters"] if ch.get("chapter_pdf_receipt_sha256"))
    print(
        json.dumps(
            {
                "titles": len(inv["titles"]),
                "chapters": ch_count,
                "toc_sections": sec_count,
                "chapter_pdfs": pdf_ok,
                "title25_row_collision": inv["gates"]["title25_row_collision"],
                "fetch_failures": len(inv["gates"]["fetch_failures"]),
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
