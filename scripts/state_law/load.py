"""Load one state-law/1 edition directory into the database (lead only; workers never write production).

  set -a; . private/scratch/env.sh; set +a          # EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY, never printed
  python3 scripts/state_law/load.py private/build/state_law/fl/fl-20261024 --dry-run
  python3 scripts/state_law/load.py private/build/state_law/fl/fl-20261024 --activate

Order: state_law_begin_edition_v1(edition.json) -> state_law_load_nodes_v1 (<=2000 rows/call) ->
state_law_load_sections_v1 (<=500 rows and <=7 MiB per call, streamed from sections.jsonl.gz) ->
state_law_activate_edition_v1 (counts + references checked in SQL; flips the state's active edition).
Every call is idempotent (begin replays an identical manifest; rows insert with ON CONFLICT DO NOTHING), so a
failed load is resumed by running the same command again. Refuses sample editions and editions whose verify.json
reports failures. Exit 0 on success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402

MAX_BATCH_BYTES = 7 * 1024 * 1024
# A run that rejected more than this share of what it parsed is not the publisher's code (MO 2026-10-23: an ordinal
# counter stopped after one duplicate id and 25,424 of 29,112 sections were rejected, yet verify passed on the rest).
MAX_REJECT_SHARE = 0.05
# Rejects the module contract ledgers on purpose, never parser failures: "Secs. 1-42 to 1-54." / "§§ 166-169." range
# entries (repealed or reserved ranges a module does not expand into numbers). They are counted and printed, not bounded.
DELIBERATE_REJECTS = ("range entry",)
# A part of the code the publisher did not serve ("unavailable: .../Title22/ returned HTTP 404"): never loaded silently,
# whatever the share; --accept-rejects names the gap in the edition note.
UNAVAILABLE_REJECTS = ("unavailable:",)


def rpc(name: str, payload: dict, *, attempts: int = 5):
    base = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not base or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set in the environment")
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(attempts):
        request = urllib.request.Request(f"{base}/rest/v1/rpc/{name}", data=data, method="POST", headers={
            "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:600]
            if error.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{name} -> HTTP {error.code}: {detail}") from None
        except urllib.error.URLError:
            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def batches(rows, max_rows: int):
    batch, size = [], 0
    for row in rows:
        encoded = len(json.dumps(row, ensure_ascii=False).encode("utf-8"))
        if batch and (len(batch) >= max_rows or size + encoded > MAX_BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += encoded
    if batch:
        yield batch


def check_files(edition_dir: pathlib.Path, edition: dict) -> None:
    for name, info in edition["files"].items():
        data = (edition_dir / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != info["sha256"]:
            raise SystemExit(f"{name}: sha256 differs from edition.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("edition_dir", type=pathlib.Path)
    parser.add_argument("--dry-run", action="store_true", help="validate files and print the plan; no network")
    parser.add_argument("--activate", action="store_true", help="activate after a complete load")
    parser.add_argument("--note", default=None)
    parser.add_argument("--purge-superseded", action="store_true",
                        help="after activation, remove the rows of the edition this one superseded (it stays listed)")
    parser.add_argument("--accept-rejects", default="",
                        help="the reason rejects above the share bound are deliberate exclusions (recorded in the note)")
    args = parser.parse_args(argv)
    edition = json.loads((args.edition_dir / "edition.json").read_text())
    if edition.get("sample") is not None:
        raise SystemExit("refusing a sample edition (sample != null)")
    verify_file = args.edition_dir / "verify.json"
    if verify_file.exists() and not json.loads(verify_file.read_text()).get("ok"):
        raise SystemExit("verify.json reports failures; fix or re-run verify before loading")
    check_files(args.edition_dir, edition)
    counts = edition["counts"]
    if counts["sections"] < 1 or counts["nodes"] < 1:
        raise SystemExit("refusing an edition with no sections or no nodes (an empty run is not the publisher's code)")
    rejected = counts.get("rejected", 0)
    deliberate = 0
    unavailable: list[str] = []
    if rejected and (args.edition_dir / "rejects.jsonl.gz").exists():
        for row in lib.read_jsonl(args.edition_dir / "rejects.jsonl.gz"):
            reason = str(row.get("reason") or "")
            deliberate += reason.startswith(DELIBERATE_REJECTS)
            if reason.startswith(UNAVAILABLE_REJECTS):
                unavailable.append(reason)
    if unavailable:
        if not args.accept_rejects.strip():
            raise SystemExit(f"{len(unavailable)} part(s) of the code were not served by the publisher: "
                             + "; ".join(unavailable[:5]) + ". Re-run later, or pass --accept-rejects '<reason>' to "
                             "load without them (the reason is recorded in the edition note)")
        args.note = ((args.note + "; ") if args.note else "") + f"not included: {args.accept_rejects.strip()}"
    share = (rejected - deliberate - len(unavailable)) / max(1, counts["sections"] + rejected - deliberate - len(unavailable))
    if share > MAX_REJECT_SHARE:
        if not args.accept_rejects.strip():
            raise SystemExit(f"{rejected - deliberate - len(unavailable)} rejected rows (besides {deliberate} range entries) "
                             f"are {share:.1%} of what the run parsed (bound "
                             f"{MAX_REJECT_SHARE:.0%}); read rejects.jsonl.gz and fix the module, or pass "
                             "--accept-rejects '<reason>' when they are deliberate exclusions")
        if not unavailable:
            args.note = ((args.note + "; ") if args.note else "") + f"rejects accepted: {args.accept_rejects.strip()}"
    print(json.dumps({"edition_id": edition["edition_id"], "state": edition["state"], "sections": counts["sections"],
                      "nodes": counts["nodes"], "rejected": rejected, "range_entries": deliberate,
                      "currency_statement": edition.get("currency_statement")}, ensure_ascii=False))
    if args.dry_run:
        n_batches = sum(1 for _ in batches(lib.read_jsonl(args.edition_dir / "sections.jsonl.gz"), 500))
        print(f"dry run: {n_batches} section batches; nothing sent")
        return 0
    started = time.monotonic()
    print("begin", rpc("state_law_begin_edition_v1", {"p_edition": edition}))
    done = 0
    for batch in batches(lib.read_jsonl(args.edition_dir / "nodes.jsonl.gz"), 2000):
        rpc("state_law_load_nodes_v1", {"p_edition_id": edition["edition_id"], "p_rows": batch})
        done += len(batch)
    print(f"nodes {done}")
    done = 0
    for batch in batches(lib.read_jsonl(args.edition_dir / "sections.jsonl.gz"), 500):
        rpc("state_law_load_sections_v1", {"p_edition_id": edition["edition_id"], "p_rows": batch})
        done += len(batch)
        if done % 10000 < len(batch):
            print(f"sections {done}/{counts['sections']} ({time.monotonic() - started:.0f}s)", flush=True)
    print(f"sections {done}")
    if args.activate:
        activated = rpc("state_law_activate_edition_v1", {"p_edition_id": edition["edition_id"], "p_note": args.note})
        print("activate", activated)
        old = (activated or {}).get("superseded") if isinstance(activated, dict) else None
        if args.purge_superseded and old:
            for _ in range(200):  # the purge removes a bounded batch per call
                got = rpc("state_law_purge_edition_v1", {"p_edition_id": old, "p_limit": 20000})
                if (got or {}).get("done"):
                    print("purged superseded", old)
                    break
    print(f"loaded in {time.monotonic() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
