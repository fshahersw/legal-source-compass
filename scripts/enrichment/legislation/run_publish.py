"""Run the shared publishers with the corpus credentials loaded into this process only.

  python3 -I -B run_publish.py build  --check|--publish private/build/legislation/crs_reports.json
  python3 -I -B run_publish.py stream --check|--publish private/build/legislation/congress_bills.meta.json

`build` runs private/scratch/enrich/publish_build.py (one JSON build file, as WORKER_RULES.md prescribes); `stream` runs
scripts/enrichment/ecfr_full/publish_stream.py, the same validation, ownership check and record-by-record readback for
builds too large to hold in memory (congress_bills about 1.3 GB of rows, state_bills about 0.9 GB). Inside a worktree the
shell does not source private/scratch/env.sh, so this wrapper reads its KEY=VALUE lines into os.environ; nothing is
printed, written or logged from it.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKTREE = HERE.parents[2]
MAIN = Path("/home/user/legal-source-compass")
ENV = MAIN / "private" / "scratch" / "env.sh"


def load_env() -> None:
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[0] not in ("build", "stream"):
        raise SystemExit(__doc__)
    load_env()
    if argv[0] == "build":
        os.chdir(MAIN)
        sys.path.insert(0, str(MAIN / "private" / "scratch" / "enrich"))
        sys.path.insert(0, str(MAIN / "scripts" / "enrichment"))
        import publish_build as pb

        pb.main([a if a.startswith("--") else str((WORKTREE / a).resolve()) for a in argv[1:]])
    else:
        os.chdir(WORKTREE)
        sys.path.insert(0, str(WORKTREE / "scripts" / "enrichment" / "ecfr_full"))
        import publish_stream as ps

        ps.main([a if a.startswith("--") else str(WORKTREE / a) for a in argv[1:]])


if __name__ == "__main__":
    main(sys.argv[1:])
