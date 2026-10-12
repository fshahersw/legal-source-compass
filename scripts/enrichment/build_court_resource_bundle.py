"""Build a private reviewed court-resource snapshot from immutable captures.

Prepare a review template (every decision starts held):
  python scripts/enrichment/build_court_resource_bundle.py --captures=private/.../captures --prepare-review=private/.../review.json
Build after explicit per-anchor review:
  python scripts/enrichment/build_court_resource_bundle.py --captures=private/.../captures --review=private/.../review.json --output=private/.../bundle
No network, database writes, manifest edits or publication are performed.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from capture_court_resources import extract_page, safe_web_url, save_immutable

KINDS = {"rules", "forms", "filing", "fees", "help", "website"}
LOGICAL_NAME = "court-resources/official-links.json"


def sha(body):
    return hashlib.sha256(body).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def iso_date(value):
    if not isinstance(value, str):
        raise ValueError("An explicit ISO timestamp is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamps must include a timezone")
    return value


def verified_captures(root):
    captures = {}
    for path in sorted((root / "receipts").glob("*.json")):
        raw_receipt = path.read_bytes()
        digest = sha(raw_receipt)
        if path.stem != digest:
            raise ValueError("Capture receipt checksum mismatch")
        receipt = json.loads(raw_receipt)
        if receipt.get("status") != "captured":
            continue
        if receipt.get("identity_reviewed") is not True or receipt.get("publication") != "not_published":
            raise ValueError("Capture identity or publication status was not recorded")
        if not re.fullmatch(r"[a-z0-9_-]{1,80}", receipt.get("court_id", "")) or not receipt.get("court_name") or not receipt.get("source_record"):
            raise ValueError("Exact capture identity or source record missing")
        if any(not re.fullmatch(r"[a-f0-9]{64}", receipt.get(field, "")) for field in ("response_sha256", "text_sha256")):
            raise ValueError("Invalid capture evidence digest")
        body = (root / "raw" / f'{receipt["response_sha256"]}.raw').read_bytes()
        text = (root / "text" / f'{receipt["text_sha256"]}.txt').read_bytes()
        if sha(body) != receipt["response_sha256"] or sha(text) != receipt["text_sha256"] or len(body) != receipt["response_bytes"]:
            raise ValueError("Captured response/text checksum or size mismatch")
        source_page = receipt["final_url"]
        if not safe_web_url(source_page):
            raise ValueError("Capture source must be public HTTPS")
        parsed, rendered_text = extract_page(body, source_page, receipt.get("response_charset", "utf-8"))
        if text != rendered_text.encode("utf-8"):
            raise ValueError("Retained plain text does not match unchanged source rendering")
        observed = {(anchor["url"], anchor["label"], anchor["href_as_published"]) for anchor in parsed["anchors"]}
        for anchor in receipt["anchors"]:
            if (anchor["url"], anchor["label"], anchor["href_as_published"]) not in observed:
                raise ValueError("Receipt anchor was not observed in the unchanged source response")
        captures[digest] = receipt
    if not captures:
        raise ValueError("No verified successful captures")
    return captures


def review_template(captures):
    return {
        "schema": "court-resource-review/1", "release": "", "reviewer": "", "reviewed_at": "",
        "decisions": [
            {"receipt_sha256": digest, "court_id": capture["court_id"], "court_system": "", "url": anchor["url"], "label": anchor["label"], "kind": "", "decision": "hold", "note": ""}
            for digest, capture in captures.items() for anchor in capture["anchors"]
        ],
    }


def build_bundle(captures, review):
    if review.get("schema") != "court-resource-review/1" or not review.get("release") or not review.get("reviewer"):
        raise ValueError("An explicit review release and reviewer are required")
    reviewed_at = iso_date(review.get("reviewed_at"))
    resources = []
    seen = set()
    identities = {}
    for decision in review.get("decisions", []):
        if decision.get("decision") not in ("approve", "hold", "exclude"):
            raise ValueError("Every decision must be approve, hold or exclude")
        if decision["decision"] != "approve":
            continue
        capture = captures.get(decision.get("receipt_sha256"))
        if not capture or capture["court_id"] != decision.get("court_id"):
            raise ValueError("Review does not match the exact captured court identity")
        if decision.get("kind") not in KINDS or decision.get("court_system") not in ("Federal", "State") or not decision.get("note"):
            raise ValueError("Every approved link needs category, court system and review rationale")
        url, label = decision.get("url"), decision.get("label")
        if not safe_web_url(url) or not any(anchor["url"] == url and anchor["label"] == label and not re.search(r"\s", anchor["href_as_published"]) for anchor in capture["anchors"]):
            raise ValueError("Approved link is not an exact observed HTTPS anchor")
        destination = urlsplit(url)
        if decision["court_system"] == "State" and (destination.hostname == "uscourts.gov" or destination.hostname.endswith(".uscourts.gov")):
            raise ValueError("Federal destination conflicts with recorded state court")
        key = (capture["court_id"], url)
        if key in seen:
            raise ValueError("Review must choose one label/category for each exact court URL")
        seen.add(key)
        identity = (capture["court_name"], decision["court_system"])
        if capture["court_id"] in identities and identities[capture["court_id"]] != identity:
            raise ValueError("Conflicting exact court identity")
        identities[capture["court_id"]] = identity
        identity_hash = sha(json_bytes([capture["court_id"], url]))
        resources.append({
            "id": f"resource:{identity_hash}", "courtId": capture["court_id"], "courtName": capture["court_name"],
            "courtSystem": decision["court_system"], "label": label, "url": url, "kind": decision["kind"],
            "status": "source_link_observed",
            "provenance": {"sourcePage": capture["final_url"], "sourceRecord": capture["source_record"], "capturedAt": iso_date(capture["retrieved_at"]), "responseSha256": capture["response_sha256"], "receiptSha256": decision["receipt_sha256"]},
            "review": {"decision": "approved", "reviewer": review["reviewer"], "reviewedAt": reviewed_at, "note": decision["note"]},
        })
    if not 1 <= len(resources) <= 5000:
        raise ValueError("The reviewed bundle must contain 1–5000 approved source-backed resources")
    return {"schema": "court-resources/1", "release": review["release"], "generatedAt": datetime.now(timezone.utc).isoformat(), "resources": sorted(resources, key=lambda row: (row["courtId"], row["kind"], row["url"]))}


def private_path(value):
    root = (Path.cwd() / "private").resolve()
    target = value.resolve()
    if target == root or not target.is_relative_to(root):
        raise ValueError("Review and bundle outputs must stay under ignored private/")
    return target


def verify_bundle(captures, review, bundle):
    expected = build_bundle(captures, review)
    iso_date(bundle.get("generatedAt"))
    if {key: value for key, value in bundle.items() if key != "generatedAt"} != {key: value for key, value in expected.items() if key != "generatedAt"}:
        raise ValueError("Bundle differs from independently rebuilt source-backed review")
    return len(expected["resources"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, required=True)
    parser.add_argument("--prepare-review", type=Path)
    parser.add_argument("--review", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--verify-bundle", type=Path)
    args = parser.parse_args()
    captures = verified_captures(args.captures)
    if args.prepare_review:
        if args.review or args.output or args.verify_bundle:
            raise ValueError("Template preparation and reviewed build are separate actions")
        target = private_path(args.prepare_review)
        save_immutable(target, json_bytes(review_template(captures)))
        print(json.dumps({"status": "review_required", "captures": len(captures), "candidates": sum(len(value["anchors"]) for value in captures.values())}))
        return
    if args.verify_bundle:
        if not args.review or args.output:
            raise ValueError("Verification requires a review and no build output")
        review = json.loads(private_path(args.review).read_text(encoding="utf-8-sig"))
        bundle = json.loads(private_path(args.verify_bundle).read_text(encoding="utf-8-sig"))
        count = verify_bundle(captures, review, bundle)
        print(json.dumps({"status": "verified_against_raw_sources", "resources": count}))
        return
    if not args.review or not args.output:
        raise ValueError("A separate explicit review and private output directory are required")
    review_raw = args.review.read_bytes()
    bundle = build_bundle(captures, json.loads(review_raw.decode("utf-8-sig")))
    output = private_path(args.output)
    body = json_bytes(bundle)
    digest = sha(body)
    if len(body) > 16 * 1024 * 1024:
        raise ValueError("Bundle exceeds protected snapshot size limit")
    save_immutable(output / f"{digest}.json", body)
    descriptor = {"schema": "court-resource-staging/1", "publication": "not_published", "reviewSha256": sha(review_raw), "release": bundle["release"], "resources": len(bundle["resources"]), "file": LOGICAL_NAME, "entry": {"sha256": digest, "bytes": len(body), "storage_key": f"atlas-private-data/sha256/{digest[:2]}/{digest}.bin"}}
    save_immutable(output / f"{digest}.staging.json", json_bytes(descriptor))
    print(json.dumps(descriptor))


if __name__ == "__main__":
    main()
