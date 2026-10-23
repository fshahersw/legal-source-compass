"""Second lines of wrapped Texas headings, read from the frozen browse release's own chapter texts (read-only).

    python3 -I -B scripts/legal/state-codes/outline/tx_heading_continuations.py <snapshot dir> <out.json>

The Texas publisher prints a long heading on two centered lines ("CHAPTER 305.  TELEPHONIC COMMUNICATIONS MADE FOR" /
"PURPOSE OF SOLICITATION"); texas-publisher-html/6 kept only the first (fixed in tx-parse.py, parser /7). The browse
release keeps every chapter's full text as the parser's blocks joined by blank lines, so the second line is the block
right after the heading block. A block continues a heading only when it directly follows a heading block (TITLE,
SUBTITLE, CHAPTER, SUBCHAPTER, ARTICLE), has no lower-case letter, and is not itself a heading or a section. The output
maps "<code>\\x1f<printed first line>" to the joined heading; a first line that continues differently in two places
within one code is reported and left out.
"""
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

LEVEL = re.compile(r"^(TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|ARTICLE)\s")
NOT_CONTINUATION = re.compile(r"^(TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|ARTICLE|SECTION|Sec\.|Art\.)\s", re.I)


def continuations(text):
    """[(first line, joined heading)] for one chapter text."""
    blocks = text.split("\n\n")
    out = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        if LEVEL.match(block):
            joined, j = block, i + 1
            while j < len(blocks):
                nxt = blocks[j]
                if not nxt or re.search(r"[a-z]", nxt) or NOT_CONTINUATION.match(nxt) or not re.search(r"[A-Z]", nxt):
                    break
                joined += " " + nxt
                j += 1
            if j > i + 1:
                out.append((block, joined))
            i = j
        else:
            i += 1
    return out


def main(argv):
    base, out_path = Path(argv[0]), Path(argv[1])
    codes = json.loads((base / "state-codes/tx/browse-v1/codes.json").read_text(encoding="utf-8"))
    found = defaultdict(set)
    files = 0
    for code in codes["codes"]:
        index = json.loads((base / code["file"]).read_text(encoding="utf-8"))
        for chapter in index["chapters"]:
            ref = chapter["text"]
            raw = (base / ref["file"]).read_bytes()
            if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise ValueError(f"text hash mismatch {ref['file']}")
            files += 1
            for first, joined in continuations(raw.decode("utf-8")):
                found[(code["code"], first)].add(joined)
    mapping, conflicts = {}, []
    for (code, first), joined in sorted(found.items()):
        if len(joined) == 1:
            mapping[f"{code}\x1f{first}"] = next(iter(joined))
        else:
            conflicts.append({"code": code, "first_line": first, "continued_as": sorted(joined)})
    out_path.write_text(json.dumps({"source": "state-codes/tx/browse-v1 chapter texts", "chapter_texts": files,
                                    "headings": mapping, "conflicts": conflicts}, ensure_ascii=False, indent=1))
    print(json.dumps({"chapter_texts": files, "wrapped_headings": len(mapping), "conflicts": len(conflicts)}))


if __name__ == "__main__":
    main(sys.argv[1:])
