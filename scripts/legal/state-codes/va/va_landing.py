#!/usr/bin/env python3
"""Build /tmp/sc/VA/landing from staged packet plus toc-proof.json."""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

from va_parse import count_section_markers, load_api_inventory, load_receipts, title_body_receipts


def build_toc_proof(root: pathlib.Path) -> dict:
    ordered_api, _ = load_api_inventory(root)
    receipts = load_receipts(root)
    bodies = title_body_receipts(receipts)
    pages = []
    for title in sorted(bodies, key=lambda t: (float(t.split(".")[0]) if t[0].isdigit() else 999, t)):
        receipt = bodies[title]
        raw_html = (root / receipt["stored_path"]).read_text(encoding="utf8")
        api_list = ordered_api.get(title, [])
        markers = count_section_markers(raw_html, api_list)
        parsed = markers
        if api_list:
            parsed = len(api_list)
        pages.append(
            {
                "url": receipt["url"],
                "markers": markers,
                "sections": parsed,
            }
        )
    return {
        "marker": (
            "<b>§ …</b> section headers on vacodefull title HTML, expanding comma lists and "
            "“through” ranges against the official section inventory"
        ),
        "pages": pages,
        "unfetched_child_pages": [],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/VA"))
    args = ap.parse_args(argv)
    root = args.root
    landing = root / "landing"
    landing.mkdir(parents=True, exist_ok=True)

    common = pathlib.Path(__file__).resolve().parents[1] / "common" / "build_landing_packet.py"
    subprocess.check_call([sys.executable, str(common), str(root)])

    parse_report = json.loads((root / "parsed" / "parse-report.json").read_text(encoding="utf8"))
    by_title = {row["title"]: row for row in parse_report.get("title_reports", [])}
    proof = build_toc_proof(root)
    for page in proof["pages"]:
        title = page["url"].rstrip("/").rsplit("title", 1)[-1].rstrip("/")
        report = by_title.get(title)
        if report is None:
            raise SystemExit(f"no parse report for title {title}")
        page["sections"] = report["html_sections"]
        if page["markers"] != page["sections"]:
            raise SystemExit(f"toc-proof mismatch for title {title}: {page['markers']} vs {page['sections']}")

    (landing / "toc-proof.json").write_text(
        json.dumps(proof, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(json.dumps({"landing": str(landing), "toc_pages": len(proof["pages"])}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
