"""Release the chambers contact text that judge_practice_documents withheld (owner decision 2026-10-27: "dont withhold any data. If its
accurate and valuable, USE IT").

Until 2026-10-27 extract_text.py replaced the e-mail addresses, telephone numbers and courtroom staff that a court prints in its own practice
documents and judge pages with "[email omitted]", "[phone omitted]", "[line naming courtroom staff omitted]" and "[staff contact block
omitted]". That was caution, not owner policy and not a seal: the court publishes the text itself, and AGENTS.md 2026-10-22 (3) allows named
people exactly as the official publisher shows them. The removed words are not in the published rows, so they are recovered from the stored
originals (corpus-originals, content addressed, SHA-256 recorded on every row):

  1. read every published judge_practice_documents row (corpus_writer.fetch_all);
  2. a row is a target when its text carries one of the four markers, or (unless --keep-access-codes) an access credential the current rule
     removes (extract_text.ACCESS_CODE / MEETING_PWD);
  3. download the original by its storage key, check SHA-256 and size against the row, extract the text with the same method
     (extract_text.extract, or html_text for a judge's page), apply the legacy rules (legacy_redaction.py) and the cap, and continue only
     when that reproduces the published text exactly (same SHA-256 as item.practice_document.text_sha256). Then apply the current rule
     (extract_text.redact: access credentials only) and the cap to the same extraction. A row whose download, checksum or reproduction fails
     is left unchanged and listed with the reason;
     Credential-only rows take the same path (the legacy rules changed nothing in them, so the check is the same);
  4. rebuild the row exactly as build_judge_practices.py lays it out (text column "<id> <title> <subtitle> <text>", item.practice_document
     text fields and redaction counts, the "Text" and "Redacted from the text" facts).

Default is a dry run: nothing is written to production; the packet (summary, per-row results without document text, and a gzip backup of
every row the publish would change) goes to private/acq/release-counsel-and-chambers-contact-redaction/. --publish (lead only) upserts the
changed rows (primary key dataset,id; ordinal kept), updates the privacy text and redaction totals in the corpus_datasets metadata of
judge_practice_documents and judge_court_pages, and reads every changed row back. --restore <backup.jsonl.gz> puts the backed-up rows and
metadata back (the rollback).

Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (or private/scratch/env.sh, as store.py reads it); never
printed. Needs the extractors the builder used (poppler pdftotext, python-docx, LibreOffice for doc/rtf/wpd, bs4).

    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py                # dry run, packet only
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --publish      # lead: write
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --restore private/acq/release-counsel-and-chambers-contact-redaction/backup_rows.jsonl.gz
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import tempfile
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import extract_text as xt  # noqa: E402
import legacy_redaction as lr  # noqa: E402

DOCS_ID = "judge_practice_documents"
PAGES_ID = "judge_court_pages"
PACKET = os.path.join(ROOT, "private", "acq", "release-counsel-and-chambers-contact-redaction")
MARKERS = ("[email omitted]", "[phone omitted]", "[line naming courtroom staff omitted]", "[staff contact block omitted]")
SELECT = "dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters"
PAGE_METHOD_SUFFIX = "; staff contact blocks in the page header omitted"
BATCH = 200


# --------------------------------------------------------------------------------------------------------------------------- pure helpers

def text_prefix(row: dict) -> str:
    """The part of corpus_records.text that corpus_writer.record() puts before the document text: "<id> <title> <subtitle> "."""
    item = row.get("item") or {}
    return " ".join(str(p) for p in [row["id"], row.get("title"), item.get("subtitle")] if p) + " "


def doc_text(row: dict) -> str | None:
    """The document text inside the row's text column, or None when the row does not carry the builder's layout."""
    pre = text_prefix(row)
    t = row.get("text") or ""
    return t[len(pre):] if t.startswith(pre) else None


def has_marker(text: str) -> bool:
    return any(m in text for m in MARKERS)


def has_credential(text: str) -> bool:
    return bool(xt.ACCESS_CODE.search(text) or xt.MEETING_PWD.search(text))


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def legacy_text(extracted: str, page_text: bool) -> str:
    """What the builder published from this extraction before 2026-10-27 (legacy rules, cap, BOM removed as the builder does)."""
    red, _ = (lr.redact_page(extracted) if page_text else lr.redact(extracted)) if extracted else ("", {})
    return xt.cap(red)[0].replace("﻿", "")


def current_text(extracted: str, keep_access_codes: bool = False) -> tuple[str, bool, int, dict]:
    if keep_access_codes or not extracted:
        red, counts = extracted or "", {"access_codes": 0}
    else:
        red, counts = xt.redact(extracted)
    capped, truncated, total = xt.cap(red)
    return capped.replace("﻿", ""), truncated, total, counts


def rebuilt(row: dict, new_text: str, truncated: bool, total: int, counts: dict) -> dict:
    """The row with the released text, laid out as build_judge_practices.py lays it out."""
    out = json.loads(json.dumps(row))
    pd = out["item"]["practice_document"]
    method = (pd.get("text_method") or "")
    if method.endswith(PAGE_METHOD_SUFFIX):
        method = method[: -len(PAGE_METHOD_SUFFIX)]
    pd.update(text_chars=len(new_text), text_chars_total=total, text_truncated=bool(truncated), text_method=method or None,
              redactions=counts, text_sha256=sha(new_text) if new_text else None)
    text_fact = (f"{len(new_text):,} characters" + (f" of {total:,} (capped)" if truncated else "") + f"; {method or 'no extraction'}"
                 if new_text else None)
    red_fact = "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in counts.items() if v) or "None"
    facts = []
    for f in out["detail"].get("facts") or []:
        if f and f[0] == "Text" and text_fact:
            f = ["Text", text_fact]
        elif f and f[0] == "Redacted from the text":
            f = ["Redacted from the text", red_fact]
        facts.append(f)
    out["detail"]["facts"] = facts
    out["text"] = text_prefix(row) + new_text
    return out


# --------------------------------------------------------------------------------------------------------------------------- storage

class Originals:
    """Whole-object reads from corpus-originals with the cache-busting parameter store.py uses for readbacks."""

    def __init__(self):
        sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "caselaw"))
        import store  # noqa: PLC0415

        self.storage = store.Storage()

    def fetch(self, key: str, want_sha: str, want_bytes: int | None, dest: str) -> str | None:
        """Download the object to dest; None when it matches the row, otherwise the reason."""
        s = self.storage
        r = s._retry(lambda: s.s.get(s._object_url(key, True), headers=s.h, params={"readback": uuid.uuid4().hex}, timeout=s.timeout, stream=True))
        try:
            if r.status_code != 200:
                return f"storage returned HTTP {r.status_code}"
            h, n = hashlib.sha256(), 0
            with open(dest, "wb") as f:
                for block in r.iter_content(1 << 20):
                    h.update(block)
                    n += len(block)
                    f.write(block)
        finally:
            r.close()
        if h.hexdigest() != want_sha or (want_bytes is not None and n != want_bytes):
            return "stored object differs from the SHA-256 or size on the row"
        return None


def process_row(row: dict, originals: Originals, tmp: str, keep_access_codes: bool = False) -> tuple[dict | None, dict]:
    pd = row["item"]["practice_document"]
    st = pd.get("storage") or {}
    res = {"id": row["id"], "detected_type": pd.get("detected_type"), "kind": pd.get("kind"),
           "old_redactions": pd.get("redactions"), "old_text_sha256": pd.get("text_sha256")}
    if not (pd.get("stored") and st.get("key") and pd.get("sha256")):
        return None, res | {"result": "skipped", "reason": "no verified stored original"}
    ext = os.path.splitext(st["key"])[1] or ".bin"
    path = os.path.join(tmp, hashlib.sha1(row["id"].encode()).hexdigest()[:16] + ext)
    try:
        err = originals.fetch(st["key"], pd["sha256"], pd.get("bytes"), path)
        if err:
            return None, res | {"result": "skipped", "reason": err}
        page_text = pd.get("kind") == "page_text"
        if page_text:
            ex = xt.html_text(open(path, "rb").read())
        else:
            ex = xt.extract(path, pd.get("detected_type") or "unknown")
        if not ex.text:
            return None, res | {"result": "skipped", "reason": f"no text from the extractor here: {ex.error or ex.method}"}
        if sha(legacy_text(ex.text, page_text)) != pd.get("text_sha256"):
            return None, res | {"result": "skipped", "reason": "re-extraction with the legacy rules does not reproduce the published text "
                                                               "(extractor version differs); row left unchanged"}
        new_text, truncated, total, counts = current_text(ex.text, keep_access_codes)
    finally:
        if os.path.exists(path):
            os.remove(path)
    out = rebuilt(row, new_text, truncated, total, counts)
    return out, res | {"result": "released", "new_redactions": counts, "new_text_sha256": out["item"]["practice_document"]["text_sha256"],
                       "chars_before": len(doc_text(row) or ""), "chars_after": len(new_text), "markers_left": has_marker(new_text)}


# --------------------------------------------------------------------------------------------------------------------------- database

def dataset_meta(writer, dataset: str) -> dict:
    rows = writer._call("GET", f"corpus_datasets?id=eq.{dataset}&select=id,manifest_sha256,metadata", prefer="return=representation")
    return rows[0]


def patch_meta(writer, meta_rows: list[dict], totals_delta: Counter | None) -> None:
    for m in meta_rows:
        md = m["metadata"]
        summary = md.setdefault("summary", {})
        summary["privacy"] = PRIVACY
        if totals_delta is not None and m["id"] == DOCS_ID:
            totals = summary.setdefault("totals", {})
            for k, v in totals_delta.items():
                totals[k] = (totals.get(k) or 0) + v
                if totals[k] == 0:
                    totals.pop(k)
        summary["contact_text_release"] = RELEASE_NOTE
        writer._call("PATCH", f"corpus_datasets?id=eq.{m['id']}", {"metadata": md})


PRIVACY = ("Document text is shown as the court publishes it, including the chambers e-mail addresses, telephone numbers and courtroom staff "
           "the court prints (owner decision 2026-10-27). Only access credentials are removed from the text: hearing passcodes, passwords and access "
           "codes, and the pwd= value of meeting links (counts recorded). The judge-page roster does not extract contact fields. Originals are stored unchanged.")
RELEASE_NOTE = ("2026-10-27: the e-mail addresses, telephone numbers and courtroom staff lines and blocks earlier replaced by markers were restored "
                "from the stored originals (re-extracted with the same method; each row released only when the old rules reproduced the published "
                "text exactly). Rows that could not be reproduced keep their earlier text.")


def upsert(writer, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH):
        writer._call("POST", "corpus_records", rows[i:i + BATCH], prefer="return=minimal,resolution=merge-duplicates")


def readback(writer, rows: list[dict]) -> list[str]:
    bad = []
    want = {r["id"]: sha(r["text"]) for r in rows}
    ids = sorted(want)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        q = ",".join('"' + x + '"' for x in chunk)
        got = writer._call("GET", f"corpus_records?select=id,text&dataset=eq.{DOCS_ID}&id=in.({q})", prefer="return=representation")
        seen = {g["id"]: sha(g["text"] or "") for g in got}
        bad += [x for x in chunk if seen.get(x) != want[x]]
    return bad


# --------------------------------------------------------------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="write the changed rows and metadata (lead only)")
    ap.add_argument("--restore", default="", help="put back the rows and metadata of a backup written by an earlier run")
    ap.add_argument("--keep-access-codes", action="store_true", help="do not remove hearing passcodes / access codes")
    ap.add_argument("--ids", default="", help="only these record ids (comma separated)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--packet", default=PACKET)
    args = ap.parse_args()

    import corpus_writer as writer  # noqa: PLC0415

    os.makedirs(args.packet, exist_ok=True)
    if args.restore:
        with gzip.open(args.restore, "rt", encoding="utf-8") as h:
            backup = [json.loads(line) for line in h]
        rows = [b for b in backup if b.get("kind") == "row"]
        metas = [b["meta"] for b in backup if b.get("kind") == "meta"]
        upsert(writer, [r["row"] for r in rows])
        for m in metas:
            writer._call("PATCH", f"corpus_datasets?id=eq.{m['id']}", {"metadata": m["metadata"]})
        bad = readback(writer, [r["row"] for r in rows])
        print(json.dumps({"restored_rows": len(rows), "restored_metadata": [m["id"] for m in metas], "readback_mismatches": len(bad)}))
        return

    t0 = time.time()
    only = set(filter(None, args.ids.split(",")))
    rows = [r for r in writer.fetch_all(DOCS_ID, select=SELECT) if not only or r["id"] in only]
    before = {r["id"]: r for r in rows}
    marked, cred_only, layout_bad = [], [], []
    for r in rows:
        t = doc_text(r)
        if t is None:
            if r.get("text") and has_marker(r["text"]):
                layout_bad.append(r["id"])
            continue
        if has_marker(t):
            marked.append(r)
        elif not args.keep_access_codes and has_credential(t):
            cred_only.append(r)

    results, changed = [], []
    targets = marked + cred_only
    originals = Originals() if targets else None
    with tempfile.TemporaryDirectory(prefix="jp_release_") as tmp, ThreadPoolExecutor(args.workers) as pool:
        for out, res in pool.map(lambda r: process_row(r, originals, tmp, args.keep_access_codes), targets):
            res["target"] = "markers" if has_marker(doc_text(before[res["id"]]) or "") else "access codes only"
            results.append(res)
            if out is not None and out["text"] != before[out["id"]]["text"]:
                changed.append(out)

    delta = Counter()
    for out in changed:
        old = before[out["id"]]["item"]["practice_document"].get("redactions") or {}
        new = out["item"]["practice_document"].get("redactions") or {}
        for k in set(old) | set(new):
            delta[f"redacted_{k}"] += (new.get(k) or 0) - (old.get(k) or 0)
        delta["text_chars"] += out["item"]["practice_document"]["text_chars"] - (before[out["id"]]["item"]["practice_document"].get("text_chars") or 0)
        delta["truncated"] += int(bool(out["item"]["practice_document"]["text_truncated"])) - int(bool(before[out["id"]]["item"]["practice_document"].get("text_truncated")))

    by = Counter((x["target"], x["result"], x.get("reason", "")) for x in results)
    summary = {
        "mode": "publish" if args.publish else "dry run (nothing written to production)",
        "rows_read": len(rows), "rows_with_markers": len(marked), "rows_with_access_codes_only": len(cred_only),
        "rows_with_markers_outside_the_builder_layout": len(layout_bad),
        "rows_changed": len(changed), "rows_left_unchanged": len(results) - len(changed),
        "markers_left_in_changed_rows": sum(1 for o in changed if has_marker(doc_text(o) or "")),
        "outcomes": [{"target": p, "result": res, "reason": why, "rows": n} for (p, res, why), n in sorted(by.items())],
        "totals_delta": dict(delta), "keep_access_codes": args.keep_access_codes, "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(args.packet, "release_results.jsonl"), "w", encoding="utf-8") as h:
        for x in sorted(results, key=lambda x: x["id"]):
            h.write(json.dumps(x, sort_keys=True) + "\n")
    metas = [dataset_meta(writer, DOCS_ID), dataset_meta(writer, PAGES_ID)]
    backup_path = os.path.join(args.packet, "backup_rows.jsonl.gz")
    with gzip.open(backup_path, "wt", encoding="utf-8") as h:
        for m in metas:
            h.write(json.dumps({"kind": "meta", "meta": m}, sort_keys=True) + "\n")
        for out in changed:
            h.write(json.dumps({"kind": "row", "row": before[out["id"]]}, sort_keys=True) + "\n")
    summary["backup"] = os.path.relpath(backup_path, ROOT).replace(os.sep, "/")

    if args.publish:
        upsert(writer, changed)
        patch_meta(writer, metas, delta)
        bad = readback(writer, changed)
        summary["readback_mismatches"] = bad
        if bad:
            print(json.dumps(summary, indent=1))
            raise SystemExit(f"{len(bad)} rows did not read back as written; restore with --restore {summary['backup']}")
    with open(os.path.join(args.packet, "release_summary.json"), "w", encoding="utf-8") as h:
        json.dump(summary, h, indent=1, sort_keys=True)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
