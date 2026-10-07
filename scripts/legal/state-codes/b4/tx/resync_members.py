#!/usr/bin/env python3
"""Re-parse and land specific Texas publisher ZIP members (e.g. after multi-occurrence gaps)."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import zipfile

import importlib.util

_TX_PARSE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tx-parse.py")
_spec = importlib.util.spec_from_file_location("tx_parse", _TX_PARSE)
tx_parse = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(tx_parse)

HERE = os.path.dirname(os.path.abspath(__file__))
LAND_CFG = os.path.join(HERE, "landing.json")
TO_LANDING = os.path.join(HERE, "to_landing.py")
LAND_SCRIPT = os.path.join(HERE, "..", "..", "common", "land_publisher_code_v2.py")
BUILD_TOC = os.path.join(HERE, "build_toc_proof.py")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--parsed", default="parsed-resync")
    ap.add_argument("--members", required=True, help="comma-separated publisher_member filenames, e.g. sd.9092.htm")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--attempt", type=int, default=1)
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    parsed_name = a.parsed
    target = os.path.join(root, parsed_name)
    if os.path.exists(target):
        raise SystemExit(f"refusing to overwrite existing parsed dir: {target}")
    os.makedirs(target)
    want = {m.strip() for m in a.members.split(",") if m.strip()}
    inventory = json.loads(open(os.path.join(root, "download-index.json"), encoding="utf-8"))["StatuteCode"]
    chapters, sections = [], []
    for code in inventory:
        receipt = json.loads(open(os.path.join(root, "receipts", code["code"] + ".json"), encoding="utf-8").read())
        archive_path = receipt["raw_file"]
        with zipfile.ZipFile(os.path.join(root, archive_path)) as zf:
            for member in zf.infolist():
                if member.filename not in want:
                    continue
                raw = zf.read(member)
                full_text, blocks, secs = tx_parse.parse_chapter(raw, code["code"], member.filename)
                text_path = os.path.join(target, f"{code['code']}_{member.filename}.txt")
                with open(text_path, "w", encoding="utf-8") as handle:
                    handle.write(full_text)
                ch_id = f"{code['code']}:{member.filename}"
                chapters.append(
                    {
                        "id": ch_id,
                        "code": code["code"],
                        "publisher_member": member.filename,
                        "text_file": os.path.relpath(text_path, root),
                        "text_sha256": tx_parse.sha(full_text.encode("utf-8")),
                        "raw_member_sha256": tx_parse.sha(raw),
                        "section_occurrences": len(secs),
                    }
                )
                for row in secs:
                    row["chapter_id"] = ch_id
                    sections.append(row)
    if not chapters:
        raise SystemExit(f"no members matched {sorted(want)}")
    with open(os.path.join(target, "chapters.jsonl"), "w", encoding="utf-8") as f:
        for row in chapters:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(os.path.join(target, "sections.jsonl"), "w", encoding="utf-8") as f:
        for row in sections:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, TO_LANDING, "--root", root, "--parsed", parsed_name, "--config", LAND_CFG], check=True)
    subprocess.run([sys.executable, BUILD_TOC, "--root", root, "--parsed", parsed_name], check=True)
    landing = os.path.join(root, parsed_name, "landing")
    cmd = [sys.executable, LAND_SCRIPT, landing]
    if a.execute:
        cmd += ["--execute", "--attempt", str(a.attempt)]
    subprocess.run(cmd, check=True)
    print(json.dumps({"members": sorted(want), "chapters": len(chapters), "sections": len(sections), "execute": a.execute}))


if __name__ == "__main__":
    main()
