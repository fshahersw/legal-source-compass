"""Batch (re-)extraction of citations over the indexed court-filing pages (citations/2).

The canonical Python engine (engine.py, held to the same golden fixture as the TypeScript engine the nightly edge
function runs) reads every indexed byte set exported by documents_export_pages_v1, page by page (short forms link
across pages), and the rows go to citations_load_v2, which re-checks each citation against the stored page text.

  sample  read-only (GET of the stable export RPC): extract --sets byte sets from a seeded position in sha256 order (a
          uniform sample), write the load rows as gzipped JSON lines plus a manifest with counts, rates per page and
          per million characters, the projection to the whole layer, offset checks and file hashes.
  stream  (lead; writes) export -> extract -> citations_load_v2 in one pass under one 'batch' run, a cursor file for
          resume, then citations_resolve_v2 until nothing is pending and citations_link_v2 over every byte set.
  load    (lead; writes) load rows written by `sample` (e.g. to try the loader on the sample first).

Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment (source private/scratch/env.sh inside the
command). Keys are never printed or written. Python standard library only; run with python3 -I -B.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import engine  # noqa: E402

UA = "LegalSourceAtlas research contact@legal-source-atlas.example"
MAX_PAGES_PER_LOAD = 400
MAX_CITATIONS_PER_LOAD = 15000


class Api:
    def __init__(self) -> None:
        url = os.environ.get("EXTERNAL_SUPABASE_URL", "")
        key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
        if not url or not key:
            raise SystemExit("EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY are not set (source private/scratch/env.sh in the command)")
        self.base = url.rstrip("/") + "/rest/v1/rpc/"
        self.headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA}
        if not key.startswith("sb_"):
            self.headers["Authorization"] = f"Bearer {key}"

    def _send(self, req: urllib.request.Request, retries: int) -> object:
        for attempt in range(1, retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=300) as res:
                    body = res.read()
                return json.loads(body) if body else None
            except urllib.error.HTTPError as e:
                detail = e.read()[:300].decode("utf-8", "replace")
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(3 * attempt)
                    continue
                raise SystemExit(f"{req.full_url.split('/rpc/')[1].split('?')[0]}: HTTP {e.code}: {detail}")
            except urllib.error.URLError:
                if attempt < retries:
                    time.sleep(3 * attempt)
                    continue
                raise
        return None

    def get(self, fn: str, **args) -> object:
        """A stable (read-only) RPC through GET."""
        q = urllib.parse.urlencode({k: v for k, v in args.items()})
        return self._send(urllib.request.Request(self.base + fn + "?" + q, headers=self.headers, method="GET"), retries=4)

    def post(self, fn: str, **args) -> object:
        """A writing RPC (never retried blindly: each call is idempotent per page / batch, but report and stop)."""
        data = json.dumps(args, ensure_ascii=False).encode("utf-8")
        return self._send(urllib.request.Request(self.base + fn, data=data, headers=self.headers, method="POST"), retries=1)


def load_rows(sha256: str, pages: list[dict], extracted: list[list[dict]]) -> list[dict]:
    """Engine output of one byte set as citations_load_v2 rows (same shape as src/lib/citations/nightly.ts toLoadPages)."""
    out = []
    for i, p in enumerate(pages):
        cites = []
        for seq, c in enumerate(extracted[i]):
            a = c["antecedent"]
            if a is None:
                ante = None
            elif isinstance(a, int):
                ante = {"page": p["page"], "seq": a}
            else:
                ante = {"page": pages[a["page"]]["page"], "seq": a["index"]}
            cites.append({
                "seq": seq, "kind": c["kind"], "form": c["form"], "short": c["short"], "short_status": c["short_status"],
                "start": c["start"], "end": c["end"], "matched": c["matched"], "key": c["key"], "normalized": c["normalized"],
                "pin": c["pin"], "group": c["group"], "name": c["name"]["text"] if c["name"] else None, "antecedent": ante,
                "fields": c["fields"],
            })
        out.append({"src": "pdf", "src_id": sha256, "page": p["page"], "citations": cites})
    return out


def batches(rows: list[dict]) -> list[list[dict]]:
    out, cur, n = [], [], 0
    for r in rows:
        if cur and (len(cur) >= MAX_PAGES_PER_LOAD or n + len(r["citations"]) > MAX_CITATIONS_PER_LOAD):
            out.append(cur)
            cur, n = [], 0
        cur.append(r)
        n += len(r["citations"])
    if cur:
        out.append(cur)
    return out


def by_set(pages: list[dict]) -> list[tuple[str, list[dict]]]:
    sets: dict[str, list[dict]] = {}
    for p in pages:
        sets.setdefault(p["sha256"], []).append(p)
    return [(s, sorted(ps, key=lambda x: x["page"])) for s, ps in sorted(sets.items())]


def extract_set(sha256: str, pages: list[dict], stats: dict) -> list[dict]:
    t0 = time.perf_counter()
    extracted = engine.extract_pages([p["text"] for p in pages])
    stats["extract_s"] += time.perf_counter() - t0
    for p, cites in zip(pages, extracted):
        stats["pages"] += 1
        stats["chars"] += len(p["text"])
        for c in cites:
            stats["citations"] += 1
            k = c["kind"] + ("" if c["form"] == "full" else ":short")
            stats["by_kind"][k] = stats["by_kind"].get(k, 0) + 1
            if c["form"] == "short":
                st = c["short_status"] or "none"
                stats["short_status"][st] = stats["short_status"].get(st, 0) + 1
            if c["key"]:
                stats["keys"].add(c["key"])
            if p["text"][c["start"] : c["end"]] != c["matched"]:
                stats["offset_mismatch"] += 1
    stats["sets"] += 1
    return load_rows(sha256, pages, extracted)


def new_stats() -> dict:
    return {"sets": 0, "pages": 0, "chars": 0, "citations": 0, "by_kind": {}, "short_status": {}, "keys": set(),
            "offset_mismatch": 0, "extract_s": 0.0}


def sample(a) -> int:
    api = Api()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(a.seed)
    after = "%064x" % rng.getrandbits(256) if a.after is None else a.after
    start_after = after
    stats = new_stats()
    files = []
    part = 0
    while stats["sets"] < a.sets:
        res = api.get("documents_export_pages_v1", p_after=after, p_limit=min(25, a.sets - stats["sets"]))
        pages = res["pages"]
        if not pages:
            if after == start_after and start_after != "":
                after = ""  # wrap around to the start of the sha256 order
                start_after = ""
                continue
            break
        rows = []
        for sha256, ps in by_set(pages):
            rows.extend(extract_set(sha256, ps, stats))
        part += 1
        f = out / f"rows-{part:04d}.jsonl.gz"
        with gzip.open(f, "wt", encoding="utf-8") as g:
            for r in rows:
                g.write(json.dumps(r, ensure_ascii=False) + "\n")
        files.append(f)
        after = res["last"]
        time.sleep(0.2)
    status = api.get("documents_status_v1")
    total_pages = int(status.get("pages_indexed") or 0)
    rate = stats["citations"] / stats["pages"] if stats["pages"] else 0
    manifest = {
        "what": "citations/2 batch sample: load rows (citations_load_v2 shape) of byte sets exported by documents_export_pages_v1",
        "extractor_version": engine.default().table["version"],
        "acquired_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "public.documents_export_pages_v1 (GET, read-only) over documents/1 indexed byte sets, sha256 order",
        "start_after": a.after if a.after is not None else "seeded:" + a.seed,
        "last": after,
        "sets": stats["sets"], "pages": stats["pages"], "chars": stats["chars"], "citations": stats["citations"],
        "distinct_keys": len(stats["keys"]),
        "by_kind": dict(sorted(stats["by_kind"].items(), key=lambda kv: -kv[1])),
        "short_status": stats["short_status"],
        "offset_mismatches": stats["offset_mismatch"],
        "extract_seconds": round(stats["extract_s"], 2),
        "per_page": round(rate, 3),
        "per_million_chars": round(stats["citations"] / stats["chars"] * 1e6, 1) if stats["chars"] else 0,
        "layer": {"pages_indexed": total_pages, "documents": status.get("documents"), "by_text_status": status.get("by_text_status")},
        "projection": {
            "occurrences": round(rate * total_pages),
            "extract_minutes_python": round(stats["extract_s"] / stats["chars"] * 561_609_974 / 60, 1) if stats["chars"] else None,
            "note": "rate per page of this sample times documents_status_v1.pages_indexed; extraction time scaled by characters "
                    "(561,609,974 indexed characters on 2026-10-23)",
        },
        "files": [{"file": f.name, "bytes": f.stat().st_size, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("sets", "pages", "citations", "per_page", "offset_mismatches", "projection")}))
    return 0


def resolve_and_link(api: Api, run: str | None, link_from: str = "") -> dict:
    out = {"resolved": 0, "documents": 0, "edges": 0}
    while True:
        r = api.post("citations_resolve_v2", p_limit=5000, p_run=run)
        out["resolved"] += r["resolved_batch"]
        print(json.dumps({"step": "resolve", **{k: r[k] for k in ("resolved_batch", "pending")}}), flush=True)
        if r["pending"] == 0 or r["resolved_batch"] == 0:
            break
    after = link_from
    while True:
        r = api.post("citations_link_v2", p_shas=None, p_after=after, p_limit=500, p_run=run)
        out["documents"] += r["documents"]
        out["edges"] += r["edges"]
        print(json.dumps({"step": "link", **r}), flush=True)
        if r["done"] or not r["last"]:
            break
        after = r["last"]
    return out


def stream(a) -> int:
    api = Api()
    version = engine.default().table["version"]
    state_file = Path(a.state)
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if state.get("version") not in (None, version):
        raise SystemExit(f"cursor file is for {state['version']}, the engine is {version}: use a new --state file")
    run = state.get("run") or api.post("citations_open_run_v2", p_kind="batch", p_trigger="manual", p_version=version)["run_id"]
    after = state.get("after", "")
    stats = new_stats()
    totals = {"accepted": 0, "rejected": {}}
    try:
        while a.max_sets is None or stats["sets"] < a.max_sets:
            res = api.get("documents_export_pages_v1", p_after=after, p_limit=25)
            if not res["pages"]:
                break
            rows = []
            for sha256, ps in by_set(res["pages"]):
                rows.extend(extract_set(sha256, ps, stats))
            for b in batches(rows):
                r = api.post("citations_load_v2", p_run=run, p_version=version, p_pages=b)
                totals["accepted"] += r["accepted"]
                for k, v in (r.get("rejected") or {}).items():
                    totals["rejected"][k] = totals["rejected"].get(k, 0) + v
            after = res["last"]
            state_file.write_text(json.dumps({"version": version, "run": run, "after": after}))
            print(json.dumps({"step": "load", "after": after[:12], "sets": stats["sets"], "pages": stats["pages"],
                              "accepted": totals["accepted"], "rejected": totals["rejected"],
                              "extract_s": round(stats["extract_s"], 1)}), flush=True)
        done = a.max_sets is None or stats["sets"] < a.max_sets
        linked = resolve_and_link(api, run) if done else {}
        fin = api.post("citations_finish_run_v2", p_run=run, p_status="ok" if done else "partial",
                       p_notes={"after": after, "sets": stats["sets"], "pages": stats["pages"], **linked}, p_error=None)
        if done:
            state_file.unlink(missing_ok=True)
        print(json.dumps({"step": "finish", **fin}))
        return 0
    except BaseException as e:  # noqa: BLE001 - record the failure in the ledger, keep the cursor for resume
        try:
            api.post("citations_finish_run_v2", p_run=run, p_status="failed", p_notes={"after": after}, p_error=str(e)[:400])
            state_file.write_text(json.dumps({"version": version, "after": after}))
        except BaseException:
            pass
        raise


def load(a) -> int:
    api = Api()
    version = engine.default().table["version"]
    run = api.post("citations_open_run_v2", p_kind="batch", p_trigger="manual", p_version=version)["run_id"]
    accepted = 0
    for f in sorted(Path(a.input).glob("rows-*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as g:
            rows = [json.loads(line) for line in g]
        for b in batches(rows):
            accepted += api.post("citations_load_v2", p_run=run, p_version=version, p_pages=b)["accepted"]
    shas = sorted({r["src_id"] for f in sorted(Path(a.input).glob("rows-*.jsonl.gz"))
                   for r in (json.loads(line) for line in gzip.open(f, "rt", encoding="utf-8"))})
    r = api.post("citations_resolve_v2", p_limit=50000, p_run=run)
    for i in range(0, len(shas), 500):
        api.post("citations_link_v2", p_shas=shas[i : i + 500], p_after="", p_limit=500, p_run=run)
    print(json.dumps(api.post("citations_finish_run_v2", p_run=run, p_status="ok", p_notes={"accepted": accepted, "pending": r["pending"]},
                              p_error=None)))
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("--sets", type=int, default=200)
    s.add_argument("--out", required=True)
    s.add_argument("--seed", default="citations-v2-batch-sample-1")
    s.add_argument("--after", default=None)
    t = sub.add_parser("stream")
    t.add_argument("--state", required=True, help="cursor file (resume)")
    t.add_argument("--max-sets", type=int, default=None)
    lo = sub.add_parser("load")
    lo.add_argument("--input", required=True)
    a = ap.parse_args(argv)
    return {"sample": sample, "stream": stream, "load": load}[a.cmd](a)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
