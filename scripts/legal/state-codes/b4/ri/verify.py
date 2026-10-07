"""Verify RI packet: receipts, spans, TOC coverage."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def verify(work):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    pkt = os.path.join(work, "packet")
    chapters = [json.loads(l) for l in open(os.path.join(pkt, "chapters.jsonl"))]
    sections = [json.loads(l) for l in open(os.path.join(pkt, "sections.jsonl"))]
    ch_text = {}
    for c in chapters:
        with open(os.path.join(pkt, "chapter-text", c["text_sha256"] + ".txt"), encoding="utf-8") as f:
            ch_text[c["native_id"]] = f.read()
    receipt_ok = 0
    receipt_fail = []
    for r in arc.index.values():
        if r.get("state") != "complete":
            continue
        try:
            arc.read(r)
            receipt_ok += 1
        except SystemExit as e:
            receipt_fail.append({"url": r["url"], "error": str(e)})
    span_fail = []
    for s in sections:
        t = ch_text[s["chapter_native_id"]]
        slice_ = t[s["start"] : s["end"]]
        if sha256_hex(slice_) != s["text_sha256"] or len(slice_) != s["end"] - s["start"]:
            span_fail.append(s["citation_path"])
    toc_sections = []
    for title in inv["titles"]:
        for ch in title["chapters"]:
            for sec in ch.get("sections") or []:
                toc_sections.append(sec["section_url"])
    fetched = {u for u, r in arc.index.items() if r.get("state") == "complete"}
    missing_body = [u for u in toc_sections if u not in fetched]
    parsed_by_ch = {}
    for s in sections:
        parsed_by_ch.setdefault(s["chapter_native_id"], 0)
        parsed_by_ch[s["chapter_native_id"]] += 1
    toc_by_ch = {}
    for title in inv["titles"]:
        for ch in title["chapters"]:
            toc_by_ch[ch["chapter_key"]] = len(ch.get("sections") or [])
    mismatches = []
    for ck, toc_n in toc_by_ch.items():
        got = parsed_by_ch.get(ck, 0)
        if toc_n != got:
            mismatches.append({"chapter": ck, "toc_sections": toc_n, "parsed_sections": got})
    routes = {"direct": 0, "firecrawl": 0}
    bytes_total = 0
    for r in arc.index.values():
        if r.get("state") == "complete":
            routes[r.get("route", "direct")] = routes.get(r.get("route", "direct"), 0) + 1
            bytes_total += r.get("bytes", 0)
    return {
        "receipts_verified": receipt_ok,
        "receipt_failures": receipt_fail,
        "span_failures": span_fail,
        "toc_section_urls": len(toc_sections),
        "missing_section_fetches": missing_body,
        "chapter_toc_mismatches": mismatches,
        "titles": len(inv["titles"]),
        "chapters_staged": len(chapters),
        "sections_staged": len(sections),
        "raw_objects_complete": receipt_ok,
        "raw_bytes": bytes_total,
        "routes": routes,
    }


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ri")
    a = ap.parse_args()
    rep = verify(a.work)
    out = os.path.join(a.work, "REPORT.json")
    json.dump(rep, open(out, "w"), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
