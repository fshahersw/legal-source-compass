"""Rebuild and verify every enforcement_actions dataset from the raw files (no network except the DOJ API count read).

  python3 -I -B scripts/enrichment/enforcement_actions/rebuild_all.py [ftc sec settlements doj spot]

Each step's output goes to private/scratch/enrich/enforcement_actions/<step>.out; the run stops at the first failure.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402

STEPS = {
    "ftc": [["build_ftc.py"], ["verify_enforcement_actions.py", "ftc"]],
    "sec": [["build_sec.py"], ["verify_enforcement_actions.py", "sec", "--sample", "4000"]],
    "settlements": [["build_settlements.py"], ["verify_enforcement_actions.py", "settlements", "--recheck"]],
    "doj": [["build_doj.py"], ["verify_enforcement_actions.py", "doj", "--sample", "5000"]],
    "spot": [["spot_checks.py"]],
}


def main(argv):
    names = argv or list(STEPS)
    for name in names:
        for i, cmd in enumerate(STEPS[name]):
            out = os.path.join(ec.SCRATCH, f"{name}_{i}.out")
            target = os.path.join(ec.BUILD, "spot_checks.md") if name == "spot" else out
            with open(target, "w", encoding="utf-8") as handle:
                result = subprocess.run([sys.executable, "-I", "-B", os.path.join(HERE, cmd[0]), *cmd[1:]],
                                        stdout=handle, stderr=subprocess.STDOUT)
            print(f"{name} {cmd[0]} exit={result.returncode} -> {ec.rel(target)}", flush=True)
            if result.returncode != 0:
                sys.exit(result.returncode)


if __name__ == "__main__":
    main(sys.argv[1:])
