"""Release the contact details judge_practice_documents text hid before 2026-10-27 (owner decision 2026-10-27, "dont withhold any data").

Until 2026-10-27 fetch_docs.py replaced e-mail addresses, telephone numbers and lines naming courtroom staff in the stored text with
"[email omitted]", "[phone omitted]", "[line naming courtroom staff omitted]" and (judge pages) "[staff contact block omitted]". The courts
publish these details on their own practice pages and documents; owner rule 2026-10-22 (3) allows named individuals the official publisher
makes public, shown as published. Nothing in these documents carries a court- or provider-reported seal or restriction, so nothing stays held.

What this does, per record whose `redactions` counts are non-zero or whose text carries a marker (the targets):
  1. download the original from corpus-originals by the key the record carries and check its SHA-256 against the record;
  2. extract the text with the record's own method (judge page: extract_text.html_text; file: extract_text.extract with the detected type);
  3. prove the fresh text is the text the record was made from: cap(legacy redaction(fresh)) must equal the published text exactly;
  4. only then replace the record's text with cap(fresh) and set text_chars, text_chars_total, text_truncated, text_sha256 and text_method
     (judge pages drop "; staff contact blocks in the page header omitted"), clear `redactions` and drop the "Redacted from the text" fact.
A target that fails any step keeps its published text and is listed in the report with the reason; nothing is guessed or patched by hand.
Every other record is written back unchanged except that its "Redacted from the text: None" fact and all-zero counts are dropped (the
dataset no longer redacts); its text is untouched. The extractors must be the ones the records were built with (poppler pdftotext, python-docx,
LibreOffice, bs4); a different pdftotext (e.g. xpdf 4.x) makes step 3 fail, never publishes a different text.

Files (in --out, default private/acq/release-judge-practice-contact-redaction/, git-ignored):
  prior_rows.jsonl, prior_dataset.json   the published dataset before the release (the rollback)
  release_rows.jsonl                     every row in ordinal order, targets released
  report.json                            counts, per-target outcome, SHA-256 of the files above

    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py                 # dry run: read, download, check, write files
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --publish       # then republish with corpus_writer.publish
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --rollback      # republish prior_rows.jsonl / prior_dataset.json
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --file-types html   # dry run on the targets of those file types only

A dry run refuses to write into an --out folder that already holds a snapshot (prior_rows.jsonl or report.json): a second dry run
after --publish would otherwise replace the pre-release snapshot with the released dataset and make --rollback a no-op. Use a new
--out folder (or --force-new-snapshot deliberately). --rollback only accepts a snapshot whose digest equals the catalog manifest the
dry run read (prior_rows_digest == prior_manifest_sha256), i.e. the published dataset byte for byte.
A partial release (--file-types, or --allow-partial) keeps the earlier redaction on the targets it did not release; the dataset's
privacy line and redacted_* totals then say how many documents still carry it.
    python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --update-doc-records private/build/judge_practices/docs

Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (or private/scratch/env.sh, as store.py reads it); never printed.
"""
from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import os
import sys
import tempfile
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import extract_text as xt  # noqa: E402

DATASET = "judge_practice_documents"
OUT = os.path.join(ROOT, "private", "acq", "release-judge-practice-contact-redaction")
SELECT = "dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters"
PAGE_SUFFIX = "; staff contact blocks in the page header omitted"
REDACTED_FACT = "Redacted from the text"


# ------------------------------------------------------------------------------------------------------------------ pure parts (tested)
def prefix_of(row: dict) -> str:
    """corpus_writer.record() stores text as " ".join of id, title, subtitle and the document text (empty parts left out)."""
    sub = (row.get("item") or {}).get("subtitle") or ""
    return " ".join(str(p) for p in [row["id"], row["title"], sub] if p)


def body_of(row: dict) -> str | None:
    """The document text of a published row, or None when the row text does not start with its own prefix."""
    pre, text = prefix_of(row), row.get("text") or ""
    if text == pre:
        return ""
    if text.startswith(pre + " "):
        return text[len(pre) + 1:]
    return None


def is_target(row: dict) -> bool:
    pd = (row.get("item") or {}).get("practice_document") or {}
    counts = pd.get("redactions") if isinstance(pd.get("redactions"), dict) else {}
    return any(int(v or 0) for v in counts.values()) or xt.has_legacy_marker(row.get("text") or "")


def legacy_text(fresh: str, page_text: bool) -> str:
    """The text fetch_docs.py stored before 2026-10-27 for this fresh extraction (redaction, then the cap; the build removed BOMs)."""
    red, _ = (xt.redact_page if page_text else xt.redact)(fresh) if fresh else ("", None)
    return xt.cap(red)[0].replace("﻿", "")


def text_fact(chars: int, total: int | None, truncated: bool, method: str | None) -> str:
    """The "Text" fact exactly as build_judge_practices.py writes it."""
    return f"{chars:,} characters" + (f" of {total:,} (capped)" if truncated else "") + f"; {method or 'no extraction'}"


def release_row(row: dict, fresh: str) -> tuple[dict | None, str]:
    """(released row, "released") or (None, reason). `fresh` is the text extracted now from the verified original."""
    pd = (row.get("item") or {}).get("practice_document") or {}
    page_text = pd.get("kind") == "page_text"
    published = body_of(row)
    if published is None:
        return None, "row text does not start with its id, title and subtitle"
    if hashlib.sha256(published.encode()).hexdigest() != pd.get("text_sha256"):
        return None, "published text does not match the record's text_sha256"
    if not fresh:
        return None, "fresh extraction is empty"
    if legacy_text(fresh, page_text) != published:
        return None, "fresh extraction does not reproduce the published text (extractor differs from the build's)"
    capped, truncated, total = xt.cap(fresh)
    capped = capped.replace("﻿", "")
    if xt.has_legacy_marker(capped):
        return None, "the court's own text contains a legacy marker string; left for review"
    out = norm(copy.deepcopy(row))
    npd = out["item"]["practice_document"]
    method = npd.get("text_method") or ""
    if method.endswith(PAGE_SUFFIX):
        method = method[: -len(PAGE_SUFFIX)]
    npd.update(text_chars=len(capped), text_chars_total=total, text_truncated=bool(truncated), text_method=method or None, redactions=None,
               text_sha256=hashlib.sha256(capped.encode()).hexdigest())
    facts = []
    for f in (out.get("detail") or {}).get("facts") or []:
        if isinstance(f, list) and f and f[0] == REDACTED_FACT:
            continue
        if isinstance(f, list) and len(f) == 2 and f[0] == "Text":
            f = ["Text", text_fact(len(capped), total, bool(truncated), npd["text_method"])]
        facts.append(f)
    out["detail"]["facts"] = facts
    out["text"] = " ".join(p for p in [prefix_of(out), capped] if p)
    return out, "released"


def tidy_untouched(row: dict) -> dict:
    """A row nothing was redacted from: its "Redacted from the text: None" fact and all-zero counts go (the dataset no longer redacts).
    A row with non-zero counts (a target that was not released) is returned unchanged apart from norm()."""
    out = norm(copy.deepcopy(row))
    pd = (out.get("item") or {}).get("practice_document")
    if not isinstance(pd, dict) or is_target(out):
        return out
    pd["redactions"] = None
    detail = out.get("detail") or {}
    if isinstance(detail.get("facts"), list):
        detail["facts"] = [f for f in detail["facts"] if not (isinstance(f, list) and f and f[0] == REDACTED_FACT and f[-1] == "None")]
    return out


def updated_summary(summary: dict, rows: list[dict] | None = None) -> dict:
    """The dataset summary after the release. With `rows` (the rows being published), documents that still carry the earlier
    redaction (targets not released) are counted: the privacy line says how many, and the redacted_* totals are recounted from them."""
    s = dict(summary or {})
    totals = dict(s.get("totals") or {})
    for k in [k for k in totals if k.startswith("redacted_")]:
        totals.pop(k)
    still = [r for r in (rows or []) if is_target(r)]
    s["privacy"] = xt.PRIVACY
    if still:
        s["privacy"] += (f" The text of {len(still):,} documents still carries the contact redaction made before 2026-10-27 "
                         "(marked in the text) until it is re-extracted with the original tools.")
        sums = Counter()
        for r in still:
            for k, v in (((r.get("item") or {}).get("practice_document") or {}).get("redactions") or {}).items():
                sums[f"redacted_{k}"] += int(v or 0)
        totals.update({k: v for k, v in sorted(sums.items()) if v})
        totals["documents_still_redacted"] = len(still)
    if totals:
        s["totals"] = totals
    return s


def norm(row: dict) -> dict:
    """A fetched row in the shape corpus_writer.record() builds: no ordinal (publish assigns it), no empty county_geoids."""
    out = {k: v for k, v in row.items() if k != "ordinal"}
    if out.get("county_geoids") in ([], None):
        out.pop("county_geoids", None)
    return out


def digest(rows: list[dict]) -> str:
    """corpus_writer.publish()'s manifest_sha256 of these rows."""
    return hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()


def sha_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def write_jsonl(path: str, rows: list[dict]) -> str:
    with open(path + ".tmp", "w", encoding="utf-8") as h:
        for r in rows:
            h.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(path + ".tmp", path)
    return sha_file(path)


def load_json(path: str):
    with open(path, encoding="utf-8") as h:
        return json.load(h)


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as h:
        return [json.loads(l) for l in h if l.strip()]


# ------------------------------------------------------------------------------------------------------------------ network parts
def fetch_prior() -> tuple[list[dict], dict]:
    import corpus_writer as writer

    rows = writer.fetch_all(DATASET, select=SELECT)
    ds = writer._call("GET", f"corpus_datasets?id=eq.{DATASET}&select=id,label,metadata,expected_records,imported_records,manifest_sha256")
    if not ds:
        raise SystemExit(f"{DATASET}: no catalog entry")
    rows.sort(key=lambda r: (r.get("ordinal") or 0, r["id"]))
    return rows, ds[0]


class Originals:
    def __init__(self):
        sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "caselaw"))
        import store  # scripts/enrichment/caselaw/store.py: credentials from the environment, project host checked

        self.st = store.Storage()

    def get(self, key: str) -> bytes:
        st = self.st
        r = st._retry(lambda: st.s.get(st._object_url(key, True), headers=st.h, params={"readback": uuid.uuid4().hex}, timeout=st.timeout))
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} for the stored original")
        return r.content


def fresh_text(pd: dict, body: bytes, tmp: str) -> str:
    if pd.get("kind") == "page_text":
        return xt.html_text(body).text
    kind = pd.get("detected_type") or "unknown"
    path = os.path.join(tmp, f"{pd['id']}.{pd.get('file_type') or 'bin'}")
    with open(path, "wb") as h:
        h.write(body)
    try:
        ex = xt.extract(path, kind)
    finally:
        os.remove(path)
    if ex.error:
        raise RuntimeError(f"extraction: {ex.error}")
    return ex.text


def process(row: dict, originals: Originals, tmp: str) -> tuple[str, dict | None, str]:
    pd = row["item"]["practice_document"]
    st = pd.get("storage") or {}
    key, sha = st.get("key"), pd.get("sha256")
    if not key or not sha or not pd.get("stored"):
        return row["id"], None, "no stored original recorded"
    try:
        body = originals.get(key)
    except Exception as e:  # noqa: BLE001 - reported per record
        return row["id"], None, f"download failed: {str(e)[:160]}"
    if hashlib.sha256(body).hexdigest() != sha:
        return row["id"], None, "stored original's SHA-256 differs from the record"
    try:
        fresh = fresh_text(pd, body, tmp)
    except Exception as e:  # noqa: BLE001
        return row["id"], None, f"{type(e).__name__}: {str(e)[:160]}"
    new, status = release_row(row, fresh)
    return row["id"], new, status


# ------------------------------------------------------------------------------------------------------------------ commands
def dry_run(out: str, workers: int, limit: int, file_types: set[str] | None = None, force_new_snapshot: bool = False) -> dict:
    os.makedirs(out, exist_ok=True)
    existing = [f for f in ("prior_rows.jsonl", "report.json") if os.path.exists(os.path.join(out, f))]
    if existing and not force_new_snapshot:
        raise SystemExit(f"{out} already holds {', '.join(existing)}: a new dry run would replace the rollback snapshot. "
                         "Use a new --out folder (keep this one for --rollback), or pass --force-new-snapshot deliberately.")
    rows, ds = fetch_prior()
    prior_sha = write_jsonl(os.path.join(out, "prior_rows.jsonl"), rows)
    with open(os.path.join(out, "prior_dataset.json"), "w", encoding="utf-8") as h:
        json.dump(ds, h, ensure_ascii=False, sort_keys=True, indent=1)
    targets = [r for r in rows if is_target(r)]
    all_targets = len(targets)
    if file_types:
        targets = [r for r in targets if (((r.get("item") or {}).get("practice_document") or {}).get("file_type") or "") in file_types]
    if limit:
        targets = targets[:limit]
    originals = Originals()
    released: dict[str, dict] = {}
    outcome: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="jp_release_", dir=os.environ.get("JP_TMP")) as tmp, ThreadPoolExecutor(workers) as pool:
        for rid, new, status in pool.map(lambda r: process(r, originals, tmp), targets):
            outcome[rid] = status
            if new is not None:
                released[rid] = new
    out_rows = [released.get(r["id"]) or tidy_untouched(r) for r in rows]
    release_sha = write_jsonl(os.path.join(out, "release_rows.jsonl"), out_rows)
    after_markers = sum(1 for r in out_rows if xt.has_legacy_marker(r.get("text") or ""))
    report = {
        "dataset": DATASET, "rows": len(rows), "targets": len(targets), "all_targets": all_targets,
        "file_types": sorted(file_types) if file_types else None,
        # same as the packet's selection query: sha256 of the sorted target ids joined by newlines
        "target_ids_sha256": hashlib.sha256("\n".join(sorted(r["id"] for r in targets)).encode()).hexdigest(),
        "targets_with_marker": sum(1 for r in targets if xt.has_legacy_marker(r.get("text") or "")),
        "released": len(released), "not_released": len(targets) - len(released),
        "not_released_by_reason": dict(Counter(s for s in outcome.values() if s != "released")),
        "rows_with_marker_after": after_markers,
        "outcome": outcome,
        "files": {"prior_rows.jsonl": prior_sha, "release_rows.jsonl": release_sha,
                  "prior_dataset.json": sha_file(os.path.join(out, "prior_dataset.json"))},
        "prior_manifest_sha256": ds.get("manifest_sha256"),
        # the snapshot is the published dataset byte for byte when its digest equals the catalog's manifest_sha256
        "prior_rows_digest": digest([norm(r) for r in rows]), "release_rows_digest": digest(out_rows), "limit": limit or None,
    }
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as h:
        json.dump(report, h, indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in report.items() if k != "outcome"}, indent=1, sort_keys=True))
    return report


def publish(out: str, allow_partial: bool) -> None:
    import corpus_writer as writer

    report = load_json(os.path.join(out, "report.json"))
    if report.get("limit"):
        raise SystemExit("the dry run was limited (--limit); run it in full before publishing")
    if report["not_released"] and not allow_partial:
        raise SystemExit(f"{report['not_released']} targets were not released ({report['not_released_by_reason']}); fix or pass --allow-partial")
    if report.get("file_types") and not allow_partial:
        raise SystemExit(f"the dry run covered file types {report['file_types']} only ({report['targets']} of {report.get('all_targets')} targets); pass --allow-partial")
    path = os.path.join(out, "release_rows.jsonl")
    if sha_file(path) != report["files"]["release_rows.jsonl"]:
        raise SystemExit("release_rows.jsonl changed since the dry run")
    ds = load_json(os.path.join(out, "prior_dataset.json"))
    rows = read_jsonl(path)
    if len(rows) != report["rows"]:
        raise SystemExit("row count differs from the dry run")
    md = ds.get("metadata") or {}
    listing = {k: v for k, v in (md.get("listing") or {}).items() if k != "total"}
    writer.publish(DATASET, ds["label"], rows, listing_block=listing, summary=updated_summary(md.get("summary") or {}, rows))


def rollback(out: str, force: bool = False) -> None:
    import corpus_writer as writer

    report = load_json(os.path.join(out, "report.json"))
    if report.get("prior_rows_digest") != report.get("prior_manifest_sha256") and not force:
        raise SystemExit("the snapshot's digest differs from the manifest the dry run read, so it may not be the pre-release dataset; "
                         "check it, then pass --force-rollback")
    path = os.path.join(out, "prior_rows.jsonl")
    if sha_file(path) != report["files"]["prior_rows.jsonl"]:
        raise SystemExit("prior_rows.jsonl changed since it was saved")
    ds = load_json(os.path.join(out, "prior_dataset.json"))
    rows = [norm(r) for r in read_jsonl(path)]
    md = ds.get("metadata") or {}
    listing = {k: v for k, v in (md.get("listing") or {}).items() if k != "total"}
    writer.publish(DATASET, ds["label"], rows, listing_block=listing, summary=md.get("summary") or {})


def update_doc_records(out: str, docs_dir: str) -> None:
    """Carry the released text into fetch_docs.py's local records (matched by URL) so a later build does not bring the markers back."""
    by_url = {}
    for r in read_jsonl(os.path.join(out, "release_rows.jsonl")):
        pd = r["item"]["practice_document"]
        body = body_of(r)
        if body is not None and pd.get("redactions") is None:
            by_url[pd["url"]] = (body, pd)
    changed = 0
    for p in glob.glob(os.path.join(docs_dir, "*.json")):
        d = load_json(p)
        if not (xt.has_legacy_marker(d.get("text") or "") or any((d.get("redactions") or {}).values())):
            continue
        hit = by_url.get(d.get("url"))
        if not hit or hit[1].get("sha256") != d.get("sha256"):
            continue
        body, pd = hit
        d.update(text=body, text_chars=len(body), text_chars_total=pd.get("text_chars_total"), text_truncated=pd.get("text_truncated"),
                 text_method=pd.get("text_method"), redactions=None, text_sha256=pd.get("text_sha256"))
        with open(p + ".tmp", "w", encoding="utf-8") as h:
            json.dump(d, h, sort_keys=True)
        os.replace(p + ".tmp", p)
        changed += 1
    print(json.dumps({"doc_records_updated": changed}))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="dry run on the first N targets only (cannot be published)")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--allow-partial", action="store_true", help="publish although some targets keep their published text")
    ap.add_argument("--rollback", action="store_true")
    ap.add_argument("--force-rollback", action="store_true", help="roll back although the snapshot digest differs from the manifest")
    ap.add_argument("--file-types", help="comma list (e.g. html): dry run on the targets of these file types only (a partial release)")
    ap.add_argument("--force-new-snapshot", action="store_true", help="let a dry run replace an existing snapshot in --out")
    ap.add_argument("--update-doc-records", metavar="DIR")
    a = ap.parse_args()
    if a.rollback:
        rollback(a.out, a.force_rollback)
    elif a.publish:
        publish(a.out, a.allow_partial)
    elif a.update_doc_records:
        update_doc_records(a.out, a.update_doc_records)
    else:
        types = {t.strip() for t in a.file_types.split(",") if t.strip()} if a.file_types else None
        dry_run(a.out, a.workers, a.limit, types, a.force_new_snapshot)


if __name__ == "__main__":
    main()
