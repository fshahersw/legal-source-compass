"""Run one state's acquisition + parse into state-law/1 files (see MODEL.md).

  python3 scripts/state_law/run.py fl --out private/build/w1025_stat-a/state_law \
      --raw private/acq/w1025_stat-a/state_law --sample 40

--sample N   stop after N sections (validation sample; raw bytes are kept automatically)
--keep-raw   keep raw bytes on a full run as well (avoid: full runs stream and discard)
--list       print each state module's metadata (blocked states included) and exit
Exit codes: 0 ok, 3 blocked by the publisher (robots/403/browser check; recorded in blocked.json), 1 error.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402


def load_state(code: str):
    path = HERE / "states" / f"{code.lower()}.py"
    if not path.exists():
        raise SystemExit(f"no state module {path}")
    spec = importlib.util.spec_from_file_location(f"state_law.states.{code.lower()}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    if not isinstance(getattr(module, "META", None), lib.StateMeta):
        raise SystemExit(f"{path} has no META")
    module.META.validate()
    return module


def list_states() -> None:
    for path in sorted((HERE / "states").glob("[a-z][a-z].py")):
        module = load_state(path.stem)
        meta = module.META
        print(json.dumps({"state": meta.state, "access": meta.access, "official_source": meta.official_source,
                          "publisher": meta.publisher, "blocked": meta.blocked, "parser": meta.parser,
                          "codes": [c.code for c in meta.codes]}, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("state", nargs="?")
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("private/build/state_law"))
    parser.add_argument("--raw", type=pathlib.Path, default=None)
    parser.add_argument("--sample", type=int, default=None)
    parser.add_argument("--keep-raw", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--option", action="append", default=[], help="state-specific key=value option")
    args = parser.parse_args(argv)
    if args.list:
        list_states()
        return 0
    if not args.state:
        parser.error("state required")
    module = load_state(args.state)
    meta = module.META
    if meta.blocked:
        print(json.dumps({"state": meta.state, "blocked": meta.blocked}, ensure_ascii=False))
        return 3
    ctx = lib.RunContext(meta, args.out, args.raw, sample=args.sample, keep_raw=args.keep_raw)
    ctx.options = dict(item.split("=", 1) for item in args.option)
    started = time.monotonic()
    try:
        module.acquire(ctx)
    except lib.Blocked as error:
        edition = ctx.finish()
        (ctx.dir / "blocked.json").write_text(json.dumps({"state": meta.state, "reason": str(error),
                                                          "at": lib.utcnow()}, indent=2))
        ctx.log(f"BLOCKED: {error} (partial edition kept for review only: {ctx.dir})")
        return 3
    except Exception:
        traceback.print_exc()
        ctx.finish()
        (ctx.dir / "failed.json").write_text(json.dumps({"state": meta.state, "error": traceback.format_exc()[-4000:]}))
        return 1
    edition = ctx.finish()
    ctx.log(f"done in {time.monotonic() - started:.1f}s: {edition['counts']} -> {ctx.dir}")
    print(json.dumps({"edition_dir": str(ctx.dir), "counts": edition["counts"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
