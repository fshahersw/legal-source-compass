"""Spot checks for REPORT.md (writes private/build/ecfr_full/spot_checks.json).

  python3 -I -B scripts/enrichment/ecfr_full/spot_check.py

Text: 15 random sections; the first and last 60 characters of the stored body are searched for in the raw GovInfo
XML fragment of that section (tags removed, whitespace folded) -> found yes/no.
History: 15 random versions linked to a Federal Register rule with basis "source_note"; the rule's effective date must
equal the version's amendment date, its CFR references must list the part, and a citation in the section's source
note must fall inside the rule's page range -> match yes/no.
"""
from __future__ import annotations

import gzip
import html
import json
import os
import random
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ecfr_parse as ep  # noqa: E402
import fetchlib as fl  # noqa: E402
import frindex  # noqa: E402
from build_ecfr_full import BUILD  # noqa: E402

rng = random.Random(1022)


def raw_section(title: str, ident: str, cache: dict) -> str | None:
    if cache.get("t") != title:
        with gzip.open(os.path.join(fl.ACQ, "govinfo", f"ECFR-title{title}.xml.gz"), "rt", encoding="utf-8") as fh:
            cache["t"], cache["s"] = title, fh.read()
    m = re.search(r'<DIV8 N="§\s*' + re.escape(ident) + r'"[^>]*>(.*?)</DIV8>', cache["s"], re.S)
    if not m:
        return None
    plain = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))
    return ep.collapse(plain)


def loose(s: str) -> str:
    """Letters and digits only, after NFKC (the stored text prints subscript 2 as ₂ where the XML has <E T="52">2</E>)."""
    return re.sub(r"[^0-9A-Za-z]+", "", unicodedata.normalize("NFKC", s))


def main() -> None:
    rows = []
    with gzip.open(os.path.join(BUILD, "ecfr_sections_full.rows.jsonl.gz"), "rt", encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            d = r["detail"]
            if d["kind"] == "section" and len(r["text"]) > 200 and "\t" not in r["text"][:200]:
                rows.append((d["title_number"], d["identifier"], r["text"], [n for n in d["notes"] if n[0] == "source"]))
    sample = sorted(rng.sample(rows, 15), key=lambda x: int(x[0]))
    cache: dict = {}
    text_checks = []
    for t, ident, text, _ in sample:
        raw = raw_section(t, ident, cache)
        head, tail = text[:60], text[-60:]
        ok = raw is not None and loose(head) in loose(raw) and loose(tail) in loose(raw)
        text_checks.append({"citation": f"{t} CFR {ident}", "stored_start": head, "stored_end": tail,
                            "where": f"GovInfo ECFR-title{t}.xml, DIV8 N=\"§ {ident}\"", "match": ok})
    docs = {d["document_number"]: d for d in frindex.load_docs()}
    cites = {}
    for t, ident, _, notes in rows:
        cites[f"cfr:{t}:{ident}"] = [c for n in notes for c in ep.fr_citations(n[1])]
    linked = []
    with gzip.open(os.path.join(BUILD, "ecfr_section_versions.rows.jsonl.gz"), "rt", encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            if r["id"] not in cites:
                continue
            for v in r["detail"]["versions"]:
                if v["fr_basis"] == "source_note" and v["date"] >= "2017-01-03":
                    linked.append((r["id"], r["detail"]["part"], v))
    fr_checks = []
    for rid, part, v in rng.sample(linked, 15):
        d = docs[v["fr"][0]["document_number"]]
        refs = {(str(x.get("title")), str(x.get("part"))) for x in d.get("cfr_references") or []}
        title = rid.split(":")[1]
        in_note = [f"{a} FR {b}" for a, b in cites[rid] if a == d["volume"] and d["start_page"] <= b <= d["end_page"]]
        ok = d.get("effective_on") == v["amendment_date"] and (title, part) in refs and bool(in_note)
        fr_checks.append({"section": rid, "version_date": v["date"], "amendment_date": v["amendment_date"],
                          "fr_document": d["document_number"], "fr_citation": d.get("citation"), "fr_effective_on": d.get("effective_on"),
                          "fr_pages": [d["start_page"], d["end_page"]], "source_note_citation": in_note[:2],
                          "cfr_reference_listed": (title, part) in refs, "match": ok})
    out = {"text": text_checks, "federal_register_links": fr_checks,
           "text_matches": sum(c["match"] for c in text_checks), "fr_matches": sum(c["match"] for c in fr_checks)}
    with open(os.path.join(BUILD, "spot_checks.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(json.dumps({"text": f"{out['text_matches']}/15", "fr": f"{out['fr_matches']}/15"}))


if __name__ == "__main__":
    main()
