"""Build and publish dataset fjc_idb_mdl_cases (owner decision 2026-10-27: release the held FJC IDB case rows).

  build    read every corpus_ingest.entities row (courtlistener / fjc-integrated-database), the label lookups
           (fjc_civil_nos, fjc_civil_districts, mdls, fjc_civil_mdls) and the exact docket index (cl_docket_metadata),
           then write <out>/fjc_idb_mdl_cases.rows.jsonl, <out>/fjc_idb_mdl_cases.meta.json and <out>/packet.json.
           Reads only. Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (corpus_writer).
           Offline test run: --input-jsonl <courtlistener normalized fjc-integrated-database.jsonl> --lookups <json>
           [--dockets-jsonl <courtlistener dockets jsonl>] (docket links from an offline index are not authoritative).
  publish  corpus_writer.publish_jsonl of the built rows; refuses unless the file holds --expect rows (default 405176).

Default out dir: private/acq/release-fjc-idb-case-rows-staged (git-ignored).
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import mdl_cases as mc  # noqa: E402

OUT = os.path.join(ROOT, "private", "acq", "release-fjc-idb-case-rows-staged")
EXPECT = 405176
PAGE = 2000


def _get(path: str, profile: str | None = None) -> list:
    base, key = writer._base()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if profile:
        headers["Accept-Profile"] = profile
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=300) as response:
                return json.loads(response.read().decode())
        except Exception:  # noqa: BLE001 - retried, then raised
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    return []


def keyset(table: str, select: str, filters: str, key: str, profile: str | None = None):
    """Yield every row of a filtered table ordered by `key`, PAGE rows at a time (keyset paging, no offsets)."""
    last = None
    while True:
        after = f"&{key}=gt.{urllib.parse.quote(last, safe='')}" if last is not None else ""
        rows = _get(f"{table}?select={select}&{filters}{after}&order={key}.asc&limit={PAGE}", profile)
        yield from rows
        if len(rows) < PAGE:
            return
        last = str(rows[-1][key])


def fetch_entities():
    yield from keyset("entities", "native_id,payload_sha256,data,provenance,source_as_of,retrieved_at,review_status",
                      "source_system=eq.courtlistener&entity_type=eq.fjc-integrated-database", "native_id", "corpus_ingest")


def fetch_lookups() -> dict:
    nos = {str(r["code"]): r["name"] for r in keyset("corpus_records", "id,code:item->cells->>code,name:item->cells->>name",
                                                      "dataset=eq.fjc_civil_nos&id=like.nos:*", "id")}
    courts = {r["id"]: (r["title"] or "").split(" — ")[0] for r in keyset("corpus_records", "id,title", "dataset=eq.fjc_civil_districts", "id")}
    mdls = {r["id"]: r["title"] for r in keyset("corpus_records", "id,title", "dataset=eq.mdls", "id")}
    civil = [r["id"] for r in keyset("corpus_records", "id", "dataset=eq.fjc_civil_mdls", "id")]
    return {"nos": nos, "courts": courts, "mdls": mdls, "fjc_civil_mdls": civil}


def fetch_dockets() -> dict:
    out = {}
    for r in keyset("corpus_records",
                    "id,idb:item->cells->>idb_data_id,court_id:item->cells->>court_id,docket_number:item->cells->>docket_number,native_id:item->cells->>native_id",
                    "dataset=eq.cl_docket_metadata&item->cells->>idb_data_id=not.is.null", "id"):
        if r.get("idb"):
            if r["idb"] in out:  # one IDB row claimed by two dockets: no exact link for either
                out[r["idb"]] = None
                continue
            out[r["idb"]] = {"record_id": r["id"], "native_id": r["native_id"], "court_id": r["court_id"], "docket_number": r["docket_number"]}
    return {k: v for k, v in out.items() if v}


def offline_entities(path: str):
    with open(path, encoding="utf-8") as h:
        for line in h:
            if line.strip():
                row = json.loads(line)
                if row.get("entity_type") == "fjc-integrated-database":
                    yield row


def offline_dockets(path: str) -> dict:
    out = {}
    with open(path, encoding="utf-8") as h:
        for line in h:
            if not line.strip():
                continue
            d = json.loads(line).get("data") or {}
            idb = (d.get("idb_data_id") or "").strip()
            if idb:
                out[idb] = None if idb in out else {"record_id": f"cl:dockets:{d['id']}", "native_id": d["id"], "court_id": d.get("court_id"), "docket_number": d.get("docket_number")}
    return {k: v for k, v in out.items() if v}


def build(args) -> None:
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    if args.input_jsonl:
        lk = json.load(open(args.lookups, encoding="utf-8"))
        dockets = offline_dockets(args.dockets_jsonl) if args.dockets_jsonl else {}
        entities = offline_entities(args.input_jsonl)
        mode = "offline"
    else:
        lk = fetch_lookups()
        dockets = fetch_dockets()
        entities = fetch_entities()
        mode = "database"
    lk["fjc_civil_mdls"] = set(lk.get("fjc_civil_mdls", []))
    rows_path = os.path.join(args.out, mc.DATASET + ".rows.jsonl")
    tmp = rows_path + ".part"
    per = collections.defaultdict(collections.Counter)
    seen, digest, total, samples = set(), hashlib.sha256(), 0, []
    unknown_nos, quarantined, courts_seen = collections.Counter(), 0, set()
    with open(tmp, "w", encoding="utf-8", newline="\n") as out:
        for e in entities:
            if e.get("review_status") == "quarantined":
                quarantined += 1
                continue
            rec = mc.build_record(e, lk, dockets)
            if rec["id"] in seen:
                raise SystemExit(f"duplicate record id {rec['id']}")
            seen.add(rec["id"])
            line = json.dumps(rec, sort_keys=True, ensure_ascii=False)
            digest.update((b"\n" if total else b"") + json.dumps(rec, sort_keys=True).encode())
            out.write(line + "\n")
            total += 1
            p = rec["item"]["profile"]
            c = per[p["mdl"]]
            c["rows"] += 1
            c["pending" if p["pending"] else "terminated" if p["date_terminated"] else "status_not_recorded"] += 1
            c["docket_linked"] += 1 if p["docket"] else 0
            c[f"origin_{p['codes']['origin_code']}"] += 1
            c["parties_missing"] += 1 if "not recorded v." in rec["title"] or rec["title"].endswith("not recorded") else 0
            courts_seen.add(p["court_id"])
            if p["codes"]["nos_code"] is not None and rec["item"]["cells"]["nature_of_suit"].startswith("Code "):
                unknown_nos[p["codes"]["nos_code"]] += 1
            if total <= 3 or (p["docket"] and len(samples) < 6):
                samples.append(rec)
    os.replace(tmp, rows_path)
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats = {"rows": total, "mdls": len(per), "docket_linked": sum(c["docket_linked"] for c in per.values()),
             "pending": sum(c["pending"] for c in per.values()), "terminated": sum(c["terminated"] for c in per.values()),
             "courts": len(courts_seen), "skipped_quarantined": quarantined, "nos_codes_not_in_codebook": dict(unknown_nos),
             "by_mdl": {k: dict(v) for k, v in sorted(per.items(), key=lambda kv: -kv[1]["rows"])}}
    mdl_labels = {m: lk["mdls"].get(m) for m in per}
    court_labels = {c: lk["courts"].get(c, c) for c in courts_seen if c}
    meta = {"dataset": mc.DATASET, "label": mc.LABEL, "listing_block": mc.listing_block(mdl_labels, court_labels), "summary": mc.summary(stats, built_at)}
    with open(os.path.join(args.out, mc.DATASET + ".meta.json"), "w", encoding="utf-8") as h:
        json.dump(meta, h, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(args.out, "packet.json"), "w", encoding="utf-8") as h:
        json.dump({"mode": mode, "built_at": built_at, "seconds": round(time.time() - t0, 1), "rows_file": rows_path,
                   "rows_sha256_publish_digest": digest.hexdigest(), "rows_file_bytes": os.path.getsize(rows_path),
                   "docket_index_size": len(dockets), "stats": stats, "samples": samples}, h, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"mode": mode, "rows": total, "docket_linked": stats["docket_linked"], "mdls": len(per), "sha256": digest.hexdigest(),
                      "seconds": round(time.time() - t0, 1)}))


def publish(args) -> None:
    rows_path = os.path.join(args.out, mc.DATASET + ".rows.jsonl")
    meta = json.load(open(os.path.join(args.out, mc.DATASET + ".meta.json"), encoding="utf-8"))
    packet = json.load(open(os.path.join(args.out, "packet.json"), encoding="utf-8"))
    if packet["mode"] != "database":
        raise SystemExit("refusing to publish an offline build; run build without --input-jsonl first")
    with open(rows_path, encoding="utf-8") as h:
        n = sum(1 for line in h if line.strip())
    if n != args.expect:
        raise SystemExit(f"rows file holds {n} rows, expected {args.expect}; nothing written")
    writer.publish_jsonl(mc.DATASET, meta["label"], rows_path, listing_block=meta["listing_block"], summary=meta["summary"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--out", default=OUT)
    b.add_argument("--input-jsonl")
    b.add_argument("--lookups")
    b.add_argument("--dockets-jsonl")
    p = sub.add_parser("publish")
    p.add_argument("--out", default=OUT)
    p.add_argument("--expect", type=int, default=EXPECT)
    args = ap.parse_args()
    if args.cmd == "build" and args.input_jsonl and not args.lookups:
        ap.error("--input-jsonl needs --lookups")
    (build if args.cmd == "build" else publish)(args)


if __name__ == "__main__":
    main()
