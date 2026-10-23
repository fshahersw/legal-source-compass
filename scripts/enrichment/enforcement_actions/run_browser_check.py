"""Run the lead's browser check for this stream from inside the worktree.

  python3 -I -B scripts/enrichment/enforcement_actions/run_browser_check.py <outdir under private/scratch/enrich/enforcement_actions/shots> <port> <path> [...]

Runs exactly `. private/scratch/env.sh && LSC_PORT=<port> timeout 900 node private/scratch/with_server.mjs
private/scratch/shoot.mjs <outdir> 1280,1024 <paths>` in the worktree (the worktree shell cannot source the
credentials file). Nothing from the environment is printed.
"""
import os
import re
import shlex
import subprocess
import sys

WORKTREE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))


def main(argv):
    if len(argv) < 3 or not argv[0].startswith("private/scratch/enrich/enforcement_actions/shots") or not re.fullmatch(r"\d{4}", argv[1]):
        raise SystemExit(__doc__)
    paths = argv[2:]
    if not all(p.startswith("/") for p in paths):
        raise SystemExit("paths must be app paths starting with /")
    command = (f". private/scratch/env.sh && LSC_PORT={argv[1]} timeout 900 node private/scratch/with_server.mjs "
               f"private/scratch/shoot.mjs {shlex.quote(argv[0])} 1280,1024 " + " ".join(shlex.quote(p) for p in paths))
    sys.exit(subprocess.run(["bash", "-c", command], cwd=WORKTREE).returncode)


if __name__ == "__main__":
    main(sys.argv[1:])
