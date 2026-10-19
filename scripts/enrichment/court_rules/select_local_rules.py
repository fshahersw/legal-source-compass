"""Score the discovered local-rules documents and propose a selection per court (no network).

  python3 -I -B scripts/enrichment/court_rules/select_local_rules.py [--write] [court ...]

Scoring is a review aid only: --write merges the proposals into local_rules_sources.json without overwriting courts that
already have a reviewed entry ("reviewed": true). Excluded: amendment orders, redlines, summaries, notices, proposed
rules, comments, archives, forms and guidelines.
"""
from __future__ import annotations

import json
import os
import re
import sys
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CANDIDATES = os.path.join(ROOT, "private", "build", "court_rules", "lookups", "local_rules_candidates.json")
SOURCES = os.path.join(HERE, "local_rules_sources.json")

EXCLUDE = re.compile(r"redline|red-line|strikeout|summary|summaries|notice|proposed|comment|archiv|supersed|amend|"
                     r"order (adopting|approving)|signed|changes? to|revision|guideline|instruction|form\b|forms/|"
                     r"bankruptcy|general order|standing order|administrative order|chief judge order|"
                     r"memo|bullet|cle|video|presentation|plan\b|jury|fee schedule|cja|speedy|committee|"
                     r"rescinded|prior|old|historical|track[- ]?changes|comparison|blackline", re.I)
LOCAL = re.compile(r"local[\s_%20-]*(civil |criminal |)rules?|circuit rules?|\blr\b|rules of (practice|court|the)|"
                   r"local[\s_-]*rules|localrules|circuit[\s_-]*rules|frap|rules[\s_-]*(and|&)[\s_-]*(internal )?(operating )?procedures?|iop", re.I)
COMPLETE = re.compile(r"complete|\ball\b|entire|full|master|in one file|current|consolidated|effective|eff\.?", re.I)
PART = re.compile(r"civil|criminal|patent|admiralty|maritime|adr|alternative dispute|habeas|appendix|chapter", re.I)


def score(doc: dict) -> int:
    hay = unquote(doc["url"]) + " " + doc["text"]
    if not re.search(r"\.(pdf|docx?)($|\?)", doc["url"], re.I):
        return -100
    if EXCLUDE.search(hay):
        return -50
    s = 0
    if LOCAL.search(hay):
        s += 10
    if COMPLETE.search(hay):
        s += 4
    if PART.search(hay):
        s += 2
    if re.search(r"/(local[_-]?rules|rules)/", doc["url"], re.I):
        s += 2
    return s


def propose(court: dict) -> list[dict]:
    seen, docs = set(), []
    for d in court["documents"]:
        key = d["url"].split("?")[0].lower()
        if key in seen:
            continue
        seen.add(key)
        sc = score(d)
        if sc >= 10:
            docs.append({**d, "score": sc})
    docs.sort(key=lambda d: -d["score"])
    complete = [d for d in docs if COMPLETE.search(unquote(d["url"]) + " " + d["text"]) and not PART.search(d["text"])]
    if complete:
        return complete[:1]
    return docs[:6]


def main(argv):
    write = "--write" in argv
    only = [a for a in argv if not a.startswith("--")]
    data = json.load(open(CANDIDATES))
    sources = json.load(open(SOURCES)) if os.path.exists(SOURCES) else {"courts": {}}
    for court in data["courts"]:
        if only and court["court"] not in only:
            continue
        picks = propose(court)
        print(f"## {court['court']}: {len(picks)} pick(s)")
        for p in picks:
            print(f"   [{p['score']}] {p['url']} | {p['text'][:70]}")
        entry = sources["courts"].get(court["court"])
        if write and not (entry and entry.get("reviewed")):
            sources["courts"][court["court"]] = {
                "host": court["host"], "reviewed": False,
                "documents": [{"url": p["url"], "title": p["text"][:160], "found_on": p["found_on"]} for p in picks],
            }
    if write:
        with open(SOURCES, "w", encoding="utf-8") as handle:
            json.dump(sources, handle, indent=1, sort_keys=True)
            handle.write("\n")


if __name__ == "__main__":
    main(sys.argv[1:])
