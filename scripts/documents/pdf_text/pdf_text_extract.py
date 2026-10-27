"""Detached, resumable full-text extractor for the private PDF library.

  text  : worklist -> bytes (local copy if present, else the private bucket with the service key; sequential-ish, modest concurrency)
          -> SHA-256 verified BEFORE extraction -> PyMuPDF text layer -> staged record. Pages that need OCR stay 'ocr_pending'.
  ocr   : worklist -> staged record (or a fresh text pass) -> machine OCR (surya, offline) of the pending pages only, one page at a time,
          every page checkpointed so a crash loses at most one page -> staged record rewritten.

Nothing is written to the database here: records go to the staging directory and the loader (pdf-text-load.mjs) sends them through
corpus_admin_register_pdf_texts_v1. A worklist row is {"sha256","bytes"?,"storage_key"?,"rank"?}; the order of the file is the priority order
(scripts/documents/text_backlog.py writes one for the documents layer's not_extracted backlog).

Provenance: imported on 2026-10-27 from the out-of-tree extractor (wt-backfill scripts/ingest/pdf-text, extractor_version pdf-text/2) that
produced the 36,209 stored texts of 2026-10-03/04. Only the credential handling changed: the bucket credentials now come from the
environment (EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY, or EXTERNAL_SUPABASE_KEY), are checked against the corpussite
project and are never printed or written. Run with the Python that has PyMuPDF 1.26.7 (and, for the ocr stage, surya 0.17.0):
  python -I -B scripts/documents/pdf_text/pdf_text_extract.py text --worklist <worklist.jsonl> --staging <dir>
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import http.client
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pdf_text_lib as lib  # noqa: E402

PROJECT = "xosqzzsnhxcyehcnirpa"
BUCKET = "corpus-originals"
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530}


class Missing(Exception):
    pass


class HashMismatch(Exception):
    pass


def default_key(sha: str) -> str:
    return "seeger-weiss/pdf-sha256/" + sha[:2] + "/" + sha + ".pdf"


def bucket_credentials(env=None) -> tuple[str, str]:
    """(base url, server key) from the environment only. Refuses another project or a publishable key; never echoes the key."""
    env = os.environ if env is None else env
    url = (env.get("EXTERNAL_SUPABASE_URL") or "").strip().rstrip("/")
    key = (env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") or env.get("EXTERNAL_SUPABASE_KEY") or "").strip()
    if url != "https://" + PROJECT + ".supabase.co":
        raise SystemExit("WRONG_PROJECT_OR_URL_MISSING")
    if not key or key.startswith("sb_publishable_"):
        raise SystemExit("SERVER_KEY_MISSING")
    return url, key


class Fetcher:
    """Verified PDF bytes by SHA-256: local copies first (hash re-verified), then the private bucket."""

    def __init__(self, local_dirs: list[str], use_bucket: bool, max_bytes: int, env=None):
        self.local_dirs = [d for d in local_dirs if d and os.path.isdir(d)]
        self.max_bytes = max_bytes
        self.base = None
        self.headers: dict = {}
        if use_bucket:
            url, key = bucket_credentials(env)
            self.base = url
            self.headers = {"apikey": key}
            if not key.startswith("sb_"):
                self.headers["Authorization"] = "Bearer " + key

    def local(self, sha: str, size: int | None):
        for d in self.local_dirs:
            for path in (os.path.join(d, sha + ".pdf"), os.path.join(d, sha[:2], sha + ".pdf")):  # flat (official-mdl peek) or sharded (the OCR cache)
                if os.path.exists(path):
                    if size is not None and os.path.getsize(path) != size:
                        continue
                    with open(path, "rb") as fh:
                        data = fh.read()
                    if lib.sha256_hex(data) == sha:
                        return data
        return None

    def download(self, sha: str, key: str | None) -> bytes:
        if not self.base:
            raise Missing("NO_CREDENTIALS_FOR_BUCKET_DOWNLOAD")
        url = self.base + "/storage/v1/object/" + BUCKET + "/" + urllib.parse.quote(key or default_key(sha), safe="/")
        delay = 2.0
        last = None
        for _ in range(7):
            try:
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=120) as resp:
                    declared = resp.headers.get("Content-Length")
                    if declared and int(declared) > self.max_bytes:
                        raise Missing("TOO_LARGE")
                    return resp.read()
            except urllib.error.HTTPError as exc:
                if exc.code in (400, 404):
                    raise Missing("OBJECT_MISSING_" + str(exc.code))
                if exc.code not in TRANSIENT_HTTP:
                    raise
                last = exc
            except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, http.client.HTTPException) as exc:
                last = exc  # includes IncompleteRead: a download that was cut off is retried, never extracted
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
        raise last if last else RuntimeError("DOWNLOAD_FAILED")

    def get(self, row: dict):
        sha, size = row["sha256"], row.get("bytes")
        data = self.local(sha, size)
        if data is not None:
            return data, "local"
        data = self.download(sha, row.get("storage_key"))
        if (size is not None and len(data) != size) or lib.sha256_hex(data) != sha:
            raise HashMismatch("HASH_OR_SIZE_MISMATCH")
        return data, "bucket"


def read_worklist(path: str) -> list[dict]:
    rows, seen = [], set()
    for row in lib.read_jsonl(path):
        sha = row.get("sha256")
        if isinstance(sha, str) and len(sha) == 64 and sha not in seen:
            seen.add(sha)
            rows.append(row)
    return rows


class Run:
    def __init__(self, args, stage: str):
        self.args = args
        self.stage = stage
        self.staging = args.staging
        os.makedirs(self.staging, exist_ok=True)
        self.receipts_path = os.path.join(self.staging, stage + "-receipts.jsonl")
        self.progress_path = os.path.join(self.staging, "progress-" + stage + ".json")
        self.inflight_path = os.path.join(self.staging, "inflight-" + stage + ".json")
        self.stop_paths = [os.path.join(self.staging, "STOP"), os.path.join(self.staging, "STOP-" + stage)]  # STOP stops every stage, STOP-<stage> just this one
        self.started = time.time()
        self.counts = {"docs": 0, "pages": 0, "chars": 0, "ocr_pages": 0, "ocr_seconds": 0.0, "text_seconds": 0.0, "pending_pages": 0,
                       "failed": 0, "crashed": 0, "skipped_done": 0, "local": 0, "bucket": 0, "bytes": 0}
        self.crashed = set()
        self._recover_inflight()

    def _recover_inflight(self):
        retry = getattr(self.args, "retry_crashed", False)
        for r in lib.read_jsonl(self.receipts_path):
            # a later non-crash receipt for the same document (a retry that finished) clears the mark
            if r.get("status") == "crashed":
                self.crashed.add(r["sha256"])
            elif r["sha256"] in self.crashed:
                self.crashed.discard(r["sha256"])
        if retry:
            self.crashed = set()
        if os.path.exists(self.inflight_path):
            try:
                with open(self.inflight_path, encoding="utf-8") as fh:
                    marker = json.load(fh)
                sha = marker.get("sha256")
                if sha and sha not in self.crashed and not retry:
                    # an operator restart can also land here: the mark only keeps a genuine poison document from being retried forever;
                    # --retry-crashed forgets every mark
                    self.crashed.add(sha)
                    lib.append_jsonl(self.receipts_path, {"sha256": sha, "status": "crashed", "note": "process ended while this document was in flight", "ts": now()})
                    self.counts["crashed"] += 1
            except (OSError, json.JSONDecodeError):
                pass
            try:
                os.remove(self.inflight_path)
            except OSError:
                pass

    def mark(self, sha: str):
        def write():
            with open(self.inflight_path, "w", encoding="utf-8") as fh:
                json.dump({"sha256": sha, "started": now()}, fh)

        try:
            lib.retry_io(write, attempts=10, delay=0.2)
        except OSError:
            pass  # without a marker only the poison-pill protection of this one document is lost

    def unmark(self):
        try:
            os.remove(self.inflight_path)
        except OSError:
            pass

    def receipt(self, obj: dict):
        obj["ts"] = now()
        lib.append_jsonl(self.receipts_path, obj)

    def progress(self, force=False, extra: dict | None = None):
        if not force and self.counts["docs"] % 10 != 0:
            return
        elapsed = max(time.time() - self.started, 1e-6)
        c = self.counts
        doc = {"stage": self.stage, "updated_at": now(), "elapsed_s": round(elapsed), **c,
               "text_pages_per_min": round(c["pages"] / max(c["text_seconds"], 1e-6) * 60, 1) if c["text_seconds"] else None,
               "ocr_seconds_per_page": round(c["ocr_seconds"] / c["ocr_pages"], 1) if c["ocr_pages"] else None, "docs_per_min": round(c["docs"] / elapsed * 60, 1)}
        try:
            import psutil

            info = psutil.Process().memory_info()
            doc.update({"rss_mb": round(info.rss / 2 ** 20), "commit_mb": round(info.vms / 2 ** 20)})
        except Exception:  # noqa: BLE001
            pass
        if extra:
            doc.update(extra)
        tmp = self.progress_path + ".part"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, indent=1)
            lib.retry_io(lambda: os.replace(tmp, self.progress_path), attempts=6, delay=0.2)
        except OSError:
            pass  # a progress snapshot is only a convenience: never let a locked file stop the run

    def should_stop(self) -> bool:
        if any(os.path.exists(p) for p in self.stop_paths):
            return True
        pages_cap = getattr(self.args, "max_ocr_pages", 0)
        if pages_cap and self.counts["ocr_pages"] >= pages_cap:
            return True  # recycle: the CPU torch allocator keeps growing, so an OCR process exits after a bounded number of pages and is restarted by the loop
        limit = self.args.max_minutes
        return bool(limit) and (time.time() - self.started) > limit * 60


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def cache_for_ocr(staging: str, sha: str, data: bytes, cap_bytes: int) -> bool:
    folder = os.path.join(staging, "ocr-cache", sha[:2])
    path = os.path.join(folder, sha + ".pdf")
    if os.path.exists(path):
        return True
    total = 0
    root = os.path.join(staging, "ocr-cache")
    if os.path.isdir(root):
        for dirpath, _, files in os.walk(root):
            total += sum(os.path.getsize(os.path.join(dirpath, f)) for f in files)
    if total + len(data) > cap_bytes:
        return False
    os.makedirs(folder, exist_ok=True)
    with open(path + ".part", "wb") as fh:
        fh.write(data)
    os.replace(path + ".part", path)
    return True


def prefetching(rows, fetcher: Fetcher, concurrency: int, window: int):
    """Yields (row, data|None, source|None, error|None) in worklist order while downloads run ahead on a small thread pool."""
    pending: list = []
    it = iter(rows)
    with cf.ThreadPoolExecutor(max_workers=concurrency) as pool:
        def top_up():
            while len(pending) < window:
                try:
                    row = next(it)
                except StopIteration:
                    return
                pending.append((row, pool.submit(fetcher.get, row)))
        top_up()
        while pending:
            row, fut = pending.pop(0)
            top_up()
            try:
                data, source = fut.result()
                yield row, data, source, None
            except (Missing, HashMismatch) as exc:
                yield row, None, None, str(exc)
            except Exception as exc:  # noqa: BLE001
                yield row, None, None, "FETCH_ERROR:" + type(exc).__name__ + ":" + str(exc)[:120]


def run_text(args) -> int:
    run = Run(args, args.stage_name or "text")  # a second text process (e.g. a --redo pass) uses its own receipts / progress / in-flight / STOP files
    rows = read_worklist(args.worklist)
    todo = []
    for row in rows:
        sha = row["sha256"]
        if sha in run.crashed:
            continue
        if not args.redo and os.path.exists(lib.record_path(args.staging, sha)):
            run.counts["skipped_done"] += 1
            continue
        todo.append(row)
    if args.limit:
        todo = todo[: args.limit]
    fetcher = Fetcher(args.local_dirs, not args.no_bucket, args.max_mb * 1024 * 1024)
    print(json.dumps({"event": "start", "stage": "text", "worklist": len(rows), "todo": len(todo), "staging": args.staging}), flush=True)
    for row, data, source, error in prefetching(todo, fetcher, args.concurrency, args.concurrency * 2):
        if run.should_stop():
            print(json.dumps({"event": "stop_requested"}), flush=True)
            break
        sha = row["sha256"]
        if error:
            run.counts["failed"] += 1
            run.receipt({"sha256": sha, "status": "failed", "reason": error})
            print(json.dumps({"sha": sha[:12], "failed": error}), flush=True)
            continue
        run.mark(sha)
        t0 = time.time()
        try:
            record = lib.process_pdf(data, sha, source=source, ocr=None)
        except Exception as exc:  # noqa: BLE001
            run.unmark()
            run.counts["failed"] += 1
            run.receipt({"sha256": sha, "status": "failed", "reason": "EXTRACT_ERROR:" + type(exc).__name__ + ":" + str(exc)[:120]})
            continue
        dt = time.time() - t0
        try:
            lib.write_record(args.staging, record)
        except OSError as exc:
            run.unmark()
            run.counts["failed"] += 1
            run.receipt({"sha256": sha, "status": "failed", "reason": "WRITE_ERROR:" + type(exc).__name__ + ":" + str(exc)[:120]})
            continue
        run.unmark()
        c = run.counts
        c["docs"] += 1
        c["pages"] += record["page_count"]
        c["chars"] += record["chars"]
        c["pending_pages"] += record["ocr_pending_pages"]
        c["text_seconds"] += dt
        c[source] += 1
        c["bytes"] += len(data)
        run.receipt({"sha256": sha, "status": record["status"], "pages": record["page_count"], "chars": record["chars"], "pending": record["ocr_pending_pages"],
                     "source": source, "ms": int(dt * 1000), "bytes": len(data)})
        if record["ocr_pending_pages"] and args.ocr_cache_gb:
            try:
                cache_for_ocr(args.staging, sha, data, int(args.ocr_cache_gb * 1024 ** 3))
            except OSError:
                pass  # the cache only saves a re-download for the OCR stage
        run.progress()
    run.progress(force=True, extra={"finished": True})
    return 0


def pages_from_record(record: dict) -> list[dict]:
    by_page = {r["page"]: r for r in record["pages"]}
    pages = []
    for m in record["pages_meta"]:
        n = m["p"]
        p = {"page": n, "state": m["state"], "reason": m.get("reason"), "image_cover": m.get("img", 0.0), "text": ""}
        if m["state"] == "text":
            p["text"] = by_page[n]["text"]
            p["engine"] = by_page[n]["engine"]
            if p["engine"] == "surya-ocr":
                p["ocr_confidence"] = by_page[n].get("ocr_confidence")
                p["ocr_low_conf_lines"] = m.get("low_conf_lines", 0)
        pages.append(p)
    return pages


def partial_path(staging: str, sha: str) -> str:
    return os.path.join(staging, "ocr-partial", sha[:2], sha + ".jsonl")


def run_ocr(args) -> int:
    from pdf_text_ocr import SuryaEngine, ModelMissing

    run = Run(args, "ocr")
    rows = read_worklist(args.worklist)
    todo = [r for r in rows if r["sha256"] not in run.crashed]
    if args.limit:
        todo = todo[: args.limit]
    fetcher = Fetcher(args.local_dirs, not args.no_bucket, args.max_mb * 1024 * 1024)
    print(json.dumps({"event": "start", "stage": "ocr", "worklist": len(rows), "todo": len(todo), "threads": args.threads}), flush=True)
    try:
        engine = SuryaEngine(threads=args.threads)
    except ModelMissing as exc:
        print(json.dumps({"event": "model_missing", "detail": str(exc)}), flush=True)
        return 2
    print(json.dumps({"event": "engine_ready", "label": engine.label, "device": engine.device}), flush=True)
    import fitz

    for row in todo:
        if run.should_stop():
            print(json.dumps({"event": "stop_requested"}), flush=True)
            break
        sha = row["sha256"]
        record = lib.read_record(args.staging, sha)
        if record is not None and record["status"] != "partial_ocr_pending" and not args.redo:
            run.counts["skipped_done"] += 1
            continue
        if record is not None and record["status"] == "partial_ocr_pending" and args.max_pending_pages and record["ocr_pending_pages"] > args.max_pending_pages:
            continue
        run.mark(sha)
        try:
            cached = os.path.join(args.staging, "ocr-cache", sha[:2], sha + ".pdf")
            if os.path.exists(cached):
                with open(cached, "rb") as fh:
                    data, source = fh.read(), "ocr-cache"
                if lib.sha256_hex(data) != sha:
                    data, source = fetcher.get(row)
            else:
                data, source = fetcher.get(row)
        except (Missing, HashMismatch) as exc:
            run.unmark()
            run.counts["failed"] += 1
            run.receipt({"sha256": sha, "status": "failed", "reason": str(exc)})
            continue
        doc, reason = lib.open_pdf(data)
        if doc is None:
            run.unmark()
            lib.write_record(args.staging, lib.unreadable_record(sha256=sha, size=len(data), reason=reason or "unreadable", pymupdf_version=fitz.VersionBind, source=source))
            run.counts["failed"] += 1
            run.receipt({"sha256": sha, "status": "unreadable", "reason": reason})
            continue
        try:
            t_text = time.time()
            pages = pages_from_record(record) if record is not None and not args.redo else lib.extract_text_layer(doc)
            run.counts["text_seconds"] += time.time() - t_text
            partial_file = partial_path(args.staging, sha)
            done_pages = {}
            for line in lib.read_jsonl(partial_file):
                done_pages[line["page"]] = line
            pending = [i for i, p in enumerate(pages) if p["state"] == "ocr_pending"]
            if args.max_pages_per_doc:
                pending = pending[: args.max_pages_per_doc]
            interrupted = False
            for i in pending:
                n = pages[i]["page"]
                if n in done_pages and "text" in done_pages[n]:
                    result = done_pages[n]
                elif done_pages.get(n, {}).get("failures", 0) >= 2:
                    continue  # this page failed twice already; it stays 'ocr_pending'
                else:
                    if run.should_stop():
                        interrupted = True
                        break
                    t0 = time.time()
                    try:
                        result = engine.recognize([lib.render_page(doc, i, 96)], [lib.render_page(doc, i, 192)])[0]
                    except Exception as exc:  # noqa: BLE001
                        fails = done_pages.get(n, {}).get("failures", 0) + 1
                        lib.append_jsonl(partial_file, {"sha256": sha, "page": n, "failures": fails, "error": type(exc).__name__ + ":" + str(exc)[:120], "ts": now()})
                        run.counts["failed"] += 1
                        continue
                    dt = time.time() - t0
                    run.counts["ocr_pages"] += 1
                    run.counts["ocr_seconds"] += dt
                    result = {"sha256": sha, "page": n, "text": result["text"], "confidence": result["confidence"], "lines": result["lines"],
                              "low_conf_lines": result["low_conf_lines"], "ms": int(dt * 1000), "label": engine.label, "ts": now()}
                    lib.append_jsonl(partial_file, result)
                    print(json.dumps({"sha": sha[:12], "page": n, "lines": result["lines"], "s": round(dt, 1), "conf": round(result["confidence"], 3)}), flush=True)
                    run.progress(force=True)
                lib.apply_ocr(pages, i, result["text"], result["confidence"], result.get("lines", 0), result.get("low_conf_lines", 0))
            final = lib.build_record(sha256=sha, size=len(data), pages=pages, status_hint=None, note=None, pymupdf_version=fitz.VersionBind, ocr_label=engine.label,
                                     source=source, timing_ms={})
            try:
                lib.write_record(args.staging, final)
            except OSError as exc:
                # the OCR results are safe in the page checkpoints; the record is rebuilt from them on the next run
                run.counts["failed"] += 1
                run.receipt({"sha256": sha, "status": "failed", "reason": "WRITE_ERROR:" + type(exc).__name__ + ":" + str(exc)[:120]})
                continue
        finally:
            doc.close()
            run.unmark()
        c = run.counts
        c["docs"] += 1
        c["pages"] += final["page_count"]
        c["chars"] += final["chars"]
        c["pending_pages"] += final["ocr_pending_pages"]
        run.receipt({"sha256": sha, "status": final["status"], "pages": final["page_count"], "chars": final["chars"], "pending": final["ocr_pending_pages"],
                     "source": source, "interrupted": interrupted})
        run.progress(force=True)
        if interrupted:
            break
    run.progress(force=True, extra={"finished": True})
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("text", "ocr"):
        p = sub.add_parser(name)
        p.add_argument("--worklist", required=True)
        p.add_argument("--staging", required=True, help="staging directory for records/receipts (keep it under private/, which git ignores)")
        p.add_argument("--local-dirs", nargs="*", default=[], help="folders of local copies named <sha256>.pdf or <aa>/<sha256>.pdf (hash re-verified)")
        p.add_argument("--no-bucket", action="store_true", help="never use the bucket (local copies only; no credentials needed)")
        p.add_argument("--limit", type=int, default=0)
        p.add_argument("--max-mb", type=int, default=400)
        p.add_argument("--max-minutes", type=float, default=0)
        p.add_argument("--redo", action="store_true")
        p.add_argument("--retry-crashed", action="store_true", help="forget the crashed marks (a document that ended the process while in flight)")
    t = sub.choices["text"]
    t.add_argument("--stage-name", default=None, help="name of this text pass for receipts/progress/STOP files (default: text)")
    t.add_argument("--concurrency", type=int, default=3)
    t.add_argument("--ocr-cache-gb", type=float, default=6.0)
    o = sub.choices["ocr"]
    o.add_argument("--threads", type=int, default=10)
    o.add_argument("--max-ocr-pages", type=int, default=0, help="exit cleanly after this many OCR'd pages (the loop restarts the process: bounded memory)")
    o.add_argument("--max-pages-per-doc", type=int, default=0)
    o.add_argument("--max-pending-pages", type=int, default=0, help="skip documents with more pending pages than this")
    args = ap.parse_args()
    try:  # this machine also runs the PDF transfer runners and other agents: the extractor never competes at normal priority
        import psutil

        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    except Exception:  # noqa: BLE001
        pass
    return run_text(args) if args.cmd == "text" else run_ocr(args)


if __name__ == "__main__":
    sys.exit(main())
