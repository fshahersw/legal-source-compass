"""Build `ecfr_sections_full`: the full current text of every eCFR section and appendix, plus one row per part.

  python3 -I -B scripts/enrichment/ecfr_full/build_ecfr_full.py [TITLE ...]

Deterministic; reads only private/acq/ecfr_full/ (acquire.py):
  govinfo/ECFR-title{n}.xml.gz         GovInfo bulk eCFR XML (the text), one file per title
  api/structure/{as_of}/title-{n}.json  eCFR structure at the title's "up to date as of" date (identity, hierarchy)
  api/titles/titles-*.json             eCFR titles.json (up to date as of, latest amended/issue dates)
Writes private/build/ecfr_full/:
  ecfr_sections_full.rows.jsonl.gz     one corpus row per line, in document order (titles ascending)
  ecfr_sections_full.meta.json         dataset, label, listing_block, summary, inputs, built_at, row count, digest
  ecfr_sections_full.alignment.json    per title: XML items matched to structure nodes, misses with reasons
The rows are too large for one JSON build file (about 1 GB of text), so publish_stream.py publishes them in batches
with the same validation and readback as private/scratch/enrich/publish_build.py.

Row kinds (filters.kind): "section", "appendix", "part". Section/appendix rows: `text` is the body exactly (one block
per line; see ecfr_parse.py), `detail.layout` says how to render each line, `detail.notes` holds the source,
authority, editorial, effective-date and amendment notes printed with the section. Part rows hold the notes printed
for the part and its subparts/subject groups (authority, source, editorial ...), stored once per part.
"""
from __future__ import annotations

import datetime
import gzip
import hashlib
import json
import os
import re
import sys
import urllib.parse
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ecfr_parse as ep  # noqa: E402
import fetchlib as fl  # noqa: E402

DATASET = "ecfr_sections_full"
LABEL = "Code of Federal Regulations — full current text (eCFR)"
BUILD = os.path.join(fl.ROOT, "private", "build", "ecfr_full")
ECFR_CURRENT = "https://www.ecfr.gov/current"
GOVINFO_FILE = "https://www.govinfo.gov/bulkdata/ECFR/title-{n}/ECFR-title{n}.xml"
QUALIFICATION = (
    "Text of the electronic Code of Federal Regulations (eCFR) as published in GovInfo's eCFR bulk XML for each title, "
    "current as of the title's \"up to date as of\" date from the eCFR API. The eCFR is an authoritative but unofficial "
    "editorial compilation; the official legal edition is the annual CFR. Paragraph depth follows the printed "
    "(a)/(1)/(i)/(A) markers. Tables keep every cell (cells separated by tabs); superscripts and subscripts are shown "
    "with Unicode super/subscript characters (or ^(..)/_(..)); graphics are referenced by their file name, not "
    "reproduced. Text does not establish applicability to any claim."
)
TYPE_LABEL = {"title": "Title", "subtitle": "Subtitle", "chapter": "Chapter", "subchapter": "Subchapter", "part": "Part",
              "subpart": "Subpart", "subject_group": "Subject group", "section": "Section", "appendix": "Appendix"}
XML_TYPE = {"SECTION": "section", "APPENDIX": "appendix", "PART": "part", "SUBPART": "subpart", "SUBJGRP": "subject_group",
            "CHAPTER": "chapter", "SUBCHAP": "subchapter", "SUBTITLE": "subtitle", "TITLE": "title"}


def titles_snapshot() -> tuple[dict, dict]:
    man = fl.read_manifest()
    snaps = sorted(p for p in man if p.startswith("api/titles/"))
    return json.loads(fl.load(snaps[-1])), man[snaps[-1]]


def clean_label(s: str) -> str:
    """Structure labels can carry HTML spans (e.g. <span class="standard">a</span>) and trailing newlines."""
    s = re.sub(r"<[^>]+>", "", s or "")
    return ep.collapse(s.replace("&amp;", "&"))


def flatten(structure: dict):
    """Leaves (section/appendix) and parts in document order with their ancestor path [(type, identifier, label)]."""
    leaves, parts = [], []

    def walk(node: dict, path: list) -> None:
        t = node.get("type")
        entry = (t, node.get("identifier") or "", clean_label(node.get("label") or ""))
        if t in ("section", "appendix"):
            leaves.append({"node": node, "path": path})
            return
        if t == "part":
            parts.append({"node": node, "path": path})
        for c in node.get("children") or []:
            walk(c, path + [entry])

    walk(structure, [])
    return leaves, parts


def native_path(path: list, kind: str, identifier: str) -> str:
    segs = [ep.native_segment(t, i) for t, i, _ in path if t != "title"]
    title = next(i for t, i, _ in path if t == "title")
    return "/".join([f"title-{title}"] + segs + [ep.native_segment(kind, identifier)])


def ecfr_url(title: str, path: list, kind: str, identifier: str) -> str:
    if kind == "section":
        return f"{ECFR_CURRENT}/title-{title}/section-{urllib.parse.quote(identifier, safe='')}"
    if kind == "part":
        return f"{ECFR_CURRENT}/title-{title}/part-{urllib.parse.quote(identifier, safe='')}"
    # Appendix: the eCFR addresses it under its hierarchy (chapter/subchapter/part/subpart), subject groups excluded.
    segs = [f"{t}-{urllib.parse.quote(i, safe='')}" for t, i, _ in path if t in ("chapter", "subchapter", "part", "subpart")]
    return "/".join([f"{ECFR_CURRENT}/title-{title}"] + segs + [f"appendix-{urllib.parse.quote(identifier, safe='')}"])


def record_id(title: str, kind: str, identifier: str) -> str:
    return f"cfr:{title}:part-{identifier}" if kind == "part" else f"cfr:{title}:{identifier}"


def citation(title: str, kind: str, identifier: str) -> str:
    return f"{title} CFR part {identifier}" if kind == "part" else f"{title} CFR {identifier}"


def matches(item: dict, leaf: dict) -> bool:
    node = leaf["node"]
    kind = XML_TYPE.get(item["type"])
    if kind != node.get("type"):
        return False
    ident = node.get("identifier") or ""
    if kind == "section":
        return ep.loose(ep.norm_identifier(item["n"])) == ep.loose(ident)
    head = ep.loose(item["heading"])
    return head.startswith(ep.loose(ident)) or ep.loose(item["n"]) == ep.loose(ident)


def path_facts(path: list) -> list[list[str]]:
    out = []
    for t, i, label in path:
        if t == "title":
            continue
        out.append([TYPE_LABEL.get(t, t), label or i])
    return out


def scope_label(anc: list) -> str:
    t, n, head = anc[-1][:3]
    kind = XML_TYPE.get(t, t)
    return clean_label(head) or f"{TYPE_LABEL.get(kind, kind)} {n}"


def make_row(rid: str, title: str, *, source_url: str, text: str, item: dict, detail: dict, filters: dict) -> dict:
    return {"dataset": DATASET, "id": rid, "category": DATASET, "state": "", "title": title, "source_url": source_url,
            "item": item, "detail": detail, "text": text, "filters": {"_listing": ["yes"], **filters}}


PART_HEAD = re.compile(r"^\s*PARTS?\s+(.+?)\s*(?:[—\[]|$)", re.I)


def part_from_head(head: str) -> str | None:
    """'PART 101-1—INTRODUCTION' -> '101-1'; 'PARTS 1240-1259—REPORTS' -> '1240-1259'."""
    m = PART_HEAD.match(head or "")
    return m.group(1).strip() if m else None


class Aligner:
    """Matches XML sections/appendices to structure leaves on identifier keys, preferring document order."""

    def __init__(self, leaves: list[dict]):
        self.leaves = leaves
        self.used: set[int] = set()
        self.ptr = 0
        self.sections: dict[str, list[int]] = {}
        self.appendices: list[tuple[int, str, str, str]] = []
        for i, leaf in enumerate(leaves):
            node = leaf["node"]
            if node.get("type") == "section":
                self.sections.setdefault(ep.loose(node.get("identifier") or ""), []).append(i)
            else:
                self.appendices.append((i, ep.loose(node.get("identifier") or ""), ep.loose(clean_label(node.get("label") or "")),
                                        ep.loose(clean_label(node.get("label_level") or ""))))

    def find(self, item: dict) -> int | None:
        kind = XML_TYPE.get(item["type"])
        if kind == "section":
            cands = [i for i in self.sections.get(ep.loose(ep.norm_identifier(item["n"])), []) if i not in self.used]
            if not cands:
                # N attribute unusable: the printed heading starts with the section number ("§ 1221.128 Qualification.")
                head = ep.norm_identifier(item["heading"].split("  ")[0])
                key = ep.loose(head.split(" ")[0]) if head else ""
                cands = [i for i in self.sections.get(key, []) if i not in self.used]
        else:
            head = ep.loose(item["heading"])
            n = ep.loose(item["n"])
            cands = [i for i, li, ll, lv in self.appendices if i not in self.used and (
                (li and not self.leaves[i]["node"].get("generated_id") and head.startswith(li)) or (ll and head == ll)
                or (lv and head.startswith(lv)) or (n and li and n == li))]
        if not cands:
            return None
        after = [i for i in cands if i >= self.ptr]
        hit = min(after) if after else min(cands)
        self.used.add(hit)
        self.ptr = max(self.ptr, hit + 1)
        return hit


def build_title(n: int, meta: dict, man: dict, out, stats: ep.Stats, align_report: dict, counts: Counter) -> None:
    t = str(n)
    as_of = meta["up_to_date_as_of"]
    srel = f"api/structure/{as_of}/title-{n}.json.gz"
    grel = f"govinfo/ECFR-title{n}.xml.gz"
    structure = json.loads(fl.load(srel))
    leaves, parts = flatten(structure)
    src_url = GOVINFO_FILE.format(n=n)
    gman = man[grel]
    source = {"url": src_url, "sha256": gman["sha256"], "retrieved_at": gman["retrieved_at"], "bulk_last_modified": gman.get("bulk_last_modified")}
    title_facts = [["eCFR up to date as of", as_of], ["Title last amended", meta.get("latest_amended_on") or "Not recorded"],
                   ["Latest eCFR issue for the title", meta.get("latest_issue_date") or "Not recorded"],
                   ["Source file", src_url], ["Source file SHA-256", gman["sha256"]],
                   ["Source file last modified (GovInfo listing)", gman.get("bulk_last_modified") or "Not recorded"]]
    aligner = Aligner(leaves)
    repeated = {k for k, c in Counter((lf["node"]["type"], lf["node"]["identifier"]) for lf in leaves).items() if c > 1}
    node_notes: dict[str, list] = {}      # XML part element (NODE) -> notes printed for the part/subparts/subject groups
    node_bodies: dict[str, dict] = {}     # XML part element (NODE) -> content placed directly in the part
    node_head: dict[str, tuple] = {}      # XML part element (NODE) -> (N, heading)
    node_part: dict[str, str] = {}        # XML part element (NODE) -> structure part identifier (from its matched sections)
    part_counts: Counter = Counter()
    misses_xml: list[dict] = []
    seen_ids: set[str] = set()
    text_hash: dict[str, str] = {}      # loose identifier -> sha256 of the stored text (to classify duplicate prints)
    pending: dict | None = None

    def part_node(anc: list) -> tuple | None:
        return next((a for a in reversed(anc) if a[0] == "PART"), None)

    def flush() -> None:
        nonlocal pending
        if pending is None:
            return
        leaf, obj = pending["leaf"], pending["obj"]
        node, path = leaf["node"], leaf["path"]
        kind_s = node["type"]
        ident = node["identifier"]
        part_n = next((i for k2, i, _ in reversed(path) if k2 == "part"), None)
        rid = record_id(t, kind_s, ident)
        if (kind_s, ident) in repeated:
            # The same appendix identifier is printed in several parts (e.g. SFAR No. 97 in 14 CFR parts 91-135).
            rid = f"{rid}@part-{part_n}" if part_n else f"{rid}@{native_path(path, kind_s, ident)}"
            counts["repeated_identifier_qualified"] += 1
        if rid in seen_ids:
            raise SystemExit(f"title {n}: duplicate row id {rid}")
        seen_ids.add(rid)
        if part_n:
            part_counts[part_n] += 1
        label_desc = clean_label(node.get("label_description") or "")
        label = clean_label(node.get("label") or "") or obj["heading"]
        reserved = bool(node.get("reserved"))
        cite = citation(t, kind_s, ident)
        row_title = f"{cite} {label_desc}".strip() if kind_s == "section" else f"{t} CFR {label}".strip()
        text = "\n".join(obj["lines"])
        url = ecfr_url(t, path, kind_s, ident)
        chapter = next((i for k2, i, _ in path if k2 == "chapter"), None)
        subpart = next((i for k2, i, _ in path if k2 == "subpart"), None)
        frs = [f"{a} FR {b}" for k2, v in obj["notes"] if k2 == "source" for a, b in ep.fr_citations(v)]
        facts = [["Citation", cite], ["Heading", label_desc or obj["heading"] or "Not recorded"]] + path_facts(path) + [
            ["Reserved", "Yes" if reserved else "No"], ["Text characters", str(len(text))]] + title_facts
        if pending["pieces"] > 1:
            facts.append(["Printed in pieces", f"{pending['pieces']} (the source prints this section across volumes; joined in order)"])
        links = [{"url": url, "label": "Open on ecfr.gov (current)"},
                 {"url": f"/law/cfr/{t}/{urllib.parse.quote(ident, safe='')}", "label": "Text, history and past versions"}]
        if part_n:
            links.append({"url": f"/law/cfr/{t}/part/{urllib.parse.quote(part_n, safe='')}", "label": f"Part {part_n} in this collection"})
        subtitle = " · ".join([f"Title {t}"] + [f"{TYPE_LABEL[k2]} {i}" for k2, i, _ in path if k2 in ("chapter", "part", "subpart")])
        item = {"id": rid, "title": row_title, "subtitle": subtitle,
                "cells": {"title_number": t, "part": part_n or "", "identifier": ident, "kind": kind_s, "reserved": reserved,
                          "as_of": as_of, "characters": len(text)},
                "badges": [TYPE_LABEL[kind_s]] + (["Reserved"] if reserved else []), "links": links}
        detail = {"title": row_title, "subtitle": subtitle, "facts": facts, "links": links,
                  "citation": cite, "heading": label_desc or obj["heading"], "printed_heading": obj["heading"],
                  "kind": kind_s, "identifier": ident, "title_number": t, "part": part_n, "subpart": subpart, "chapter": chapter,
                  "path": [[k2, i, lab] for k2, i, lab in path], "native_id": native_path(path, kind_s, ident),
                  "ecfr_url": url, "as_of": as_of, "reserved": reserved, "layout": obj["layout"], "notes": obj["notes"],
                  "source_fr_citations": frs, "received_on": node.get("received_on"), "source": source,
                  "qualification": QUALIFICATION}
        filters = {"title": [t], "kind": [kind_s], "reserved": ["true" if reserved else "false"]}
        if part_n:
            filters["part"] = [part_n]
        if chapter:
            filters["chapter"] = [chapter]
        if subpart:
            filters["subpart"] = [subpart]
        out.write(json.dumps(make_row(rid, row_title, source_url=src_url, text=text, item=item, detail=detail, filters=filters),
                             ensure_ascii=False, sort_keys=True) + "\n")
        text_hash[ep.loose(ident)] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        counts[kind_s] += 1
        counts["characters"] += len(text)
        if reserved:
            counts[f"{kind_s}_reserved"] += 1
        if not obj["layout"]:
            counts[f"{kind_s}_no_body"] += 1
            if not reserved:
                counts[f"{kind_s}_no_body_not_reserved"] += 1
        elif not text.strip():
            counts[f"{kind_s}_graphics_only"] += 1
        pending = None

    with gzip.open(os.path.join(fl.ACQ, grel), "rb") as fh:
        for kind, obj, anc in ep.iter_title(fh, stats):
            pn = part_node(anc)
            if pn is not None:
                node_head.setdefault(pn[3], (pn[1], pn[2]))
            if kind in ("note", "body"):
                if pn is None:
                    counts["notes_above_part" if kind == "note" else "body_above_part"] += 1
                    continue
                scope = scope_label(anc)
                if kind == "note":
                    node_notes.setdefault(pn[3], []).append([obj[0], obj[1], scope])
                else:
                    pb = node_bodies.setdefault(pn[3], {"lines": [], "layout": []})
                    pb["lines"].extend(obj["lines"])
                    pb["layout"].extend(obj["layout"])
                    node_notes.setdefault(pn[3], []).extend([[k, v, scope] for k, v in obj["notes"]])
                continue
            # A section printed across volumes continues under the same number with "(Continued)".
            if pending is not None and obj["heading"].rstrip().endswith("(Continued)") and \
                    ep.loose(ep.norm_identifier(obj["n"])) == ep.loose(pending["leaf"]["node"]["identifier"]):
                po = pending["obj"]
                po["lines"].extend(obj["lines"])
                po["layout"].extend(obj["layout"])
                po["notes"].extend(obj["notes"])
                pending["pieces"] += 1
                counts["continuation_pieces_joined"] += 1
                continue
            hit = aligner.find(obj)
            if hit is None:
                flush()
                own = "\n".join(obj["lines"])
                prior = text_hash.get(ep.loose(ep.norm_identifier(obj["n"])))
                reason = ("printed twice in the source XML; identical text already stored" if prior and
                          prior == hashlib.sha256(own.encode("utf-8")).hexdigest() else
                          "printed twice in the source XML; this copy differs from the stored one" if prior else
                          "no node with this identifier in the eCFR structure")
                misses_xml.append({"n": obj["n"], "heading": obj["heading"][:160], "type": obj["type"], "reason": reason,
                                   "part": pn[1] if pn else None, "characters": len(own)})
                counts["xml_unmatched"] += 1
                counts["xml_unmatched:" + reason.split(";")[-1].strip()] += 1
                continue
            flush()
            leaf = leaves[hit]
            part_ident = next((i for k2, i, _ in reversed(leaf["path"]) if k2 == "part"), None)
            if pn is not None and part_ident:
                node_part.setdefault(pn[3], part_ident)
            pending = {"leaf": leaf, "obj": obj, "pieces": 1}
    flush()
    skipped_structure = [{"identifier": leaves[k]["node"].get("identifier"), "type": leaves[k]["node"].get("type"),
                          "reserved": leaves[k]["node"].get("reserved"), "label": clean_label(leaves[k]["node"].get("label") or "")}
                         for k in range(len(leaves)) if k not in aligner.used]
    # Part-level notes and content: an XML part element maps to the structure part of its matched sections; a part
    # with no sections maps by the part number printed in its heading, else by its N attribute.
    part_ids = {p["node"]["identifier"] for p in parts}
    loose_parts = {ep.loose(i): i for i in part_ids}
    loose_labels = {ep.loose(clean_label(p["node"].get("label") or "")): p["node"]["identifier"] for p in parts}
    notes_by_part: dict[str, list] = {}
    bodies_by_part: dict[str, dict] = {}
    unplaced: dict[str, int] = {}
    for node_id, (xn, head) in node_head.items():
        ident = node_part.get(node_id)
        if ident is None:
            for cand in (part_from_head(head), xn):
                if cand and ep.loose(cand) in loose_parts:
                    ident = loose_parts[ep.loose(cand)]
                    break
        if ident is None and ep.loose(head) in loose_labels:
            ident = loose_labels[ep.loose(head)]
        notes = node_notes.get(node_id, [])
        body = node_bodies.get(node_id)
        if ident is None:
            if notes or body:
                unplaced[f"{xn} {head}"[:80]] = len(notes) + (len(body["lines"]) if body else 0)
            continue
        notes_by_part.setdefault(ident, []).extend(notes)
        if body:
            pb = bodies_by_part.setdefault(ident, {"lines": [], "layout": []})
            pb["lines"].extend(body["lines"])
            pb["layout"].extend(body["layout"])
    # Part rows (every part node in the structure, reserved ones included), after the title's sections.
    for p in parts:
        node, path = p["node"], p["path"]
        ident = node["identifier"]
        rid = record_id(t, "part", ident)
        if rid in seen_ids:
            counts["duplicate_part_identifier"] += 1
            continue
        seen_ids.add(rid)
        notes = notes_by_part.get(ident, [])
        body = bodies_by_part.get(ident, {"lines": [], "layout": []})
        reserved = bool(node.get("reserved"))
        label = clean_label(node.get("label") or "")
        row_title = f"{t} CFR {label}".strip()
        url = ecfr_url(t, path, "part", ident)
        chapter = next((i for k2, i, _ in path if k2 == "chapter"), None)
        n_items = part_counts.get(ident, 0)
        facts = [["Citation", citation(t, "part", ident)], ["Heading", clean_label(node.get("label_description") or "") or "Not recorded"]] + \
            path_facts(path) + [["Reserved", "Yes" if reserved else "No"], ["Sections and appendices", str(n_items)],
                                ["Range", node.get("descendant_range") or "Not recorded"]] + title_facts
        links = [{"url": url, "label": "Open on ecfr.gov (current)"},
                 {"url": f"/law/cfr/{t}/part/{urllib.parse.quote(ident, safe='')}", "label": "Sections of this part"}]
        subtitle = " · ".join([f"Title {t}"] + [f"{TYPE_LABEL[k2]} {i}" for k2, i, _ in path if k2 == "chapter"])
        item = {"id": rid, "title": row_title, "subtitle": subtitle,
                "cells": {"title_number": t, "part": ident, "identifier": ident, "kind": "part", "reserved": reserved, "as_of": as_of,
                          "sections": n_items},
                "badges": ["Part"] + (["Reserved"] if reserved else []), "links": links}
        detail = {"title": row_title, "subtitle": subtitle, "facts": facts, "links": links, "citation": citation(t, "part", ident),
                  "heading": clean_label(node.get("label_description") or ""), "kind": "part", "identifier": ident, "title_number": t,
                  "part": ident, "chapter": chapter, "path": [[k2, i, lab] for k2, i, lab in path],
                  "native_id": native_path(path, "part", ident), "ecfr_url": url, "as_of": as_of, "reserved": reserved,
                  "layout": body["layout"], "notes": notes, "sections": n_items, "range": node.get("descendant_range"),
                  "source": source, "qualification": QUALIFICATION}
        filters = {"title": [t], "kind": ["part"], "reserved": ["true" if reserved else "false"], "part": [ident]}
        if chapter:
            filters["chapter"] = [chapter]
        out.write(json.dumps(make_row(rid, row_title, source_url=src_url, text="\n".join(body["lines"]), item=item, detail=detail,
                                      filters=filters), ensure_ascii=False, sort_keys=True) + "\n")
        counts["part"] += 1
        counts["part_notes"] += len(notes)
        counts["part_body_lines"] += len(body["lines"])
    counts["part_notes_unplaced"] += sum(unplaced.values())
    align_report[t] = {"structure_leaves": len(leaves), "xml_matched": len(aligner.used), "xml_unmatched": misses_xml,
                       "xml_unmatched_count": len(misses_xml), "structure_without_xml": skipped_structure,
                       "structure_without_xml_count": len(skipped_structure),
                       "structure_without_xml_reserved": sum(1 for s in skipped_structure if s.get("reserved")),
                       "parts": len(parts), "unplaced_part_content": unplaced}
    print(json.dumps({"title": n, "leaves": len(leaves), "matched": len(aligner.used), "xml_unmatched": len(misses_xml),
                      "structure_without_xml": len(skipped_structure), "unplaced": len(unplaced)}), flush=True)


def listing_block(title_counts: Counter, titles_meta: dict) -> dict:
    return {
        "page": 1, "limit": 50,
        "columns": [{"key": "title_number", "label": "CFR title"}, {"key": "part", "label": "Part"},
                    {"key": "identifier", "label": "Section or appendix"}, {"key": "kind", "label": "Kind"},
                    {"key": "reserved", "label": "Reserved"}, {"key": "as_of", "label": "Up to date as of"}],
        "filters": [{"name": "q", "type": "search", "label": "Search"},
                    {"name": "kind", "type": "select", "label": "Kind", "options": [
                        {"label": "Section", "value": "section", "count": title_counts["section"]},
                        {"label": "Appendix", "value": "appendix", "count": title_counts["appendix"]},
                        {"label": "Part", "value": "part", "count": title_counts["part"]}]},
                    {"name": "title", "type": "select", "label": "CFR title", "options": [
                        {"label": f"Title {k} — {titles_meta[k]['name']}", "value": k, "count": title_counts[f"title:{k}"]}
                        for k in sorted(titles_meta, key=int) if title_counts[f"title:{k}"]]},
                    {"name": "reserved", "type": "select", "label": "Reserved", "options": [
                        {"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]}],
        "qualification": QUALIFICATION,
    }


def main(argv: list[str]) -> None:
    os.makedirs(BUILD, exist_ok=True)
    snap, snap_entry = titles_snapshot()
    man = fl.read_manifest()
    titles = {str(x["number"]): x for x in snap["titles"] if not x["reserved"]}
    wanted = [int(a) for a in argv] or sorted(int(k) for k in titles)
    rows_path = os.path.join(BUILD, f"{DATASET}.rows.jsonl.gz")
    tmp = rows_path + ".tmp"
    stats = ep.Stats()
    counts: Counter = Counter()
    align: dict = {}
    inputs = [{"url": snap_entry["url"], "path": "private/acq/ecfr_full/" + snap_entry["path"], "sha256": snap_entry["sha256"]}]
    for n in wanted:
        meta = titles[str(n)]
        # The GovInfo file must postdate the title's latest eCFR issue, so it carries the current text.
        mod = man[f"govinfo/ECFR-title{n}.xml.gz"].get("bulk_last_modified")
        mod_date = datetime.datetime.strptime(mod, "%d-%b-%Y %H:%M").date().isoformat()
        if meta["latest_issue_date"] and mod_date <= meta["latest_issue_date"]:
            raise SystemExit(f"title {n}: GovInfo file ({mod}) is not newer than the latest eCFR issue {meta['latest_issue_date']}")
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as out:
        for n in wanted:
            meta = titles[str(n)]
            before = Counter(counts)
            build_title(n, meta, man, out, stats, align, counts)
            counts[f"title:{n}"] = sum(counts[k] - before[k] for k in ("section", "appendix", "part"))
            for rel in (f"govinfo/ECFR-title{n}.xml.gz", f"api/structure/{meta['up_to_date_as_of']}/title-{n}.json.gz"):
                e = man[rel]
                inputs.append({"url": e["url"], "path": "private/acq/ecfr_full/" + rel, "sha256": e["sha256"]})
    os.replace(tmp, rows_path)
    digest = hashlib.sha256()
    total = 0
    with gzip.open(rows_path, "rt", encoding="utf-8") as fh:
        for line in fh:
            digest.update(line.encode("utf-8"))
            total += 1
    as_of_values = sorted({titles[str(n)]["up_to_date_as_of"] for n in wanted})
    summary = {
        "source": "GovInfo eCFR bulk XML (https://www.govinfo.gov/bulkdata/ECFR) with eCFR API structure and titles (https://www.ecfr.gov/api/versioner/v1)",
        "up_to_date_as_of": as_of_values, "titles": len(wanted), "sections": counts["section"], "appendices": counts["appendix"],
        "parts": counts["part"], "reserved_sections": counts["section_reserved"], "reserved_appendices": counts["appendix_reserved"],
        "sections_without_body": counts["section_no_body"], "appendices_without_body": counts["appendix_no_body"],
        "characters": counts["characters"], "tables": stats.tables, "graphics": stats.graphics,
        "xml_items_unmatched": counts["xml_unmatched"], "appendix_ids_qualified_by_part": counts["repeated_identifier_qualified"],
        "notes_above_part_level_not_stored": counts["notes_above_part"], "content_above_part_level_not_stored": counts["body_above_part"],
        "unknown_elements_kept_as_paragraphs": dict(stats.unknown), "accent_codes": dict(stats.accents),
        "build_counts": {k: v for k, v in sorted(counts.items()) if not k.startswith("title:")},
        "method": ("One row per section and appendix of the GovInfo eCFR bulk XML, matched in document order to the eCFR "
                   "structure at the same date (identifiers, labels and hierarchy come from the structure). Body text is "
                   "one block per line; detail.layout gives each block's kind and paragraph depth; notes printed with the "
                   "section are kept apart in detail.notes. One row per part carries the notes printed for the part, its "
                   "subparts and subject groups."),
        "qualification": QUALIFICATION, "row_ids": ("cfr:<title>:<section or appendix identifier>; an appendix identifier printed in several parts of a title "
                    "gets @part-<part>; parts cfr:<title>:part-<part>"),
    }
    meta_out = {"dataset": DATASET, "label": LABEL, "listing_block": listing_block(counts, titles), "summary": summary,
                "rows_file": os.path.relpath(rows_path, fl.ROOT), "rows": total, "rows_sha256": digest.hexdigest(),
                "built_at": fl.utc_now(), "inputs": inputs}
    with open(os.path.join(BUILD, f"{DATASET}.meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta_out, fh, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(BUILD, f"{DATASET}.alignment.json"), "w", encoding="utf-8") as fh:
        json.dump(align, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"rows": total, "counts": {k: v for k, v in counts.items() if not k.startswith("title:")},
                      "unknown": dict(stats.unknown)}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
