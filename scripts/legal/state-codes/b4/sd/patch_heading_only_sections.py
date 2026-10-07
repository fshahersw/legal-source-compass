"""Apply heading-only landing policy to the 20 publisher gaps (no operative body).

Sets each section span to the printed heading line and status_label to the printed heading text.
Rebuilds affected chapter text and span offsets.

Usage: python3 patch_heading_only_sections.py --work /tmp/sc4/sd
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import collapse, sha256_hex, utc_now, write_jsonl  # noqa: E402


def heading_only_citations(report_path: str) -> list[str]:
    rep = json.load(open(report_path))
    return sorted(
        {
            m["citation"]
            for m in rep.get("missing_body") or []
            if m.get("reason") == "empty body" and m.get("citation")
        }
    )


def section_number(hierarchy: list) -> str:
    return hierarchy[-1]["number"]


def printed_heading_line(number: str, heading: str | None) -> str:
    h = collapse(heading or "")
    if not h:
        raise ValueError(f"missing heading for {number}")
    return collapse(f"{number}. {h}")


def block_for_section(s: dict, old_texts: dict, targets: frozenset[str]) -> str:
    num = section_number(s["hierarchy"])
    if num in targets:
        return printed_heading_line(num, s.get("heading"))
    ch = old_texts[s["chapter_native_id"]]
    return ch[s["start"] : s["end"]]


def rebuild_chapter(ch_id: str, sections: list, old_texts: dict, targets: frozenset[str]) -> str:
    in_ch = sorted([s for s in sections if s["chapter_native_id"] == ch_id], key=lambda x: x["start"])
    blocks = [block_for_section(s, old_texts, targets) for s in in_ch]
    return "\n\n".join(blocks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--report", default=None)
    a = ap.parse_args()
    report = a.report or os.path.join(a.work, "REPORT.json")
    targets = frozenset(heading_only_citations(report))
    if len(targets) != 20:
        raise SystemExit(f"expected 20 heading-only citations, got {len(targets)}")
    pk = os.path.join(a.work, "packet")
    sections = [json.loads(line) for line in open(os.path.join(pk, "sections.jsonl"), encoding="utf-8")]
    chapters = [json.loads(line) for line in open(os.path.join(pk, "chapters.jsonl"), encoding="utf-8")]
    ch_by_id = {c["native_id"]: c for c in chapters}
    texts = {}
    old_texts = {}
    for c in chapters:
        body = open(os.path.join(pk, "chapter-text", c["text_sha256"] + ".txt"), encoding="utf-8").read()
        texts[c["native_id"]] = body
        old_texts[c["native_id"]] = body

    touched = {s["chapter_native_id"] for s in sections if section_number(s["hierarchy"]) in targets}
    patched = 0
    for s in sections:
        num = section_number(s["hierarchy"])
        if num not in targets:
            continue
        s["status_label"] = s.get("heading")
        patched += 1

    for ch_id in touched:
        new_text = rebuild_chapter(ch_id, sections, old_texts, targets)
        texts[ch_id] = new_text
        c = ch_by_id[ch_id]
        new_sha = sha256_hex(new_text)
        path = os.path.join(pk, "chapter-text", new_sha + ".txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        c["text_sha256"] = new_sha
        c["text_codepoints"] = len(new_text)

    for ch_id in touched:
        in_ch = sorted([s for s in sections if s["chapter_native_id"] == ch_id], key=lambda x: x["start"])
        blocks = [block_for_section(s, old_texts, targets) for s in in_ch]
        pos = 0
        for i, s in enumerate(in_ch):
            if i:
                pos += 2
            block = blocks[i]
            start = pos
            end = start + len(block)
            s["start"] = start
            s["end"] = end
            s["text_sha256"] = sha256_hex(block)
            pos = end

    if len(targets) != 20:
        raise SystemExit(f"expected 20 unique heading-only citations, got {len(targets)}")
    if patched < 20:
        raise SystemExit(f"patched {patched} section rows, expected at least 20")

    write_jsonl(os.path.join(pk, "sections.jsonl"), sections)
    write_jsonl(os.path.join(pk, "chapters.jsonl"), list(ch_by_id.values()))
    man_path = os.path.join(pk, "manifest.json")
    man = json.load(open(man_path))
    man["sections_sha256"] = sha256_hex("\n".join(json.dumps(r, sort_keys=True) for r in sections))
    man["chapters_sha256"] = sha256_hex("\n".join(json.dumps(r, sort_keys=True) for r in ch_by_id.values()))
    man["patched_heading_only_at"] = utc_now()
    man["patched_heading_only"] = sorted(targets)
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    # refresh REPORT missing_body for empty -> resolved via status
    rep_path = os.path.join(a.work, "REPORT.json")
    if os.path.exists(rep_path):
        rep = json.load(open(rep_path))
        rep["missing_body"] = [m for m in rep["missing_body"] if m.get("citation") not in targets or m.get("reason") != "empty body"]
        rep["heading_only_patched"] = sorted(targets)
        json.dump(rep, open(rep_path, "w"), indent=1)
    print(json.dumps({"patched": patched, "chapters_rewritten": len(touched)}))


if __name__ == "__main__":
    main()
