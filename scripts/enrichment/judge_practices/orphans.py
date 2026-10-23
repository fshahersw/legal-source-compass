"""Stored originals that no judge record uses any more (documents downloaded before a later parser change left them out: a judge's decisions in
particular cases, opinions indexes, pages that were not judges' own). Nothing is deleted: the list is written for the lead, who can remove the
objects from the bucket if wished.

    python3 -I -B scripts/enrichment/judge_practices/orphans.py
Writes private/build/judge_practices/orphans.json and prints the counts.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
COURTS = os.path.join(ROOT, "private", "build", "judge_practices", "courts")
DOCS = os.path.join(ROOT, "private", "build", "judge_practices", "docs")


def main() -> None:
    used: set[str] = set()
    pages: set[str] = set()
    for f in os.listdir(COURTS):
        if not f.endswith(".json"):
            continue
        c = json.load(open(os.path.join(COURTS, f), encoding="utf-8"))
        for j in c["judges"]:
            pages.add(j["page_url"].split("#")[0])
            for d in j.get("documents") or []:
                used.add(d["url"])
    orphans, kept = [], 0
    used_keys: set[str] = set()
    records = [json.load(open(os.path.join(DOCS, f), encoding="utf-8")) for f in sorted(os.listdir(DOCS))]
    for d in records:
        if d["url"] in used or (d.get("kind") == "pagetext" and d["url"] in pages):
            used_keys.add((d.get("storage") or {}).get("key"))
    for d in records:
        url = d["url"]
        if url in used or (d.get("kind") == "pagetext" and url in pages):
            kept += 1
            continue
        st = d.get("storage") or {}
        orphans.append({"url": url, "titles": (d.get("titles") or [])[:2], "status": d.get("status"), "sha256": d.get("sha256"), "bytes": d.get("bytes"),
                        "bucket": st.get("bucket"), "key": st.get("key"), "stored": bool(st.get("readback_ok")),
                        "same_object_used_by_a_kept_record": st.get("key") in used_keys})
    # Web pages stored earlier as a document and later replaced by the file they carry (a record no longer exists for them): found from the fetch
    # manifest (every document fetch with its SHA-256) and confirmed by a read of the bucket.
    known = {o["key"] for o in orphans} | used_keys
    replaced: list[dict] = []
    store = None
    seen_keys: set[str] = set()
    with open(os.path.join(ROOT, "private", "acq", "judge_practices", "_manifest.jsonl"), encoding="utf-8") as h:
        for line in h:
            m = json.loads(line)
            if m.get("kind") != "document" or m.get("status") != 200 or not m.get("sha256") or not str(m.get("content_type") or "").startswith("text/html"):
                continue
            key = f"judge_practices/{m['retrieved_at'][:10]}/{m['sha256']}.html"
            if key in known or key in seen_keys:
                continue
            seen_keys.add(key)
            if store is None:
                import docstore
                store = docstore.DocStore()
            status, sha, nbytes = store.readback(key)
            if status == 200 and sha == m["sha256"]:
                replaced.append({"url": m["url"], "key": key, "sha256": sha, "bytes": nbytes, "bucket": "corpus-originals",
                                 "reason": "a web page that answered for a document address; the file it carries was stored as the document instead"})
    out = {"records_in_use": kept, "orphans": orphans, "replaced_web_pages": replaced,
           "note": "Originals stored in corpus-originals under judge_practices/ that no judge record in the datasets refers to. Not deleted."}
    with open(os.path.join(ROOT, "private", "build", "judge_practices", "orphans.json"), "w", encoding="utf-8") as h:
        json.dump(out, h, indent=1)
    stored = [o for o in orphans if o["stored"]]
    free = {o["key"] for o in stored if not o["same_object_used_by_a_kept_record"]}
    print(f"document records in use: {kept}; not used: {len(orphans)} (stored originals: {len(stored)}; objects used by no kept record: {len(free)}); "
          f"replaced web pages still in the bucket: {len(replaced)}")


if __name__ == "__main__":
    main()
