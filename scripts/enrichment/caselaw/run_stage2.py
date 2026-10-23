"""Case-law stage 2: run every step in order, once stage 1 (extract_text.py) has completed every unit.

    cd scripts/enrichment/caselaw
    python3 -I -B run_stage2.py --build full-1 [--from STEP] [--only STEP] [--dry-run]

Steps (each is its own script, logged to private/build/caselaw_read/logs/<step>.log, stopping at the first failure):
  read         read_store.py run --units all --workers 3        reading store from every stage-1 shard (rebuilds
                                                                every group whose input shards changed)
  citedby      citator.py run --kind citedby                    cited-by members (independent of the extraction, about
                                                                50 minutes; skip with --from authorities if current)
  authorities  citator.py run --kind authorities                cited authorities from the reading store's anchors
  names        names.py                                         only when meta/names.parquet is missing
  meta         case_meta.py                                     one row per case
  objects      load_caselaw.py objects                          register the storage objects the rows point to
  courts       load_caselaw.py courts
  cases        load_caselaw.py cases --build <build> --workers 4
  fts          load_caselaw.py fts --build <build> --tiers t1 --workers 3
  status       load_caselaw.py status                           sizes and counts -> load_status.json
  verify       verify_caselaw.py --sample 200                   0 failures expected
Credentials are read from the environment or private/scratch/env.sh by the scripts themselves; nothing is printed.
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "caselaw_read")


def steps(build: str) -> list[tuple[str, list[str], bool]]:
    """(name, argv, run only when needed)"""
    return [
        ("read", ["read_store.py", "run", "--units", "all", "--workers", "3"], False),
        ("citedby", ["citator.py", "run", "--kind", "citedby"], False),
        ("authorities", ["citator.py", "run", "--kind", "authorities"], False),
        ("names", ["names.py"], True),
        ("meta", ["case_meta.py"], False),
        ("objects", ["load_caselaw.py", "objects"], False),
        ("courts", ["load_caselaw.py", "courts"], False),
        ("cases", ["load_caselaw.py", "cases", "--build", build, "--workers", "4"], False),
        ("fts", ["load_caselaw.py", "fts", "--build", build, "--tiers", "t1", "--workers", "3"], False),
        ("status", ["load_caselaw.py", "status"], False),
        ("verify", ["verify_caselaw.py", "--sample", "200"], False),
    ]


def needed(name: str) -> bool:
    if name == "citedby":
        return len(glob.glob(os.path.join(BUILD, "citator", "index", "c*.tsv.gz"))) == 0
    if name == "names":
        return not os.path.exists(os.path.join(BUILD, "meta", "names.parquet"))
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--build", required=True)
    ap.add_argument("--from", dest="start", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    os.makedirs(os.path.join(BUILD, "logs"), exist_ok=True)
    plan = steps(a.build)
    names = [s[0] for s in plan]
    for want in (a.start, a.only):
        if want and want not in names:
            raise SystemExit(f"unknown step {want!r}; steps: {', '.join(names)}")
    started = not a.start
    for name, args, conditional in plan:
        started = started or name == a.start
        if not started or (a.only and name != a.only):
            continue
        if conditional and not a.only and not needed(name):
            print(f"[stage2] {name}: skipped (already built)", flush=True)
            continue
        cmd = [sys.executable, "-I", "-B", *args]
        print(f"[stage2] {name}: {' '.join(args)}", flush=True)
        if a.dry_run:
            continue
        t0 = time.time()
        with open(os.path.join(BUILD, "logs", f"{name}.log"), "a") as log:
            code = subprocess.call(cmd, cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
        print(f"[stage2] {name}: exit {code} after {time.time() - t0:.0f}s (log: private/build/caselaw_read/logs/{name}.log)", flush=True)
        if code != 0:
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
