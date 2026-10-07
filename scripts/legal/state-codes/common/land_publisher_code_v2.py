#!/usr/bin/env python3
"""Generic lander for publisher-code-intake/2 from a normalized landing packet.

Packet directory (all UTF-8 JSONL, produced by a state's staging script, no credentials):
  manifest.json   publisher-code-manifest/2 document
  objects.jsonl   {sha256, bytes, kind: publisher_original|unit_text_derivative, path, code_points?,
                   sources: [{source_url, retrieved_at, http_status, retrieval_method, proxy}]}
  units.jsonl     {unit_key, unit_kind, heading, original_sha256, publisher_member, raw_member_sha256,
                   text_sha256, text_code_points, sections_expected, currency,
                   source_url, retrieved_at, retrieval_method, proxy}
  sections.jsonl  {citation_path, citation, heading, text, hierarchy, history, status_note,
                   unit_key, span, currency}
  toc-proof.json  {marker, pages: [{url, markers, sections}], unfetched_child_pages: []}
Empty unit or section text is not a row: the packet author records it in gaps.json and leaves it out.
toc-proof.json compares the publisher's own section markers on every retained page with the parsed
sections. unfetched_child_pages must be present and empty (Delaware chapter indexes linked 350
subchapter pages that were never fetched). Dry-run and --execute both refuse a packet that fails this.
Credentials come from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY in the environment
only; nothing is printed. Dry run (default) validates and counts; --execute uploads and lands.
The run is always closed in a finally.
"""
import argparse
import base64
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
STANDARD_UPLOAD_LIMIT = 45 * 1024 * 1024
TUS_CHUNK = 6 * 1024 * 1024
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
        if u.get("parent_archive_sha256"):
            data["parent_archive_sha256"] = u["parent_archive_sha256"]
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


def tus_upload(cloud, key, path, ctype):
    """Resumable (TUS) upload for originals above the standard cap; same object key, never upserts."""
    size = os.path.getsize(path)
    meta = ",".join(f"{k} {base64.b64encode(v.encode()).decode()}" for k, v in
                    (("bucketName", BUCKET), ("objectName", key), ("contentType", ctype), ("cacheControl", "3600")))
    endpoint = cloud.url + "/storage/v1/upload/resumable"
    head = {**cloud.h, "Tus-Resumable": "1.0.0", "x-upsert": "false"}
    r = cloud._retry(lambda: cloud.s.post(endpoint, headers={**head, "Upload-Length": str(size), "Upload-Metadata": meta},
                                          timeout=120))
    if r.status_code not in (200, 201):
        return r.status_code, r.text[:200]
    location = r.headers["Location"]
    if location.startswith("/"):
        location = cloud.url + location
    offset = 0
    with open(path, "rb") as handle:
        while offset < size:
            handle.seek(offset)
            chunk = handle.read(TUS_CHUNK)
            r = cloud._retry(lambda: cloud.s.patch(location, data=chunk, timeout=600, headers={
                **head, "Content-Type": "application/offset+octet-stream", "Upload-Offset": str(offset)}))
            if r.status_code not in (200, 204):
                return r.status_code, r.text[:200]
            offset = int(r.headers.get("Upload-Offset", offset + len(chunk)))
    return 201, ""


def put_object(cloud, o):
    """Upload if missing, then whole-object authenticated readback; returns the readback receipt."""
    key = f"state-codes/sha256/{o['sha256'][:2]}/{o['sha256']}"
    st, body = cloud.readback(key)
    if st != 200:
        digest = hashlib.sha256()
        with open(o["path"], "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        if digest.hexdigest() != o["sha256"] or os.path.getsize(o["path"]) != o["bytes"]:
            raise RuntimeError(f"local file does not match plan {o['sha256'][:12]}")
        ctype = "text/plain; charset=utf-8" if o["kind"] == "unit_text_derivative" else "application/octet-stream"
        for attempt in range(7):
            if o["bytes"] > STANDARD_UPLOAD_LIMIT:
                ust, msg = tus_upload(cloud, key, o["path"], ctype)
            else:
                with open(o["path"], "rb") as handle:
                    ust, msg = cloud.upload(key, handle.read(), ctype)
                if ust == 413:
                    ust, msg = tus_upload(cloud, key, o["path"], ctype)
            # Storage answers LockTimeout when many uploads contend for the same lock; back off and try again.
            if ust not in (200, 201) and "LockTimeout" in str(msg) and attempt < 6:
                time.sleep(min(60, 2 ** (attempt + 1)))
                st, body = cloud.readback(key)
                if st == 200:
                    break
                continue
            break
        if ust not in (200, 201) and "already exists" not in msg and "Duplicate" not in msg and not (ust != 200 and "LockTimeout" in str(msg) and cloud.readback(key)[0] == 200):
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


def preflight_packet(packet):
    """Refuse a packet before any run is opened.

    Every source needs http_status 200. Empty unit or section text is a gap, not a row.
    toc-proof.json must show the publisher's own section-marker count matching the parsed
    sections on every unit page, and must list no unfetched child pages.
    """
    objects = list(jsonl(os.path.join(packet, "objects.jsonl")))
    units = list(jsonl(os.path.join(packet, "units.jsonl")))
    sections = list(jsonl(os.path.join(packet, "sections.jsonl")))
    if not objects or not units:
        raise RuntimeError("packet has no objects or units")
    derivatives = {}
    for obj in objects:
        sources = obj.get("sources") or []
        if not sources:
            raise RuntimeError(f"object {obj.get('sha256', '')[:12]} has no sources")
        for source in sources:
            if source.get("http_status") != 200:
                raise RuntimeError(f"source http_status must be 200: {source.get('source_url')}")
        if obj.get("kind") == "unit_text_derivative":
            if int(obj.get("bytes") or 0) < 1:
                raise RuntimeError(f"empty unit derivative {obj['sha256'][:12]}; record it as a gap")
            with open(obj["path"], encoding="utf-8") as handle:
                body = handle.read()
            if not body.strip() or "\x00" in body:
                raise RuntimeError(f"empty unit text {obj['sha256'][:12]}; record it as a gap")
            derivatives[obj["sha256"]] = body
    for unit in units:
        if int(unit.get("text_code_points") or 0) < 1:
            raise RuntimeError(f"empty unit {unit.get('unit_key')}; record it as a gap")
        if unit.get("text_sha256") not in derivatives:
            raise RuntimeError(f"unit {unit.get('unit_key')} has no text derivative")
    for section in sections:
        if not str(section.get("text") or "").strip():
            raise RuntimeError(f"empty section text {section.get('citation_path')}; record it as a gap")
    proof_path = os.path.join(packet, "toc-proof.json")
    if not os.path.isfile(proof_path):
        raise RuntimeError("toc-proof.json is required: publisher section markers per page, including child pages")
    with open(proof_path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if "unfetched_child_pages" not in proof:
        raise RuntimeError("toc-proof.json must include unfetched_child_pages")
    pending = proof.get("unfetched_child_pages") or []
    if pending:
        raise RuntimeError(f"toc-proof lists {len(pending)} unfetched child pages; do not land")
    pages = proof.get("pages") or []
    if not pages or not str(proof.get("marker") or "").strip():
        raise RuntimeError("toc-proof.json needs a marker description and one entry per page")
    mismatched = [page for page in pages if page.get("markers") != page.get("sections")]
    if mismatched:
        raise RuntimeError(f"toc marker mismatch on {len(mismatched)} pages; first {mismatched[0].get('url')}")
    covered = {page.get("url") for page in pages}
    missing = sorted({unit["source_url"] for unit in units} - covered)
    if missing:
        raise RuntimeError(f"toc-proof.json omits {len(missing)} unit pages; first {missing[0]}")
    return {"objects": len(objects), "units": len(units), "sections": len(sections), "toc_pages": len(pages)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packet")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--run-id")
    ap.add_argument("--attempt", type=int, default=1, help="a closed run cannot reopen; attempt N>1 derives a new deterministic run id")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--multicode", action="store_true",
                    help="register, open and finish through the v3 multi-code functions, so a second code can land under a jurisdiction "
                         "that already has one; intake, objects and verification are the v2 functions either way. Never reviews anything.")
    a = ap.parse_args()
    fn = "_v3" if a.multicode else "_v2"
    checked = preflight_packet(a.packet)
    manifest = json.load(open(os.path.join(a.packet, "manifest.json"), encoding="utf-8"))
    manifest_sha = sha(manifest)
    objects = list(jsonl(os.path.join(a.packet, "objects.jsonl")))
    unit_rows, section_rows = build_rows(a.packet, manifest_sha, manifest)
    suffix = "" if a.attempt == 1 else f":{a.attempt}"
    run_id = a.run_id or str(uuid.uuid5(NS, f"{manifest['jurisdiction']}:{manifest_sha}{suffix}"))
    summary = {"jurisdiction": manifest["jurisdiction"], "manifest_sha256": manifest_sha, "run_id": run_id,
               "objects": len(objects), "object_bytes": sum(o["bytes"] for o in objects), "units": len(unit_rows),
               "sections": len(section_rows), "toc_pages": checked["toc_pages"]}
    print(json.dumps(summary))
    if not a.execute:
        return 0
    cloud = Cloud()
    reg = cloud.rpc("corpus_publisher_code_register_manifest" + fn, {"p_manifest": manifest})
    assert reg["manifest_sha256"] == manifest_sha, "server manifest hash differs from local canonical hash"
    cloud.rpc("corpus_publisher_code_open_run" + fn, {"p_run": run_id, "p_manifest_sha256": manifest_sha})
    status, counts = "failed", dict(summary)
    try:
        from concurrent.futures import ThreadPoolExecutor
        receipts = {}
        with ThreadPoolExecutor(a.workers) as ex:
            for o, rec in zip(objects, ex.map(lambda o: put_object(cloud, o), objects)):
                receipts[o["sha256"]] = rec
        chunk, size = [], 0
        for o in objects:
            item = {"sha256": o["sha256"], "bytes": o["bytes"], "kind": o["kind"], "sources": [{**x, "http_status": 200} for x in o["sources"]], "readback": receipts[o["sha256"]]}
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
        fin = cloud.rpc("corpus_publisher_code_finish_run" + fn, {"p_run": run_id, "p_status": status, "p_counts": counts})
        print(json.dumps({"finish": fin}))
    return 0 if status == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
