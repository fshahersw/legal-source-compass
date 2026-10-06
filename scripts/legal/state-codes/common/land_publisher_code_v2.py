#!/usr/bin/env python3
"""Generic lander for publisher-code-intake/2 from a normalized landing packet.

Packet directory (all UTF-8 JSONL, produced by a state's staging script, no credentials):
  manifest.json   publisher-code-manifest/2 document
  objects.jsonl   {sha256, bytes, kind: publisher_original|unit_text_derivative, path, code_points?,
                   sources: [{source_url, retrieved_at, retrieval_method, proxy}]}
  units.jsonl     {unit_key, unit_kind, heading, original_sha256, publisher_member, raw_member_sha256,
                   text_sha256, text_code_points, sections_expected, currency,
                   source_url, retrieved_at, retrieval_method, proxy}
  sections.jsonl  {citation_path, citation, heading, text, hierarchy, history, status_note,
                   unit_key, span, currency}
Credentials come from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY in the environment
only; nothing is printed. Dry run (default) validates and counts; --execute uploads and lands.
The run is always closed in a finally.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import uuid

import requests

BUCKET = "corpus-originals"
MAX_ROWS = 500
MAX_BYTES = 6_000_000
NS = uuid.UUID("5b6f1c58-2a56-4e6a-9f7a-1c0de5a7c0de")


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(value):
    return hashlib.sha256((value if isinstance(value, bytes) else canon(value).encode("utf-8"))).hexdigest()


def jsonl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def gates(jur):
    return {"jurisdiction": jur, "publisher_native_entity": False, "public_projection_allowed": False,
            "current_law_verified": False, "calculation_activation_allowed": False}


def build_rows(packet, manifest_sha, manifest):
    jur = manifest["jurisdiction"]
    system = manifest["source_system"]
    parser = f"{manifest['parser']['name']}/{manifest['parser']['version']}"
    units = {}
    unit_rows = []
    for u in jsonl(os.path.join(packet, "units.jsonl")):
        data = {**gates(jur), "identity_kind": "publisher_source_unit", "unit_key": u["unit_key"], "unit_kind": u["unit_kind"],
                "heading": u["heading"], "original_sha256": u["original_sha256"], "publisher_member": u["publisher_member"],
                "raw_member_sha256": u["raw_member_sha256"], "text_sha256": u["text_sha256"],
                "text_code_points": u["text_code_points"], "sections_expected": u["sections_expected"], "currency": u["currency"]}
        prov = {"source_url": u["source_url"], "source_sha256": u["original_sha256"], "retrieved_at": u["retrieved_at"],
                "retrieval_method": u["retrieval_method"], "proxy": u["proxy"], "source_as_of": u["currency"]["through_date"],
                "record_hash_codec": "canonical-integer-jsonb/1", "record_sha256": sha(data), "parser": parser,
                "manifest_sha256": manifest_sha}
        row = {"schema_version": "publisher-code-evidence/2", "source_system": system, "entity_type": "code-source-unit",
               "native_id": f"{jur}:unit:{u['unit_key']}", "data": data, "provenance": prov}
        units[u["unit_key"]] = (row, u)
        unit_rows.append(row)
    section_rows = []
    for s in jsonl(os.path.join(packet, "sections.jsonl")):
        row_u, u = units[s["unit_key"]]
        text = s["text"]
        data = {**gates(jur), "identity_kind": "official_citation_path", "citation_path": s["citation_path"],
                "citation": s["citation"], "heading": s["heading"], "text": text, "text_sha256": sha(text.encode("utf-8")),
                "text_code_points": len(text), "hierarchy": s["hierarchy"], "history": s["history"],
                "status_note": s["status_note"], "unit_id": row_u["native_id"], "unit_text_sha256": u["text_sha256"],
                "span": s["span"], "currency": s["currency"]}
        prov = {**{k: row_u["provenance"][k] for k in ("source_url", "source_sha256", "retrieved_at", "retrieval_method", "proxy")},
                "source_as_of": s["currency"]["through_date"], "record_hash_codec": "canonical-integer-jsonb/1",
                "record_sha256": sha(data), "parser": parser, "manifest_sha256": manifest_sha}
        section_rows.append({"schema_version": "publisher-code-evidence/2", "source_system": system, "entity_type": "code-section",
                             "native_id": f"{jur}:{s['citation_path']}", "data": data, "provenance": prov})
    return unit_rows, section_rows


def batches(rows):
    cur, size = [], 0
    for r in rows:
        n = len(canon(r))
        if cur and (len(cur) >= MAX_ROWS or size + n > MAX_BYTES):
            yield cur
            cur, size = [], 0
        cur.append(r)
        size += n
    if cur:
        yield cur


class Cloud:
    def __init__(self):
        self.url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
        key = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
        self.h = {"apikey": key}
        if not key.startswith("sb_"):
            self.h["Authorization"] = f"Bearer {key}"
        self.s = requests.Session()

    def rpc(self, name, args):
        for attempt in range(4):
            r = self.s.post(f"{self.url}/rest/v1/rpc/{name}", headers={**self.h, "Content-Type": "application/json"},
                            data=json.dumps(args, ensure_ascii=False).encode("utf-8"), timeout=180)
            if r.status_code in (502, 503, 504, 522, 524) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{name} {r.status_code}: {r.text[:500]}")
            return r.json()

    def _retry(self, call):
        for attempt in range(4):
            try:
                r = call()
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
                continue
            if r.status_code in (429, 502, 503, 504, 522, 524) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            return r

    def readback(self, key):
        r = self._retry(lambda: self.s.get(f"{self.url}/storage/v1/object/authenticated/{BUCKET}/{key}",
                                           headers=self.h, timeout=600))
        return r.status_code, r.content

    def upload(self, key, data, ctype):
        r = self._retry(lambda: self.s.post(f"{self.url}/storage/v1/object/{BUCKET}/{key}", data=data, timeout=1200,
                                            headers={**self.h, "x-upsert": "false", "Content-Type": ctype}))
        return r.status_code, r.text[:200]


def put_object(cloud, o):
    """Upload if missing, then whole-object authenticated readback; returns the readback receipt."""
    key = f"state-codes/sha256/{o['sha256'][:2]}/{o['sha256']}"
    st, body = cloud.readback(key)
    if st != 200:
        data = open(o["path"], "rb").read()
        if hashlib.sha256(data).hexdigest() != o["sha256"] or len(data) != o["bytes"]:
            raise RuntimeError(f"local file does not match plan {o['sha256'][:12]}")
        ctype = "text/plain; charset=utf-8" if o["kind"] == "unit_text_derivative" else "application/octet-stream"
        ust, msg = cloud.upload(key, data, ctype)
        if ust not in (200, 201) and "already exists" not in msg and "Duplicate" not in msg:
            raise RuntimeError(f"upload {ust} {msg}")
        st, body = cloud.readback(key)
    if st != 200 or hashlib.sha256(body).hexdigest() != o["sha256"] or len(body) != o["bytes"]:
        raise RuntimeError(f"readback mismatch {o['sha256'][:12]} status={st}")
    rec = {"bytes": o["bytes"], "bucket": BUCKET, "object_key": key, "readback_sha256": o["sha256"], "readback_bytes": len(body),
           "verification_method": "authenticated-whole-object-get-sha256", "http_status": 200,
           "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if o["kind"] == "unit_text_derivative":
        rec.update(readback_text_encoding="utf-8", readback_text_code_points=len(body.decode("utf-8")))
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packet")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--run-id")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.packet, "manifest.json"), encoding="utf-8"))
    manifest_sha = sha(manifest)
    objects = list(jsonl(os.path.join(a.packet, "objects.jsonl")))
    unit_rows, section_rows = build_rows(a.packet, manifest_sha, manifest)
    run_id = a.run_id or str(uuid.uuid5(NS, f"{manifest['jurisdiction']}:{manifest_sha}"))
    summary = {"jurisdiction": manifest["jurisdiction"], "manifest_sha256": manifest_sha, "run_id": run_id,
               "objects": len(objects), "object_bytes": sum(o["bytes"] for o in objects), "units": len(unit_rows), "sections": len(section_rows)}
    print(json.dumps(summary))
    if not a.execute:
        return 0
    cloud = Cloud()
    reg = cloud.rpc("corpus_publisher_code_register_manifest_v2", {"p_manifest": manifest})
    assert reg["manifest_sha256"] == manifest_sha, "server manifest hash differs from local canonical hash"
    cloud.rpc("corpus_publisher_code_open_run_v2", {"p_run": run_id, "p_manifest_sha256": manifest_sha})
    status, counts = "failed", dict(summary)
    try:
        from concurrent.futures import ThreadPoolExecutor
        receipts = {}
        with ThreadPoolExecutor(a.workers) as ex:
            for o, rec in zip(objects, ex.map(lambda o: put_object(cloud, o), objects)):
                receipts[o["sha256"]] = rec
        chunk, size = [], 0
        for o in objects:
            item = {"sha256": o["sha256"], "bytes": o["bytes"], "kind": o["kind"], "sources": o["sources"], "readback": receipts[o["sha256"]]}
            n = len(canon(item))
            if chunk and (len(chunk) >= 1000 or size + n > 6_000_000):
                cloud.rpc("corpus_publisher_code_register_objects_v2", {"p_run": run_id, "p_objects": chunk})
                chunk, size = [], 0
            chunk.append(item)
            size += n
        if chunk:
            cloud.rpc("corpus_publisher_code_register_objects_v2", {"p_run": run_id, "p_objects": chunk})
        landed = verified = 0
        for rows in batches(unit_rows + section_rows):
            cloud.rpc("corpus_publisher_code_intake_v2", {"p_run": run_id, "p_rows": rows})
            v = cloud.rpc("corpus_publisher_code_verify_batch_v2", {"p_run": run_id, "p_rows": rows})
            if not v.get("verified"):
                raise RuntimeError(f"batch not verified: {json.dumps(v)[:300]}")
            landed += len(rows)
            verified += v["matched"]
        counts.update(landed_rows=landed, verified_rows=verified)
        status = "completed" if landed == len(unit_rows) + len(section_rows) else "partial"
    finally:
        fin = cloud.rpc("corpus_publisher_code_finish_run_v2", {"p_run": run_id, "p_status": status, "p_counts": counts})
        print(json.dumps({"finish": fin}))
    return 0 if status == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
