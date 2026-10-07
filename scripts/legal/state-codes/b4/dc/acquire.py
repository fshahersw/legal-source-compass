#!/usr/bin/env python3
"""Acquire D.C. Code HTML from code.dccouncil.gov (direct HTTP only).

Walks the publisher index.json TOC, captures every section page and supporting TOC JSON.
Resumable via sc_common.Archive receipts under --work (default /tmp/sc4/dc).

Usage: python3 acquire.py [--work /tmp/sc4/dc] [--max-sections N]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from dc_lib import HOST, CODE_PREFIX  # noqa: E402

INDEX_JSON = HOST + CODE_PREFIX + "index.json"


def grab(arc: Archive, url: str, **kw):
    kw.setdefault("route", "direct")
    kw.setdefault("accept", "text/html,application/json,*/*")
    return arc.fetch(url, **kw)


def load_json(arc: Archive, url: str) -> dict:
    rec = grab(arc, url)
    if rec.get("state") != "complete":
        raise RuntimeError(f"fetch failed {url}: {rec}")
    return json.loads(decode_html(arc.read(rec))[0])


def walk_toc(arc: Archive, root: dict, toc_docs: dict, sections: list, outlines: dict):
    """Depth-first TOC walk; records section nodes (no # fragment) and outline parents."""

    def visit(node, parent_outline: str | None):
        if not isinstance(node, dict):
            return
        p = node.get("p")
        page = p.split("#", 1)[0] if p else None
        is_code = bool(
            p
            and page
            and (page == CODE_PREFIX.rstrip("/") or page.startswith(CODE_PREFIX))
        )
        child_parent = parent_outline
        if is_code and p and "#" not in p:
            outlines[p] = node.get("t") or ""
            if "/sections/" in p:
                sections.append(
                    {
                        "native_id": p,
                        "source_url": HOST + p,
                        "toc_title": node.get("t") or "",
                        "parent_outline": parent_outline,
                        "et": node.get("et"),
                    }
                )
            else:
                child_parent = p
        for child in node.get("c") or []:
            visit(child, child_parent)
        ref = node.get("j")
        if ref:
            if not ref.startswith("/"):
                ref = "/" + ref
            if ref not in toc_docs:
                toc_docs[ref] = load_json(arc, HOST + ref)
            visit(toc_docs[ref], parent_outline)

    visit(root, None)


def build_inventory(arc: Archive) -> dict:
    root = load_json(arc, INDEX_JSON)
    toc_docs = {CODE_PREFIX + "index.json": root}
    sections = []
    outlines = {}
    walk_toc(arc, root, toc_docs, sections, outlines)
    return {
        "schema": "dc-council-code/1",
        "source_root": HOST + CODE_PREFIX.rstrip("/"),
        "index_json_url": INDEX_JSON,
        "toc_json_documents": len(toc_docs),
        "toc_outline_nodes": len(outlines),
        "sections": sections,
    }


def fetch_sections(arc: Archive, inv: dict, inv_path: str, max_sections: int | None):
    n = 0
    for sec in inv["sections"]:
        if sec.get("receipt_sha256"):
            continue
        if max_sections is not None and n >= max_sections:
            break
        rec = grab(arc, sec["source_url"])
        n += 1
        if rec.get("state") != "complete":
            sec["fetch_failed"] = True
            sec["fetch_receipt"] = {k: rec.get(k) for k in ("http_status", "state", "route")}
            continue
        sec["receipt_sha256"] = rec["sha256"]
        if n % 500 == 0:
            print("sections", n, flush=True)
            json.dump(inv, open(inv_path, "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/dc")
    ap.add_argument("--max-sections", type=int, default=None)
    ap.add_argument("--inventory-only", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    arc = Archive(a.work, min_interval=1.0)
    inv_path = os.path.join(a.work, "inventory.json")
    if os.path.exists(inv_path):
        inv = json.load(open(inv_path, encoding="utf-8"))
    else:
        inv = build_inventory(arc)
        json.dump(inv, open(inv_path, "w"), indent=1)
        print("inventory sections", len(inv["sections"]), "toc_json_docs", inv["toc_json_documents"], flush=True)
    if a.inventory_only:
        return
    fetch_sections(arc, inv, inv_path, a.max_sections)
    json.dump(inv, open(inv_path, "w"), indent=1)
    ok = sum(1 for s in inv["sections"] if s.get("receipt_sha256"))
    fail = sum(1 for s in inv["sections"] if s.get("fetch_failed"))
    print(json.dumps({"toc_sections": len(inv["sections"]), "captured": ok, "failed": fail}, indent=1))


if __name__ == "__main__":
    main()
