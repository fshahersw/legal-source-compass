"""Exact-text and structural proof for a state-law/1 edition directory (MODEL.md §1).

  python3 scripts/state_law/verify.py private/build/w1025_stat-a/state_law/fl/fl-20261024 \
      --raw private/acq/w1025_stat-a/state_law

For every section whose source bytes were kept (.raw), the `.txt` rendering (lib.render_text) is written beside the
raw file and every line of `text`, the `heading`, the `history` line and the `status_marker` must occur verbatim
(whitespace-normalised) in it. Structural checks: file hashes and counts match edition.json, ids unique, node
references resolve, parents precede children, ordinals are unique, text_sha256 matches, no markup.
Writes verify.json beside edition.json; exit 0 only when every check passes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402


def verify(edition_dir: pathlib.Path, raw_root: pathlib.Path | None, *, require_raw: bool = True) -> dict:
    edition = json.loads((edition_dir / "edition.json").read_text())
    failures: list[dict] = []

    def fail(kind: str, ident: str, detail: str) -> None:
        if len(failures) < 200:
            failures.append({"check": kind, "id": ident, "detail": detail[:400]})

    for name, info in edition["files"].items():
        data = (edition_dir / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != info["sha256"] or len(data) != info["bytes"]:
            fail("file_hash", name, "sha256/bytes differ from edition.json")

    sources: dict[str, dict] = {}
    for row in lib.read_jsonl(edition_dir / "sources.jsonl.gz"):
        sources.setdefault(row["sha256"], row)
        if row["status"] not in (200, 206):
            fail("source_status", row["url"], f"HTTP {row['status']}")

    nodes: dict[str, dict] = {}
    for row in lib.read_jsonl(edition_dir / "nodes.jsonl.gz"):
        if row["node_id"] in nodes:
            fail("node_unique", row["node_id"], "duplicate")
        if row["parent_id"] is not None and row["parent_id"] not in nodes:
            fail("node_parent", row["node_id"], f"parent {row['parent_id']} not emitted first")
        if row["level"] not in lib.LEVELS:
            fail("node_level", row["node_id"], row["level"])
        nodes[row["node_id"]] = row

    renderings: dict[str, str | None] = {}

    def rendering(sha: str) -> str | None:
        if sha in renderings:
            return renderings[sha]
        src = sources.get(sha)
        text = None
        if src and src.get("raw") and raw_root is not None:
            raw_file = raw_root / src["raw"]
            if raw_file.exists():
                body = raw_file.read_bytes()
                if hashlib.sha256(body).hexdigest() != sha:
                    fail("raw_hash", str(raw_file), "kept bytes differ from recorded sha256")
                txt_file = raw_file.with_suffix(".txt")
                text = lib.render_text(body, src.get("content_type"), src.get("member") or src.get("url"))
                txt_file.write_text(text, encoding="utf-8")
                text = lib.norm_ws(text)
        renderings[sha] = text
        return text

    seen: set[str] = set()
    counts = {"sections": 0, "checked_against_raw": 0, "quotes_checked": 0, "by_status": {}}
    ordinals: set[int] = set()
    for row in lib.read_jsonl(edition_dir / "sections.jsonl.gz"):
        sid = row["section_id"]
        counts["sections"] += 1
        counts["by_status"][row["status"]] = counts["by_status"].get(row["status"], 0) + 1
        if sid in seen:
            fail("section_unique", sid, "duplicate")
        seen.add(sid)
        if row["ordinal"] in ordinals:
            fail("ordinal", sid, "duplicate ordinal")
        ordinals.add(row["ordinal"])
        if row["node_id"] not in nodes:
            fail("section_node", sid, row["node_id"])
        if hashlib.sha256(row["text"].encode("utf-8")).hexdigest() != row["text_sha256"]:
            fail("text_sha256", sid, "mismatch")
        if row["status"] not in lib.STATUSES or row["status_basis"] not in lib.STATUS_BASES:
            fail("status", sid, f"{row['status']}/{row['status_basis']}")
        if row["number_norm"] != lib.norm_number(row["number"]):
            fail("number_norm", sid, row["number_norm"])
        for field in ("text", "heading", "history", "status_marker"):
            value = row.get(field)
            if value and lib._MARKUP_RE.search(value):
                fail("markup", sid, f"{field}: {lib._MARKUP_RE.search(value).group(0)}")
        rendered = rendering(row["source"]["sha256"])
        if rendered is not None and row["source"].get("also"):
            extra = [rendering(item["sha256"]) for item in row["source"]["also"]]
            if any(part is None for part in extra):
                fail("raw_missing", sid, "secondary source bytes not kept")
            rendered = " ".join([rendered] + [part for part in extra if part])
        if rendered is None:
            if require_raw:
                fail("raw_missing", sid, row["source"]["sha256"])
            continue
        counts["checked_against_raw"] += 1
        for field in ("text", "heading", "history", "status_marker"):
            value = row.get(field)
            if not value:
                continue
            counts["quotes_checked"] += 1
            if not lib.check_quote(rendered, value):
                missing = next((line for line in value.split("\n") if lib.norm_ws(line) not in rendered), value)
                fail(f"quote_{field}", sid, f"not in source rendering: {missing[:300]!r}")
        tail = row["number"].split(":")[-1].split("/")[-1]
        if lib.norm_ws(tail).translate(lib._DASHES) not in rendered.translate(lib._DASHES):
            fail("number_in_source", sid, tail)

    expected = edition["counts"]
    if counts["sections"] != expected["sections"]:
        fail("count_sections", edition["edition_id"], f"{counts['sections']} != {expected['sections']}")
    if len(nodes) != expected["nodes"]:
        fail("count_nodes", edition["edition_id"], f"{len(nodes)} != {expected['nodes']}")
    result = {"edition_id": edition["edition_id"], "state": edition["state"], "ok": not failures,
              "counts": {**counts, "nodes": len(nodes), "sources": len(sources)}, "failures": failures,
              "verified_at": lib.utcnow()}
    (edition_dir / "verify.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("edition_dir", type=pathlib.Path)
    parser.add_argument("--raw", type=pathlib.Path, default=None)
    parser.add_argument("--no-require-raw", action="store_true")
    args = parser.parse_args(argv)
    result = verify(args.edition_dir, args.raw, require_raw=not args.no_require_raw)
    print(json.dumps({k: result[k] for k in ("edition_id", "ok", "counts")}, ensure_ascii=False))
    for item in result["failures"][:20]:
        print("FAIL", json.dumps(item, ensure_ascii=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
