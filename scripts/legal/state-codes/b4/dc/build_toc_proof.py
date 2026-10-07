#!/usr/bin/env python3
"""TOC proof: inventory section count vs staged packet (pre-land)."""
import json
import os
import sys


def build(work: str) -> dict:
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    toc_n = len(inv["sections"])
    staged = sum(1 for _ in open(os.path.join(work, "packet", "sections.jsonl"), encoding="utf-8"))
    proof = {
        "marker": "publisher index.json TOC section nodes (no # fragment)",
        "toc_sections": toc_n,
        "staged_sections": staged,
        "match": toc_n == staged,
    }
    out_dir = os.path.join(work, "staging-proof")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "toc-proof.json")
    json.dump(proof, open(out, "w"), indent=1)
    if toc_n != staged:
        raise SystemExit(f"TOC mismatch: inventory={toc_n} staged={staged}")
    return proof


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/dc"
    print(json.dumps(build(work)))
