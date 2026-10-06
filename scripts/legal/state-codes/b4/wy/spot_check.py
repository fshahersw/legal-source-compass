"""Compare staged section text to a fresh pdftotext parse for spot checks."""
import argparse
import json
import os
import sys

_WY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_WY, ".."))
sys.path.insert(0, _WY)
from sc_common import Archive, sha256_hex  # noqa: E402

from titles import pdf_url  # noqa: E402
from wy_parse import parse_title_text, pdf_to_text  # noqa: E402

PICKS = [
    ("01", "1-1-123"),
    ("06", "6-2-511"),
    ("09", "9-1-202"),
    ("14", "14-2-907"),
    ("17", "17-16-122"),
    ("21", "21-4-315"),
    ("26", "26-13-304"),
    ("32", "32-3-101"),
    ("34.1", "34.1-1-101"),
    ("97", "97-1-1"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wy")
    a = ap.parse_args()
    arc = Archive(a.work)
    pkt = os.path.join(a.work, "packet")
    chapters = {}
    for line in open(os.path.join(pkt, "chapters.jsonl")):
        r = json.loads(line)
        with open(os.path.join(pkt, "chapter-text", r["text_sha256"] + ".txt"), encoding="utf-8") as f:
            chapters[r["native_id"]] = f.read()
    staged_by = {}
    for line in open(os.path.join(pkt, "sections.jsonl")):
        s = json.loads(line)
        staged_by.setdefault(s["citation_path"], s)
    results = []
    for title_key, cite in PICKS:
        url = pdf_url(title_key)
        rec = arc.index[url]
        pdf_text = pdf_to_text(os.path.join(a.work, rec["file"]))
        _, _, paths = parse_title_text(
            pdf_text,
            title_key=title_key,
            title_label="",
            source_url=url,
            receipt_sha=rec["sha256"],
        )
        # rebuild section texts in doc order
        _, secs, _ = parse_title_text(
            pdf_text,
            title_key=title_key,
            title_label="",
            source_url=url,
            receipt_sha=rec["sha256"],
        )
        reparsed = {s["citation_path"]: s for s in secs}
        st = staged_by.get(cite)
        if not st or cite not in reparsed:
            results.append({"title": title_key, "citation_path": cite, "error": "missing"})
            continue
        ch = chapters[st["chapter_native_id"]]
        staged = ch[st["start"] : st["end"]]
        # reparsed does not expose raw text; re-parse via chapter slice
        rep = reparsed[cite]
        rep_frag = chapters[rep["chapter_native_id"]][rep["start"] : rep["end"]]
        results.append(
            {
                "title": title_key,
                "citation_path": cite,
                "staged_sha256": sha256_hex(staged),
                "reparsed_sha256": sha256_hex(rep_frag),
                "match": sha256_hex(staged) == sha256_hex(rep_frag),
                "codepoints": len(staged),
                "preview": staged[:120].replace("\n", " "),
            }
        )
    path = os.path.join(a.work, "spot_checks.json")
    json.dump(results, open(path, "w"), indent=2)
    print(json.dumps({"checked": len(results), "match": sum(1 for r in results if r.get("match"))}))


if __name__ == "__main__":
    main()
