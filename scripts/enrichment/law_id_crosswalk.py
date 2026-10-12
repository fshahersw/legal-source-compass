"""Add optional Open Law IDs to reviewed, source-bound records without replacing native IDs.
Uses the pinned MIT reference implementation; no data bundle or resolver request.
Input JSONL requires explicit publisher hierarchy and source bytes; collisions stay held.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor/open-law-id/impl"))
import lawid

UPSTREAM = "75f69acf4386fa7e198a33e3f93a58a0fe836774"

def candidate(record):
    if not isinstance(record, dict):
        raise ValueError("RECORD_MUST_BE_AN_OBJECT")
    required = ("source_system", "native_id", "source_url", "source_sha256",
                "jurisdiction", "corpus", "publisher_hierarchy", "section_number")
    if any(key not in record for key in required):
        raise ValueError("MISSING_SOURCE_IDENTITY_OR_PUBLISHER_PATH")
    if any(not isinstance(record[k], str) or not record[k].strip()
           for k in ("source_system", "native_id", "section_number")):
        raise ValueError("MISSING_NATIVE_IDENTITY")
    if not isinstance(record["source_url"], str):
        raise ValueError("INVALID_SOURCE_URL")
    url = urlsplit(record["source_url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443):
        raise ValueError("INVALID_SOURCE_URL")
    digest = record["source_sha256"]
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("INVALID_SOURCE_SHA256")
    hierarchy = record["publisher_hierarchy"]
    if (not isinstance(hierarchy, list) or not hierarchy or
            any(not isinstance(x, str) or not x.strip() for x in hierarchy)):
        raise ValueError("EXPLICIT_COMPLETE_PUBLISHER_HIERARCHY_REQUIRED")
    if record.get("hierarchy_complete") is not True or record.get("identity_reviewed") is not True:
        raise ValueError("IDENTITY_REVIEW_REQUIRED")
    # Expression dates cannot be inferred from retrieval dates, code filenames or release dates.
    if record.get("point_in_time") is not None:
        raise ValueError("EXPRESSION_MINTING_NOT_SUPPORTED")
    identifier = lawid.mint(record["jurisdiction"], record["corpus"], hierarchy,
                            record["section_number"], kind=record.get("publisher_kind"))
    if not lawid.validate(identifier):
        raise ValueError("UNREGISTERED_OR_INVALID_LAW_ID")
    return {"schema_version": "publisher-law-id-crosswalk/1",
            "source_system": record["source_system"], "native_id": record["native_id"],
            "source_url": record["source_url"], "source_sha256": digest,
            "law_id": identifier, "identity_basis": "reviewed_publisher_path",
            "upstream_commit": UPSTREAM, "spec_version": "0.1",
            "native_id_preserved": True, "publication_allowed": False,
            "calculation_activation_allowed": False}

def build_crosswalk(records):
    candidates, rejected = [], []
    for record in records:
        try:
            candidates.append(candidate(record))
        except (ValueError, TypeError, KeyError) as exc:
            rejected.append({"native_id": record.get("native_id") if isinstance(record, dict) else None, "reason": str(exc)})
    groups = collections.defaultdict(list)
    native_groups = collections.defaultdict(set)
    for row in candidates:
        groups[row["law_id"]].append(row)
        native_groups[(row["source_system"], row["native_id"])].add(row["law_id"])
    accepted = []
    for identifier, rows in groups.items():
        identities = {(r["source_system"], r["native_id"]) for r in rows}
        versions = {r["source_sha256"] for r in rows}
        if len(identities) != 1 or len(versions) != 1 or any(len(native_groups[key]) != 1 for key in identities):
            rejected.extend({"native_id": r["native_id"], "law_id": identifier,
                             "reason": "AMBIGUOUS_IDENTITY_OR_VERSION"} for r in rows)
        else:
            accepted.append(rows[0])
    return {"schema_version": "publisher-law-id-review/1", "candidates": accepted,
            "held": rejected, "publication_allowed": False,
            "calculation_activation_allowed": False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    source, destination = Path(args.input), Path(args.out).resolve()
    if not destination.is_relative_to((Path.cwd() / "private").resolve()):
        raise SystemExit("OUTPUT_MUST_STAY_PRIVATE")
    if destination.exists():
        raise SystemExit("OUTPUT_EXISTS_USE_A_NEW_VERSION")
    records = [json.loads(line) for line in source.read_text(encoding="utf8").splitlines() if line.strip()]
    report = build_crosswalk(records)
    report["input_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf8") as stream:
        stream.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"candidates": len(report["candidates"]), "held": len(report["held"]),
                      "publication_allowed": False}))
    if report["held"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
