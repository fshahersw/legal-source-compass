"""Build state administrative code data (state-regs/1) from the official publishers, as a stream.

  python3 -I -B scripts/state_regs/build.py index  ST [ST ...]          table of contents -> <ST>/nodes.jsonl.gz
  python3 -I -B scripts/state_regs/build.py sample ST [ST ...]          index + the sample units -> <ST>/rules-sample.jsonl.gz
  python3 -I -B scripts/state_regs/build.py full   ST [--from N] [--limit N] [--shard N] [--keep-raw]
                                                                         every unit, streamed into rules-full-NNNN.jsonl.gz

Outputs go to private/build/w1025_regs/<ST>/ with report-<run>.json (counts, exact-text check summary, failures, the
URL + sha256 of every response used). Raw responses are kept gzip-compressed under private/acq/w1025_regs/raw/<ST>/ for
`sample` runs; `full` runs delete each unit's raw bytes once its rules are parsed and checked (the manifest keeps the
URL, sha256 and size), so the transient footprint stays at one unit. A full run is resumable: units already present in
a shard file listed in report-full.json are skipped (--from also skips by position).

Every rule's text is checked against an independent rendering of the unchanged response bytes (lib.html_text for HTML,
pdftotext/pypdf for PDF, LibreOffice for Word files): the whole text, cut into 80-character windows with whitespace
removed, must be found in the rendering ("confirmed"); otherwise the share found is recorded ("mostly_confirmed" >= 0.9,
"partly_confirmed" below). Headings and history notes are checked the same way.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import shutil
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib  # noqa: E402
import model  # noqa: E402

STATE_MODULES = {"OH": "oh", "WA": "wa", "MN": "mn", "OR": "or_", "NC": "nc", "MI": "mi", "IL": "il", "FL": "fl", "GA": "ga",
                 "VA": "va", "CO": "co"}


def module(st: str):
    name = STATE_MODULES.get(st.upper())
    if not name:
        raise SystemExit(f"no module for {st}")
    return importlib.import_module(f"states.{name}")


class Ctx:
    """Fetching, raw retention and exact-text checks for one state run."""

    def __init__(self, st: str, run: str, keep_raw: bool = True):
        self.st, self.run, self.keep_raw = st.upper(), run, keep_raw
        self.requests: list[dict] = []
        self.failures: list[dict] = []
        self._refs: dict[str, str] = {}
        self.out = os.path.join(lib.BUILD, self.st)
        os.makedirs(self.out, exist_ok=True)

    def get(self, url: str, rel: str, **kw):
        """Fetch url, keep its body under raw/<ST>/<rel>, return (Response, manifest entry)."""
        r = lib.fetch(url, **kw)
        entry = lib.store(f"{self.st}/{rel}", r, keep=True)
        self.requests.append({k: entry[k] for k in ("url", "final_url", "sha256", "bytes", "status", "retrieved_at")})
        if r.status != 200:
            raise RuntimeError(f"{url}: HTTP {r.status}")
        return r, entry

    def drop(self, entry: dict) -> None:
        if not self.keep_raw and entry.get("path"):
            try:
                os.remove(os.path.join(lib.ROOT, entry["path"]))
            except FileNotFoundError:
                pass

    # ---------------------------------------------------------------- exact-text checks
    def reference(self, entry: dict, kind: str = "html", body: bytes | None = None) -> str:
        """Squashed independent rendering of a stored response (cached per sha256)."""
        key = entry["sha256"] + kind
        if key not in self._refs:
            raw = body if body is not None else lib.load_raw(entry)
            if kind == "html":
                rendered = lib.html_text(raw, entry.get("content_type", ""))
            elif kind == "pdf":
                rendered = lib.pdf_text(raw)
            elif kind == "doc":
                from states.worddoc import libreoffice_text
                rendered = libreoffice_text(raw)
            elif kind == "json":
                rendered = raw.decode("utf-8", "replace")
            else:
                raise ValueError(kind)
            self._refs.clear() if len(self._refs) > 50 else None
            self._refs[key] = lib.squash(rendered)
        return self._refs[key]

    def check(self, rule: dict, ref: str, method: str) -> dict:
        res = {"method": method}
        for field in ("text", "heading", "history"):
            v = rule.get(field)
            if not v:
                res[field] = "absent"
                continue
            ok, share = lib.contained(v, ref)
            res[field] = "confirmed" if ok else ("mostly_confirmed" if share >= 0.9 else "partly_confirmed")
            if not ok:
                res[field + "_share"] = round(share, 4)
        rule["text_check"] = res
        return rule


def write_report(ctx: Ctx, name: str, payload: dict) -> str:
    path = os.path.join(ctx.out, f"report-{name}.json")
    payload = {"state": ctx.st, "run": name, "generated_at": lib.utc_now(), **payload,
               "requests": ctx.requests, "failures": ctx.failures}
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
    return path


def summarize(rules: list[dict]) -> dict:
    out: dict = {"rules": len(rules), "with_text": sum(1 for r in rules if r["text"]), "checks": {}}
    for r in rules:
        for f in ("text", "heading", "history"):
            v = (r.get("text_check") or {}).get(f, "not_checked")
            out["checks"].setdefault(f, {}).setdefault(v, 0)
            out["checks"][f][v] += 1
    out["status"] = {}
    for r in rules:
        out["status"][r["status"]] = out["status"].get(r["status"], 0) + 1
    return out


def do_index(st: str, ctx: Ctx | None = None) -> list[dict]:
    mod = module(st)
    ctx = ctx or Ctx(st, "index")
    nodes = mod.index(ctx)
    for n in nodes:
        model.check_node(n)
    ids = [n["id"] for n in nodes]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})[:5]
        raise SystemExit(f"{st}: duplicate node ids {dup}")
    n, sha = lib.write_jsonl_gz(os.path.join(ctx.out, "nodes.jsonl.gz"), nodes)
    levels: dict = {}
    for x in nodes:
        levels[x["level"]] = levels.get(x["level"], 0) + 1
    write_report(ctx, "index", {"nodes": n, "nodes_sha256": sha, "levels": levels,
                                "rule_count_listed": sum(x["rule_count"] or 0 for x in nodes)})
    shutil.rmtree(os.path.join(lib.RAW, st.upper(), "index"), ignore_errors=True)  # manifest keeps url + sha256
    print(json.dumps({"state": st, "nodes": n, "levels": levels}), flush=True)
    return nodes


def load_nodes(st: str) -> list[dict]:
    path = os.path.join(lib.BUILD, st.upper(), "nodes.jsonl.gz")
    return list(lib.read_jsonl_gz(path)) if os.path.exists(path) else []


def do_rules(st: str, units: list[dict], ctx: Ctx, label: str, shard: int = 0) -> tuple[list[dict], dict]:
    mod = module(st)
    out: list[dict] = []
    done = []
    for u in units:
        t0 = time.time()
        try:
            got = mod.rules(ctx, u)
        except lib.Blocked as err:
            ctx.failures.append({"unit": u["id"], "error": str(err), "kind": "blocked"})
            continue
        except Exception as err:  # recorded per unit; the stream continues
            ctx.failures.append({"unit": u["id"], "error": str(err)[:300], "trace": traceback.format_exc()[-600:]})
            continue
        for r in got:
            model.check_rule(r)
        out.extend(got)
        done.append({"unit": u["id"], "rules": len(got), "seconds": round(time.time() - t0, 1)})
    ids = [r["id"] for r in out]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        ctx.failures.append({"unit": "*", "error": f"duplicate rule ids dropped after the first occurrence: {dups[:10]}"})
        seen = set()
        out = [r for r in out if not (r["id"] in seen or seen.add(r["id"]))]
    name = f"rules-{label}.jsonl.gz" if not shard else f"rules-{label}-{shard:04d}.jsonl.gz"
    n, sha = lib.write_jsonl_gz(os.path.join(ctx.out, name), out)
    return out, {"file": name, "rules": n, "sha256": sha, "units": done}


def do_sample(st: str) -> None:
    mod = module(st)
    ctx = Ctx(st, "sample", keep_raw=True)
    nodes = load_nodes(st)
    if not nodes:
        nodes = mod.index(ctx) if not hasattr(mod, "sample_index") else mod.sample_index(ctx)
        lib.write_jsonl_gz(os.path.join(ctx.out, "nodes-sample.jsonl.gz"), nodes)
    want = list(mod.SAMPLE_UNITS)
    units = [n for n in nodes if n["id"] in want]
    missing = [w for w in want if w not in {n["id"] for n in units}]
    if missing:
        units += [mod.unit(st, w) for w in missing] if hasattr(mod, "unit") else []
    rules, shard = do_rules(st, units, ctx, "sample")
    summary = summarize(rules)
    path = write_report(ctx, "sample", {"units": [u["id"] for u in units], "shard": shard, "summary": summary})
    print(json.dumps({"state": st, **summary, "failures": len(ctx.failures), "report": os.path.relpath(path, lib.ROOT)}), flush=True)


def do_full(st: str, start: int, limit: int | None, shard_units: int, keep_raw: bool) -> None:
    mod = module(st)
    ctx = Ctx(st, "full", keep_raw=keep_raw)
    nodes = load_nodes(st) or do_index(st, ctx)
    units = mod.units(nodes)
    prior_path = os.path.join(ctx.out, "report-full.json")
    done_units: set[str] = set()
    shards: list[dict] = []
    if os.path.exists(prior_path):
        prior = json.load(open(prior_path))
        shards = prior.get("shards", [])
        for s in shards:
            done_units.update(u["unit"] for u in s["units"])
    todo = [u for i, u in enumerate(units) if i >= start and u["id"] not in done_units]
    if limit is not None:
        todo = todo[:limit]
    totals = {"rules": sum(s["rules"] for s in shards)}
    for i in range(0, len(todo), shard_units):
        batch = todo[i:i + shard_units]
        _rules, shard = do_rules(st, batch, ctx, "full", shard=len(shards) + 1)
        shards.append(shard)
        totals["rules"] += shard["rules"]
        write_report(ctx, "full", {"units_total": len(units), "units_done": sum(len(s["units"]) for s in shards),
                                   "shards": shards, "totals": totals})
        if not keep_raw:
            shutil.rmtree(os.path.join(lib.RAW, st.upper()), ignore_errors=True)
        print(json.dumps({"state": st, "shard": shard["file"], "rules": shard["rules"], "done": sum(len(s["units"]) for s in shards),
                          "of": len(units), "failures": len(ctx.failures)}), flush=True)


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["index", "sample", "full"])
    ap.add_argument("states", nargs="+")
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--shard", type=int, default=25, help="units per shard file (full)")
    ap.add_argument("--keep-raw", action="store_true")
    a = ap.parse_args(argv)
    for st in a.states:
        st = st.upper()
        if a.command == "index":
            do_index(st)
        elif a.command == "sample":
            do_sample(st)
        else:
            do_full(st, a.start, a.limit, a.shard, a.keep_raw)


if __name__ == "__main__":
    main(sys.argv[1:])
