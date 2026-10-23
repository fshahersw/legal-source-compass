"""Delete this stream's superseded publish backups (private/build/_published_backups/<dataset>.<manifest16>.json).

  python3 -I -B scripts/enrichment/enforcement_actions/prune_backups.py <dataset> [...]

publish_build.py saves the live rows of a dataset before replacing them. Once the new version's read-back and check
have succeeded, those backups are superseded (every version can be rebuilt from the raw files with the scripts here).
Only this stream's dataset ids are accepted, and only files named exactly <dataset>.<16 hex>.json are removed; each
removal is printed and appended to private/scratch/enrich/enforcement_actions/pruned_backups.log.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402

BACKUPS = "/home/user/legal-source-compass/private/build/_published_backups"
OURS = re.compile(r"^(?:doj_press_releases(?:_\d{4})?|ftc_enforcement_actions|ftc_cases|sec_enforcement_actions|settlement_claims_official)$")
LOG = os.path.join(ec.SCRATCH, "pruned_backups.log")


def prune(dataset):
    if not OURS.fullmatch(dataset):
        raise SystemExit(f"not a dataset of this stream: {dataset}")
    name = re.compile(re.escape(dataset) + r"\.[0-9a-f]{16}\.json$")
    removed = []
    for fname in sorted(os.listdir(BACKUPS)):
        if name.fullmatch(fname):
            path = os.path.join(BACKUPS, fname)
            size = os.path.getsize(path)
            os.remove(path)
            removed.append((fname, size))
    with open(LOG, "a", encoding="utf-8") as h:
        for fname, size in removed:
            h.write(f"{ec.now_utc()} removed {fname} ({size:,} bytes)\n")
    for fname, size in removed:
        print(f"removed {fname} ({size:,} bytes)")
    return removed


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    for dataset in argv:
        prune(dataset)


if __name__ == "__main__":
    main(sys.argv[1:])
