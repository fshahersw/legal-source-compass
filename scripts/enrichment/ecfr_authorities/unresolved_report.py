"""Count and classify what the cross-links could not resolve (written to private/build/ecfr_authorities/unresolved_report.json).

  python3 -I -B unresolved_report.py

U.S. Code authorities that are one section (exact) or the note to one but are not stored: counted by title, with the
reason that can be shown from stored data (the same key under another letter case; the title has no stored section at all).
CFR parts the table lists but ecfr_sections_full does not store: each is looked up in the eCFR structure acquired for
ecfr_full (private/acq/ecfr_full/api/structure/<date>/title-N.json.gz) to tell "the part is in the current eCFR but not in
the stored dataset" (a gap in the stored dataset) from "the part is not in the current eCFR" (removed, renumbered or never
existed since the table's January 1, 2025 revision date, or a citation error in the agency's authority note).
"""
from __future__ import annotations

import collections
import glob
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "ecfr_authorities")


def walk(node, found):
    if isinstance(node, dict):
        if node.get("type") == "part" and node.get("identifier") is not None:
            found[str(node["identifier"])] = bool(node.get("reserved"))
        for c in node.get("children") or []:
            walk(c, found)


def structure_parts() -> tuple[dict[int, dict[str, bool]], str]:
    dirs = sorted(glob.glob(os.path.join(ROOT, "private", "acq", "ecfr_full", "api", "structure", "*")))
    d = dirs[-1]
    out: dict[int, dict[str, bool]] = {}
    for f in glob.glob(os.path.join(d, "title-*.json.gz")):
        n = int(re.search(r"title-(\d+)\.json", f).group(1))
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            found: dict[str, bool] = {}
            walk(json.load(fh), found)
        out[n] = found
    return out, os.path.basename(d)


def main() -> None:
    with open(os.path.join(OUT, "ecfr_parallel_authorities.json"), encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    with open(os.path.join(OUT, "lookups", "us_code_section_ids.json"), encoding="utf-8") as fh:
        sections = set(json.load(fh)["status_by_id"])
    low = {s.lower() for s in sections}
    titles_with_sections = {s.split(":", 1)[0] for s in sections}
    states = collections.Counter()
    unresolved_by_title = collections.Counter()
    examples: dict[str, list[str]] = collections.defaultdict(list)
    case_only = []
    seen_auth = set()
    for r in rows:
        p = r["detail"]["ptoa"]
        if p["category"] != "usc":
            continue
        key = (p["heading"], p["authority"])
        if key in seen_auth:
            continue
        seen_auth.add(key)
        st = p["link"]["state"]
        states[st] += 1
        if st == "not_in_stored_code":
            t = p["link"].get("title") or ""
            unresolved_by_title[t] += 1
            sid = f"{t}:{p['link'].get('key')}"
            if p.get("variant") == "1939 I.R.C.":
                examples["1939 Internal Revenue Code"].append(p["citation"])
            elif sid.lower() in low:
                case_only.append(p["citation"])
            elif t not in titles_with_sections:
                examples["title has no stored sections"].append(p["citation"])
            else:
                examples["no section with this title and number"].append(p["citation"])
    parts_all: dict[tuple[int, str], bool] = {}
    range_tokens = []
    unparsed = []
    for r in rows:
        c = r["detail"]["ptoa"]["cfr"]
        for t in c["parts"]:
            parts_all[(c["title"], t)] = t in c["parts_stored"]
        range_tokens += [(c["title"], x) for x in c["part_ranges"]]
        unparsed += [(c["title"], x) for x in c["unparsed"]]
    struct, struct_date = structure_parts()
    missing = [k for k, v in parts_all.items() if not v]
    classes = collections.Counter()
    ex_parts: dict[str, list[str]] = collections.defaultdict(list)
    for t, part in sorted(missing):
        s = struct.get(t, {})
        if part in s:
            cls = "in the current eCFR structure but not stored (reserved)" if s[part] else "in the current eCFR structure but not stored"
        else:
            cls = "not in the current eCFR structure"
        classes[cls] += 1
        if len(ex_parts[cls]) < 12:
            ex_parts[cls].append(f"{t} CFR part {part}")
    report = {
        "structure_snapshot": struct_date,
        "usc_authorities_by_state_distinct_printed_authorities": dict(states),
        "usc_not_in_stored_code_by_title": dict(unresolved_by_title.most_common()),
        "usc_not_in_stored_code_same_key_other_case": case_only,
        "usc_not_in_stored_code_reasons": {k: {"count": len(v), "examples": v[:12]} for k, v in examples.items()},
        "cfr_distinct_parts_listed": len(parts_all),
        "cfr_distinct_parts_stored": sum(1 for v in parts_all.values() if v),
        "cfr_distinct_parts_not_stored": len(missing),
        "cfr_stored_parts_also_found_in_the_structure_walk": sum(1 for (t, pt), v in parts_all.items() if v and pt in struct.get(t, {})),
        "cfr_not_stored_classes": dict(classes),
        "cfr_not_stored_examples": ex_parts,
        "cfr_part_range_tokens": range_tokens,
        "cfr_unparsed_tokens": unparsed,
    }
    with open(os.path.join(OUT, "unresolved_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k not in ("cfr_not_stored_examples", "usc_not_in_stored_code_reasons")}, indent=1))
    for k, v in report["usc_not_in_stored_code_reasons"].items():
        print(k, v["count"], v["examples"][:6])
    for k, v in ex_parts.items():
        print(k, v[:8])


if __name__ == "__main__":
    main()
