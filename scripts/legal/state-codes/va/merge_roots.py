#!/usr/bin/env python3
"""Merge parallel va_acquire.py worker roots into one capture root.

    merge_roots.py /tmp/sc/VA /tmp/sc/VA-w0 /tmp/sc/VA-w1 ...

Bodies are content-addressed (raw/<sha[:2]>/<sha256>), so they are copied as-is after a sha256 check; receipts.jsonl lines are
appended in worker order. A URL captured by more than one worker keeps every receipt (the parser reads the ok receipt per label).
"""
import hashlib
import pathlib
import shutil
import sys


def main(dest, sources):
    dest = pathlib.Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    copied = receipts = 0
    with (dest / "receipts.jsonl").open("a", encoding="utf8") as out:
        for src in map(pathlib.Path, sources):
            for body in (src / "raw").rglob("*"):
                if not body.is_file():
                    continue
                data = body.read_bytes()
                if hashlib.sha256(data).hexdigest() != body.name:
                    raise SystemExit("content address mismatch: %s" % body)
                target = dest / body.relative_to(src)
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(body, target)
                    copied += 1
            for line in (src / "receipts.jsonl").read_text(encoding="utf8").splitlines():
                if line.strip():
                    out.write(line + "\n")
                    receipts += 1
    print({"dest": str(dest), "bodies_copied": copied, "receipts": receipts})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
