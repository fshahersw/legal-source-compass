"""The DOJ builder's boilerplate sentence keys (build_doj.py pass 1b), for the scheduled DOJ refresh.

build_doj.py marks a dollar figure's sentence as a stock paragraph when the same sentence (build_doj.sentence_key)
appears around a figure in 25 or more kept releases. A scheduled run sees only new releases, so it uses the key set of
the base build, computed here with build_doj.py's own functions over the same harvested pages (read-only):

  nice python3 -I -B scripts/api_law/enforcement/doj_boilerplate.py --out FILE

Output: {"min_releases": 25, "keys": [...sorted...], "counts": {key: releases}, "near_threshold": {key: n} (20-24),
"releases": n, "pages": n, "pages_sha256": digest of the page list}.
"""
import argparse
import gzip
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EA = ROOT / "scripts" / "enrichment" / "enforcement_actions"
sys.path.insert(0, str(EA))
sys.path.insert(0, str(EA.parent))
import build_doj  # noqa: E402

PAGES = ROOT / "private" / "acq" / "enforcement_actions" / "doj" / "pages"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    files = sorted(f for f in os.listdir(PAGES) if f.endswith(".json.gz"))
    # pass 1: the copy of each release the builder keeps (latest "changed")
    winner = {}
    for fname in files:
        data = json.loads(gzip.open(PAGES / fname).read())
        for i, r in enumerate(data.get("results") or []):
            uuid = r.get("uuid")
            if not uuid:
                continue
            changed = build_doj.time_attr(r.get("changed")) or ""
            if uuid in winner and winner[uuid][0] >= changed:
                continue
            winner[uuid] = (changed, fname, i)
    keep = {}
    for uuid, (_, fname, i) in winner.items():
        keep.setdefault(fname, set()).add(i)
    counts = Counter()
    for n, fname in enumerate(files):
        if fname not in keep:
            continue
        data = json.loads(gzip.open(PAGES / fname).read())
        for i, r in enumerate(data.get("results") or []):
            if i in keep[fname]:
                counts.update(build_doj.amount_sentence_keys(r))
        if n % 500 == 0:
            print(json.dumps({"pages_done": n, "keys": len(counts)}), file=sys.stderr)
    keys = sorted(k for k, v in counts.items() if v >= build_doj.BOILERPLATE_MIN)
    out = {
        "generator": "scripts/api_law/enforcement/doj_boilerplate.py",
        "rule": "build_doj.py pass 1b: sentence_key of a dollar figure's sentence counted once per kept release; keys counted in 25 or more releases",
        "min_releases": build_doj.BOILERPLATE_MIN,
        "releases": len(winner),
        "pages": len(files),
        "pages_sha256": hashlib.sha256("\n".join(files).encode()).hexdigest(),
        "keys": keys,
        "counts": {k: counts[k] for k in keys},
        "near_threshold": {k: v for k, v in sorted(counts.items()) if build_doj.BOILERPLATE_MIN - 5 <= v < build_doj.BOILERPLATE_MIN},
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, indent=0))
    print(json.dumps({"keys": len(keys), "near_threshold": len(out["near_threshold"]), "releases": len(winner)}))


if __name__ == "__main__":
    main()
