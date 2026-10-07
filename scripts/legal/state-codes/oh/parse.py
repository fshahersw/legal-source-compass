#!/usr/bin/env python3
"""Parse archived Ohio Revised Code section HTML into a staging packet."""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "b4"))
from sc_common import Archive, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

PARSER = "ohio-codes-html/1"
SECTION_URL_RE = re.compile(r"https://codes\.ohio\.gov/ohio-revised-code/section-([\d.]+)$", re.I)
HEADER_RE = re.compile(
    r'<section class="laws-header laws-section-header">\s*<h1>(.*?)</h1>',
    re.S | re.I,
)
BODY_RE = re.compile(r'<section class="laws-body">(.*?)</section>', re.S | re.I)
BREADCRUMB_RE = re.compile(
    r'<div class="breadcrumbs-node">\s*<a href="([^"]+)">([^<]+)</a>\s*</div>',
    re.S | re.I,
)
EFFECTIVE_RE = re.compile(
    r'<div class="label">Effective:</div>\s*<div class="value">([^<]+)</div>',
    re.S | re.I,
)


def collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def parse_heading(h1_inner: str) -> tuple[str, str | None]:
    text = collapse_ws(html_text(h1_inner))
    m = re.match(r"Section\s+([\d.]+)\s*\|\s*(.+)$", text, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    m = re.match(r"Section\s+([\d.]+)\s*(.*)$", text, re.I)
    return m.group(1).strip(), collapse_ws(m.group(2)) or None


def hierarchy_from_breadcrumbs(html: str) -> list:
    nodes = BREADCRUMB_RE.findall(html)
    out = []
    for href, label in nodes[1:]:
        label = collapse_ws(html_text(label))
        if href.endswith("/ohio-revised-code"):
            continue
        if "/title-" in href:
            out.append({"level": "title", "number": None, "heading": label})
        elif "/chapter-" in href:
            out.append({"level": "chapter", "number": None, "heading": label})
    return out


def body_text(body_html: str) -> str:
    body_html = re.sub(r'<div class="laws-notice">.*', "", body_html, flags=re.S | re.I)
    return collapse_ws(html_text(body_html))


def parse_work(work: str, parsed_name: str) -> dict:
    work = os.path.abspath(work)
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    arc = Archive(work)
    parsed_dir = os.path.join(work, parsed_name)
    os.makedirs(parsed_dir, exist_ok=True)
    sections = []
    failures = []
    cite_global: dict[str, int] = {}

    for row in inv["section_urls"]:
        url = row["source_url"]
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            failures.append({"source_url": url, "reason": "not_captured"})
            continue
        raw = arc.read(rec)
        html, _ = decode_html(raw)
        m = SECTION_URL_RE.match(url)
        if not m:
            failures.append({"source_url": url, "reason": "bad_url"})
            continue
        sec_num = m.group(1)
        h1 = HEADER_RE.search(html)
        if not h1:
            failures.append({"source_url": url, "reason": "no_header"})
            continue
        parsed_num, heading = parse_heading(h1.group(1))
        if parsed_num != sec_num and parsed_num.replace(".", "") != sec_num.replace(".", ""):
            failures.append({"source_url": url, "reason": "section_number_mismatch", "parsed": parsed_num})
            continue
        body_m = BODY_RE.search(html)
        if not body_m:
            failures.append({"source_url": url, "reason": "no_body"})
            continue
        text = body_text(body_m.group(1))
        if not text.strip():
            failures.append({"source_url": url, "reason": "empty_body"})
            continue
        base = sec_num
        cite_global[base] = cite_global.get(base, 0) + 1
        occ = cite_global[base]
        citation_path = base if occ == 1 else f"{base}~{occ}"
        eff = EFFECTIVE_RE.search(html)
        hierarchy = hierarchy_from_breadcrumbs(html)
        hierarchy.append({"level": "section", "number": citation_path.split("~", 1)[0], "heading": heading})
        sections.append(
            {
                "id": url,
                "section_number": sec_num,
                "citation_path": citation_path,
                "citation": f"ORC § {sec_num}",
                "heading": heading,
                "text": text,
                "text_sha256": sha256_hex(text),
                "effective_label": collapse_ws(eff.group(1)) if eff else None,
                "hierarchy": hierarchy,
                "source_url": url,
                "receipt_sha256": rec["sha256"],
            }
        )

    with open(os.path.join(parsed_dir, "sections.jsonl"), "wb") as handle:
        for s in sections:
            handle.write((json.dumps(s, ensure_ascii=False, separators=(",", ":")) + "\n").encode())

    summary = {
        "schema_version": "ohio-revised-code-parse-summary/1",
        "parser": {"name": PARSER, "version": "1"},
        "inventory_sections": inv["sections"],
        "sections_parsed": len(sections),
        "parse_failures": len(failures),
        "unique_citation_paths": len({s["citation_path"] for s in sections}),
    }
    json.dump(summary, open(os.path.join(parsed_dir, "summary.json"), "w"), indent=2)
    if failures:
        with open(os.path.join(parsed_dir, "parse-failures.jsonl"), "w", encoding="utf-8") as handle:
            for f in failures:
                handle.write(json.dumps(f) + "\n")
    print(json.dumps(summary, indent=2))
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/oh")
    ap.add_argument("--parsed", default="parsed-20261007")
    a = ap.parse_args()
    summary = parse_work(a.work, a.parsed)
    sys.exit(1 if summary.get("parse_failures") else 0)


if __name__ == "__main__":
    main()
