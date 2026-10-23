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
    args = parser.parse_args(argv)
    edition = json.loads((args.edition_dir / "edition.json").read_text())
    if edition.get("sample") is not None:
        raise SystemExit("refusing a sample edition (sample != null)")
    verify_file = args.edition_dir / "verify.json"
    if verify_file.exists() and not json.loads(verify_file.read_text()).get("ok"):
        raise SystemExit("verify.json reports failures; fix or re-run verify before loading")
    check_files(args.edition_dir, edition)
    counts = edition["counts"]
    print(json.dumps({"edition_id": edition["edition_id"], "state": edition["state"], "sections": counts["sections"],
                      "nodes": counts["nodes"], "rejected": counts.get("rejected", 0),
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
        print("activate", rpc("state_law_activate_edition_v1", {"p_edition_id": edition["edition_id"], "p_note": args.note}))
    print(f"loaded in {time.monotonic() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
