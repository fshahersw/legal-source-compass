#!/usr/bin/env python3
"""Build the shared landing packet (+ toc-proof.json) for the New York Consolidated Laws from capture.py's receipts.

The table of contents is the publisher's own: the CONSOLIDATED index, then every entry each law / container page prints
(`li.nys-openleg-result-item-container`). Every SECTION or RULE entry is a section; its page is one unit (the Firecrawl
rawHtml original plus a UTF-8 text derivative holding exactly the `.nys-openleg-result-text` block, `<br>` kept as a
newline). toc-proof.json compares, on every container page, the leaf entries it prints with the sections that landed
under it, and on every section page the text blocks it prints with the one section parsed from it. A printed entry
that was not captured is listed in unfetched_child_pages; a section page whose text is empty is a gap, never a row.
A section whose whole printed text is a status line (Repealed, Renumbered, ...) keeps that line as text and status_note.

    build_packet.py [--root /tmp/sc/NY] [--reviewer NAME]  ->  ROOT/landing/{manifest.json,objects.jsonl,units.jsonl,
                                                               sections.jsonl,toc-proof.json,gaps.json,inventory.json}
"""
import argparse
import collections
import datetime
import hashlib
import json
import pathlib
import re
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from common.provenance_fetch import Fetcher  # noqa: E402
from parse import INDEX, LEAF_TYPES, parse_page, split_url  # noqa: E402

SECTION_PATH = r"^[A-Z][A-Z0-9]{1,6}/[A-Z0-9][A-Za-z0-9.*-]*$"
URL_PATTERNS = [r"^https://www\.nysenate\.gov/legislation/laws/CONSOLIDATED$",
                r"^https://www\.nysenate\.gov/legislation/laws/[A-Z][A-Z0-9]{1,6}(/[A-Za-z0-9][A-Za-z0-9.*-]*)?$"]
STATUS = re.compile(r"^(?:(?:§+|Section\.?)\s*[\w.*-]+\.?\s*)?[\[(]?(?:Repealed|Renumbered|Transferred|Expired|Omitted|Reserved|"
                    r"Deemed repealed|Unconstitutional|Blank)(?=\s*(?:[\])\.,;:]|$)|\s+(?:by|and|eff|pursuant|as|to|L\.|ch\.)\b)", re.I)


def level_name(word):
    return re.sub(r"[^a-z]+", "_", word.lower()).strip("_")


def usable(r):
    return (r.get("ok") and r.get("retrieval_method") == "proxied:firecrawl" and r.get("status") == 200
            and r.get("source_status") == 200)


def parse_receipt(job):
    root, r = job
    return parse_page((pathlib.Path(root) / r["stored_path"]).read_bytes().decode("utf8", "replace"), r["url"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/NY")
    ap.add_argument("--reviewer", default="NY capture worker (bc-a45fef0c)")
    a = ap.parse_args()
    root = pathlib.Path(a.root)
    out = root / "landing"
    (out / "text").mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher("NY", root, min_interval=0)
    pages, receipts = {}, {}
    candidates = [r for r in fetcher.receipts() if usable(r)]
    with ProcessPoolExecutor() as ex:
        for r, page in zip(candidates, ex.map(parse_receipt, [(str(root), r) for r in candidates], chunksize=64)):
            if r["url"] not in pages and page["statute_page"] and not page["not_found"]:
                pages[r["url"]], receipts[r["url"]] = page, r
    law_names = {}
    parent, order, seen, frontier = {}, [], {INDEX}, [INDEX]
    while frontier:
        nxt = []
        for url in frontier:
            order.append(url)
            page = pages.get(url)
            if not page:
                continue
            for child, label, _word in page["toc"]:
                if url == INDEX:
                    law_names[split_url(child)[0]] = label.split(" ", 1)[1] if " " in label else label
                if child not in seen:
                    seen.add(child)
                    parent[child] = url
                    nxt.append(child)
        frontier = nxt
    unfetched = sorted(u for u in seen if u not in pages)

    def chain(url):
        up = []
        while url in parent and parent[url] != INDEX:
            url = parent[url]
            up.append(url)
        return list(reversed(up))

    levels = ["law"]
    sections, units, gaps, objects, proof_pages = [], [], [], {}, []
    leaf_entries = {}
    status_rows = 0
    types = collections.Counter()

    def add_object(sha, size, kind, path, src):
        o = objects.setdefault(sha, {"sha256": sha, "bytes": size, "kind": kind, "path": str(path), "sources": []})
        if src not in o["sources"]:
            o["sources"].append(src)

    for url in order:
        page = pages.get(url)
        if not page or url == INDEX:
            continue
        for child, label, word in page["toc"]:
            if word in LEAF_TYPES:
                leaf_entries.setdefault(child, label)
    landed = set()
    for url in order:
        page = pages.get(url)
        if not page or not page["leaf"]:
            continue
        r = receipts[url]
        law, node = split_url(url)
        path = "%s/%s" % (law, node)
        text = page["text"]
        types[page["type"]] += 1
        if not text.strip():
            gaps.append({"citation_path": path, "url": url, "reason": "section page prints no text"})
            continue
        if not re.match(SECTION_PATH, path):
            gaps.append({"citation_path": path, "url": url, "reason": "citation path outside the manifest regex"})
            continue
        if not page["currency_statement"]:
            gaps.append({"citation_path": path, "url": url, "reason": "no revision statement"})
            continue
        currency = {"basis": "publisher_statement", "statement": page["currency_statement"],
                    "through_date": page["revision_date"], "edition": None}
        deriv = text.encode("utf-8")
        tsha = hashlib.sha256(deriv).hexdigest()
        tpath = out / "text" / (tsha + ".txt")
        if not tpath.exists():
            tpath.write_bytes(deriv)
        src = {"source_url": url, "retrieved_at": r["retrieved_at"], "http_status": 200,
               "retrieval_method": "proxied_fetch", "proxy": "firecrawl"}
        add_object(r["sha256"], r["bytes"], "publisher_original", root / r["stored_path"], src)
        add_object(tsha, len(deriv), "unit_text_derivative", tpath, src)
        hier = [{"level": "law", "number": law, "heading": law_names.get(law)}]
        for anc in chain(url):
            if split_url(anc)[1] is None:
                continue
            container = pages[anc]
            lvl = level_name(container["type"] or "division")
            if lvl not in levels:
                levels.append(lvl)
            hier.append({"level": lvl, "number": container["number"], "heading": container["heading"]})
        hier.append({"level": "section", "number": page["number"], "heading": page["heading"]})
        status_note = text if STATUS.match(text) and len(text) <= 300 else None
        status_rows += status_note is not None
        mark = "Rule" if page["type"] == "RULE" else "§"
        units.append({"unit_key": path, "unit_kind": "section_page", "heading": page["heading"], "original_sha256": r["sha256"],
                      "publisher_member": None, "raw_member_sha256": None, "text_sha256": tsha, "text_code_points": len(text),
                      "sections_expected": 1, "currency": currency, "source_url": url, "retrieved_at": r["retrieved_at"],
                      "retrieval_method": "proxied_fetch", "proxy": "firecrawl"})
        sections.append({"unit_key": path, "citation_path": path,
                         "citation": "N.Y. %s %s %s" % (law_names.get(law) or law, mark, page["number"]),
                         "heading": page["heading"], "text": text, "hierarchy": hier, "history": None, "status_note": status_note,
                         "span": {"unit": "unicode_code_points", "start": 0, "end": len(text)}, "currency": currency})
        proof_pages.append({"url": url, "markers": page["text_blocks"], "sections": 1})
        landed.add(url)
    gap_urls = {g["url"] for g in gaps}
    for url in order:
        page = pages.get(url)
        if not page or page["leaf"]:
            continue
        r = receipts[url]
        add_object(r["sha256"], r["bytes"], "publisher_original", root / r["stored_path"],
                   {"source_url": url, "retrieved_at": r["retrieved_at"], "http_status": 200,
                    "retrieval_method": "proxied_fetch", "proxy": "firecrawl"})
        printed = [c for c, _l, w in page["toc"] if w in LEAF_TYPES]
        proof_pages.append({"url": url, "markers": len(printed), "sections": sum(1 for c in printed if c in landed),
                            "printed_entries": len(page["toc"])})
    levels.append("section")
    duplicates = [p for p, n in collections.Counter(s["citation_path"] for s in sections).items() if n > 1]
    manifest = {"schema_version": "publisher-code-manifest/2", "jurisdiction": "NY",
                "publisher": "New York State Senate (OpenLegislation, nysenate.gov)",
                "publisher_url": INDEX, "source_system": "ny-consolidated-laws", "code_title": "New York Consolidated Laws",
                "parser": {"name": "ny-openleg-html", "version": "2"},
                "retrieval": {"methods": ["proxied_fetch"], "source_url_patterns": URL_PATTERNS,
                              "terms_gate": False, "official_source": True, "rate_limit_ms": 100},
                "structure": {"levels": levels, "unit": "one nysenate.gov section or rule page"},
                "section_id": {"scheme": "official_citation_path", "regex": SECTION_PATH, "example": "EDN/2-A",
                               "citation_format": "N.Y. <law> § <section> (Rule <rule> for CPLR rules)"},
                "currency": {"basis": "publisher_statement",
                             "location": "each section page prints 'Viewing most recent revision (from YYYY-MM-DD)'"},
                "review": {"reviewed_by": a.reviewer, "reviewed_at": datetime.date.today().isoformat()}}
    proof = {"marker": "publisher table of contents: SECTION/RULE entries (li.nys-openleg-result-item-container) printed on "
                       "each law/container page, and .nys-openleg-result-text blocks on each section page",
             "pages": proof_pages, "unfetched_child_pages": unfetched, "empty_text_pages": sorted(gap_urls)}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    for name, rows in (("objects.jsonl", sorted(objects.values(), key=lambda x: x["sha256"])), ("units.jsonl", units),
                       ("sections.jsonl", sections)):
        with open(out / name, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    (out / "toc-proof.json").write_text(json.dumps(proof))
    (out / "gaps.json").write_text(json.dumps(gaps, indent=1))
    per_law = collections.Counter(s["citation_path"].split("/", 1)[0] for s in sections)
    toc_per_law = collections.Counter(split_url(u)[0] for u in leaf_entries)
    inventory = {"laws": len(law_names), "printed_leaf_entries": len(leaf_entries), "parsed_sections": len(sections),
                 "per_law": {law: {"name": law_names[law], "toc_entries": toc_per_law.get(law, 0), "parsed": per_law.get(law, 0)}
                             for law in sorted(law_names)}}
    (out / "inventory.json").write_text(json.dumps(inventory, indent=1))
    mism = [p for p in proof_pages if p["markers"] != p["sections"]]
    print(json.dumps({"laws": len(law_names), "printed_entries": len(seen) - 1, "captured_pages": len(pages),
                      "toc_leaf_entries": len(leaf_entries), "sections": len(sections), "units": len(units), "objects": len(objects),
                      "status_only": status_rows, "gaps": len(gaps), "unfetched": len(unfetched), "duplicates": len(duplicates),
                      "toc_pages": len(proof_pages), "toc_mismatch": len(mism), "first_mismatch": mism[:3], "leaf_types": types,
                      "levels": levels}, default=str))


if __name__ == "__main__":
    main()
