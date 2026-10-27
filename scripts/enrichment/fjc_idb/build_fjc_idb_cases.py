"""Build (and, with --publish, publish) dataset fjc_idb_civil_cases: one record per FJC IDB civil case that CourtListener copied.

Input (read only): corpus_ingest.entities where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database'
(405,176 rows on 2026-10-27, from fjc-integrated-database-2026-09-30.csv.bz2), plus four published lookups in corpus_records:
fjc_civil_nos (codebook NOS labels), fjc_civil_districts (district -> state), fjc_civil_mdls (exact "mdl:<n>" ids) and
cl_docket_metadata (exact idb_data_id -> docket record).

Steps
  python build_fjc_idb_cases.py               # dry run: reads, projects, writes private/build/fjc_idb_cases/, writes nothing remote
  python build_fjc_idb_cases.py --publish     # the lead only: same build, then corpus_writer.publish_jsonl

Credentials only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment (corpus_writer); nothing is printed.
Nothing is held back: the IDB carries no seal or restriction flag, and the rows hold no other source evidence for a hold.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import idb_case_level as cl  # noqa: E402

OUT = os.path.join(ROOT, "private", "build", "fjc_idb_cases")
PAGE = 1000
ENTITY_FILTER = "source_system=eq.courtlistener&entity_type=eq.fjc-integrated-database"


def _get(path: str, profile: str | None = None):
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


def keyset(table: str, select: str, filters: str, key: str, profile: str | None = None):
    """Every row of a filtered table, paged by the key column (uses the primary key index, no OFFSET)."""
    last = None
    while True:
        after = f"&{key}=gt.{urllib.parse.quote(last, safe='')}" if last is not None else ""
        chunk = _get(f"{table}?select={select}&{filters}{after}&order={key}.asc&limit={PAGE}", profile)
        yield from chunk
        if len(chunk) < PAGE:
            return
        last = chunk[-1][key]


def lookups() -> dict:
    nos, district_state, mdl_ids, docket_by_idb = {}, {}, set(), {}
    for r in keyset("corpus_records", "id,name:item->cells->>name", "dataset=eq.fjc_civil_nos", "id"):
        if r["id"].startswith("nos:") and r["id"][4:].isdigit() and r.get("name"):
            nos[int(r["id"][4:])] = r["name"]
    for r in keyset("corpus_records", "id,state", "dataset=eq.fjc_civil_districts", "id"):
        district_state[r["id"]] = r.get("state") or ""
    for r in keyset("corpus_records", "id", "dataset=eq.fjc_civil_mdls", "id"):
        mdl_ids.add(r["id"])
    dup = Counter()
    for r in keyset("corpus_records", "id,idb:item->cells->>idb_data_id", "dataset=eq.cl_docket_metadata", "id"):
        if r.get("idb"):
            dup[r["idb"]] += 1
            docket_by_idb[r["idb"]] = r["id"]
    # exact links only: an FJC record id carried by two docket records links to neither
    for idb, n in dup.items():
        if n > 1:
            docket_by_idb.pop(idb, None)
    return {"nos": nos, "district_state": district_state, "mdl_ids": mdl_ids, "docket_by_idb": docket_by_idb,
            "docket_ids_ambiguous": sorted(k for k, n in dup.items() if n > 1)}


def build(lk: dict) -> dict:
    os.makedirs(OUT, exist_ok=True)
    raw_path = os.path.join(OUT, "entities.jsonl")
    n_raw, latest = 0, {}
    with open(raw_path, "w", encoding="utf-8") as raw:
        for r in keyset("entities", "native_id,data,provenance,source_as_of,payload_sha256", ENTITY_FILTER, "native_id", "corpus_ingest"):
            raw.write(json.dumps(r, sort_keys=True) + "\n")
            n_raw += 1
            src, filed = str((r["data"] or {}).get("dataset_source") or ""), (r["data"] or {}).get("date_filed") or ""
            if filed and filed > latest.get(src, ""):
                latest[src] = filed
    lk = {**lk, "latest_filed": latest}
    unsorted = os.path.join(OUT, "records.unsorted.jsonl")
    index, stats = [], Counter()
    with open(raw_path, encoding="utf-8") as src, open(unsorted, "wb") as dst:
        for line in src:
            rec = cl.project(json.loads(line), lk)
            blob = (json.dumps(rec, sort_keys=True) + "\n").encode()
            index.append((cl.sort_key(rec), dst.tell(), len(blob)))
            dst.write(blob)
            f = rec["filters"]
            stats["records"] += 1
            for k in ("status", "disposition_group", "class_action", "linked_docket", "transferred", "fjc_source", "mdl"):
                for v in f[k]:
                    stats[f"{k}={v}"] += 1
            stats["state_blank"] += rec["state"] == ""
            stats["nos_not_recorded"] += rec["item"]["cells"]["nos"] == cl.NR
            stats["origin_not_recorded"] += rec["item"]["cells"]["origin"] == cl.NR
            stats["judgment_not_recorded_terminated"] += f["status"] == ["terminated"] and rec["item"]["cells"]["judgment_for"] == cl.NR
            stats["plaintiff_not_recorded"] += rec["item"]["cells"]["plaintiff"] == cl.NR
            stats["defendant_not_recorded"] += rec["item"]["cells"]["defendant"] == cl.NR
            stats["mdl_link"] += any(l["url"].startswith("/records/fjc_civil_mdls/") for l in rec["item"]["links"])
    index.sort(key=lambda t: t[0])
    final = os.path.join(OUT, f"{cl.DATASET}.jsonl")
    digest = hashlib.sha256()
    with open(unsorted, "rb") as src, open(final, "wb") as dst:
        for i, (_k, off, size) in enumerate(index):
            src.seek(off)
            blob = src.read(size)
            dst.write(blob)
            digest.update((b"\n" if i else b"") + json.dumps(json.loads(blob), sort_keys=True).encode())
    os.remove(unsorted)
    manifest = {
        "dataset": cl.DATASET, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entities_read": n_raw, "records": stats["records"], "records_sha256": digest.hexdigest(),
        "latest_filed_by_fjc_source": latest, "lookup_sizes": {k: len(v) for k, v in lk.items() if isinstance(v, (dict, set, list))},
        "stats": dict(sorted(stats.items())), "file": os.path.relpath(final, ROOT).replace(os.sep, "/"),
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    return manifest


def listing_and_summary(manifest: dict, lk: dict) -> tuple[dict, dict]:
    mdls = sorted({k.split("=", 1)[1] for k in manifest["stats"] if k.startswith("mdl=")}, key=int)
    listing = writer.listing(
        [("plaintiff", "Plaintiff (as recorded)"), ("defendant", "Defendant (as recorded)"), ("court_id", "Court"), ("docket", "IDB docket"),
         ("filed", "Filed"), ("terminated", "Terminated"), ("mdl", "MDL (FJC IDB, historical)"), ("nos", "Nature of suit"),
         ("origin", "Origin"), ("disposition", "Disposition"), ("judgment_for", "Judgment for"), ("amount_received", "Amount received"),
         ("class_action", "Class action")],
        [("mdl", "MDL docket number (FJC IDB, historical)", {m: f"MDL {m}" for m in mdls}),
         ("status", "Status in the FJC file", {"pending": "Pending", "terminated": "Terminated"}),
         ("disposition_group", "Disposition group", {g: g for g in ["Pending", "Dismissed", "Judgment", "Transferred or remanded", cl.NR]}),
         ("class_action", "Class action", {"yes": "Alleged (CLASSACT = 1)", "not_recorded": cl.NR}),
         ("linked_docket", "Docket record", {"yes": "Linked by exact FJC record id", "no": "No docket record"}),
         ("transferred", "Transfer recorded", {"yes": "Yes", "no": "No"})],
    )
    summary = {
        "source": "Federal Judicial Center, Integrated Database (IDB), civil cases filed, terminated and pending, SY 1988 to present, as copied by CourtListener",
        "source_page": cl.FJC_PAGE, "codebook": cl.CODEBOOK,
        "source_file": "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2",
        "source_as_of": "2026-09-30",
        "terms": "FJC IDB: public data of the Federal Judicial Center (a U.S. government publisher; owner decision 2026-10-22 permits the IDB). CourtListener bulk data copy from Free Law Project.",
        "scope": "The FJC IDB civil records in the corpus intake: those carrying an explicit FJC MDL docket number (MDLDOCK) for the matters the corpus tracks. Not the whole IDB.",
        "vintage": "Each record keeps the FJC file CourtListener imported (dataset source). Latest filing date by source: "
                   + ", ".join(f"{k}: {v}" for k, v in sorted(manifest["latest_filed_by_fjc_source"].items()))
                   + ". Pending means pending in that file, not today.",
        "evidence_rule": "MDL association is the IDB's MDLDOCK field, labelled 'FJC IDB (historical)'. It is not current JPML membership and is never inferred from caption, product, judge, firm or court.",
        "decoding": "Codes are decoded with the FJC civil codebook; a missing code (-8 or blank, which CourtListener stores as null) or one outside the codebook table shows as 'Not recorded' with the raw code. Money fields are whole thousands of dollars as recorded; 9999 is the field's largest value.",
        "names": "Plaintiff and defendant appear exactly as the FJC recorded them; nothing is inferred about a person and names are not linked to profiles.",
        "links": "Docket links only where cl_docket_metadata carries the exact FJC record id (idb_data_id); MDL links only to fjc_civil_mdls 'mdl:<n>'.",
        "data_notes": ["Pro se is the IDB PROSE code as recorded; most MDL 2885 records filed on its administrative docket carry code 1 (pro se plaintiff)."],
        "held_back": "None. The IDB carries no seal or restriction flag and no record has source evidence for a hold.",
        "records": manifest["records"], "records_sha256": manifest["records_sha256"],
        "counts": {k: v for k, v in manifest["stats"].items() if not k.startswith("mdl=")},
        "ambiguous_docket_links_dropped": len(lk.get("docket_ids_ambiguous", [])),
    }
    return listing, summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="publish to corpus_records (lead only)")
    args = ap.parse_args()
    lk = lookups()
    manifest = build(lk)
    listing, summary = listing_and_summary(manifest, lk)
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as handle:
        json.dump({"listing": listing, "summary": summary}, handle, indent=2)
    print(json.dumps({"records": manifest["records"], "entities_read": manifest["entities_read"], "sha256": manifest["records_sha256"]}))
    if manifest["records"] != manifest["entities_read"]:
        raise SystemExit("record count differs from the entities read; nothing published")
    if args.publish:
        writer.publish_jsonl(cl.DATASET, cl.LABEL, os.path.join(ROOT, manifest["file"]), listing_block=listing, summary=summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
