#!/usr/bin/env python3
"""Driver for the ecfr-section-text/1 contract (database/contracts/ecfr-section-text-v1.sql).

Subcommands (credentials only from the environment; nothing secret is printed or written):
  upload-raw   retained eCFR responses -> private storage (content-addressed), whole-object hash readback
  intake       packet batches -> corpus_ecfr_text_intake_v1 (checkpointed, resumable, idempotent)
  verify       status + paged server-side hash check + per-row readback against the local packets
  publish      project entities into public.corpus_records (dataset ecfr_section_text) in batches
  finalize     paged server-side full-field verification of every projected record, then ready=true
  plan         stage links to repoint (federal_regulations_sections, citation_index CFR)
  apply        md5-guarded ledgered repoint (use --dry first)
  rollback     reverse a run's applied repoints from the ledger
  recheck      remaining `oul:` links across federal_regulations_sections and citation_index
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import pgrest  # noqa: E402
from ecfr_text_lib import raw_object_key, sha256_hex  # noqa: E402

RUN_ID = "f71cd778-f3b5-4674-942a-4979554e1e05"
BUCKET = "corpus-originals"


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def out(obj):
    print(json.dumps(obj, indent=1, sort_keys=True))


# ---------------------------------------------------------------------------------------------------- raw storage
def storage_request(method, key, body=None, timeout=300):
    url, k = pgrest._cfg()
    headers = {"apikey": k}
    if not k.startswith("sb_"):
        headers["Authorization"] = "Bearer " + k
    if body is not None:
        headers["Content-Type"] = "application/octet-stream"
        headers["x-upsert"] = "false"
    req = urllib.request.Request(f"{url}/storage/v1/object/{BUCKET}/{key}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def cmd_upload_raw(a):
    man = load_json(os.path.join(a.work, "acquisition.json"))
    receipts_path = os.path.join(a.work, "raw_storage_receipts.json")
    receipts = load_json(receipts_path, {})
    items = {}
    for e in man["parts"].values():
        if e.get("state") == "complete":
            items[e["sha256"]] = e["file"]
    t = man["titles"]
    items[t["sha256"]] = t["file"]
    done = failed = 0
    for sha, rel in sorted(items.items()):
        if receipts.get(sha, {}).get("verified"):
            continue
        with open(os.path.join(a.work, rel), "rb") as f:
            body = f.read()
        if sha256_hex(body) != sha:
            raise SystemExit("local original changed: " + rel)
        key = raw_object_key(sha) if rel.endswith(".xml") else f"ecfr-text/sha256/{sha[:2]}/{sha}.json"
        status, _ = storage_request("POST", key, body)
        if status not in (200, 201, 400, 409):
            time.sleep(3)
            status, _ = storage_request("POST", key, body)
        gstatus, back = storage_request("GET", key)
        ok = gstatus == 200 and sha256_hex(back) == sha and len(back) == len(body)
        receipts[sha] = {"key": key, "bytes": len(body), "verified": ok, "upload_http_status": status,
                         "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        done += 1 if ok else 0
        failed += 0 if ok else 1
        if (done + failed) % 25 == 0:
            save_json(receipts_path, receipts)
    save_json(receipts_path, receipts)
    out({"objects": len(items), "verified": sum(1 for r in receipts.values() if r["verified"]), "failed_now": failed})
    if failed:
        raise SystemExit(1)


# ---------------------------------------------------------------------------------------------------- intake
def batches(work):
    man = load_json(os.path.join(work, "packets", "manifest.json"))
    for b in man["batches"]:
        with open(os.path.join(work, "packets", "batches", b["name"]), encoding="utf-8") as f:
            body = f.read()
        if sha256_hex(body) != b["sha256"]:
            raise SystemExit("batch changed after build: " + b["name"])
        yield b, body


def cmd_intake(a):
    ck_path = os.path.join(a.work, "intake_checkpoint.json")
    ck = load_json(ck_path, {"run_id": a.run, "batches": {}})
    total = {"received": 0, "new_versions": 0, "new_observations": 0, "entities_written": 0}
    done = 0
    for b, body in batches(a.work):
        if b["sha256"] in ck["batches"]:
            continue
        res = pgrest.rpc("corpus_ecfr_text_intake_v1", {"p_run": a.run, "p_rows": json.loads(body)})
        if res.get("received") != b["records"]:
            raise SystemExit(f"batch {b['name']}: server received {res.get('received')} of {b['records']}")
        ck["batches"][b["sha256"]] = {"name": b["name"], "records": b["records"], "result": res,
                                      "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        save_json(ck_path, ck)
        for k in total:
            total[k] += res.get(k, 0)
        done += 1
        if a.limit and done >= a.limit:
            break
    out({"batches_sent_now": done, "totals_now": total, "batches_acknowledged": len(ck["batches"])})


def cmd_verify(a):
    man = load_json(os.path.join(a.work, "packets", "manifest.json"))
    after, mism, rows = None, {"hash": 0, "text": 0, "storage": 0}, 0
    status = None
    while True:
        status = pgrest.rpc("corpus_ecfr_text_status_v1", {"p_run": a.run, "p_after": after, "p_limit": 2000})
        pg = status["page"]
        rows += pg["rows"]
        mism["hash"] += pg["hash_mismatches"]
        mism["text"] += pg["text_hash_mismatches"]
        mism["storage"] += pg["storage_mismatches"]
        if pg["rows"] < 2000:
            break
        after = pg["last"]
    expected = man["summary"]["entities"]
    local = {}
    with open(os.path.join(a.work, "packets", "entities.jsonl"), encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            local[e["native_id"]] = e
    diffs = 0
    ids = sorted(local)
    for i in range(0, len(ids), 1000):
        chunk = ids[i:i + 1000]
        back = {r["native_id"]: r for r in pgrest.rpc("corpus_ecfr_text_readback_v1", {"p_run": a.run, "p_native_ids": chunk})}
        for nid in chunk:
            e, r = local[nid], back.get(nid)
            if (not r or r["payload_sha256"] != e["provenance"]["record_sha256"] or r["source_sha256"] != e["provenance"]["source_sha256"]
                    or r["source_as_of"] != e["provenance"]["source_as_of"] or r["text_sha256"] != e["data"]["text_sha256"]
                    or r["source_url"] != e["provenance"]["source_url"] or r["schema_version"] != "ecfr-section-text/1"):
                diffs += 1
    result = {"expected_entities": expected, "server_versions_in_run": status["versions_first_seen_in_run"],
              "server_observations": status["observations"], "distinct_source_sha256": status["distinct_source_sha256"],
              "paged_rows_checked": rows, "server_hash_mismatches": mism, "readback_rows": len(ids),
              "readback_differences": diffs, "as_of_dates": status["as_of_dates"]}
    result["verified"] = (diffs == 0 and not any(mism.values()) and rows >= expected and status["observations"] >= expected)
    out(result)
    if not result["verified"]:
        raise SystemExit(1)


# ---------------------------------------------------------------------------------------------------- projection
def cmd_publish(a):
    total = 0
    while True:
        r = pgrest.rpc("corpus_ecfr_text_publish_v1", {"p_run": a.run, "p_limit": a.batch, "p_dry": a.dry})
        if a.dry:
            out(r)
            return
        total += r["written"]
        print(json.dumps({"written": r["written"], "pending_before": r["pending_before"]}), flush=True)
        if r["written"] == 0 or r["pending_before"] <= r["written"]:
            break
    out({"written_total": total})


def cmd_finalize(a):
    after, pages, rows = None, 0, 0
    while True:
        v = pgrest.rpc("corpus_ecfr_text_verify_v1", {"p_run": a.run, "p_after": after, "p_limit": 1000})
        pages += 1
        rows += v["entities"]
        print(json.dumps(v), flush=True)
        if v["missing"] or v["mismatched"]:
            raise SystemExit("record verification found differences; not finalizing")
        if v["entities"] < 1000:
            break
        after = v["last"]
    r = pgrest.rpc("corpus_ecfr_text_finalize_v1", {"p_run": a.run})
    r["verify_pages"], r["verify_rows"] = pages, rows
    out(r)
    if not r["verified"]:
        raise SystemExit(1)


def build_plan_items(work):
    targets = load_json(os.path.join(work, "targets.json"))
    resolution = {(r["title"], r["part"], r["section"]): r for r in load_json(os.path.join(work, "packets", "resolution.json"))}
    items, counts = [], {"section_row": {"repoint": 0, "unavailable": 0, "no_oul": 0}, "citation_row": {"repoint": 0, "unavailable": 0}}
    import re
    oul = re.compile(r"oul:[0-9a-f]{64}")
    from ecfr_text_lib import normalize_section_number
    with open(os.path.join(work, "sections.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            ids = sorted(set(oul.findall(json.dumps(r["item"]) + json.dumps(r["detail"]) + json.dumps(r.get("filters")))))
            if not ids:
                counts["section_row"]["no_oul"] += 1
                continue
            i = r["item"]
            res = resolution[(str(i["title"]), str(i["part"]), normalize_section_number(i["section"]))]
            it = {"kind": "section_row", "dataset": "federal_regulations_sections", "record_id": r["id"], "oul_ids": ids}
            if res["status"] in ("acquired", "reserved_in_ecfr"):
                it["native_id"] = res["native_id"]
                counts["section_row"]["repoint"] += 1
            else:
                it["native_id"], it["unavailable_reason"] = None, res["status"]
                counts["section_row"]["unavailable"] += 1
            items.append(it)
    for cid, link in sorted(targets["citation_links"].items()):
        if link["class"] != "cfr":
            continue
        res = resolution[(link["title"], link["part"], link["section"])]
        it = {"kind": "citation_row", "dataset": "citation_index", "record_id": cid, "oul_ids": [link["oul_id"]]}
        if res["status"] in ("acquired", "reserved_in_ecfr"):
            it["native_id"] = res["native_id"]
            counts["citation_row"]["repoint"] += 1
        else:
            it["native_id"], it["unavailable_reason"] = None, res["status"]
            counts["citation_row"]["unavailable"] += 1
        items.append(it)
    return items, counts


def cmd_plan(a):
    items, counts = build_plan_items(a.work)
    total = {"planned": 0, "rejected": []}
    for i in range(0, len(items), 500):
        r = pgrest.rpc("corpus_ecfr_text_plan_v1", {"p_run": a.run, "p_items": items[i:i + 500]})
        total["planned"] += r["planned"]
        total["rejected"] += r["rejected"]
        print(json.dumps({"chunk": i // 500, "planned": r["planned"], "rejected": len(r["rejected"])}), flush=True)
    out({"items_built": len(items), "counts": counts, "planned_new": total["planned"], "rejected": total["rejected"][:20],
         "rejected_total": len(total["rejected"])})


def cmd_apply(a):
    total = {"applied": 0, "would_apply": 0, "skipped": 0}
    while True:
        r = pgrest.rpc("corpus_ecfr_text_apply_v1", {"p_run": a.run, "p_limit": a.batch, "p_dry": a.dry})
        for k in total:
            total[k] += r[k]
        print(json.dumps(r), flush=True)
        if a.dry or r["remaining_planned"] == 0 or (r["applied"] + r["skipped"] == 0):
            break
    out(total)


def cmd_rollback(a):
    total = {"restored": 0, "skipped": 0}
    while True:
        r = pgrest.rpc("corpus_ecfr_text_rollback_v1", {"p_run": a.run, "p_limit": a.batch, "p_dry": a.dry})
        for k in total:
            total[k] += r[k]
        print(json.dumps(r), flush=True)
        if a.dry or r["remaining_applied"] == 0 or (r["restored"] + r["skipped"] == 0):
            break
    out(total)


def cmd_recheck(a):
    args = {"p_deep": a.deep}
    if a.dataset:
        args["p_dataset"] = a.dataset
    out(pgrest.rpc("corpus_ecfr_text_recheck_v1", args))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", required=True)
    ap.add_argument("--run", default=RUN_ID)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("upload-raw").set_defaults(fn=cmd_upload_raw)
    p = sub.add_parser("intake"); p.add_argument("--limit", type=int, default=0); p.set_defaults(fn=cmd_intake)
    sub.add_parser("verify").set_defaults(fn=cmd_verify)
    p = sub.add_parser("publish"); p.add_argument("--batch", type=int, default=500); p.add_argument("--dry", action="store_true"); p.set_defaults(fn=cmd_publish)
    sub.add_parser("finalize").set_defaults(fn=cmd_finalize)
    sub.add_parser("plan").set_defaults(fn=cmd_plan)
    p = sub.add_parser("apply"); p.add_argument("--batch", type=int, default=250); p.add_argument("--dry", action="store_true"); p.set_defaults(fn=cmd_apply)
    p = sub.add_parser("rollback"); p.add_argument("--batch", type=int, default=250); p.add_argument("--dry", action="store_true"); p.set_defaults(fn=cmd_rollback)
    p = sub.add_parser("recheck"); p.add_argument("--deep", action="store_true"); p.add_argument("--dataset", choices=["federal_regulations_sections", "citation_index"]); p.set_defaults(fn=cmd_recheck)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
