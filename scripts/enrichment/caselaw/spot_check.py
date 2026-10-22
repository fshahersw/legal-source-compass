"""Independent verification of the stored case-law shards, plus a comparison with CourtListener's API.

    python3 -I -B spot_check.py [--sample 20] [--seed 20261022] [--no-api] [--units 0,1]

Second path, from storage rather than from the extraction run:
  1. every shard listed in work/shards.jsonl (latest line per key) is downloaded (cache-bypassing readback) and its
     SHA-256 and size compared with the manifest;
  2. every record is re-checked: raw_sha256 / raw_bytes recomputed from `raw`; `text` re-rendered from `raw` with
     html_text (or verbatim for plain_text) and compared; text_sha256 and text_chars recomputed; citation and page
     offsets inside the text they point into; opinion id inside the shard's id range, in the selection, in the shard's
     court/tier, and in no other shard; the shard's opinion count;
  3. a seeded random sample of opinions (at least two per tier when the shards hold them) is fetched from
     https://www.courtlistener.com/api/rest/v4/opinions/<id>/ (COURTLISTENER_API_KEY from private/scratch/secrets.env,
     never printed; <= 1 request/second) and the stored raw field compared byte for byte with the API's value of the
     same field; the API's own first non-empty field, type and author are compared too. A difference on an opinion the
     API reports as modified after the snapshot date is reported separately from an unexplained mismatch.

Writes private/build/caselaw/work/verify_report.json and prints the failure counts. Exit status 1 when any shard or
record check fails or the API comparison has an unexplained mismatch.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import io
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "court_rules"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import extract_text as et  # noqa: E402
import html_text  # noqa: E402

API = "https://www.courtlistener.com/api/rest/v4/opinions/{}/"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
TEXT_FIELDS = et.FIELD_PRIORITY


def latest_manifest(units: set[int] | None) -> list[dict]:
    keys = et.manifest_keys()
    out = []
    for k, lines in sorted(keys.items()):
        e = lines[-1]
        if e.get("extractor") != et.VERSION:
            continue
        if units is not None and e["unit"] not in units:
            continue
        out.append(e)
    return out


def check_record(r: dict, shard: dict) -> list[str]:
    errs = []
    raw_b = r["raw"].encode("utf-8")
    if hashlib.sha256(raw_b).hexdigest() != r["raw_sha256"] or len(raw_b) != r["raw_bytes"]:
        errs.append("raw hash/size")
    src = r["source_field"]
    if src is None:
        expected = ""
        if r["raw"] or r["fields_present"]:
            errs.append("no source field but raw or fields present")
    elif src == "plain_text":
        expected = r["raw"]
    else:
        expected = html_text.render(r["raw"]).text
    if src is not None and (not r["fields_present"] or r["fields_present"][0] != src):
        errs.append("source field is not the first present field")
    if r["text"] != expected:
        errs.append("text differs from a fresh rendering of raw")
    t_b = r["text"].encode("utf-8")
    if hashlib.sha256(t_b).hexdigest() != r["text_sha256"] or len(r["text"]) != r["text_chars"]:
        errs.append("text hash/size")
    n = len(r["text"])
    for c in r["citations"]:
        if not (0 <= c["start"] < c["end"] <= n):
            errs.append("citation offset out of range")
            break
    target = r["text_paginated"] if r["pages_source"] == "xml_harvard_text" else r["text"]
    if r["pages_source"] == "xml_harvard_text" and not r["text_paginated"]:
        errs.append("xml_harvard_text without text_paginated")
    for p in r["pages"]:
        if not (0 <= p["offset"] <= len(target or "")):
            errs.append("page offset out of range")
            break
    if not (shard["min_opinion_id"] <= r["opinion_id"] <= shard["max_opinion_id"]):
        errs.append("opinion id outside the shard's recorded range")
    if r["court_id"] != shard["court"] or r["tier"] != shard["tier"]:
        errs.append("court/tier differ from the shard's group")
    return errs


def fetch_api(session, oid: int) -> dict | None:
    fields = ",".join(["id", "type", "author_id", "date_modified", "cluster_id"] + TEXT_FIELDS)
    for attempt in range(4):
        r = session.get(API.format(oid), params={"fields": fields}, timeout=120)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            return None
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"API HTTP {r.status_code} for opinion {oid}")
    raise RuntimeError(f"API kept failing for opinion {oid}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261022)
    ap.add_argument("--no-api", action="store_true")
    ap.add_argument("--units", default=None, help="comma-separated unit numbers (default: every unit in the manifest)")
    a = ap.parse_args()
    units = {int(u) for u in a.units.split(",")} if a.units else None

    import store

    st = store.Storage()
    sel = et.Selection()
    shards = latest_manifest(units)
    seen: dict[int, str] = {}
    dup = 0
    shard_fail = []
    record_fail = collections.Counter()
    record_fail_examples = []
    per_tier = collections.Counter()
    records_index = []  # (tier, shard path, line number)
    notable = collections.defaultdict(list)  # opinion ids in rare categories, for review
    t0 = time.time()
    total_bytes = 0
    for e in shards:
        r = st._retry(lambda: st.s.get(st._object_url(e["path"], True), headers=st.h, params={"readback": os.urandom(8).hex()}, timeout=900))
        body = r.content if r.status_code == 200 else b""
        r.close()
        total_bytes += len(body)
        if r.status_code != 200 or hashlib.sha256(body).hexdigest() != e["sha256"] or len(body) != e["bytes"]:
            shard_fail.append({"path": e["path"], "status": r.status_code, "reason": "sha256/size differ from the manifest"})
            continue
        n = 0
        for i, line in enumerate(gzip.GzipFile(fileobj=io.BytesIO(body))):
            rec = json.loads(line)
            n += 1
            oid = rec["opinion_id"]
            errs = check_record(rec, e)
            row = sel.row_of(oid)
            if row < 0:
                errs.append("opinion id not in the selection")
            else:
                m = sel.meta(row)
                if (m[1], m[2], m[3], m[4]) != (rec["cluster_id"], rec["docket_id"], rec["court_id"], rec["tier"]):
                    errs.append("cluster/docket/court/tier differ from the selection")
            if oid in seen:
                dup += 1
                errs.append("opinion id in two shards")
            seen[oid] = e["path"]
            for x in errs:
                record_fail[x] += 1
            if errs and len(record_fail_examples) < 20:
                record_fail_examples.append({"opinion_id": oid, "shard": e["path"], "errors": errs})
            per_tier[rec["tier"]] += 1
            records_index.append((rec["tier"], e["path"], i, oid))
            for label, hit in (("pages_xml_harvard_text", rec["pages_source"] == "xml_harvard_text"), ("pages_aligned", rec["pages_source"] == "aligned"),
                               ("no_text_field", rec["source_field"] is None), ("empty_rendering", rec["source_field"] is not None and not rec["text"])):
                if hit and len(notable[label]) < 50:
                    notable[label].append(oid)
        if n != e["opinions"]:
            shard_fail.append({"path": e["path"], "reason": f"{n} records, manifest says {e['opinions']}"})
    verify_s = time.time() - t0
    print(f"[verify] {len(shards)} shards, {total_bytes / 1e6:,.0f} MB downloaded, {len(seen):,} opinions, "
          f"shard failures {len(shard_fail)}, record failures {sum(record_fail.values())}, duplicates {dup}, {verify_s:,.0f}s", flush=True)

    api = {"checked": 0, "match": 0, "mismatch_unexplained": 0, "changed_after_snapshot": 0, "missing_in_api": 0, "details": []}
    if not a.no_api and records_index:
        import requests
        import secrets_env

        key = secrets_env.load("COURTLISTENER_API_KEY")
        sess = requests.Session()
        sess.headers.update({"Authorization": "Token " + key, "User-Agent": UA})
        rng = random.Random(a.seed)
        by_tier = collections.defaultdict(list)
        for x in records_index:
            by_tier[x[0]].append(x)
        pick = []
        for t in sorted(by_tier):
            pick += rng.sample(by_tier[t], min(2, len(by_tier[t])))
        chosen = set(pick)
        rest = [x for x in records_index if x not in chosen]
        pick += rng.sample(rest, max(0, min(a.sample - len(pick), len(rest))))
        wanted = collections.defaultdict(set)
        for t, path, i, oid in pick:
            wanted[path].add(i)
        recs = {}
        for path, lines in wanted.items():
            r = st._retry(lambda: st.s.get(st._object_url(path, True), headers=st.h, params={"readback": os.urandom(8).hex()}, timeout=900))
            for i, line in enumerate(gzip.GzipFile(fileobj=io.BytesIO(r.content))):
                if i in lines:
                    rec = json.loads(line)
                    recs[rec["opinion_id"]] = rec
            r.close()
        for t, path, i, oid in pick:
            rec = recs[oid]
            time.sleep(1.0)
            j = fetch_api(sess, oid)
            api["checked"] += 1
            d = {"opinion_id": oid, "tier": rec["tier"], "court_id": rec["court_id"], "source_field": rec["source_field"], "raw_bytes": rec["raw_bytes"]}
            if j is None:
                api["missing_in_api"] += 1
                d["result"] = "not in the API (404)"
                api["details"].append(d)
                continue
            src = rec["source_field"]
            api_val = (j.get(src) or "") if src else ""
            api_first = next((f for f in TEXT_FIELDS if j.get(f)), None)
            d.update({"api_sha256": hashlib.sha256(api_val.encode("utf-8")).hexdigest(), "stored_sha256": rec["raw_sha256"],
                      "api_date_modified": j.get("date_modified"), "snapshot_date_modified": rec["date_modified"],
                      "api_first_field": api_first, "type_match": j.get("type") == rec["type"], "author_match": j.get("author_id") == rec["author_id"]})
            same = d["api_sha256"] == rec["raw_sha256"]
            if same:
                api["match"] += 1
                d["result"] = "match"
            elif (j.get("date_modified") or "") [:10] > et.SNAPSHOT:
                api["changed_after_snapshot"] += 1
                d["result"] = "differs; the API reports a modification after the snapshot"
            else:
                api["mismatch_unexplained"] += 1
                d["result"] = "MISMATCH"
            api["details"].append(d)
            print(f"[api] {oid} {rec['tier']} {rec['court_id']} {src}: {d['result']}", flush=True)
    report = {
        "checked_at": et.now(), "extractor": et.VERSION, "shards": len(shards), "downloaded_bytes": total_bytes, "opinions": len(seen),
        "per_tier": dict(per_tier), "shard_failures": shard_fail, "record_failures": dict(record_fail), "record_failure_examples": record_fail_examples,
        "duplicate_opinions": dup, "verify_seconds": round(verify_s, 1), "notable_opinions": dict(notable), "api": api,
    }
    et.write_json(os.path.join(et.WORK, "verify_report.json"), report)
    fails = len(shard_fail) + sum(record_fail.values()) + dup + api["mismatch_unexplained"]
    print(f"[verify] failures: shards {len(shard_fail)}, records {sum(record_fail.values())}, duplicates {dup}; "
          f"API {api['checked']} checked, {api['match']} match, {api['changed_after_snapshot']} changed after snapshot, "
          f"{api['mismatch_unexplained']} unexplained, {api['missing_in_api']} missing", flush=True)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
