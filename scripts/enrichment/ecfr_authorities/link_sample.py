"""Draw the 30-row sample of resolved links for the two-direction check and run the reverse direction on the build rows.

  python3 -I -B link_sample.py            writes private/build/ecfr_authorities/link_sample_30.json and prints the id lists

Forward (row -> stored records): the U.S. Code section id and one stored CFR part id of each sampled row must exist in the
published us_code_sections and ecfr_sections_full (checked with read-only SELECTs by id; results are recorded in REPORT.md).
Reverse (stored record -> row), computed here exactly as the pages query it: the rows whose filters contain the section id
("usc") and the rows whose filters contain "<title>:<part>" ("cfr_part") must include the sampled row.
"""
from __future__ import annotations

import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "ecfr_authorities")


def main() -> None:
    with open(os.path.join(OUT, "ecfr_parallel_authorities.json"), encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    cand = [
        r
        for r in rows
        if r["detail"]["ptoa"]["link"]["state"] in ("resolved", "resolved_note") and r["detail"]["ptoa"]["cfr"]["parts_stored"]
    ]
    rnd = random.Random(20261023)
    pick = rnd.sample(cand, 30)
    out = []
    bad = 0
    for r in pick:
        p = r["detail"]["ptoa"]
        sid = p["link"]["id"]
        part = p["cfr"]["parts_stored"][0]
        key = f"{p['cfr']['title']}:{part}"
        rev_section = any(x["id"] == r["id"] for x in rows if sid in (x["filters"].get("usc") or []))
        rev_part = any(x["id"] == r["id"] for x in rows if key in (x["filters"].get("cfr_part") or []))
        bad += 0 if (rev_section and rev_part) else 1
        out.append({"row": r["id"], "section_id": sid, "citation": p["citation"], "part_id": f"cfr:{p['cfr']['title']}:part-{part}", "reverse_section_ok": rev_section, "reverse_part_ok": rev_part})
    with open(os.path.join(OUT, "link_sample_30.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("reverse failures", bad)
    print("SECTIONS", ",".join(sorted({o["section_id"] for o in out})))
    print("PARTS", ",".join(sorted({o["part_id"] for o in out})))


if __name__ == "__main__":
    main()
