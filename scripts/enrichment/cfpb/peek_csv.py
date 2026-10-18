"""Diagnostic: print the header and first rows of the complaints CSV inside the zip (no extraction)."""
import csv
import io
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ZIP = os.path.join(ROOT, "private", "acq", "cfpb", "bulk", "complaints.csv.zip")

n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
with zipfile.ZipFile(ZIP) as archive:
    with archive.open("complaints.csv") as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))
        for i, row in enumerate(reader):
            print(i, [cell[:120] for cell in row])
            if i >= n:
                break
