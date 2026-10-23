"""Case-law stage 2a: reading store. Repacks stage-1 shards so every opinion is one gzip member that one HTTP Range
request can fetch, with all opinions of a cluster stored next to each other.

    cd scripts/enrichment/caselaw
    python3 -I -B read_store.py run [--units all|0,1] [--groups t1/scotus/1960s,...] [--workers 2]
    python3 -I -B read_store.py status

Input: the stage-1 manifest (private/build/caselaw/work/shards.jsonl, read only) and checkpoint. A shard is used when
its newest manifest line has the current extractor version, a verified readback and a unit whose checkpoint status is
"complete" (`--units all` requires every unit of the input to be complete; `--units 0` is the trial on unit 0 only).
Every downloaded shard is checked against the manifest's sha256 and byte count before use.

Per opinion (stage-1 record -> reading record, READ_FORMAT):
  * blocked opinions (cluster or docket blocked) are dropped: never stored, indexed or linked;
  * kept: opinion_id, cluster_id, court_id, tier, type, author_str, author_id, per_curiam, joined_by_str,
    download_url, extracted_by_ocr, text, text_sha256, text_chars, pages_source, pages, text_paginated,
    source_url, snapshot, renderer and the stage-1 shard key + sha256 (provenance);
  * pages are [label, citation_index, offset] triples (offsets into `text`, or into `text_paginated` when
    pages_source is "xml_harvard_text");
  * citations are [start, end, cited_cluster_id|null, cited_opinion_id, held] where held=1 when the cited cluster has a
    page here (an unblocked cluster of the three tiers, from the stage-1 selection), 2 when the cited cluster or its
    docket is blocked in CourtListener (the page shows the citation as plain text, linked nowhere), else 0; offsets
    are code points into text;
  * the raw markup is not repeated (it stays in the stage-1 shard, which the record names).

Objects: caselaw/read/<snapshot>/<tier>/<court>/<group tag>-<seq>-<sha256[:12]>.jsonl.gz. Inside a stage-1 shard
group (tier/court or tier/court/decade, so all opinions of a cluster are in one group) members are ordered by
cluster_id, then by CourtListener's opinion type code and opinion id; an object closes at a cluster boundary once it
reaches OBJECT_TARGET bytes, so a cluster's opinions are always one contiguous byte range of one object. Keys are
content-addressed (a rebuild with other bytes gets other keys), so a CDN copy can never serve stale bytes for a key.
Members are gzip level 6 with mtime 0: the same input gives the same bytes and the same keys.

Outputs (private/build/caselaw_read/read/):
  objects.jsonl          one line per verified object (key, group, seq, bytes, sha256, opinions, clusters, receipt)
  index/<group>.tsv.gz   opinion_id, cluster_id, key, offset, length, text_sha256, text_chars, type, author_str,
                         per_curiam, stage1_key, stage1_sha256, member_sha256
  anchors/<group>.tsv.gz citing_opinion_id, citing_cluster_id, cited_cluster_id, cited_opinion_id, anchors,
                         first anchor text (citations CourtListener linked in html_with_citations)
  groups.json            per group: input shards (key, sha256), outputs, counts -> a rerun skips unchanged groups
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

SNAPSHOT = "2026-09-30"
READ_FORMAT = "caselaw-read/1"
READ_PREFIX = f"caselaw/read/{SNAPSHOT}"
STAGE1_PREFIX = f"caselaw/courtlistener/{SNAPSHOT}/"
OBJECT_TARGET = 24_000_000  # compressed bytes; bounds the cost of a cold CDN fill for a ranged read
GZIP_LEVEL = 6
STAGE1_WORK = os.path.join(ROOT, "private", "build", "caselaw", "work")
STAGE1_MANIFEST = os.path.join(STAGE1_WORK, "shards.jsonl")
STAGE1_CHECKPOINT = os.path.join(STAGE1_WORK, "checkpoint.json")
SELECTION = os.path.join(STAGE1_WORK, "selection.parquet")
OUT = os.path.join(ROOT, "private", "build", "caselaw_read", "read")
TMP = os.path.join(ROOT, "private", "build", "caselaw_read", "tmp")
MIN_FREE_BYTES = 3_700_000_000  # the extraction job pauses itself at 3.5 GB free; stay above it

TYPE_ORDER = ["010combined", "015unamimous", "020lead", "025plurality", "030concurrence", "035concurrenceinpart", "040dissent",
              "050addendum", "060remittitur", "070rehearing", "080onthemerits", "090onmotiontostrike", "100trialcourt"]
INDEX_COLUMNS = ["opinion_id", "cluster_id", "key", "offset", "length", "text_sha256", "text_chars", "type", "author_str", "per_curiam",
                 "stage1_key", "stage1_sha256", "member_sha256"]
ANCHOR_COLUMNS = ["citing_opinion_id", "citing_cluster_id", "cited_cluster_id", "cited_opinion_id", "anchors", "first_text"]


class ReadStoreError(RuntimeError):
    pass


# ==================================================================================================== pure helpers
def type_rank(t: str | None) -> int:
    return TYPE_ORDER.index(t) if t in TYPE_ORDER else len(TYPE_ORDER)


def member_order(rec: dict) -> tuple:
    return (rec["cluster_id"], type_rank(rec.get("type")), rec["opinion_id"])


def group_tag(group: str) -> str:
    """t2/ca9/2000s -> ca9-2000s ; t3/me -> me"""
    parts = group.split("/")
    return "-".join(parts[1:])


def gzip_member(data: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=GZIP_LEVEL, mtime=0) as g:
        g.write(data)
    return buf.getvalue()


def is_held(cluster_id, held, blocked=frozenset()) -> int:
    if cluster_id is None:
        return 0
    if cluster_id in blocked:
        return 2
    return 1 if cluster_id in held else 0


def reading_record(rec: dict, held, stage1_key: str, stage1_sha: str, blocked=frozenset()) -> dict | None:
    """Stage-1 record -> reading record (None for a blocked opinion)."""
    if rec.get("blocked") or rec.get("cluster_blocked") or rec.get("docket_blocked"):
        return None
    text = rec.get("text") or ""
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != rec.get("text_sha256"):
        raise ReadStoreError(f"opinion {rec.get('opinion_id')}: text does not match its stage-1 text_sha256")
    pages = [[p["page"], p.get("citation_index"), p["offset"]] for p in (rec.get("pages") or [])]
    cites = []
    for c in rec.get("citations") or []:
        cid = c.get("cluster_id")
        cites.append([c["start"], c["end"], cid, c.get("opinion_id"), is_held(cid, held, blocked)])
    return {
        "format": READ_FORMAT,
        "opinion_id": rec["opinion_id"], "cluster_id": rec["cluster_id"], "court_id": rec["court_id"], "tier": rec["tier"],
        "type": rec.get("type"), "author_str": rec.get("author_str") or None, "author_id": rec.get("author_id"),
        "per_curiam": bool(rec.get("per_curiam")), "joined_by_str": rec.get("joined_by_str") or None,
        "download_url": rec.get("download_url") or None, "extracted_by_ocr": bool(rec.get("extracted_by_ocr")),
        "text": text, "text_sha256": rec["text_sha256"], "text_chars": rec.get("text_chars", len(text)),
        "pages_source": rec.get("pages_source"), "pages": pages, "text_paginated": rec.get("text_paginated"),
        "citations": cites, "source_url": rec.get("source_url"), "snapshot": rec.get("snapshot"), "renderer": rec.get("renderer"),
        "stage1": {"key": stage1_key, "sha256": stage1_sha},
    }


def anchor_rows(rec: dict) -> list[list]:
    """Aggregate a reading record's citation anchors per cited cluster (or cited opinion when the cluster is unknown)."""
    agg: dict = collections.OrderedDict()
    text = rec["text"]
    for start, end, cid, oid, _held in rec["citations"]:
        k = (cid, oid if cid is None else None)
        if k not in agg:
            agg[k] = [rec["opinion_id"], rec["cluster_id"], cid, oid, 0, text[start:end][:120]]
        agg[k][4] += 1
    return list(agg.values())


def pack(members: list[tuple[tuple, int, bytes]], target: int) -> list[list[tuple[tuple, int, bytes]]]:
    """members: (order key, cluster_id, gzip member) sorted by key. Split into objects at cluster boundaries once an
    object reaches `target` bytes; a cluster is never split."""
    objects: list[list] = []
    cur: list = []
    size = 0
    prev_cluster = None
    for m in members:
        if cur and m[1] != prev_cluster and size >= target:
            objects.append(cur)
            cur, size = [], 0
        cur.append(m)
        size += len(m[2])
        prev_cluster = m[1]
    if cur:
        objects.append(cur)
    return objects


def object_key(group: str, seq: int, sha: str) -> str:
    tier, court = group.split("/")[:2]
    return f"{READ_PREFIX}/{tier}/{court}/{group_tag(group)}-{seq:04d}-{sha[:12]}.jsonl.gz"


def iter_gzip_members(data: bytes):
    """Yield (offset, length, decompressed bytes) for each gzip member of a concatenation."""
    pos = 0
    n = len(data)
    while pos < n:
        d = zlib.decompressobj(31)
        out = d.decompress(data[pos:])
        out += d.flush()
        used = n - pos - len(d.unused_data)
        if used <= 0:
            raise ReadStoreError("empty gzip member")
        yield pos, used, out
        pos += used


def iter_jsonl(gz: bytes):
    """Records of a gzip JSON Lines blob. Lines end at "\\n" only: str.splitlines() would also split at U+2028, U+0085
    and other separators that JSON leaves unescaped inside strings."""
    for line in gzip.decompress(gz).decode("utf-8").split("\n"):
        if line:
            yield json.loads(line)


# ==================================================================================================== stage-1 inputs
def current_shards(units: str = "all", manifest_path: str = STAGE1_MANIFEST, checkpoint_path: str = STAGE1_CHECKPOINT,
                   version: str | None = None) -> dict[str, list[dict]]:
    """Group -> verified current stage-1 shards (newest manifest line per key) of the requested complete units."""
    if version is None:
        import extract_text

        version = extract_text.VERSION
    with open(checkpoint_path) as h:
        ck = json.load(h)
    n_units = ck["input"]["units"]
    complete = {int(u) for u, s in ck["units"].items() if s.get("status") == "complete" and s.get("extractor") == version}
    if units == "all":
        wanted = set(range(n_units))
        missing = sorted(wanted - complete)
        if missing:
            raise ReadStoreError(f"units not complete for {version}: {missing[:10]}{'...' if len(missing) > 10 else ''}")
    else:
        wanted = {int(u) for u in units.split(",")}
        if not wanted <= complete:
            raise ReadStoreError(f"requested units are not complete: {sorted(wanted - complete)}")
    latest: dict[str, dict] = {}
    with open(manifest_path) as h:
        for line in h:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue  # a line being appended right now
            latest[e["path"]] = e
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for e in latest.values():
        if e.get("extractor") != version or e.get("unit") not in wanted:
            continue
        if not e.get("readback_ok"):
            raise ReadStoreError(f"{e['path']}: stage-1 readback not verified")
        if e.get("partial_unit"):
            raise ReadStoreError(f"{e['path']}: part of a partial unit")
        groups[e["group"]].append(e)
    for g in groups.values():
        g.sort(key=lambda e: (e["unit"], e["part"]))
    return dict(groups)


def load_held(selection: str = SELECTION) -> frozenset:
    """Cluster ids that get a page: clusters of the three tiers that are not blocked."""
    import duckdb

    con = duckdb.connect()
    con.execute("PRAGMA threads=1")
    rows = con.execute(f"SELECT DISTINCT cluster_id FROM read_parquet('{selection}') WHERE NOT blocked").fetchall()
    return frozenset(r[0] for r in rows)


def load_blocked() -> frozenset:
    """Every CourtListener cluster that is blocked, or whose docket is blocked (any court, from the local tables)."""
    import duckdb

    con = duckdb.connect()
    con.execute("PRAGMA threads=1")
    con.execute("PRAGMA memory_limit='1GB'")
    db = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
    for name in ("cluster", "docket"):
        con.execute(f"ATTACH '{os.path.join(db, name + '.duckdb')}' AS {name} (READ_ONLY)")
    rows = con.execute("""SELECT k.id FROM cluster.cluster k LEFT JOIN docket.docket d ON d.id = k.docket_id
                          WHERE coalesce(k.blocked, false) OR coalesce(d.blocked, false)""").fetchall()
    return frozenset(r[0] for r in rows)


# ==================================================================================================== one group
def _download(st, key: str, sha: str, nbytes: int) -> bytes:
    import uuid

    for attempt in range(4):
        r = st._retry(lambda: st.s.get(st._object_url(key, True), headers=st.h, params={"read": uuid.uuid4().hex}, timeout=st.timeout))
        try:
            if r.status_code == 200:
                data = r.content
                if len(data) == nbytes and hashlib.sha256(data).hexdigest() == sha:
                    return data
        finally:
            r.close()
        time.sleep(2 * (attempt + 1))
    raise ReadStoreError(f"{key}: stage-1 shard could not be read with the manifest's sha256/size")


def build_group(group: str, shards: list[dict], held, st, out: str = OUT, upload: bool = True, blocked=frozenset()) -> dict:
    """Read every shard of one group, write the reading objects, upload and verify them, write index and anchors."""
    t0 = time.time()
    members: list[tuple[tuple, int, bytes]] = []
    index_meta: dict[int, list] = {}
    anchors: list[list] = []
    seen: set[int] = set()
    counts = collections.Counter()
    for sh in shards:
        data = _download(st, sh["path"], sh["sha256"], sh["bytes"])
        counts["stage1_bytes"] += len(data)
        for rec in iter_jsonl(data):
            counts["stage1_opinions"] += 1
            oid = rec["opinion_id"]
            if oid in seen:
                raise ReadStoreError(f"opinion {oid} occurs twice in group {group}")
            seen.add(oid)
            rr = reading_record(rec, held, sh["path"], sh["sha256"], blocked)
            if rr is None:
                counts["blocked_dropped"] += 1
                continue
            body = json.dumps(rr, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            m = gzip_member(body)
            members.append((member_order(rr), rr["cluster_id"], m))
            index_meta[oid] = [oid, rr["cluster_id"], rr["text_sha256"], rr["text_chars"], rr["type"], rr["author_str"] or "",
                               int(rr["per_curiam"]), sh["path"], sh["sha256"], hashlib.sha256(m).hexdigest()]
            anchors.extend(anchor_rows(rr))
            counts["opinions"] += 1
            counts["json_bytes"] += len(body)
            counts["citations"] += len(rr["citations"])
        del data
    members.sort(key=lambda m: m[0])
    objects = pack(members, OBJECT_TARGET)
    os.makedirs(TMP, exist_ok=True)
    receipts = []
    index_rows = []
    for seq, obj in enumerate(objects):
        blob = b"".join(m[2] for m in obj)
        sha = hashlib.sha256(blob).hexdigest()
        key = object_key(group, seq, sha)
        off = 0
        for order, _cluster_id, m in obj:
            meta = index_meta[order[2]]
            index_rows.append([meta[0], meta[1], key, off, len(m), meta[2], meta[3], meta[4], meta[5], meta[6], meta[7], meta[8], meta[9]])
            off += len(m)
        rec = {"key": key, "group": group, "seq": seq, "bytes": len(blob), "sha256": sha, "opinions": len(obj),
               "clusters": len({m[1] for m in obj}), "format": READ_FORMAT}
        if upload:
            receipt = put_blob(st, key, blob, sha)
            rec.update({"state": receipt["state"], "readback_ok": receipt["readback_ok"], "verified_at": receipt["verified_at"]})
        receipts.append(rec)
        counts["objects"] += 1
        counts["read_bytes"] += len(blob)
    slug = group.replace("/", "__")
    write_tsv_gz(os.path.join(out, "index", slug + ".tsv.gz"), INDEX_COLUMNS, sorted(index_rows))
    write_tsv_gz(os.path.join(out, "anchors", slug + ".tsv.gz"), ANCHOR_COLUMNS, anchors)
    counts["clusters"] = len({r[1] for r in index_rows})
    return {"group": group, "inputs": [{"key": s["path"], "sha256": s["sha256"], "unit": s["unit"]} for s in shards], "objects": receipts,
            "counts": dict(counts), "seconds": round(time.time() - t0, 1), "format": READ_FORMAT,
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def put_blob(st, key: str, blob: bytes, sha: str) -> dict:
    """Upload an object from memory (no local staging file, so the shared disk is not used) with the guarantees of
    store.Storage.put_verified: never overwrite other bytes (x-upsert false; an existing object must hold exactly these
    bytes), then read the whole object back and compare sha256 and size. Objects above the standard upload limit go
    through put_verified with a staged file, guarded by MIN_FREE_BYTES."""
    import store

    if hashlib.sha256(blob).hexdigest() != sha:
        raise ReadStoreError(f"{key}: blob does not match its sha256")
    if len(blob) > store.STANDARD_UPLOAD_LIMIT:
        if shutil.disk_usage(TMP).free < MIN_FREE_BYTES + len(blob):
            raise ReadStoreError("not enough free disk to stage a large object; stopping")
        os.makedirs(TMP, exist_ok=True)
        fd, path = tempfile.mkstemp(dir=TMP, suffix=".gz")
        try:
            with os.fdopen(fd, "wb") as h:
                h.write(blob)
            return st.put_verified(key, path, sha, len(blob), may_replace=None)
        finally:
            if os.path.exists(path):
                os.remove(path)
    t0 = time.time()
    r = st._retry(lambda: st.s.post(st._object_url(key), data=blob, timeout=st.timeout,
                                    headers={**st.h, "Content-Type": store.CONTENT_TYPE, "x-upsert": "false"}))
    status, text = r.status_code, r.text[:300]
    r.close()
    state = "uploaded"
    if status not in (200, 201):
        if not store._is_duplicate(status, text):
            raise ReadStoreError(f"{key}: upload failed with HTTP {status}: {text[:160]}")
        rst, rsha, rn = st.readback(key)
        if not (rst == 200 and rsha == sha and rn == len(blob)):
            raise store.ChecksumConflict(f"{key} already holds other bytes (sha256 {rsha})")
        state = "already_present"
    upload_s = time.time() - t0
    for attempt in range(4):
        rst, rsha, rn = st.readback(key)
        if rst == 200 and rsha == sha and rn == len(blob):
            return {"key": key, "state": state, "bytes": len(blob), "sha256": sha, "readback_ok": True, "upload_seconds": round(upload_s, 2),
                    "readback_attempts": attempt + 1, "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        time.sleep(3 * (attempt + 1))
    raise store.ReadbackMismatch(f"{key}: readback HTTP {rst}, sha256 {rsha}, {rn} bytes")


def _clean(v) -> str:
    s = "" if v is None else str(v)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def write_tsv_gz(path: str, columns: list[str], rows) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as h:
        h.write("\t".join(columns) + "\n")
        for r in rows:
            h.write("\t".join(_clean(v) for v in r) + "\n")
    os.replace(tmp, path)


def read_tsv_gz(path: str):
    def unesc(s: str) -> str:
        if "\\" not in s:
            return s
        out, i = [], 0
        while i < len(s):
            c = s[i]
            if c == "\\" and i + 1 < len(s):
                out.append({"t": "\t", "n": "\n", "r": "\r", "\\": "\\"}.get(s[i + 1], s[i + 1]))
                i += 2
            else:
                out.append(c)
                i += 1
        return "".join(out)

    with gzip.open(path, "rt", encoding="utf-8") as h:
        cols = h.readline().rstrip("\n").split("\t")
        for line in h:
            yield dict(zip(cols, (unesc(v) for v in line.rstrip("\n").split("\t"))))


# ==================================================================================================== driver
_HELD = None
_BLOCKED = frozenset()
READ_BUILDER = "caselaw-read-builder/2"  # 2: held=2 marks citations of blocked clusters


def _worker_init(selection: str) -> None:
    global _HELD, _BLOCKED
    _HELD = load_held(selection)
    _BLOCKED = load_blocked()


def _worker(group: str, shards: list[dict]) -> dict:
    import store

    res = build_group(group, shards, _HELD, store.Storage(), blocked=_BLOCKED)
    res["builder"] = READ_BUILDER
    return res


def load_groups_state(out: str = OUT) -> dict:
    p = os.path.join(out, "groups.json")
    if os.path.exists(p):
        with open(p) as h:
            return json.load(h)
    return {}


def save_groups_state(state: dict, out: str = OUT) -> None:
    p = os.path.join(out, "groups.json")
    tmp = p + ".tmp"
    with open(tmp, "w") as h:
        json.dump(state, h, indent=1, sort_keys=True)
    os.replace(tmp, p)


def run(units: str, groups_filter: list[str] | None, workers: int) -> int:
    os.makedirs(OUT, exist_ok=True)
    shards = current_shards(units)
    todo = sorted(g for g in shards if not groups_filter or g in groups_filter or any(g.startswith(f + "/") for f in groups_filter))
    state = load_groups_state()
    pending = []
    for g in todo:
        inputs = [{"key": s["path"], "sha256": s["sha256"], "unit": s["unit"]} for s in shards[g]]
        prev = state.get(g)
        if (prev and prev.get("inputs") == inputs and prev.get("format") == READ_FORMAT and prev.get("builder") == READ_BUILDER
                and all(o.get("readback_ok") for o in prev["objects"])):
            continue
        pending.append(g)
    print(f"[read] {len(todo)} groups, {len(pending)} to build ({sum(len(shards[g]) for g in pending)} shards)", flush=True)
    t0 = time.time()
    done = 0
    obj_log = os.path.join(OUT, "objects.jsonl")
    with cf.ProcessPoolExecutor(max_workers=workers, initializer=_worker_init, initargs=(SELECTION,)) as ex:
        futs = {ex.submit(_worker, g, shards[g]): g for g in pending}
        for f in cf.as_completed(futs):
            g = futs[f]
            res = f.result()
            state[g] = res
            save_groups_state(state)
            with open(obj_log, "a") as h:
                for o in res["objects"]:
                    h.write(json.dumps(o, sort_keys=True) + "\n")
            done += 1
            c = res["counts"]
            print(f"[read] {done}/{len(pending)} {g}: {c.get('opinions', 0):,} opinions, {c.get('objects', 0)} objects, "
                  f"{c.get('read_bytes', 0) / 1e6:.1f} MB, {res['seconds']}s, free {shutil.disk_usage(OUT).free / 1e9:.1f} GB, "
                  f"elapsed {time.time() - t0:.0f}s", flush=True)
    return 0


def status() -> int:
    state = load_groups_state()
    tot = collections.Counter()
    for g in state.values():
        tot.update({k: v for k, v in g["counts"].items() if isinstance(v, int)})
    print(json.dumps({"groups": len(state), "totals": dict(tot), "free_gb": round(shutil.disk_usage(OUT if os.path.exists(OUT) else ROOT).free / 1e9, 1)}, indent=1))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--units", default="all")
    r.add_argument("--groups", default="")
    r.add_argument("--workers", type=int, default=2)
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        return run(a.units, [g for g in a.groups.split(",") if g], a.workers)
    return status()


if __name__ == "__main__":
    sys.exit(main())
