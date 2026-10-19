"""Keep the court_rules build and work files gzipped on the shared disk; restore one plain build file for publishing.

  python3 -I -B scripts/enrichment/court_rules/compress_outputs.py            # gzip every plain build/work file
  python3 -I -B scripts/enrichment/court_rules/compress_outputs.py --plain court_rule_sections   # before publishing it
  python3 -I -B scripts/enrichment/court_rules/compress_outputs.py --gzip court_rule_sections    # after the readback

Readers in this folder (fetchlib.open_text / load_json) read <file>.gz when the plain file is absent.
"""
from __future__ import annotations

import gzip
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

BUILD = os.path.join(fetchlib.ROOT, "private", "build", "court_rules")
WORK = os.path.join(BUILD, "work")
DATASETS = ["court_rule_documents", "court_rule_sections", "court_rule_insights", "state_constitutions",
            "state_constitution_sections", "state_regulation_codes", "state_regulation_index"]
WORK_FILES = ["sections.jsonl", "constitution_sections.jsonl", "regulation_index.jsonl", "insights.json"]


def gzip_file(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "rb") as src, gzip.open(path + ".gz", "wb", compresslevel=6) as dst:
        shutil.copyfileobj(src, dst)
    os.remove(path)
    print(f"gzipped {os.path.relpath(path, fetchlib.ROOT)} -> {os.path.getsize(path + '.gz')} bytes")


def plain_file(path: str) -> None:
    if os.path.exists(path) or not os.path.exists(path + ".gz"):
        return
    with gzip.open(path + ".gz", "rb") as src, open(path, "wb") as dst:
        shutil.copyfileobj(src, dst)
    os.remove(path + ".gz")
    print(f"restored {os.path.relpath(path, fetchlib.ROOT)} ({os.path.getsize(path)} bytes)")


def main(argv):
    if "--plain" in argv:
        plain_file(os.path.join(BUILD, argv[argv.index("--plain") + 1] + ".json"))
    elif "--gzip" in argv:
        gzip_file(os.path.join(BUILD, argv[argv.index("--gzip") + 1] + ".json"))
    else:
        for d in DATASETS:
            gzip_file(os.path.join(BUILD, d + ".json"))
        for name in WORK_FILES:
            gzip_file(os.path.join(WORK, name))
        text_dir = os.path.join(BUILD, "text")
        for name in sorted(os.listdir(text_dir)):
            if name.endswith(".txt"):
                gzip_file(os.path.join(text_dir, name))


if __name__ == "__main__":
    main(sys.argv[1:])
