"""Shared writer for enrichment datasets: upserts a catalog entry and its records into the corpus.

Credentials come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

BATCH = 500


def _base():
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set")
    return url + "/rest/v1/", key


def _call(method, path, body=None, prefer="return=minimal"):
    base, key = _base()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": prefer}
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(5):
        request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:800]
            if error.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{method} {path} -> {error.code}: {detail}") from None
        except urllib.error.URLError:
            if attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise


def listing(columns, filters=()):
    """Catalog listing block: columns are (key, label) pairs; filters are (name, label, {value: label}) triples."""
    return {
        "page": 1,
        "limit": 50,
        "columns": [{"key": key, "label": label} for key, label in columns],
        "filters": [{"name": "q", "type": "search", "label": "Search"}]
        + [
            {"name": name, "type": "select", "label": label, "options": [{"label": v, "value": k} for k, v in options.items()]}
            for name, label, options in filters
        ],
    }


def record(dataset, rid, title, *, source_url, cells, facts, text, filters, subtitle="", badges=(), links=(), state="", extra=None):
    """Build a corpus_records row in the shape the app's entity and table views read."""
    item = {"id": rid, "title": title, "subtitle": subtitle, "cells": cells, "badges": list(badges), "links": list(links)}
    if extra:
        item.update(extra)
    return {
        "dataset": dataset,
        "id": rid,
        "category": dataset,
        "state": state or "",
        "title": title,
        "source_url": source_url,
        "item": item,
        "detail": {"id": rid, "title": title, "subtitle": subtitle, "facts": facts, "links": list(links)},
        "text": " ".join(str(part) for part in [rid, title, subtitle, text] if part),
        "filters": {"_listing": ["yes"], **filters},
    }


def publish(dataset, label, rows, *, listing_block, summary, replace=True):
    """Create or update the catalog entry, replace the dataset's records, then mark it ready with exact counts."""
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{dataset}: duplicate record ids")
    # Validate every row before anything is written: the replace below deletes the live rows first, so a row the database
    # would reject (no dataset, another dataset, no id) must stop the publish here, not after the delete.
    for row in rows:
        row.setdefault("dataset", dataset)
        if row["dataset"] != dataset or not isinstance(row.get("id"), str) or not row["id"]:
            raise ValueError(f"{dataset}: row {row.get('id')!r} has dataset {row.get('dataset')!r} or no id; nothing written")
    digest =hashlib.sha256("\n".join(json.dumps(row, sort_keys=True) for row in rows).encode()).hexdigest()
    metadata = {"id": dataset, "label": label, "ready": False, "listing": {**listing_block, "total": len(rows)}, "summary": summary}
    _call("POST", "corpus_datasets", [{"id": dataset, "label": label, "ready": False, "expected_records": len(rows), "imported_records": 0, "manifest_sha256": digest, "metadata": metadata}], prefer="return=minimal,resolution=merge-duplicates")
    if replace:
        _call("DELETE", f"corpus_records?dataset=eq.{dataset}")
    for start in range(0, len(rows), BATCH):
        for ordinal, row in enumerate(rows[start:start + BATCH], start):
            row["ordinal"] = ordinal
        _call("POST", "corpus_records", rows[start:start + BATCH], prefer="return=minimal,resolution=merge-duplicates")
    stored = _call("GET", f"corpus_records?select=id&dataset=eq.{dataset}&limit=1", prefer="count=exact")
    count = _count(dataset)
    if count != len(rows):
        raise RuntimeError(f"{dataset}: wrote {len(rows)} rows but {count} are stored")
    metadata["ready"] = True
    _call("PATCH", f"corpus_datasets?id=eq.{dataset}", {"ready": True, "imported_records": count, "metadata": metadata})
    print(json.dumps({"dataset": dataset, "records": count, "sha256": digest}))
    return stored


def _jsonl_rows(path):
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def publish_jsonl(dataset, label, path, *, listing_block, summary, replace=True):
    """publish() for a dataset too large to hold in memory: rows are read from a JSONL file, one row per line.

    Same contract as publish(): every row is validated (dataset, id, unique ids) and the digest computed in a first pass before
    anything is written; the digest equals publish()'s for the same rows in the same order.
    """
    seen, digest, total = set(), hashlib.sha256(), 0
    for row in _jsonl_rows(path):
        row.setdefault("dataset", dataset)
        if row["dataset"] != dataset or not isinstance(row.get("id"), str) or not row["id"]:
            raise ValueError(f"{dataset}: row {row.get('id')!r} has dataset {row.get('dataset')!r} or no id; nothing written")
        if row["id"] in seen:
            raise ValueError(f"{dataset}: duplicate record ids")
        seen.add(row["id"])
        digest.update((b"\n" if total else b"") + json.dumps(row, sort_keys=True).encode())
        total += 1
    digest = digest.hexdigest()
    metadata = {"id": dataset, "label": label, "ready": False, "listing": {**listing_block, "total": total}, "summary": summary}
    _call("POST", "corpus_datasets", [{"id": dataset, "label": label, "ready": False, "expected_records": total, "imported_records": 0, "manifest_sha256": digest, "metadata": metadata}], prefer="return=minimal,resolution=merge-duplicates")
    if replace:
        _call("DELETE", f"corpus_records?dataset=eq.{dataset}")
    batch = []
    for ordinal, row in enumerate(_jsonl_rows(path)):
        row.setdefault("dataset", dataset)
        row["ordinal"] = ordinal
        batch.append(row)
        if len(batch) == BATCH:
            _call("POST", "corpus_records", batch, prefer="return=minimal,resolution=merge-duplicates")
            batch = []
    if batch:
        _call("POST", "corpus_records", batch, prefer="return=minimal,resolution=merge-duplicates")
    count = _count(dataset)
    if count != total:
        raise RuntimeError(f"{dataset}: wrote {total} rows but {count} are stored")
    metadata["ready"] = True
    _call("PATCH", f"corpus_datasets?id=eq.{dataset}", {"ready": True, "imported_records": count, "metadata": metadata})
    print(json.dumps({"dataset": dataset, "records": count, "sha256": digest}))
    return count


def fetch_all(dataset, select="id,title,state,item", page=1000):
    """Read every record of a dataset (ordered by id) for joins in builders."""
    rows, start = [], 0
    while True:
        base, key = _base()
        request = urllib.request.Request(
            base + f"corpus_records?select={select}&dataset=eq.{dataset}&order=id.asc",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + page - 1}"},
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            chunk = json.loads(response.read().decode())
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        start += page


def _count(dataset):
    base, key = _base()
    request = urllib.request.Request(
        base + f"corpus_records?select=id&dataset=eq.{dataset}&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "count=exact"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return int(response.headers["Content-Range"].split("/")[-1])
