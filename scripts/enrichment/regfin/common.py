"""Shared helpers for the regulatory-finance builders: corpus row shape, facts, build-file writing, input manifest."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
import corpus_writer as writer  # noqa: E402

ACQ = ROOT / "private" / "acq" / "regfin"
BUILD = ROOT / "private" / "build" / "regfin"
LOOKUPS = BUILD / "lookups"
NOT_RECORDED = "Not recorded"
SEC = "https://www.sec.gov"
FRB = "https://www.federalreserve.gov"


def built_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def facts_list(pairs):
    """[(label, value)] -> corpus facts [[label, str]]; lists are joined, None/'' shown as Not recorded."""
    out = []
    for label, value in pairs:
        if isinstance(value, (list, tuple)):
            value = "; ".join(str(v) for v in value if v not in (None, "")) or None
        out.append([label, NOT_RECORDED if value in (None, "") else str(value)])
    return out


def record(dataset, rid, title, *, source_url, cells, facts, text, filters, subtitle="", badges=(), links=(), state="", extra=None):
    return writer.record(
        dataset, rid, title, source_url=source_url, cells=cells, facts=facts_list(facts), text=text, filters=filters,
        subtitle=subtitle, badges=badges, links=links, state=state, extra=extra,
    )


def listing(columns, filters=()):
    return writer.listing(columns, filters)


def overview_record(dataset, title, *, source_url, overview, facts, subtitle=""):
    """summary:overview record (not a listed row), the same convention company_sec_profiles uses."""
    return record(
        dataset, "summary:overview", title, source_url=source_url, subtitle=subtitle,
        cells={"summary": "Overview"}, facts=facts, text="summary overview",
        filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "overview": overview},
    )


def manifest_inputs(prefixes):
    """[{url, path, sha256}] for manifest rows (HTTP 200) whose path contains one of prefixes; latest per url+path."""
    seen = {}
    manifest = ACQ / "_manifest.jsonl"
    if not manifest.exists():
        return []
    for line in manifest.read_text().splitlines():
        row = json.loads(line)
        if row.get("http_status") == 200 and any(p in row["path"] for p in prefixes):
            seen[(row["url"], row["path"])] = {"url": row["url"], "path": row["path"], "sha256": row["sha256"], "bytes": row["bytes"]}
    return sorted(seen.values(), key=lambda r: (r["path"], r["url"]))


def write_build(dataset, label, rows, listing_block, summary, inputs):
    """Write private/build/regfin/<dataset>.json exactly as publish_build.py reads it."""
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    path = BUILD / f"{dataset}.json"
    BUILD.mkdir(parents=True, exist_ok=True)
    build = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
             "built_at": built_at(), "inputs": inputs}
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(build, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "file": str(path.relative_to(ROOT)), "bytes": path.stat().st_size}))
    return path


def load_companies():
    """Companies lookup from the saved company_sec_profiles read (id, title); see lookups/company_sec_profiles.json."""
    import names

    data = json.loads((LOOKUPS / "company_sec_profiles.json").read_text(encoding="utf-8"))
    return names.Companies([(cik, title) for cik, title in data["rows"]]), data
