"""Check that every file in private/acq/enforcement_series/_manifest.jsonl is intact (exists, same byte size, same sha256).

Entries with "action": "removed" are checked the other way round: the file must be absent.
Usage: python3 -I -B verify_acq.py
Exit status 1 when anything is missing, truncated or changed.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement_series")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    removed = set()
    entries = []
    with open(os.path.join(ACQ, "_manifest.jsonl")) as handle:
        for line in handle:
            if line.strip():
                entries.append(json.loads(line))
    for entry in entries:
        if entry.get("action") == "removed":
            removed.add(entry["path"])
    problems, checked = [], 0
    latest = {}
    for entry in entries:
        if entry.get("action") == "removed":
            continue
        latest[entry["path"]] = entry  # a later fetch of the same path supersedes the earlier line
    for path, entry in sorted(latest.items()):
        full = os.path.join(ROOT, path)
        if path in removed:
            if os.path.exists(full):
                problems.append(f"{path}: logged as removed but still on disk")
            continue
        if not os.path.exists(full):
            problems.append(f"{path}: missing")
            continue
        size = os.path.getsize(full)
        if size != entry["bytes"]:
            problems.append(f"{path}: size {size} != manifest {entry['bytes']}")
            continue
        if sha256_file(full) != entry["sha256"]:
            problems.append(f"{path}: sha256 differs from manifest")
            continue
        checked += 1
    extra = []
    for base, _dirs, files in os.walk(ACQ):
        for name in files:
            rel = os.path.relpath(os.path.join(base, name), ROOT)
            if name != "_manifest.jsonl" and rel not in latest:
                extra.append(rel)
    print(json.dumps({"entries": len(latest), "intact": checked, "problems": problems, "files_not_in_manifest": sorted(extra)}, indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
