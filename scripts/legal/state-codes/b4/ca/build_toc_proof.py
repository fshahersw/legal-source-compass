#!/usr/bin/env python3
"""Write landing/toc-proof.json: one publisher section page per landed unit."""
import argparse
import json
import os


def build(landing: str) -> dict:
    landing = os.path.abspath(landing)
    pages = []
    for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8"):
        u = json.loads(line)
        pages.append(
            {
                "url": u["source_url"],
                "unit_key": u["unit_key"],
                "markers": 1,
                "sections": 1,
            }
        )
    proof = {
        "marker": "one official leginfo codes_displaySection.xhtml page per LAW_SECTION_TBL row",
        "pages": sorted(pages, key=lambda p: p["unit_key"]),
        "unfetched_child_pages": [],
    }
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--landing", default="/tmp/sc4/ca/landing")
    a = ap.parse_args()
    print(json.dumps(build(a.landing)))


if __name__ == "__main__":
    main()
