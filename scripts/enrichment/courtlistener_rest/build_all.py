"""Run every courtlistener_rest builder in order (after ingest_rest.py and build_rest_work.py), stopping at the first failure.

    python3 -I -B build_all.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDERS = ["build_clb_bankruptcy", "build_clb_oral", "build_clb_appellate", "build_clb_judge_disclosures", "build_clb_parentheticals", "build_clb_unmatched", "build_clb_schema_rest"]

for b in BUILDERS:
    r = subprocess.run([sys.executable, "-I", "-B", os.path.join(HERE, b + ".py")], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode:
        print(r.stderr[-3000:])
        sys.exit(f"{b} failed")
