"""Shared helpers for the enforcement_actions builders: corpus row shape, money labels, build-file writing."""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import corpus_writer as writer  # noqa: E402

import enf_common as ec  # noqa: E402

NOT_RECORDED = "Not recorded"


def built_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def money_label(value):
    if value is None:
        return NOT_RECORDED
    v = float(value)
    if v >= 1e9:
        return f"${v / 1e9:,.2f} billion"
    if v >= 1e6:
        return f"${v / 1e6:,.2f} million"
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"


def amount_bucket(value):
    """Filter bucket for a stated dollar figure (label states the bound, nothing is estimated)."""
    if value is None:
        return "none"
    if value >= 1e9:
        return "1b_plus"
    if value >= 1e8:
        return "100m_plus"
    if value >= 1e7:
        return "10m_plus"
    if value >= 1e6:
        return "1m_plus"
    return "under_1m"


AMOUNT_BUCKETS = {
    "1b_plus": "$1 billion or more", "100m_plus": "$100 million to under $1 billion",
    "10m_plus": "$10 million to under $100 million", "1m_plus": "$1 million to under $10 million",
    "under_1m": "Under $1 million", "none": "No dollar figure stated",
}


def facts_list(pairs):
    """[(label, value)] -> corpus facts [[label, str]] with None shown as Not recorded."""
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


def manifest_inputs(prefixes):
    """[{url, path, sha256}] for manifest entries whose path starts with one of prefixes (latest per url+path)."""
    seen = {}
    for row in ec.load_jsonl(ec.MANIFEST):
        if any(row["path"].startswith(p) for p in prefixes):
            key = (row["url"], row["path"], row.get("offset"))
            seen[key] = {"url": row["url"], "path": row["path"], "sha256": row["sha256"],
                         **({"offset": row["offset"], "length": row["length"]} if "offset" in row else {})}
    return list(seen.values())


def write_build(dataset, label, rows, listing_block, summary, inputs, path=None, compress=False):
    """Write the build file publish_build.py reads. compress=True writes <dataset>.json.gz (decompress it to
    <dataset>.json just before publishing; used for the large DOJ partitions to stay inside the disk budget)."""
    import gzip

    path = path or os.path.join(ec.BUILD, f"{dataset}.json" + (".gz" if compress else ""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    build = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
             "built_at": built_at(), "inputs": inputs}
    tmp = path + ".tmp"
    opener = (lambda p: gzip.open(p, "wt", encoding="utf-8", compresslevel=6)) if compress else (lambda p: open(p, "w", encoding="utf-8"))
    with opener(tmp) as handle:
        json.dump(build, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "file": ec.rel(path), "bytes": os.path.getsize(path)}))
    return path


def clip(text, limit):
    """First `limit` characters of text, cut at a word boundary; returns (excerpt, truncated)."""
    if text is None:
        return None, False
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.8:
        cut = cut[:space]
    return cut.rstrip(), True
