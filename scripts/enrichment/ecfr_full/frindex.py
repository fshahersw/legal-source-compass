"""Federal Register RULE documents (acquire.py fr) as an index for linking eCFR versions to the rules that made them.

Network-free. A version (title, part, amendment date, issue date) links to an FR document only on exact keys:
  * the document lists that CFR title and part in its cfr_references, and
  * its effective_on equals the version's amendment date (the eCFR's issue date tracks the amendment date, not the
    Federal Register publication date: measured 2026-10-22), and it was published on or before the eCFR issue date.
Basis, strongest first:
  source_note                  a candidate's page range contains a Federal Register citation printed in the
                               section's own source note (CITA)
  only_rule_for_part_on_date   exactly one candidate
  rules_for_part_on_date       several candidates (e.g. a rule and its correction); all are listed, none is picked
  none                         no candidate (Not recorded)
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib as fl  # noqa: E402


def load_docs() -> list[dict]:
    man = fl.read_manifest()
    docs: dict[str, dict] = {}
    for rel in sorted(p for p in man if p.startswith("fr/rules-")):
        for d in json.loads(fl.load(rel)).get("results") or []:
            docs[d["document_number"]] = d
    return list(docs.values())


class FRIndex:
    def __init__(self, docs: list[dict]):
        self.by_part_eff: dict[tuple, list[dict]] = defaultdict(list)
        self.docs = docs
        for d in docs:
            refs = {(str(r.get("title")), str(r.get("part"))) for r in d.get("cfr_references") or [] if r.get("title") and r.get("part")}
            for t, p in refs:
                self.by_part_eff[(t, p, d.get("effective_on"))].append(d)

    def link(self, title: str, part: str | None, amendment_date: str, issue_date: str, note_cites: list[tuple[int, int]]):
        """Return (basis, [doc, ...]) for one version (see module docstring)."""
        if not part or not amendment_date:
            return "none", []
        cands = [d for d in self.by_part_eff.get((title, part, amendment_date), [])
                 if (d.get("publication_date") or "9999") <= (issue_date or amendment_date)]
        if not cands:
            return "none", []
        named = [d for d in cands if any(d.get("volume") == v and (d.get("start_page") or 0) <= pg <= (d.get("end_page") or 0)
                                         for v, pg in note_cites)]
        if named:
            return "source_note", sorted(named, key=lambda d: d["document_number"])
        if len(cands) == 1:
            return "only_rule_for_part_on_date", cands
        return "rules_for_part_on_date", sorted(cands, key=lambda d: d["document_number"])


def compact(d: dict) -> dict:
    return {"document_number": d["document_number"], "citation": d.get("citation"), "publication_date": d.get("publication_date"),
            "effective_on": d.get("effective_on"), "title": d.get("title"), "url": d.get("html_url"), "action": d.get("action")}
