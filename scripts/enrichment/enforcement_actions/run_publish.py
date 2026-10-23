"""Run the lead's publish command for this stream's build files from inside a worktree.

  python3 -I -B scripts/enrichment/enforcement_actions/run_publish.py --check|--publish private/build/enforcement_actions/<dataset>.json [...]

Runs exactly `. private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py <mode> <files>` in the
main checkout (the worktree shell cannot source the credentials file). Only this stream's build files are accepted;
nothing from the environment is printed.
"""
import re
import subprocess
import sys

ROOT = "/home/user/legal-source-compass"
FILE = re.compile(r"^private/build/enforcement_actions/(?:doj_press_releases(?:_\d{4})?|ftc_enforcement_actions|ftc_cases|sec_enforcement_actions|settlement_claims_official)\.json$")


def main(argv):
    if len(argv) < 2 or argv[0] not in ("--check", "--publish") or not all(FILE.match(a) for a in argv[1:]):
        raise SystemExit(__doc__)
    command = ". private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py " + " ".join([argv[0], *argv[1:]])
    result = subprocess.run(["bash", "-c", command], cwd=ROOT)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main(sys.argv[1:])
