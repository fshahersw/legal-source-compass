#!/usr/bin/env python3
"""Write landing/toc-proof.json: publisher section-heading markers per chapter unit."""
import argparse
import importlib.util
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from to_landing import unit_key  # noqa: E402


def load_parser():
    spec = importlib.util.spec_from_file_location("tx_parse", os.path.join(HERE, "..", "..", "tx-parse.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build(root: str, parsed_name: str, landing: str | None = None) -> dict:
    root = os.path.abspath(root)
    parsed = os.path.join(root, parsed_name)
    landing = landing or os.path.join(root, "landing")
    parser = load_parser()
    chapters = {json.loads(l)["id"]: json.loads(l) for l in open(os.path.join(parsed, "chapters.jsonl"), encoding="utf-8")}
    by_unit = {unit_key(cid): c for cid, c in chapters.items()}
    sec_by: dict[str, int] = {}
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        sec_by[row["unit_key"]] = sec_by.get(row["unit_key"], 0) + 1
    pages = []
    for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8"):
        u = json.loads(line)
        ch = by_unit.get(u["unit_key"])
        if not ch:
            raise SystemExit("unknown unit " + u["unit_key"])
        receipt = json.loads(open(os.path.join(root, "receipts", ch["code"] + ".json"), encoding="utf-8").read())
        with zipfile.ZipFile(os.path.join(root, receipt["raw_file"])) as zf:
            raw = zf.read(ch["publisher_member"])
        _, blocks, _ = parser.parse_chapter(raw, ch["code"], ch["publisher_member"])
        markers = sum(1 for b in blocks if b["kind"] == "section_heading")
        sections = sec_by.get(u["unit_key"], 0)
        pages.append({"url": u["source_url"], "unit_key": u["unit_key"], "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {u['source_url']}: markers={markers} sections={sections}")
    proof = {
        "marker": "publisher HTML section heading blocks (Sec./Art./SECTION) in official ZIP .htm members",
        "pages": sorted(pages, key=lambda p: p["unit_key"]),
        "unfetched_child_pages": [],
    }
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc4/tx")
    ap.add_argument("--parsed", default="parsed-v5-20261007")
    ap.add_argument("--landing", default=None)
    a = ap.parse_args()
    print(json.dumps(build(a.root, a.parsed, a.landing)))


if __name__ == "__main__":
    main()
