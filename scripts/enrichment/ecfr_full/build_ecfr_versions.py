"""Build `ecfr_section_versions`: every eCFR section/appendix's change history (2017 onward) with the Federal Register
rule that made each change where exact keys identify it.

  python3 -I -B scripts/enrichment/ecfr_full/build_ecfr_versions.py

Deterministic; reads private/acq/ecfr_full/api/versions/ (every page of versions/title-{n}.json), private/acq/ecfr_full/fr/
(Federal Register RULE documents) and the section source notes from private/build/ecfr_full/ecfr_sections_full.rows.jsonl.gz
(run build_ecfr_full.py first). No historical text is stored: the site fetches the text as of a chosen date live from
the eCFR API. Writes ecfr_section_versions.rows.jsonl.gz + .meta.json in private/build/ecfr_full/.

One row per (title, section or appendix identifier) the versioner lists, including sections removed since 2017. Row id
is the same as in ecfr_sections_full (cfr:<title>:<identifier>), so a section page joins both on id.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
import urllib.parse
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import acquire  # noqa: E402
import ecfr_parse as ep  # noqa: E402
import fetchlib as fl  # noqa: E402
import frindex  # noqa: E402
from build_ecfr_full import BUILD, titles_snapshot  # noqa: E402

DATASET = "ecfr_section_versions"
LABEL = "Code of Federal Regulations — section change history since 2017 (eCFR)"
VERSIONS_URL = "https://www.ecfr.gov/api/versioner/v1/versions/title-{n}.json"
POINT_IN_TIME_START = "2017-01-03"
BASIS_LABEL = {
    "source_note": "Federal Register rule effective that day for this part, cited in the section's source note",
    "only_rule_for_part_on_date": "The only Federal Register rule for this part effective that day",
    "rules_for_part_on_date": "Federal Register rules for this part effective that day (the eCFR does not say which one)",
    "none": "Not recorded",
}
QUALIFICATION = (
    "Change dates are the eCFR versioner's content versions for each section (amendment date = date the change took "
    "effect in the eCFR; issue date = date the eCFR incorporated it; substantive = the eCFR's own flag). The eCFR "
    "point-in-time record starts on 2017-01-03; an earlier date marks the version in effect when the record begins. "
    "The eCFR API does not name the Federal Register document behind a change; the link shown is found on exact keys "
    "(a Federal Register rule listing this CFR part whose effective date equals the amendment date, published by the "
    "eCFR issue date), preferring a rule cited in the section's own source note, and every candidate is listed when "
    "several match. Text as of any date is read live from the eCFR API."
)


def note_citations() -> tuple[dict[str, list[tuple[int, int]]], set[tuple[str, str]]]:
    """Source-note FR citations per text row id, and the (title, appendix identifier) pairs qualified by part."""
    out: dict[str, list[tuple[int, int]]] = {}
    qualified: set[tuple[str, str]] = set()
    path = os.path.join(BUILD, "ecfr_sections_full.rows.jsonl.gz")
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            cites = []
            for note in r["detail"].get("notes") or []:
                kind, text = note[0], note[1]
                if kind == "source":
                    cites.extend(ep.fr_citations(text))
            out[r["id"]] = cites
            if "@part-" in r["id"]:
                qualified.add((r["detail"]["title_number"], r["detail"]["identifier"]))
    return out, qualified


def fr_ref(d: dict) -> dict:
    return {"document_number": d["document_number"], "citation": d.get("citation"), "publication_date": d.get("publication_date"),
            "url": f"https://www.federalregister.gov/d/{urllib.parse.quote(d['document_number'], safe='')}"}


def main() -> None:
    snap, snap_entry = titles_snapshot()
    man = fl.read_manifest()
    titles = {str(x["number"]): x for x in snap["titles"] if not x["reserved"]}
    cites, qualified = note_citations()
    docs = frindex.load_docs()
    idx = frindex.FRIndex(docs)
    fr_inputs = sorted(p for p in man if p.startswith("fr/rules-"))
    counts: Counter = Counter()
    inputs = [{"url": snap_entry["url"], "path": "private/acq/ecfr_full/" + snap_entry["path"], "sha256": snap_entry["sha256"]}]
    rows_path = os.path.join(BUILD, f"{DATASET}.rows.jsonl.gz")
    tmp = rows_path + ".tmp"
    used_docs: set[str] = set()
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as out:
        for n in sorted(int(k) for k in titles):
            t = str(n)
            meta = titles[t]
            pages = acquire.version_pages(n)
            raw: list[dict] = []
            expected = None
            for rel in pages:
                data = json.loads(fl.load(rel))
                expected = int(data["meta"]["result_count"])
                raw.extend(data["content_versions"])
                e = man[rel]
                inputs.append({"url": e["url"], "path": "private/acq/ecfr_full/" + rel, "sha256": e["sha256"]})
            uniq = {json.dumps(v, sort_keys=True) for v in raw}
            if len(raw) != expected or len(uniq) != expected:
                raise SystemExit(f"title {n}: {len(raw)} versions read ({len(uniq)} distinct), result_count {expected}")
            groups: dict[tuple, list[dict]] = defaultdict(list)
            for v in raw:
                # Appendix identifiers printed in several parts are told apart by part, as in ecfr_sections_full.
                qualify = v["type"] == "appendix" and (t, v["identifier"]) in qualified
                groups[(v["type"], v["identifier"], v["part"] if qualify else None)].append(v)
            for (kind, ident, qpart), vs in sorted(groups.items(), key=lambda kv: (min(x["part"] or "" for x in kv[1]), kv[0][1], kv[0][2] or "")):
                vs.sort(key=lambda v: (v["date"], v["issue_date"], v["amendment_date"]))
                rid = f"cfr:{t}:{ident}" + (f"@part-{qpart}" if qpart else "")
                note_cites = cites.get(rid, [])
                in_text = rid in cites
                versions = []
                for v in vs:
                    basis, found = ("none", [])
                    if v["substantive"] or v["removed"]:
                        basis, found = idx.link(t, v["part"], v["amendment_date"], v["issue_date"], note_cites)
                    for d in found:
                        used_docs.add(d["document_number"])
                    counts[f"basis:{basis}" + (":since2017" if v["date"] >= POINT_IN_TIME_START else ":baseline")] += 1
                    versions.append({"date": v["date"], "amendment_date": v["amendment_date"], "issue_date": v["issue_date"],
                                     "substantive": bool(v["substantive"]), "removed": bool(v["removed"]), "name": ep.collapse(v["name"]),
                                     "part": v["part"], "subpart": v["subpart"], "fr_basis": basis, "fr": [fr_ref(d) for d in found]})
                latest = versions[-1]
                part = latest["part"] or next((x["part"] for x in reversed(versions) if x["part"]), None)
                changes = [x for x in versions if x["date"] >= POINT_IN_TIME_START and x["substantive"]]
                cite = f"{t} CFR {ident}"
                name = latest["name"] or cite
                row_title = f"{t} CFR {name.lstrip('§ ').strip()}" if kind == "section" else f"{t} CFR {name}"
                facts = [["Citation", cite], ["Versions listed by the eCFR", str(len(versions))],
                         ["Substantive changes since 2017-01-03", str(len(changes))],
                         ["First version date listed", versions[0]["date"]], ["Latest version date", latest["date"]],
                         ["Removed in the latest version", "Yes" if latest["removed"] else "No"],
                         ["In the current text collection", "Yes" if in_text else "No (removed, renamed or not in the current eCFR)"],
                         ["eCFR up to date as of", meta["up_to_date_as_of"]]]
                links = []
                if in_text:
                    links.append({"url": f"/law/cfr/{t}/{urllib.parse.quote(ident, safe='')}", "label": "Current text and history"})
                links.append({"url": f"https://www.ecfr.gov/api/versioner/v1/versions/title-{t}.json?{urllib.parse.urlencode({'part': part or '', kind: ident})}",
                              "label": "eCFR versions (API)"})
                item = {"id": rid, "title": row_title, "subtitle": f"Title {t} · Part {part}" if part else f"Title {t}",
                        "cells": {"title_number": t, "part": part or "", "identifier": ident, "kind": kind, "versions": len(versions),
                                  "changes_since_2017": len(changes), "latest_date": latest["date"], "removed": latest["removed"]},
                        "badges": [kind.capitalize()] + (["Removed"] if latest["removed"] else []), "links": links}
                detail = {"title": row_title, "subtitle": item["subtitle"], "facts": facts, "links": links, "citation": cite,
                          "kind": kind, "identifier": ident, "title_number": t, "part": part, "versions": versions,
                          "in_current_text": in_text, "as_of": meta["up_to_date_as_of"], "basis_labels": BASIS_LABEL,
                          "qualification": QUALIFICATION}
                filters = {"_listing": ["yes"], "title": [t], "kind": [kind], "removed": ["true" if latest["removed"] else "false"],
                           "changed_since_2017": ["true" if changes else "false"]}
                if part:
                    filters["part"] = [part]
                row = {"dataset": DATASET, "id": rid, "category": DATASET, "state": "", "title": row_title,
                       "source_url": VERSIONS_URL.format(n=n), "item": item, "detail": detail,
                       "text": f"{cite} {name}", "filters": filters}
                out.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
                counts["rows"] += 1
                counts["versions"] += len(versions)
                counts[f"kind:{kind}"] += 1
                counts["in_current_text"] += in_text
                counts["removed_latest"] += latest["removed"]
            print(json.dumps({"title": n, "versions": len(raw), "rows": len(groups)}), flush=True)
    os.replace(tmp, rows_path)
    for rel in fr_inputs:
        e = man[rel]
        inputs.append({"url": e["url"], "path": "private/acq/ecfr_full/" + rel, "sha256": e["sha256"]})
    digest = hashlib.sha256()
    total = 0
    with gzip.open(rows_path, "rt", encoding="utf-8") as fh:
        for line in fh:
            digest.update(line.encode("utf-8"))
            total += 1
    summary = {"source": "eCFR API versions/title-{n}.json (all pages) and the Federal Register API (RULE documents published 2015-07 to 2026-10)",
               "rows": total, "versions": counts["versions"], "sections": counts["kind:section"], "appendices": counts["kind:appendix"],
               "rows_in_current_text": counts["in_current_text"], "rows_removed_in_latest_version": counts["removed_latest"],
               "fr_link_basis_counts": {k: v for k, v in counts.items() if k.startswith("basis:")},
               "fr_documents_loaded": len(docs), "fr_documents_linked": len(used_docs),
               "point_in_time_start": POINT_IN_TIME_START, "basis_labels": BASIS_LABEL, "qualification": QUALIFICATION}
    listing = {"page": 1, "limit": 50,
               "columns": [{"key": "title_number", "label": "CFR title"}, {"key": "part", "label": "Part"},
                           {"key": "identifier", "label": "Section or appendix"}, {"key": "versions", "label": "Versions"},
                           {"key": "changes_since_2017", "label": "Substantive changes since 2017"},
                           {"key": "latest_date", "label": "Latest version"}],
               "filters": [{"name": "q", "type": "search", "label": "Search"},
                           {"name": "kind", "type": "select", "label": "Kind", "options": [
                               {"label": "Section", "value": "section", "count": counts["kind:section"]},
                               {"label": "Appendix", "value": "appendix", "count": counts["kind:appendix"]}]},
                           {"name": "changed_since_2017", "type": "select", "label": "Changed since 2017",
                            "options": [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]},
                           {"name": "removed", "type": "select", "label": "Removed in latest version",
                            "options": [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]}],
               "qualification": QUALIFICATION}
    meta_out = {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary,
                "rows_file": os.path.relpath(rows_path, fl.ROOT), "rows": total, "rows_sha256": digest.hexdigest(),
                "built_at": fl.utc_now(), "inputs": inputs}
    with open(os.path.join(BUILD, f"{DATASET}.meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta_out, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"rows": total, **{k: v for k, v in counts.items()}}))


if __name__ == "__main__":
    main()
