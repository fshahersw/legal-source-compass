"""Run the lead's publisher (private/scratch/enrich/publish_build.py) for the uscourts_tables_* build files.

Equivalent to `. private/scratch/env.sh && python3 -I -B private/scratch/enrich/publish_build.py [--check|--publish] <file>...`:
the two EXTERNAL_SUPABASE_* variables are read from private/scratch/env.sh into THIS process only (never printed, logged or
written), then the publisher runs unchanged. The one difference is the write batch size: these records are 10-120 KB each,
so the shared writer's batch of 500 rows is lowered to USTABLES_BATCH (default 40) to keep each request under the gateway's
body limit; the stored rows are identical and the publisher's own readback compares every stored row with what was sent.

Usage: python3 -I -B publish_tables.py [--check|--publish] private/build/uscourts_tables/<dataset>.json ...
"""
import os
import re
import runpy
import sys
from pathlib import Path

ROOT = Path("/home/user/legal-source-compass")


def load_env():
    for line in (ROOT / "private" / "scratch" / "env.sh").read_text().splitlines():
        line = line.strip()
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m and m.group(1).startswith("EXTERNAL_SUPABASE_"):
            os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def main():
    load_env()
    sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))
    import corpus_writer as cw  # the same module the publisher imports

    cw.BATCH = int(os.environ.get("USTABLES_BATCH", "40"))
    sys.argv = ["publish_build.py"] + sys.argv[1:]
    runpy.run_path(str(ROOT / "private" / "scratch" / "enrich" / "publish_build.py"), run_name="__main__")


if __name__ == "__main__":
    main()
