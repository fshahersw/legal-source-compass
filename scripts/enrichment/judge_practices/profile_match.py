"""Link a judge read from a court's website to an existing judge profile, only on a unique exact match of normalised name plus court.

Normalisation (deterministic, documented): case, accents, punctuation, honorifics and suffixes (Jr., Sr., II, III, IV) removed; hyphens split
tokens; every middle name is reduced to its initial ("Lewis Jeffrey Liman" and "Lewis J. Liman" are the same key; "Lewis Liman" is a
different key). The court must be the page's own court: the profile's court list (directory `courts`, FJC service courts) is rewritten to
court ids by the exact court-name aliases of scripts/enrichment/judge_xwalk/xwalk_lib.py. A key is linked only when exactly one profile
holds it at that court; no key at the court is "unmatched"; several are "ambiguous". Nothing is fuzzy: no edit distance, nicknames or
surname-only matching, and a person is never linked across courts.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "judge_xwalk"))

import xwalk_lib as xl  # noqa: E402

LOOKUPS = os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups")
CL_COURTS = os.path.join(ROOT, "private", "build", "court_locations", "lookups", "cl_courts.json")


def name_key(name: str) -> tuple[str, str, str] | None:
    """(first, middle initials, last) of a person's name, or None when it has fewer than two name parts."""
    toks, _suffix = xl.record_name(name)
    toks = [t for t in toks if t]
    if len(toks) < 2:
        return None
    return toks[0], "".join(t[0] for t in toks[1:-1]), toks[-1]


def court_alias_index() -> dict[str, set[str]]:
    """normalised court name -> {court ids} for every federal district and bankruptcy court."""
    courts = json.load(open(CL_COURTS, encoding="utf-8"))["rows"]
    index: dict[str, set[str]] = defaultdict(set)
    for c in courts:
        if c["jurisdiction"] not in ("FD", "FB") or c.get("in_use") == "f":
            continue
        for alias in xl.court_aliases(c.get("full_name"), c.get("short_name")):
            index[alias].add(c["id"])
    return index


class ProfileIndex:
    """(court id, name key) -> directory profile ids, built from the judge directory and the FJC service lookup."""

    def __init__(self) -> None:
        self.by_court_key: dict[tuple[str, tuple], set[str]] = defaultdict(set)
        self.names: dict[str, str] = {}
        aliases = court_alias_index()
        directory = [json.loads(l) for l in open(os.path.join(LOCATIONS_DIR(), "judges.jsonl"), encoding="utf-8")]
        for r in directory:
            if r.get("system") != "Federal":
                continue
            key = name_key(r.get("name") or "")
            if not key:
                continue
            self.names[r["id"]] = r["name"]
            for court_name in r.get("courts") or []:
                for cid in aliases.get(xl.norm_court(court_name), ()):
                    self.by_court_key[(cid, key)].add(r["id"])
        fjc = os.path.join(LOCATIONS_DIR(), "judge_profiles_fjc.jsonl")
        for line in open(fjc, encoding="utf-8"):
            r = json.loads(line)
            jp = r.get("jp")
            key = name_key(r.get("title") or "")
            if not jp or not key:
                continue
            for s in r.get("svc") or []:
                cid = s.get("court_id")
                if cid:
                    self.by_court_key[(cid, key)].add(jp)
            if r.get("curcourt"):
                self.by_court_key[(r["curcourt"], key)].add(jp)

    def match(self, court_id: str, name: str) -> dict:
        key = name_key(name)
        if not key:
            return {"status": "unmatched", "reason": "name has fewer than two parts", "candidates": 0}
        ids = self.by_court_key.get((court_id, key), set())
        if len(ids) == 1:
            pid = next(iter(ids))
            return {"status": "linked", "judge_id": pid, "profile_name": self.names.get(pid), "candidates": 1,
                    "basis": "unique exact normalised name (middle names reduced to initials) at the same court"}
        if not ids:
            return {"status": "unmatched", "reason": "no profile with this name at this court", "candidates": 0}
        return {"status": "ambiguous", "reason": "more than one profile has this name at this court", "candidates": len(ids), "candidate_ids": sorted(ids)[:6]}


def LOCATIONS_DIR() -> str:
    return LOOKUPS
