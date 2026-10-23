"""Browser check: start the dev server with the corpus credentials and take screenshots (private/scratch/shoot.mjs).

  python3 -I -B run_shoot.py <port> <outdir under private/scratch/enrich/legislation/shots> <widths> <path> [path ...]

The credentials are read from private/scratch/env.sh into the child processes' environment only; nothing is printed.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[3]
ENV = Path("/home/user/legal-source-compass/private/scratch/env.sh")


def main(argv: list[str]) -> int:
    if len(argv) < 4 or not re.fullmatch(r"\d{4}", argv[0]) or not argv[1].startswith("private/scratch/enrich/legislation/shots/"):
        raise SystemExit(__doc__)
    env = dict(os.environ)
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    env["LSC_PORT"] = argv[0]
    r = subprocess.run(["node", "private/scratch/with_server.mjs", "private/scratch/shoot.mjs", *argv[1:]], cwd=WORKTREE, env=env)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
