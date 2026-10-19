"""Re-split rule documents into sections from their saved text renderings, after a change to sections.py.

  python3 -I -B scripts/enrichment/court_rules/resplit_sections.py [--dry-run] [doc_id ...]

extract_rules.py renders each acquired file to text once (private/build/court_rules/text/<doc>.txt) and splits it; the
acquired PDFs may since have been pruned (prune_raw.py keeps their URL and SHA-256). This script reads each saved
rendering, checks it against the SHA-256 recorded in documents.json, splits it again with the current sections.py and
rewrites work/sections.jsonl and the documents' sections/split/coverage fields. Only documents whose sections came from
sections.split_sections are touched (HTML anchor, per-page HTML and whole-page documents keep theirs). Section source
URLs keep the form extract_rules gave them: the same file with "#page=N" for PDFs, the document URL for HTML. The
replaced sections' ids and page spans are appended to work/sections_replaced.jsonl (insights.py --reattach reads them).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract_rules as E  # noqa: E402
import fetchlib  # noqa: E402
import sections as S  # noqa: E402

WORK = E.WORK
REPLACED = os.path.join(WORK, "sections_replaced.jsonl")
SPLIT_TOKENS = {"local_rule", "rule", "abbrev", "bare", "nested", "pages", "named"}


def read_exact(path: str) -> str:
    """The saved rendering exactly as written: newline="" keeps carriage returns that text mode would turn into line feeds
    (the recorded SHA-256 covers them)."""
    full = path if os.path.isabs(path) else os.path.join(fetchlib.ROOT, path)
    if not os.path.exists(full) and os.path.exists(full + ".gz"):
        with gzip.open(full + ".gz", "rt", encoding="utf-8", newline="") as handle:
            return handle.read()
    with open(full, encoding="utf-8", newline="") as handle:
        return handle.read()


def from_split_sections(method: str | None) -> bool:
    return bool(method) and set(method.split("+")) <= SPLIT_TOKENS


def url_maker(doc: dict, old_rows: list[dict]):
    """The section URL scheme extract_rules used for this document."""
    paged = next((r["source_url"] for r in old_rows if r.get("source_url") and "#page=" in r["source_url"]), None)
    if paged:
        base = paged.split("#page=")[0]
        return lambda s: f"{base}#page={s.page}"
    fixed = next((r["source_url"] for r in old_rows if r.get("source_url")), None) or doc.get("url")
    return lambda s: fixed


def main(argv: list[str]) -> None:
    dry = "--dry-run" in argv
    only = [a for a in argv if not a.startswith("--")]
    data = fetchlib.load_json(os.path.join(WORK, "documents.json"))
    rows_by_doc: dict[str, list[dict]] = defaultdict(list)
    order: list[str] = []
    with fetchlib.open_text(os.path.join(WORK, "sections.jsonl")) as handle:
        for line in handle:
            row = json.loads(line)
            if row["doc"] not in rows_by_doc:
                order.append(row["doc"])
            rows_by_doc[row["doc"]].append(row)
    changed = []
    replaced: dict[str, list[dict]] = {}
    for doc in data["documents"]:
        if doc.get("status") != "text" or not doc.get("text_path") or not from_split_sections(doc.get("split")):
            continue
        if only and doc["id"] not in only:
            continue
        text = read_exact(doc["text_path"])
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if doc.get("text_sha256") and digest != doc["text_sha256"]:
            raise SystemExit(f"{doc['id']}: saved text does not match its recorded SHA-256; re-run extract_rules.py")
        secs, method = S.split_sections(text)
        old = rows_by_doc.get(doc["id"], [])
        new = E.section_rows(doc["id"], secs, url_maker(doc, old))
        if [(r["label"], r["title"], r["text"]) for r in old] == [(r["label"], r["title"], r["text"]) for r in new]:
            continue
        changed.append({"doc": doc["id"], "split": f"{doc.get('split')} -> {method}", "sections": f"{len(old)} -> {len(new)}"})
        if doc["id"] not in rows_by_doc:
            order.append(doc["id"])
        replaced[doc["id"]] = old
        rows_by_doc[doc["id"]] = new
        doc.update(sections=len(new), split=method, coverage=S.coverage(secs, text))
    for c in changed:
        print(json.dumps(c))
    print(json.dumps({"changed_documents": len(changed), "dry_run": dry}))
    if dry or not changed:
        return
    ids = [r["id"] for d in order for r in rows_by_doc[d]]
    assert len(ids) == len(set(ids)), "duplicate section ids"
    now = fetchlib.utc_now()
    # the replaced sections' ids and page spans, so insights.py --reattach can tell which section a cached response cited
    with open(REPLACED, "a", encoding="utf-8") as handle:
        for c in changed:
            for r in replaced[c["doc"]]:
                handle.write(json.dumps({"doc": r["doc"], "id": r["id"], "label": r["label"], "page": r.get("page"),
                                         "page_end": (r["page"] + r["text"].count("\f")) if r.get("page") is not None else None,
                                         "replaced_at": now}) + "\n")
    data["sections_resplit_at"] = now
    with open(os.path.join(WORK, "documents.json"), "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=1)
    with open(os.path.join(WORK, "sections.jsonl"), "w", encoding="utf-8") as handle:
        for d in order:
            for row in rows_by_doc[d]:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    stale = os.path.join(WORK, "sections.jsonl.gz")
    if os.path.exists(stale):
        os.remove(stale)  # the plain file now holds the current sections; compress_outputs.py re-gzips it


if __name__ == "__main__":
    main(sys.argv[1:])
