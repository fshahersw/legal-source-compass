"""Parse every title zip of one OLRC release point into per-title JSON Lines (gzip) under
private/build/uscode/parsed/<release>/t<key>.jsonl.gz.

  python3 -I -B scripts/enrichment/uscode/parse_release.py <release> [--titles 09,42]

Line 1 of each file is {"type": "title", ...meta, file, zip_sha256}; then {"type": "container", ...} records; then
{"type": "unit", ..., "hash": sha256 of the unit's printed content} in document order. The hash covers heading,
status, body lines, footnotes, source credit and notes, so two release points can be compared section by section.
"""
import argparse
import gzip
import hashlib
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402
import uslm  # noqa: E402


def unit_hash(u):
    payload = {k: u[k] for k in ("heading", "status", "lines", "footnotes", "source_credit", "notes")}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def title_key_from_name(name):
    """'usc05A.xml' -> '5a', 'usc42.xml' -> '42'."""
    stem = name.rsplit("/", 1)[-1][3:-4].lower()
    return stem.lstrip("0") or "0"


def parse_zip(zip_path, out_path):
    z = zipfile.ZipFile(zip_path)
    names = [n for n in z.namelist() if n.lower().endswith(".xml")]
    if len(names) != 1:
        raise SystemExit(f"{zip_path}: expected one XML file, found {names}")
    name = names[0]
    tkey = title_key_from_name(name)
    containers, units, meta = [], [], {}
    with z.open(name) as fh:
        for kind, rec in uslm.parse_title(fh, tkey):
            if kind == "container":
                containers.append(rec)
            elif kind == "unit":
                rec["hash"] = unit_hash(rec)
                units.append(rec)
            else:
                meta = rec
    containers.sort(key=lambda c: c["index"])
    head = {"type": "title", "key": tkey, "file": name, "zip": str(zip_path), "zip_sha256": fetchlib.sha256_file(zip_path),
            "xml_bytes": z.getinfo(name).file_size, "meta": meta, "containers": len(containers), "units": len(units)}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wt", encoding="utf-8", compresslevel=6) as out:
        out.write(json.dumps(head, ensure_ascii=False) + "\n")
        for c in containers:
            out.write(json.dumps({"type": "container", **c}, ensure_ascii=False) + "\n")
        for u in units:
            out.write(json.dumps({"type": "unit", **u}, ensure_ascii=False) + "\n")
    return head


def read_parsed(path):
    """(head, containers, units) from a parsed title file."""
    head, containers, units = None, [], []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            t = rec.pop("type")
            if t == "title":
                head = rec
            elif t == "container":
                containers.append(rec)
            else:
                units.append(rec)
    return head, containers, units


def parsed_dir(release):
    return fetchlib.BUILD / "parsed" / release


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    ap.add_argument("--titles")
    args = ap.parse_args()
    src = fetchlib.ACQ / args.release
    wanted = set(args.titles.split(",")) if args.titles else None
    for zip_path in sorted(src.glob("xml_usc*@*.zip")):
        key = zip_path.name[len("xml_usc"):].split("@")[0]
        if wanted and key not in wanted:
            continue
        head = parse_zip(zip_path, parsed_dir(args.release) / f"t{key.lower()}.jsonl.gz")
        print(json.dumps({k: head[k] for k in ("key", "file", "containers", "units", "xml_bytes")}), flush=True)


if __name__ == "__main__":
    main()
