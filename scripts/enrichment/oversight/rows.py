"""Corpus row helpers for the oversight builders: row shape, Not-recorded handling, build-file writing."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import corpus_writer as writer  # noqa: E402

import common as cm  # noqa: E402

NOT_RECORDED = cm.NOT_RECORDED


def built_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stable_id(prefix, key, length=14):
    """prefix + first `length` hex characters of sha1(key): stable for an unchanged key."""
    return f"{prefix}:{hashlib.sha1(key.encode('utf-8')).hexdigest()[:length]}"


def money_label(value):
    if value is None:
        return NOT_RECORDED
    v = float(value)
    if v >= 1e9:
        return f"${v / 1e9:,.2f} billion"
    if v >= 1e6:
        return f"${v / 1e6:,.2f} million"
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"


def facts_list(pairs):
    """[(label, value)] -> corpus facts [[label, str]]; None or empty shows as Not recorded; lists join with '; '."""
    out = []
    for label, value in pairs:
        if isinstance(value, (list, tuple)):
            value = "; ".join(str(v) for v in value if v not in (None, "")) or None
        out.append([label, NOT_RECORDED if value in (None, "") else str(value)])
    return out


def record(dataset, rid, title, *, source_url, cells, facts, text, filters, subtitle="", badges=(), links=(), state="", extra=None):
    return writer.record(dataset, rid, title, source_url=source_url, cells=cells, facts=facts_list(facts), text=text,
                         filters=filters, subtitle=subtitle, badges=badges, links=links, state=state, extra=extra)


def listing(columns, filters=()):
    return writer.listing(columns, filters)


def clip(text, limit):
    """First `limit` characters of text cut at a word boundary; returns (excerpt, was_clipped)."""
    if text is None:
        return None, False
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.8:
        cut = cut[:space]
    return cut.rstrip(), True


def manifest_inputs(prefixes):
    """[{url, path, sha256}] of manifest entries whose path starts with one of prefixes (latest entry per url+path)."""
    seen = {}
    for row in cm.load_jsonl(cm.MANIFEST):
        if any(row["path"].startswith(p) for p in prefixes):
            seen[(row["url"], row["path"])] = {"url": row["url"], "path": row["path"], "sha256": row["sha256"]}
    return list(seen.values())


def inputs_digest(inputs):
    """One sha256 over the sorted (url, sha256) pairs: the identity of the raw inputs a build used."""
    pairs = sorted((i["url"], i["sha256"]) for i in inputs)
    return hashlib.sha256(json.dumps(pairs).encode()).hexdigest()


def write_build(dataset, label, rows, listing_block, summary, inputs, path=None):
    path = path or os.path.join(cm.BUILD, f"{dataset}.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    build = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
             "built_at": built_at(), "inputs": inputs}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(build, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "file": cm.rel(path), "bytes": os.path.getsize(path)}))
    return path
