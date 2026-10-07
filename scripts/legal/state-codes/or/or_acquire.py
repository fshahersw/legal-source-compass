"""Capture Oregon Revised Statutes chapter HTML from oregonlegislature.gov.

Phases (resumable via receipts.jsonl):
  index     official ORS index page and title-group inventory
  discover  probe one chapter per title group and expand suffix chapters from publisher TOCs
  chapters  fetch every chapter listed in chapter-list.json
  pilot     index + single probe chapter 12 (for /tmp/sc/OR smoke tests)

Usage: or_acquire.py [--root /tmp/sc/OR] [--phase index|discover|chapters|pilot|all] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

from provenance_fetch import Fetcher, now_iso, verify_store  # noqa: E402
from or_lib import (  # noqa: E402
    INDEX_URL,
    chapter_url,
    numeric_chapter_ids,
    parse_index_groups,
)
from or_parse import parse_title_chapter_list_html  # noqa: E402


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")


def load_groups(root: pathlib.Path) -> list[dict]:
    return json.loads((root / "index-groups.json").read_text(encoding="utf8"))


def discover_chapter_ids(fetcher: Fetcher, groups: list[dict]) -> dict[str, dict]:
    """Return chapter id -> title metadata using publisher chapter TOCs where present."""
    chapter_list: dict[str, dict] = {}
    for group in groups:
        seed_ids = numeric_chapter_ids(group["chapter_start"], group["chapter_end"])
        toc_ids: list[str] = []
        for seed in seed_ids:
            url = chapter_url(seed)
            receipt = fetcher.get(url, label="toc-probe")
            if not receipt.get("ok"):
                continue
            raw = fetcher.read(receipt)
            try:
                toc = parse_title_chapter_list_html(raw)
            except ValueError:
                toc = {"chapters": []}
            if toc.get("chapters"):
                toc_ids = [entry["chapter"] for entry in toc["chapters"]]
                break
        chosen = toc_ids or seed_ids
        for chapter_id in chosen:
            chapter_list[str(chapter_id)] = {
                "title_number": group["title_number"],
                "title_name": group["title_name"],
                "url": chapter_url(chapter_id),
                "discovery": "publisher_chapter_toc" if toc_ids else "index_numeric_range",
            }
    return chapter_list


def capture_chapters(fetcher: Fetcher, chapter_list: dict[str, dict], limit: int = 0) -> None:
    items = sorted(chapter_list.items(), key=lambda row: (len(row[0]), row[0]))
    if limit:
        items = items[:limit]
    for index, (chapter_id, meta) in enumerate(items, 1):
        receipt = fetcher.get(meta["url"], label="chapter-html")
        print(
            chapter_id,
            receipt.get("status"),
            receipt.get("bytes"),
            receipt.get("error"),
            flush=True,
        )
        if index % 25 == 0:
            print("progress", index, len(items), flush=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/OR"))
    ap.add_argument(
        "--phase",
        choices=("index", "discover", "chapters", "pilot", "all"),
        default="all",
    )
    ap.add_argument("--limit", type=int, default=0, help="limit chapter captures (smoke tests)")
    args = ap.parse_args(argv)
    root = args.root
    root.mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher("OR", root, min_interval=1.0)

    phases = {args.phase} if args.phase != "all" else {"index", "discover", "chapters"}
    if args.phase == "pilot":
        phases = {"index", "chapters"}
        pilot_list = {
            "12": {
                "title_number": "2",
                "title_name": "Procedure in Civil Proceedings",
                "url": chapter_url("12"),
                "discovery": "pilot",
            }
        }
        write_json(root / "chapter-list.json", pilot_list)

    if "index" in phases:
        receipt = fetcher.get(INDEX_URL, label="ors-index")
        if not receipt.get("ok"):
            raise SystemExit(f"index capture failed: {receipt}")
        index_html = fetcher.read(receipt).decode("utf8", "replace")
        groups = parse_index_groups(index_html)
        expected_docs = sum(group["index_document_count"] for group in groups)
        write_json(root / "index-groups.json", groups)
        summary = {
            "captured_at": now_iso(),
            "title_groups": len(groups),
            "index_document_count": expected_docs,
            "index_url": INDEX_URL,
        }
        write_json(root / "logs" / f"index-summary-{now_iso()}.json", summary)
        print("index", len(groups), "groups", expected_docs, "documents", flush=True)

    if "discover" in phases:
        groups = load_groups(root)
        chapter_list = discover_chapter_ids(fetcher, groups)
        write_json(root / "chapter-list.json", chapter_list)
        print("discovered", len(chapter_list), "chapter ids", flush=True)

    if "chapters" in phases:
        if args.phase == "pilot":
            chapter_list = json.loads((root / "chapter-list.json").read_text(encoding="utf8"))
        else:
            chapter_list = json.loads((root / "chapter-list.json").read_text(encoding="utf8"))
        capture_chapters(fetcher, chapter_list, limit=args.limit)

    checked, problems = verify_store(root)
    print("verify_store", checked, "problems", len(problems), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
