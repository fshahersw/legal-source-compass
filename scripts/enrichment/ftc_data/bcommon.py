"""Shared pieces of the ftc_data builders: paths, manifest lookups, record shape, build-file writer, formats.

Display helpers and exact-name matching come from the Consumer Sentinel builder (scripts/enrichment/ftc_sentinel/ftc_common.py)
so both streams format and match the same way. Published text names no scraping or search service and no AI model.
"""
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENRICH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENRICH, "ftc_sentinel"))
sys.path.insert(0, ENRICH)

import corpus_writer as writer  # noqa: E402
import ftc_common as C  # noqa: E402  (display formats, exact-name matching, routable places)
import ftc_http as fh  # noqa: E402

NOT_RECORDED = C.NOT_RECORDED
ROOT = fh.ROOT
ACQ = fh.ACQ
BUILD = fh.BUILD
LOOKUPS = os.path.join(BUILD, "lookups")

GOV_TERMS = (
    "Public domain: FTC Website Policy (https://www.ftc.gov/policy-notices/website-policy, Copyright Permission) says most material on the FTC "
    "website is a work of the United States Government in the public domain and not subject to copyright restrictions (17 U.S.C. 105); "
    "attribution requested where feasible (\"Source: United States Federal Trade Commission, www.ftc.gov\"); no FTC endorsement may be implied."
)
API_TERMS = (
    "FTC for Developers (https://www.ftc.gov/developer): the FTC API is read-only and open to anyone with an api.data.gov key; it publishes no separate "
    "licence or use restriction beyond the FTC Website Policy above. api.data.gov (https://api.data.gov/docs/developer-manual/) issues the key and limits each key by the hour; "
    "requests over the limit are refused with HTTP 429. In this build a burst of about one request a second was refused with a requested wait of up to about 48 minutes, so requests were "
    "then spaced two seconds apart."
)
PLACES_ROUTABLE = C.routable_places()


def now_utc():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_manifest(path=fh.MANIFEST):
    """Manifest lines in file order (later lines for a URL supersede earlier ones)."""
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
    return out


def current_entries(manifest=None):
    """{url: latest entry with status 200 whose stored file still exists}."""
    out = {}
    for e in manifest if manifest is not None else load_manifest():
        if e.get("status") == 200 and e.get("path") and os.path.exists(os.path.join(ROOT, e["path"])):
            out[e["url"]] = e
    return out


def input_ref(entry):
    return {"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]}


def record(*args, facts, **kwargs):
    """corpus_writer.record with facts as (label, value) pairs; the entity view reads [label, value] string pairs."""
    if kwargs.get("extra") is not None:
        kwargs["extra"] = json.loads(json.dumps(kwargs["extra"]))
    return writer.record(*args, facts=[[label, NOT_RECORDED if value is None else str(value)] for label, value in facts], **kwargs)


def places(usps, name):
    return C.places_links(usps, name, PLACES_ROUTABLE)


def write_build(dataset, label, listing_block, summary, rows, inputs):
    os.makedirs(BUILD, exist_ok=True)
    path = os.path.join(BUILD, f"{dataset}.json")
    payload = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows, "built_at": now_utc(), "inputs": inputs}
    assert json.loads(json.dumps(payload["rows"])) == payload["rows"]
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=False)
    return path


def fmt_int(v):
    return C.fmt_int(v)


def fmt_pct(v, digits=1):
    return C.fmt_pct(v, digits)


def share_pct(part, total, digits=2):
    if part is None or not total:
        return None
    return round(part / total * 100, digits)


def yoy_pct(current, previous):
    return C.yoy_pct(current, previous)
