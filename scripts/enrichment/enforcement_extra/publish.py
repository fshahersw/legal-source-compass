"""Run the lead's private/scratch/enrich/publish_build.py with the corpus credentials from private/scratch/env.sh.

Equivalent to `. private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py <args>` for shells
that may not source files: only EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY are read into this process's
environment (never printed or written), then publish_build.py runs unchanged with the same arguments.

  python3 -I -B publish.py --check <build.json>
  python3 -I -B publish.py --publish <build.json>
"""
import os
import resource
import runpy
import sys

ROOT = "/home/user/legal-source-compass"
ENV = os.path.join(ROOT, "private", "scratch", "env.sh")
NAMES = ("EXTERNAL_SUPABASE_URL", "EXTERNAL_SUPABASE_KEY")


def load_env() -> None:
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[7:].strip()
            k, _, v = line.partition("=")
            if k.strip() in NAMES and not os.environ.get(k.strip()):
                os.environ[k.strip()] = v.strip().strip('"').strip("'")


if __name__ == "__main__":
    load_env()
    sys.argv = ["publish_build.py"] + sys.argv[1:]
    try:
        runpy.run_path(os.path.join(ROOT, "private", "scratch", "enrich", "publish_build.py"), run_name="__main__")
    finally:
        print(f"peak RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024} MB", file=sys.stderr)
