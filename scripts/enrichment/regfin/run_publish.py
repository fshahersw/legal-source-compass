"""Run the lead's publish command for this stream's build files from inside a worktree.

  python3 -I -B scripts/enrichment/regfin/run_publish.py --validate|--check|--publish private/build/regfin/<dataset>.json [...]

--validate runs `python3 -I -B private/scratch/enrich/publish_build.py <files>` (no credentials, no network).
--check / --publish run exactly `. private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py <mode> <files>`
in the main checkout (the worktree shell cannot source the credentials file). Only this stream's four dataset ids are accepted;
nothing from the environment is printed.
"""
import re
import subprocess
import sys

ROOT = "/home/user/legal-source-compass"
FILE = re.compile(r"^private/build/regfin/(?:sec_broker_dealers|sec_investment_advisers|sec_adviser_statistics|frb_enforcement_actions)\.json$")


def main(argv):
    if len(argv) < 2 or argv[0] not in ("--validate", "--check", "--publish") or not all(FILE.match(a) for a in argv[1:]):
        raise SystemExit(__doc__)
    if argv[0] == "--validate":
        command = "python3 -I -B private/scratch/enrich/publish_build.py " + " ".join(argv[1:])
    else:
        command = ". private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py " + " ".join(argv)
    result = subprocess.run(["bash", "-c", command], cwd=ROOT)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main(sys.argv[1:])
