"""Budgeted, resumable embedding of the legal text the corpus already holds (the semantic index).

    cd <repo>
    python3 -I -B scripts/semantic/embed.py plan [--corpus ID ...] [--calibrate N]    # chunk counts and estimates, no API calls
    python3 -I -B scripts/semantic/embed.py run --corpus ID [--max-tokens N] [--workers 4]
    python3 -I -B scripts/semantic/embed.py status

Output (private/build/semantic/<dataset>/): shard-NNNNN.vec.f16 (little-endian float16, rows x 1024), shard-NNNNN.meta.jsonl.gz
(one JSON object per row, in the same order) and manifest.json (parameters, source file digest, shards with sha256, totals,
status). Token usage per corpus and in total is kept in private/build/semantic/usage.json.

Properties:
  * deterministic: the same source rows and chunker parameters give the same chunks, offsets and hashes;
  * resumable: shards close only at record boundaries; a rerun skips every record already in a shard of the manifest;
  * idempotent: a chunk whose embed_sha256 (model, input type and the exact embedded string) is already stored is not sent
    to the service again, its stored vector is copied;
  * budgeted: stops before the token budget (default 400,000,000 in total over all corpora and runs) or when free disk space
    would fall below the floor (default 3.6 GB), and says why in the manifest; a stop is never reported as complete.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import gzip
import hashlib
import json
import math
import os
import shutil
import signal
import sys
import threading
import time
from collections.abc import Callable, Iterable, Iterator

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import sources as src  # noqa: E402
import voyage as vg  # noqa: E402

ROOT = src.ROOT
OUT = os.path.join(ROOT, "private", "build", "semantic")
INDEX_VERSION = "si-1"  # opaque label of the embedding configuration; the model itself is not named in served data
TOTAL_BUDGET = 400_000_000
MIN_FREE_BYTES = 3_600_000_000
SHARD_ROWS = 5000
WINDOW_CHUNKS = 1600
BATCH_TEXTS = 100
BATCH_EST_TOKENS = 70_000
ROW_DISK_BYTES = 2048 + 400


class Stop(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def embed_key(text: str, model: str = vg.MODEL, input_type: str = "document") -> str:
    """Identity of one embedding request input: the model, the input type and the exact string."""
    return hashlib.sha256(f"{model}\x00{input_type}\x00{text}".encode()).hexdigest()


def read_json(path: str):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def atomic_write(path: str, data: bytes) -> None:
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "wb") as handle:
        handle.write(data)
    os.replace(tmp, path)


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# ------------------------------------------------------------------------------------------------------------------ usage
class Usage:
    """Token and request counts per corpus, shared by all runs (also concurrent ones), saved to usage.json.

    Counts accumulate in memory as deltas and are merged into the file under an exclusive lock (usage.json.lock), so two
    corpora can be embedded at once without losing each other's counts. The budget check reads the file, so it sees the other
    run's spending with at most one save of delay; SAFETY_MARGIN keeps that delay from ever crossing the budget."""

    SAFETY_MARGIN = 3_000_000

    def __init__(self, path: str, budget: int):
        self.path, self.budget, self.lock = path, budget, threading.Lock()
        self.pending: dict = {"tokens": 0, "requests": 0, "by_corpus": {}}
        self.ratio_hi = 1.0  # highest recent actual/estimated token ratio, used to reserve before sending

    def _read(self) -> dict:
        data = {"budget_tokens": self.budget, "tokens_used": 0, "requests": 0, "by_corpus": {}, "runs": []}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as handle:
                data.update(json.load(handle))
        data["budget_tokens"] = self.budget
        return data

    @property
    def data(self) -> dict:
        return self._read()

    @property
    def used(self) -> int:
        with self.lock:
            return int(self._read()["tokens_used"]) + int(self.pending["tokens"])

    def add(self, dataset: str, tokens: int, requests: int = 1, chunks: int = 0, retries: int = 0, rate_limited: int = 0) -> None:
        with self.lock:
            self.pending["tokens"] += tokens
            self.pending["requests"] += requests
            c = self.pending["by_corpus"].setdefault(dataset, {"tokens": 0, "requests": 0, "chunks_embedded": 0, "retries": 0, "rate_limited": 0})
            c["tokens"] += tokens
            c["requests"] += requests
            c["chunks_embedded"] += chunks
            c["retries"] += retries
            c["rate_limited"] += rate_limited

    def remaining(self) -> int:
        return self.budget - self.SAFETY_MARGIN - self.used

    def reserve_estimate(self, est_tokens: int) -> int:
        return int(est_tokens * max(1.0, self.ratio_hi) * 1.05)

    def note_ratio(self, est: int, actual: int) -> None:
        if est > 0:
            with self.lock:
                self.ratio_hi = max(0.9 * self.ratio_hi, actual / est)

    def save(self, run: dict | None = None) -> None:
        import fcntl

        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with self.lock, open(self.path + ".lock", "w") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            data = self._read()
            data["tokens_used"] += self.pending["tokens"]
            data["requests"] += self.pending["requests"]
            for name, c in self.pending["by_corpus"].items():
                d = data["by_corpus"].setdefault(name, {"tokens": 0, "requests": 0, "chunks_embedded": 0, "retries": 0, "rate_limited": 0})
                for k, v in c.items():
                    d[k] = d.get(k, 0) + v
            if run:
                data["runs"].append(run)
            data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            atomic_write(self.path, json.dumps(data, indent=1, sort_keys=True).encode())
            self.pending = {"tokens": 0, "requests": 0, "by_corpus": {}}


# --------------------------------------------------------------------------------------------------------- shards on disk
def shard_paths(directory: str, no: int) -> tuple[str, str]:
    base = os.path.join(directory, f"shard-{no:05d}")
    return base + ".vec.f16", base + ".meta.jsonl.gz"


def read_meta(path: str) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle]


class Store:
    """The shards of one dataset: manifest, known embed keys, finished records, and the shard being filled."""

    def __init__(self, directory: str, dataset: str, params: dict, shard_rows: int = SHARD_ROWS):
        self.dir, self.dataset, self.params, self.shard_rows = directory, dataset, params, shard_rows
        os.makedirs(directory, exist_ok=True)
        self.manifest_path = os.path.join(directory, "manifest.json")
        self.manifest = {
            "dataset": dataset,
            "index_version": INDEX_VERSION,
            "dimensions": vg.DIMENSIONS,
            "dtype": "float16",
            "params": params,
            "shards": [],
            "totals": {"records": 0, "chunks": 0, "capped_records": 0, "tokens": 0, "requests": 0, "reused": 0},
            "status": "empty",
        }
        if os.path.exists(self.manifest_path):
            with open(self.manifest_path, encoding="utf-8") as handle:
                old = json.load(handle)
            if old.get("params") != params:
                raise SystemExit(
                    f"{dataset}: existing shards were built with other parameters; remove {directory} to rebuild "
                    "(a rerun never mixes chunkers)"
                )
            self.manifest = old
        self.done_records: set[str] = set()
        self.index: dict[str, tuple[int, int]] = {}
        self._maps: dict[int, np.ndarray] = {}
        listed = {s["name"] for s in self.manifest["shards"]}
        for name in sorted(os.listdir(directory)):  # orphans of an interrupted run are not part of the manifest
            if name.startswith("shard-") and name.split(".")[0] not in listed:
                os.remove(os.path.join(directory, name))
        for no, s in enumerate(self.manifest["shards"]):
            for row, m in enumerate(read_meta(shard_paths(directory, no)[1])):
                self.done_records.add(m["record_id"])
                self.index.setdefault(m["embed_sha256"], (no, row))
        self.next_no = len(self.manifest["shards"])
        self.buf_meta: list[dict] = []
        self.buf_vec: list[np.ndarray] = []
        self.buf_records: set[str] = set()
        self.buf_tokens = 0
        self.buf_requests = 0
        self.buf_reused = 0
        self.buf_capped: set[str] = set()

    # reading back a stored vector (for reuse)
    def vector(self, key: str) -> np.ndarray | None:
        hit = self.index.get(key)
        if hit is None:
            return None
        no, row = hit
        if no == self.next_no:  # in the shard being filled
            offset = 0
            for block in self.buf_vec:
                if row < offset + len(block):
                    return block[row - offset]
                offset += len(block)
            return None
        if no not in self._maps:
            self._maps[no] = np.memmap(shard_paths(self.dir, no)[0], dtype="<f2", mode="r").reshape(-1, vg.DIMENSIONS)
        return np.array(self._maps[no][row])

    def add(self, metas: list[dict], vectors: np.ndarray, records: Iterable[str], capped: Iterable[str], tokens: int, requests: int, reused: int) -> None:
        base = sum(len(b) for b in self.buf_vec)
        for i, m in enumerate(metas):
            self.index.setdefault(m["embed_sha256"], (self.next_no, base + i))
        self.buf_meta.extend(metas)
        self.buf_vec.append(vectors)
        self.buf_records.update(records)
        self.buf_capped.update(capped)
        self.buf_tokens += tokens
        self.buf_requests += requests
        self.buf_reused += reused

    def full(self) -> bool:
        return len(self.buf_meta) >= self.shard_rows

    def flush(self, status: str | None = None) -> None:
        if self.buf_meta:
            vec_path, meta_path = shard_paths(self.dir, self.next_no)
            matrix = np.concatenate(self.buf_vec).astype("<f2", copy=False)
            assert matrix.shape == (len(self.buf_meta), vg.DIMENSIONS)
            tmp_vec = vec_path + ".tmp"
            matrix.tofile(tmp_vec)
            os.replace(tmp_vec, vec_path)
            body = "\n".join(json.dumps(m, ensure_ascii=False, sort_keys=True, separators=(",", ":")) for m in self.buf_meta) + "\n"
            tmp_meta = meta_path + ".tmp"
            with open(tmp_meta, "wb") as raw:
                with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=6) as gz:
                    gz.write(body.encode("utf-8"))
            os.replace(tmp_meta, meta_path)
            self.manifest["shards"].append(
                {
                    "name": f"shard-{self.next_no:05d}",
                    "rows": len(self.buf_meta),
                    "records": len(self.buf_records),
                    "first_record": self.buf_meta[0]["record_id"],
                    "last_record": self.buf_meta[-1]["record_id"],
                    "vec_bytes": os.path.getsize(vec_path),
                    "vec_sha256": file_sha256(vec_path),
                    "meta_sha256": file_sha256(meta_path),
                }
            )
            t = self.manifest["totals"]
            t["records"] += len(self.buf_records)
            t["chunks"] += len(self.buf_meta)
            t["capped_records"] += len(self.buf_capped)
            t["tokens"] += self.buf_tokens
            t["requests"] += self.buf_requests
            t["reused"] += self.buf_reused
            self.done_records |= self.buf_records
            self.next_no += 1
            self.buf_meta, self.buf_vec, self.buf_records, self.buf_capped = [], [], set(), set()
            self.buf_tokens = self.buf_requests = self.buf_reused = 0
        if status:
            self.manifest["status"] = status
        self.manifest["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_write(self.manifest_path, json.dumps(self.manifest, indent=1, sort_keys=True).encode())


# ------------------------------------------------------------------------------------------------------------------- run
def chunk_meta(c: ck.Chunk, key: str) -> dict:
    return {
        "dataset": c.dataset,
        "record_id": c.record_id,
        "chunk_no": c.chunk_no,
        "chunk_total": c.chunk_total,
        "char_start": c.start,
        "char_end": c.end,
        "text_sha256": c.text_sha256,
        "embed_sha256": key,
        "title": c.title,
        "href": c.href,
        "source_url": c.source_url,
        "snippet": c.snippet,
    }


def make_batches(texts: list[str]) -> list[list[int]]:
    """Indices of `texts` grouped into requests of at most BATCH_TEXTS inputs and BATCH_EST_TOKENS estimated tokens."""
    batches: list[list[int]] = []
    cur: list[int] = []
    est = 0
    for i, t in enumerate(texts):
        e = ck.estimate_tokens(t)
        if cur and (len(cur) >= BATCH_TEXTS or est + e > BATCH_EST_TOKENS):
            batches.append(cur)
            cur, est = [], 0
        cur.append(i)
        est += e
    if cur:
        batches.append(cur)
    return batches


class Runner:
    def __init__(
        self,
        dataset: str,
        docs: Iterable[ck.Doc],
        client,
        store: Store,
        usage: Usage,
        *,
        workers: int = 4,
        max_tokens: int | None = None,
        max_chunks: int | None = None,
        min_free: int = MIN_FREE_BYTES,
        free_bytes: Callable[[], int] | None = None,
        log: Callable[[str], None] = lambda m: print(m, flush=True),
        window_chunks: int = WINDOW_CHUNKS,
    ):
        self.dataset, self.docs, self.client, self.store, self.usage = dataset, docs, client, store, usage
        self.workers, self.max_tokens, self.max_chunks = workers, max_tokens, max_chunks
        self.min_free = min_free
        self.free_bytes = free_bytes or (lambda: shutil.disk_usage(OUT if os.path.isdir(OUT) else ROOT).free)
        self.log, self.window_chunks = log, window_chunks
        self.stop_flag = threading.Event()
        self.run_tokens = 0
        self.run_chunks = 0
        self.t0 = time.time()

    def _check_room(self, n_chunks: int, est_tokens: int) -> None:
        if self.stop_flag.is_set():
            raise Stop("interrupted")
        if self.free_bytes() - n_chunks * ROW_DISK_BYTES < self.min_free:
            raise Stop("disk_floor")
        if self.usage.remaining() < self.usage.reserve_estimate(est_tokens):
            raise Stop("total_budget")
        if self.max_tokens is not None and self.run_tokens + self.usage.reserve_estimate(est_tokens) > self.max_tokens:
            raise Stop("run_token_limit")
        if self.max_chunks is not None and self.run_chunks + n_chunks > self.max_chunks:
            raise Stop("run_chunk_limit")

    def _windows(self) -> Iterator[list[list[ck.Chunk]]]:
        window: list[list[ck.Chunk]] = []
        n = 0
        for doc in self.docs:
            if doc.record_id in self.store.done_records:
                continue
            chunks = ck.chunk_doc(doc)
            if not chunks:
                continue
            window.append(chunks)
            n += len(chunks)
            if n >= self.window_chunks:
                yield window
                window, n = [], 0
        if window:
            yield window

    def _embed_window(self, window: list[list[ck.Chunk]]) -> None:
        flat = [c for doc in window for c in doc]
        keys = [embed_key(c.embed_text) for c in flat]
        texts_by_key: dict[str, str] = {}
        for c, k in zip(flat, keys):
            if k not in texts_by_key and self.store.vector(k) is None:
                texts_by_key[k] = c.embed_text
        need = list(texts_by_key)
        texts = [texts_by_key[k] for k in need]
        vectors: dict[str, np.ndarray] = {}
        tokens = requests = 0
        if texts:
            batches = make_batches(texts)

            def send(idx: list[int]) -> tuple[list[int], np.ndarray, int]:
                v, t = self.client.embed([texts[i] for i in idx], "document")
                self.usage.add(self.dataset, t, 1, len(idx))
                self.usage.note_ratio(sum(ck.estimate_tokens(texts[i]) for i in idx), t)
                return idx, v, t

            with cf.ThreadPoolExecutor(max_workers=self.workers) as pool:
                for idx, v, t in pool.map(send, batches):
                    for j, i in enumerate(idx):
                        vectors[need[i]] = v[j]
                    tokens += t
                    requests += 1
        reused = len(flat) - len(need)
        for k in keys:
            if k not in vectors:
                v = self.store.vector(k)
                assert v is not None
                vectors[k] = v
        matrix = np.stack([vectors[k] for k in keys]).astype("<f2")
        metas = [chunk_meta(c, k) for c, k in zip(flat, keys)]
        capped = [doc[0].record_id for doc in window if doc[0].chunk_total > len(doc)]
        self.store.add(metas, matrix, [doc[0].record_id for doc in window], capped, tokens, requests, reused)
        self.run_tokens += tokens
        self.run_chunks += len(flat)

    def run(self) -> str:
        status = "complete"
        try:
            for window in self._windows():
                n = sum(len(d) for d in window)
                est = sum(ck.estimate_tokens(c.embed_text) for d in window for c in d)
                while True:  # drop trailing records until the window fits, never part of a record
                    try:
                        self._check_room(n, est)
                        break
                    except Stop as stop:
                        if stop.reason in ("total_budget", "run_token_limit", "run_chunk_limit") and len(window) > 1:
                            dropped = window.pop()
                            n -= len(dropped)
                            est -= sum(ck.estimate_tokens(c.embed_text) for c in dropped)
                            continue
                        raise
                self._embed_window(window)
                if self.store.full():
                    self.store.flush("running")
                    self.usage.save()
                    self.log(
                        f"{self.dataset}: {self.store.manifest['totals']['chunks']:,} chunks stored, "
                        f"{self.usage.used:,} tokens used in all, {time.time() - self.t0:,.0f}s"
                    )
        except Stop as stop:
            status = f"stopped_{stop.reason}"
        except KeyboardInterrupt:
            status = "stopped_interrupted"
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised after saving what is complete
            self.store.flush("failed")
            self.usage.save()
            self.log(f"{self.dataset}: failed ({type(exc).__name__}: {str(exc)[:200]})")
            raise
        self.store.flush(status)
        self.usage.save(
            {
                "dataset": self.dataset,
                "status": status,
                "tokens": self.run_tokens,
                "chunks": self.run_chunks,
                "seconds": round(time.time() - self.t0, 1),
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        return status


# ------------------------------------------------------------------------------------------------------------------ plan
def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    s = sorted(values)
    return s[min(len(s) - 1, int(math.ceil(p * len(s))) - 1)]


def plan_dataset(dataset: str, docs: Iterable[ck.Doc], progress: Callable[[str], None] = print) -> dict:
    stats = {"records": 0, "chunks": 0, "capped_records": 0, "chunks_dropped_by_cap": 0, "embed_chars": 0, "body_chars": 0, "est_tokens": 0}
    sizes: list[int] = []
    per_record: list[int] = []
    for doc in docs:
        chunks = ck.chunk_doc(doc)
        if not chunks:
            continue
        stats["records"] += 1
        stats["chunks"] += len(chunks)
        per_record.append(len(chunks))
        if chunks[0].chunk_total > len(chunks):
            stats["capped_records"] += 1
            stats["chunks_dropped_by_cap"] += chunks[0].chunk_total - len(chunks)
        for c in chunks:
            et = c.embed_text
            stats["embed_chars"] += len(et)
            stats["body_chars"] += c.end - c.start
            stats["est_tokens"] += ck.estimate_tokens(et)
            sizes.append(len(et))
        if stats["records"] % 20000 == 0:
            progress(f"  {dataset}: {stats['records']:,} records, {stats['chunks']:,} chunks")
    stats["chunk_chars_p50"] = percentile(sizes, 0.5)
    stats["chunk_chars_p95"] = percentile(sizes, 0.95)
    stats["chunk_chars_max"] = max(sizes) if sizes else 0
    stats["chunks_per_record_max"] = max(per_record) if per_record else 0
    stats["vector_mb"] = round(stats["chunks"] * 2048 / 1e6, 1)
    return stats


def calibrate(dataset: str, docs: Iterable[ck.Doc], client, n: int) -> dict:
    """Embed n evenly spread chunks one request each to measure real tokens per character and per chunk."""
    sample: list[str] = []
    every = 1
    pool = [c.embed_text for doc in docs for c in ck.chunk_doc(doc)[:2]]
    every = max(1, len(pool) // n)
    sample = pool[::every][:n]
    toks = []
    for t in sample:
        _, used = client.embed([t], "document")
        toks.append((used, len(t)))
    per_chunk = [u for u, _ in toks]
    return {
        "sample": len(toks),
        "tokens_total": sum(per_chunk),
        "chars_per_token": round(sum(c for _, c in toks) / max(1, sum(per_chunk)), 3),
        "tokens_p50": percentile(per_chunk, 0.5),
        "tokens_p95": percentile(per_chunk, 0.95),
        "tokens_max": max(per_chunk) if per_chunk else 0,
    }


def get_docs(dataset: str) -> Iterable[ck.Doc]:
    if dataset == "caselaw_scotus":
        import scotus

        return scotus.iter_scotus_opinions()
    return src.ITERATORS[dataset]()


def chunk_params(dataset: str) -> dict:
    return {
        "chunker": ck.CHUNKER_VERSION,
        "max_chars": ck.MAX_CHARS,
        "max_embed_chars": ck.MAX_EMBED_CHARS,
        "composed": src.COMPOSED[dataset],
        "model_ref": INDEX_VERSION,
        "input_type": "document",
    }


def cmd_plan(args) -> int:
    datasets = args.corpus or list(src.ITERATORS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "plan.json")
    result = read_json(path) if os.path.exists(path) else {}
    client = None
    for ds in datasets:
        t = time.time()
        s = plan_dataset(ds, get_docs(ds))
        s["seconds"] = round(time.time() - t, 1)
        if args.calibrate:
            client = client or vg.VoyageClient()
            s["calibration"] = calibrate(ds, get_docs(ds), client, args.calibrate)
        result[ds] = s
        print(ds, json.dumps(s))
        atomic_write(path, json.dumps(result, indent=1, sort_keys=True).encode())
    return 0


def cmd_status(args) -> int:
    for ds in sorted(os.listdir(OUT)) if os.path.isdir(OUT) else []:
        mp = os.path.join(OUT, ds, "manifest.json")
        if os.path.exists(mp):
            m = read_json(mp)
            t = m["totals"]
            print(f"{ds}: {m['status']}, {t['records']:,} records, {t['chunks']:,} chunks, {len(m['shards'])} shards, {t['tokens']:,} tokens")
    up = os.path.join(OUT, "usage.json")
    if os.path.exists(up):
        u = read_json(up)
        print(f"total tokens used: {u['tokens_used']:,} of {u['budget_tokens']:,}")
    print(f"free disk: {shutil.disk_usage(ROOT).free / 1e9:.2f} GB")
    return 0


def cmd_run(args) -> int:
    ds = args.corpus
    os.makedirs(OUT, exist_ok=True)
    usage = Usage(os.path.join(OUT, "usage.json"), args.total_budget)
    params = chunk_params(ds)
    store = Store(os.path.join(OUT, ds), ds, params, shard_rows=args.shard_rows)
    if ds in src.SOURCE_FILES:
        store.manifest["source"] = src.source_file_digest(ds)
    client = vg.VoyageClient()
    runner = Runner(
        ds,
        get_docs(ds),
        client,
        store,
        usage,
        workers=args.workers,
        max_tokens=args.max_tokens,
        max_chunks=args.max_chunks,
        min_free=int(args.min_free_gb * 1e9),
    )
    signal.signal(signal.SIGTERM, lambda *_: runner.stop_flag.set())
    status = runner.run()
    store.manifest["client"] = {"retries": client.retries, "rate_limited": client.rate_limited}
    usage.add(ds, 0, requests=0, retries=client.retries, rate_limited=client.rate_limited)
    usage.save()
    store.flush()
    print(f"{ds}: {status}; {store.manifest['totals']['chunks']:,} chunks; {usage.used:,} of {usage.budget:,} tokens used in all")
    return 0 if status in ("complete",) else 3


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("plan")
    a.add_argument("--corpus", action="append", choices=[*src.ITERATORS, "caselaw_scotus"])
    a.add_argument("--calibrate", type=int, default=0)
    b = sub.add_parser("run")
    b.add_argument("--corpus", required=True, choices=[*src.ITERATORS, "caselaw_scotus"])
    b.add_argument("--max-tokens", type=int, default=None, help="stop this run after about this many tokens")
    b.add_argument("--max-chunks", type=int, default=None)
    b.add_argument("--total-budget", type=int, default=TOTAL_BUDGET)
    b.add_argument("--workers", type=int, default=4)
    b.add_argument("--shard-rows", type=int, default=SHARD_ROWS)
    b.add_argument("--min-free-gb", type=float, default=MIN_FREE_BYTES / 1e9)
    sub.add_parser("status")
    args = p.parse_args(argv)
    return {"plan": cmd_plan, "run": cmd_run, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
