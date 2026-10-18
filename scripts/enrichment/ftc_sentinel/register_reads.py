"""Register the independent second-extraction reads in private/acq/ftc_sentinel/verify/ in the manifest (idempotent).

Each read_NN_*.txt starts with SOURCE <official FTC URL>; the body is the Tavily tavily_extract raw_content for that URL,
transcribed verbatim by the agent (the tool returns the text inline, so the file is not a byte-identical capture and the
manifest says so). These reads are used only to spot-check parsed figures and to adjudicate figures the Firecrawl
extraction damaged; they never replace the stored Firecrawl captures.

Usage: python3 -I -B register_reads.py
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import record_excerpt  # noqa: E402

ROOT = record_excerpt.ROOT
VERIFY = os.path.join(ROOT, "private", "acq", "ftc_sentinel", "verify")
METHOD = "independent text extraction of the official PDF by Tavily tavily_extract (extract_depth=advanced); result transcribed verbatim by the agent into this file, not a byte-identical capture"


def main():
    known = set()
    with open(record_excerpt.MANIFEST) as handle:
        for line in handle:
            if line.strip():
                known.add(json.loads(line)["path"])
    for path in sorted(glob.glob(os.path.join(VERIFY, "read*.txt"))):
        rel = os.path.relpath(path, ROOT)
        if rel in known:
            print("already registered", rel)
            continue
        first = open(path, encoding="utf-8").readline().strip()
        assert first.startswith("SOURCE "), path
        record_excerpt.main(path, first[len("SOURCE "):], "independent reading for spot checks and adjudication", METHOD)


if __name__ == "__main__":
    main()
