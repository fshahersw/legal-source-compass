"""Start scripts/ingest/dry_run.mjs with the api.data.gov key loaded the approved way (secrets_env.load), never printed.

  . private/scratch/env.sh && python3 -I -B scripts/ingest/dry_run.py [--source ID] [--json FILE] [--show N]
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_rules"))
from secrets_env import load  # noqa: E402

load("DATA_GOV_API_KEY")  # into this process's environment only; inherited by the child
sys.exit(subprocess.call(["node", "--experimental-strip-types", "--no-warnings", os.path.join(HERE, "dry_run.mjs"), *sys.argv[1:]], cwd=ROOT))
