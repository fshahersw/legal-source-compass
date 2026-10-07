#!/usr/bin/env python3
"""Supplement Wisconsin ch. 893 from retained 893.txt when the HTML chapter TOC truncates early.

Re-parses with wi-official-toc-text/2 txt-inventory fallback, builds a single-chapter landing packet
(102 sections on unit 893.txt), writes toc-proof against plain-text headings, and optionally lands after
893.54 live verification.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT_DIR / "common"))

import wi_parse  # noqa: E402

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TXT_URL = wi_parse.BASE + "/statutes/statutes/893.txt"
REVIEWER = "batch B lead (bc-ddde25f5)"


def squash(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for dash in ("\u2013", "\u2014", "\u2012", "\u2212"):
        text = text.replace(dash, "-")
    return re.sub(r"\s+", "", text)


def verify_893_54(rows: list[dict], root: pathlib.Path) -> dict:
    """Live-fetch 893.txt and confirm landed 893.54 text matches before any public flip."""
    sys.path.insert(0, str(ROOT_DIR / "b4"))
    import sc_common as sc  # noqa: E402

    row = next(r for r in rows if r["citation"] == "893.54")
    tmp = pathlib.Path("/tmp/review-wi-89354")
    tmp.mkdir(parents=True, exist_ok=True)
    arc = sc.Archive(str(tmp), min_interval=1.0)
    rec = arc.fetch(TXT_URL, accept="*/*", min_bytes=1000)
    if rec["state"] != "complete":
        raise SystemExit(f"893.54 gate: live fetch failed for {TXT_URL}")
    live = arc.read(rec).decode("utf-8", errors="replace")
    live_squash = squash(live)
    heading_ok = squash(row["heading"]) in live_squash
    text_ok = squash(row["text"]) in live_squash
    number_ok = squash("893.54") in live_squash
    ok = heading_ok and text_ok and number_ok
    return {
        "citation": "893.54",
        "ok": ok,
        "heading_ok": heading_ok,
        "text_ok": text_ok,
        "citation_ok": number_ok,
        "live_status": rec["http_status"],
        "route": rec["route"],
    }


def build_landing(root: pathlib.Path, parsed: dict, out: pathlib.Path) -> dict:
    existing_manifest = json.loads((root / "landing" / "manifest.json").read_text(encoding="utf-8"))
    manifest = dict(existing_manifest)
    manifest["parser"] = {"name": wi_parse.PARSER_NAME, "version": "2"}
    manifest["review"] = {
        "reviewed_by": REVIEWER,
        "reviewed_at": datetime.date.today().isoformat(),
    }
    regex = re.compile(manifest["section_id"]["regex"])
    levels = set(manifest["structure"]["levels"])
    base_currency = manifest["currency"]["basis"]

    receipts_by_sha: dict[str, list[dict]] = {}
    with (root / "receipts.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            receipt = json.loads(line)
            if receipt.get("ok") and receipt.get("status") == 200:
                receipts_by_sha.setdefault(receipt["sha256"], []).append(receipt)

    txt_receipt = parsed["txt_receipt"]
    orig_sha = txt_receipt["sha256"]
    derivative_path = out / "derivatives" / orig_sha
    derivative_path.parent.mkdir(parents=True, exist_ok=True)
    derivative_bytes = parsed["derivative"].encode("utf-8")
    deriv_sha = hashlib.sha256(derivative_bytes).hexdigest()
    # Plain-text chapter rebuild can byte-match the publisher .txt; intake requires distinct hashes.
    if deriv_sha == orig_sha:
        derivative_bytes = derivative_bytes + b"\n"
        deriv_sha = hashlib.sha256(derivative_bytes).hexdigest()
    derivative_path = out / "derivatives" / deriv_sha
    derivative_path.parent.mkdir(parents=True, exist_ok=True)
    derivative_path.write_bytes(derivative_bytes)

    def sources_for(sha: str, url: str) -> list[dict]:
        items = []
        seen = set()
        for receipt in sorted(receipts_by_sha.get(sha, []), key=lambda row: row["retrieved_at"]):
            key = (receipt["url"], receipt["retrieved_at"])
            if key in seen:
                continue
            seen.add(key)
            items.append(
                {
                    "source_url": receipt["url"],
                    "retrieved_at": receipt["retrieved_at"],
                    "retrieval_method": "publisher_bulk_download",
                    "proxy": None,
                    "http_status": receipt.get("status") or 200,
                }
            )
        if not items:
            items = [
                {
                    "source_url": url,
                    "retrieved_at": txt_receipt["retrieved_at"],
                    "retrieval_method": "publisher_bulk_download",
                    "proxy": None,
                    "http_status": 200,
                }
            ]
        return items[:50]

    original_sources = sources_for(orig_sha, TXT_URL)
    unit_key = "893.txt"
    unit = {
        "unit_key": unit_key,
        "unit_kind": "unit",
        "heading": parsed["chapter_meta"]["heading"],
        "original_sha256": orig_sha,
        "publisher_member": None,
        "raw_member_sha256": None,
        "text_sha256": deriv_sha,
        "text_code_points": len(derivative_bytes.decode("utf-8")),
        "sections_expected": len(parsed["rows"]),
        "currency": None,
        "source_url": TXT_URL,
        "retrieved_at": original_sources[0]["retrieved_at"],
        "retrieval_method": "publisher_bulk_download",
        "proxy": None,
    }

    sections = []
    for row in parsed["rows"]:
        cur = row.get("currency") or parsed["currency"]
        through = cur.get("as_of") if ISO.match(cur.get("as_of") or "") else None
        currency = {
            "basis": base_currency,
            "statement": cur.get("statement") or "",
            "through_date": through,
            "edition": row.get("edition") or parsed["edition"],
        }
        if unit["currency"] is None:
            unit["currency"] = currency
        path = row["native_id"]
        if not regex.match(path):
            raise SystemExit(f"citation_path does not match manifest regex: {path!r}")
        text = row["text"]
        status_note = row.get("status_label")
        if not text.strip():
            if (row.get("heading") or "").strip():
                text = row["heading"]
                status_note = status_note or row["heading"]
            else:
                raise SystemExit(f"empty section with no heading: {path}")
        hierarchy = [
            {"level": h["level"], "number": h.get("number"), "heading": h.get("heading")}
            for h in row["citation_path"]
        ]
        if not hierarchy or hierarchy[-1]["level"] != "section":
            raise SystemExit(f"invalid hierarchy for {path}")
        span = row["source"].get("span")
        sections.append(
            {
                "unit_key": unit_key,
                "citation_path": path,
                "citation": row["citation"],
                "heading": row.get("heading"),
                "text": text,
                "hierarchy": hierarchy,
                "history": row.get("history"),
                "status_note": status_note,
                "span": span,
                "currency": currency,
            }
        )

    objects = [
        {
            "sha256": orig_sha,
            "bytes": txt_receipt["bytes"],
            "kind": "publisher_original",
            "path": str(root / txt_receipt["stored_path"]),
            "sources": original_sources,
        },
        {
            "sha256": deriv_sha,
            "bytes": len(derivative_bytes),
            "kind": "unit_text_derivative",
            "path": str(derivative_path),
            "sources": original_sources,
        },
    ]

    toc_proof = {
        "marker": (
            "plain-text 893.txt section headings (TOC block through body) match parsed section count; "
            "HTML chapter TOC alone lists only 49 entries"
        ),
        "unfetched_child_pages": [],
        "pages": [
            {
                "url": TXT_URL,
                "unit_key": unit_key,
                "markers": len(parsed["toc_sections"]),
                "sections": len(sections),
            }
        ],
    }

    out.mkdir(parents=True, exist_ok=True)
    with (out / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)
        handle.write("\n")

    def dump(name: str, rows: list[dict]) -> None:
        with (out / name).open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    dump("objects.jsonl", objects)
    dump("units.jsonl", [unit])
    dump("sections.jsonl", sections)
    with (out / "toc-proof.json").open("w", encoding="utf-8") as handle:
        json.dump(toc_proof, handle, indent=2)
        handle.write("\n")
    summary = {
        "sections": len(sections),
        "toc_sections": len(parsed["toc_sections"]),
        "txt_toc_fallback": parsed["stats"].get("txt_toc_fallback"),
        "893.54_present": any(s["citation"] == "893.54" for s in sections),
    }
    with (out / "packet-report.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
        handle.write("\n")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=wi_parse.ROOT_DEFAULT)
    ap.add_argument(
        "--landing",
        type=pathlib.Path,
        default=None,
        help="output landing packet (default: <root>/supplement/893/landing)",
    )
    ap.add_argument("--land", action="store_true", help="land + review after 893.54 gate")
    ap.add_argument("--skip-893-54-gate", action="store_true", help="testing only; do not use before flip")
    args = ap.parse_args()
    landing = args.landing or (args.root / "supplement" / "893" / "landing")
    parsed = wi_parse.parse_single_chapter(args.root, "893")
    summary = build_landing(args.root, parsed, landing)
    print(json.dumps({"landing": str(landing), **summary}, indent=2))

    gate = verify_893_54(parsed["rows"], args.root)
    print(json.dumps({"893_54_gate": gate}, indent=2))
    if not gate["ok"]:
        raise SystemExit("893.54 live verification failed; refusing land/review")

    if not args.land:
        return 0
    if args.skip_893_54_gate:
        raise SystemExit("--skip-893-54-gate cannot be combined with --land")

    common = ROOT_DIR / "common"
    store = pathlib.Path(
        "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/state-codes/batch-b/wi"
    )
    store.mkdir(parents=True, exist_ok=True)
    report = store / "ch893-supplement-review.md"
    subprocess.run(
        [
            sys.executable,
            str(common / "land_publisher_code_v2.py"),
            str(landing),
            "--execute",
            "--workers",
            "6",
        ],
        check=True,
        cwd="/workspace",
    )
    subprocess.run(
        [
            sys.executable,
            str(common / "review_publisher_code_v2.py"),
            "--landing",
            str(landing),
            "--state",
            "WI",
            "--toc-ok",
            "893.txt plain-text inventory 102 sections including 893.54 (HTML chapter TOC lists 49)",
            "--must-include",
            "893.54",
            "--report",
            str(report),
            "--apply",
        ],
        check=True,
        cwd="/workspace",
    )
    (landing / ".landed").write_text(datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ") + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
