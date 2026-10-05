"""Compare every parsed DC code article to the publisher's separate bulk export."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import zipfile


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def comparison_text(text, publisher_export=False, identity=None):
    # HTMLParser already decodes HTML entities in the parsed article. The
    # independent search export retains them and needs exactly one decode.
    if publisher_export:
        text = html.unescape(text)
    text = re.sub(r"\s+", "", text)
    prefix = "CodeoftheDistrictofColumbia"
    if publisher_export and identity != "/us/dc/council/code" and text.startswith(prefix):
        text = text[len(prefix):]
    return text


def audit(parsed, bulk, bulk_receipt, output):
    if output.exists():
        raise ValueError("Refusing audit overwrite")
    manifest = json.loads((parsed / "manifest.json").read_text(encoding="utf-8"))
    if manifest["parser"] != "dc-council-html/2":
        raise ValueError("Reviewed parser v2 required")
    for name, pin in manifest["outputs"].items():
        file = parsed / name
        if file.parent.resolve() != parsed.resolve() or file.stat().st_size != pin["bytes"] or sha(file) != pin["sha256"]:
            raise ValueError("Changed parser output")
    receipt = json.loads(bulk_receipt.read_text(encoding="utf-8"))
    if (receipt["commit"] != manifest["source"]["commit"] or receipt["status"] != 200
            or receipt["whole_object_verified"] is not True or bulk.stat().st_size != receipt["bytes"]
            or sha(bulk) != receipt["sha256"]):
        raise ValueError("Publisher bulk version or byte mismatch")
    rows = {}
    for line in (parsed / "records.jsonl").open(encoding="utf-8"):
        row = json.loads(line)
        if row["native_id"] in rows:
            raise ValueError("Duplicate derivative identity")
        body = row["text"].encode("utf-8")
        if hashlib.sha256(body).hexdigest() != row["text_sha256"] or len(body) != row["text_bytes"]:
            raise ValueError("Changed article text")
        rows[row["native_id"]] = row
    seen = set()
    counts = {"publisher_export_records": 0, "code_export_records": 0, "character_sequence_matches": 0}
    missing, mismatches, duplicates = [], [], []
    with zipfile.ZipFile(bulk) as z:
        if z.namelist() != ["index.bulk"]:
            raise ValueError("Unexpected publisher search archive")
        with z.open("index.bulk") as f:
            while line := f.readline():
                action = json.loads(line)
                data = json.loads(f.readline())
                identity = action["index"]["_id"]
                counts["publisher_export_records"] += 1
                if identity in seen:
                    duplicates.append(identity)
                seen.add(identity)
                if identity != data["url"]:
                    raise ValueError("Search action and document identity conflict")
                if identity == "/us/dc/council/code" or identity.startswith("/us/dc/council/code/"):
                    counts["code_export_records"] += 1
                    if identity not in rows:
                        missing.append(identity)
                        continue
                    actual = comparison_text(rows[identity]["text"])
                    expected = comparison_text(data["body"], publisher_export=True, identity=identity)
                    if actual != expected:
                        mismatches.append({"native_id": identity, "parsed_characters": len(actual), "export_characters": len(expected)})
                    else:
                        counts["character_sequence_matches"] += 1
    outside_export = sorted(rows.keys() - seen)
    toc = {r["p"]: r for r in json.loads((parsed / "toc.json").read_text(encoding="utf-8"))}
    reconciliation = json.loads((parsed / "reconciliation.json").read_text(encoding="utf-8"))
    unresolved = []
    for identity in reconciliation["toc_nodes_without_article"]:
        node = toc[identity]
        parent = rows.get(node["parent_id"])
        matches = sum(line == node["t"] for line in parent["text"].splitlines()) if parent else 0
        unresolved.append({"publisher_toc_target": identity, "publisher_toc_heading": node["t"],
                           "parent_id_from_toc": node["parent_id"], "parent_article_captured": bool(parent),
                           "parent_text_sha256": parent["text_sha256"] if parent else None,
                           "matching_heading_occurrences_in_parent": matches,
                           "standalone_html_page_present": False})
    result = {"schema_version": "dc-council-full-capture-audit/1", "source_commit": receipt["commit"],
              "source_codified_date": manifest["source"]["source_codified_date"],
              "method": "All non-whitespace article characters must equal the independent publisher search export after one HTML entity decode and removal of its Code of the District of Columbia breadcrumb. This checks full text including notes, not whitespace or layout equivalence.",
              "counts": counts, "missing_export_articles": missing, "duplicate_export_identities": duplicates,
              "text_mismatches": mismatches, "parsed_articles_outside_export": outside_export,
              "all_publisher_code_articles_match": not any([missing, duplicates, mismatches, outside_export]),
              "publisher_toc_targets_without_standalone_pages": unresolved,
              "publisher_fragment_identity_conflicts": reconciliation["fragment_identity_conflicts"],
              "published": False, "current_law_verified": False, "calculation_activation_allowed": False,
              "inputs": {str(p): {"sha256": sha(p), "bytes": p.stat().st_size} for p in [parsed / "manifest.json", bulk, bulk_receipt]}}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--parsed", type=Path, required=True)
    p.add_argument("--bulk", type=Path, required=True)
    p.add_argument("--receipt", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    result = audit(a.parsed, a.bulk, a.receipt, a.output)
    print(json.dumps({"counts": result["counts"], "all_publisher_code_articles_match": result["all_publisher_code_articles_match"],
                      "text_mismatches": len(result["text_mismatches"]), "toc_targets_without_standalone_pages": len(result["publisher_toc_targets_without_standalone_pages"]), "report_sha256": sha(a.output)}))
