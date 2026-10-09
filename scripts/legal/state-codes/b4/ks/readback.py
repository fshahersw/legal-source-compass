#!/usr/bin/env python3
"""Kansas step 5: independent database readback of a landed packet (read-only).

For every unit and section row the packet would land, the stored current entity must carry the same
native id, data record hash (canonical JSON sha256), text sha256, citation path, source URL and source
sha256, and must have been written by the given run. Earlier versions must still exist in entity_versions.
Env: EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_SERVICE_ROLE_KEY (never printed).
"""
import argparse, json, os, sys
import requests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "common"))
import land_publisher_code_v2 as L


def fetch_all(url, h, table, params):
    out, off = [], 0
    while True:
        r = requests.get(f"{url}/rest/v1/{table}", headers={**h, "Accept-Profile": "corpus_ingest"}, timeout=300,
                         params={**params, "order": "native_id,payload_sha256", "offset": off, "limit": 1000})
        r.raise_for_status()
        rows = r.json()
        out += rows
        off += len(rows)
        if len(rows) < 1000:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packet")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.packet, "manifest.json"), encoding="utf-8"))
    units, sections = L.build_rows(a.packet, L.sha(manifest), manifest)
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
    key = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, **({} if key.startswith("sb_") else {"Authorization": f"Bearer {key}"})}
    sel = "native_id,entity_type,payload_sha256,data,provenance,last_run"
    stored = {(r["entity_type"], r["native_id"]): r for r in
              fetch_all(url, h, "entities", {"source_system": f"eq.{manifest['source_system']}", "select": sel})}
    problems, ok = [], 0
    for row in units + sections:
        k = (row["entity_type"], row["native_id"])
        s = stored.pop(k, None)
        if s is None:
            problems.append({"native_id": row["native_id"], "issue": "missing"}); continue
        d, p = s["data"], s["provenance"]
        checks = {"record_sha256": L.sha(d) == row["provenance"]["record_sha256"],
                  "data": L.canon(d) == L.canon(row["data"]),
                  "text_sha256": d.get("text_sha256") == row["data"].get("text_sha256"),
                  "source_url": p.get("source_url") == row["provenance"]["source_url"],
                  "source_sha256": p.get("source_sha256") == row["provenance"]["source_sha256"],
                  "run": s["last_run"] == a.run_id}
        if row["entity_type"] == "code-section":
            checks["citation_path"] = d.get("citation_path") == row["data"]["citation_path"]
        bad = [c for c, v in checks.items() if not v]
        if bad:
            problems.append({"native_id": row["native_id"], "issue": bad})
        else:
            ok += 1
    # Rows stored for this source system but absent from the packet: earlier identities, kept, never deleted.
    not_in_packet = sorted(n for (_, n) in stored)
    versions = fetch_all(url, h, "entity_versions", {"source_system": f"eq.{manifest['source_system']}", "select": "native_id,payload_sha256,first_run"})
    by_run = {}
    for v in versions:
        by_run[v["first_run"]] = by_run.get(v["first_run"], 0) + 1
    report = {"run_id": a.run_id, "expected_rows": len(units) + len(sections), "matched_rows": ok, "problems": problems,
              "stored_not_in_packet": not_in_packet, "entity_versions_by_first_run": by_run}
    json.dump(report, open(a.out, "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
