"""Locate the acquired CJRA files of each report period from the manifest (offline) and verify them against it.

private/acq/uscourts_cjra/_manifest.jsonl lists every response with url, path, sha256, bytes, retrieved_at, status, method.
A period's files sit in private/acq/uscourts_cjra/files/<period>/. Naming: 2004-2018 reports are one PDF
(report text, Tables 1-4 and Appendix A); 2019-2026 reports are cjra_<1..4> (the four summary tables) plus cjra_na
(Appendix A, "n-a").
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "uscourts_cjra"
BUILD = ROOT / "private" / "build" / "uscourts_cjra"
MANIFEST = ACQ / "_manifest.jsonl"
TABLE_FILE = re.compile(r"(?i)cjra_([1-4])_")


def manifest():
    """{relative path: manifest entry} (the last successful fetch of a path wins)."""
    entries = {}
    for line in MANIFEST.read_text().splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry.get("path") and entry.get("status") == 200:
            entries[entry["path"]] = entry
    return entries


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def periods():
    """{period 'YYYY-MM-DD': {"main": entry, "tables": {1..4: entry}}} from the manifest (PDF files only)."""
    out = {}
    for path, entry in sorted(manifest().items()):
        if not path.endswith(".pdf"):
            continue
        parts = Path(path).parts
        if len(parts) < 2 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", parts[-2]):
            continue
        period = parts[-2]
        slot = out.setdefault(period, {"main": None, "tables": {}})
        m = TABLE_FILE.search(parts[-1])
        if m:
            slot["tables"][int(m.group(1))] = entry
        else:
            if slot["main"] is not None:
                raise SystemExit(f"{period}: more than one main PDF ({slot['main']['path']}, {path})")
            slot["main"] = entry
    return out


def verified(entry):
    """Absolute path of a manifest entry's file after checking its sha256 against the manifest."""
    path = ROOT / entry["path"]
    actual = sha256(path)
    if actual != entry["sha256"]:
        raise SystemExit(f"{entry['path']}: sha256 {actual} differs from manifest {entry['sha256']}")
    return path
