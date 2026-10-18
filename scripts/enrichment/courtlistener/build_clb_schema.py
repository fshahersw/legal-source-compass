"""Build clb_bulk_schema: CourtListener's published database schema, which tables have a public bulk file, and how complete the loaded columns are.

Sources (snapshot 2026-09-30): schema-2026-09-30.sql (tables, columns, foreign keys, column comments) and load-bulk-data-2026-09-30.sh
(the COPY statements that list which tables have a bulk CSV). Loaded-column completeness is measured on this project's slim DuckDB
copies (private/acq/courtlistener/db/*.duckdb). A table is never described as available unless the load script names it.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import schema_catalog as sc  # noqa: E402

ACQ = os.path.join(ROOT, "private", "acq", "courtlistener")
DB = os.path.join(ACQ, "db")
OUT = os.path.join(ROOT, "private", "build", "courtlistener")
SCHEMA_URL = cc.BULK_BASE + "schema-2026-09-30.sql"
LOAD_URL = cc.BULK_BASE + "load-bulk-data-2026-09-30.sh"

# Plain-language labels written by this project from the table and column names and the schema's own column comments.
LABEL = {
    "search_docket": "Dockets: one case or appeal in one court",
    "search_docketentry": "Docket entries: the numbered filings on a docket",
    "search_recapdocument": "RECAP documents: the PDFs attached to docket entries",
    "search_opinioncluster": "Opinion clusters: one decided case with its opinions",
    "search_opinion": "Opinions: the text of each majority, concurring or dissenting opinion",
    "search_opinionscited": "Citation map: which opinion cites which opinion",
    "search_citation": "Reporter citations (volume, reporter, page) of opinion clusters",
    "search_court": "Courts",
    "search_courthouse": "Courthouses",
    "search_court_appeals_to": "Which court appeals go to from which court",
    "search_originatingcourtinformation": "Lower-court information attached to an appeal",
    "search_parenthetical": "Parentheticals that describe a cited opinion",
    "search_opinioncluster_panel": "Judges on the panel of an opinion cluster",
    "search_opinioncluster_non_participating_judges": "Judges recorded as not participating in a cluster",
    "search_opinion_joined_by": "Judges who joined an opinion",
    "audio_audio": "Oral argument recordings",
    "people_db_person": "People (judges and other officials)",
    "people_db_position": "Positions held by people (seats on courts and other offices)",
    "people_db_education": "Education records of people",
    "people_db_school": "Schools",
    "people_db_politicalaffiliation": "Political affiliations of people",
    "people_db_person_race": "Race records of people",
    "people_db_race": "Race code list",
    "people_db_retentionevent": "Retention elections of judges",
    "people_db_attorney": "Attorneys named on RECAP dockets",
    "people_db_attorneyorganization": "Law firms and other organizations of attorneys",
    "people_db_attorneyorganizationassociation": "Links between attorneys, organizations and dockets",
    "people_db_party": "Parties named on RECAP dockets",
    "people_db_partytype": "Party roles on a docket (plaintiff, defendant, and so on)",
    "people_db_role": "Roles of attorneys on a docket",
    "people_db_criminalcount": "Criminal counts of a party",
    "people_db_criminalcomplaint": "Criminal complaints of a party",
    "people_db_abarating": "American Bar Association ratings of judicial nominees",
    "recap_fjcintegrateddatabase": "Copy of the FJC Integrated Database civil and criminal records",
    "disclosures_financialdisclosure": "Judicial financial disclosure reports",
    "disclosures_investment": "Investments listed in disclosures",
    "disclosures_position": "Outside positions listed in disclosures",
    "disclosures_agreement": "Agreements listed in disclosures",
    "disclosures_noninvestmentincome": "Non-investment income listed in disclosures",
    "disclosures_spouseincome": "Spousal income listed in disclosures",
    "disclosures_reimbursement": "Reimbursements listed in disclosures",
    "disclosures_gift": "Gifts listed in disclosures",
    "disclosures_debt": "Debts listed in disclosures",
    "search_bankruptcyinformation": "Bankruptcy details of a docket",
    "search_casetransfer": "Case transfers between dockets",
    "search_claim": "Claims in bankruptcy cases",
    "search_trialcourtdata": "Trial-court data attached to appeals",
    "citations_unmatchedcitation": "Citations found in opinions that were not matched to a cluster",
}


def table_label(name: str) -> str:
    if name in LABEL:
        return LABEL[name]
    if name.endswith("event") and name[: -len("event")] in LABEL:
        return "Change-history (event) rows for: " + LABEL[name[: -len("event")]]
    if name.endswith("event"):
        return "Change-history (event) table, by name"
    return "Not labelled by this project"


def group_of(name: str) -> str:
    for prefix in ("search_", "people_db_", "disclosures_", "recap_", "audio_", "citations_"):
        if name.startswith(prefix):
            return prefix.rstrip("_")
    return name.split("_", 1)[0]


# our slim tables -> (duckdb file, table, schema table, bulk key)
LOADED = {
    "search_docket": ("docket.duckdb", "docket"),
    "search_opinioncluster": ("cluster.duckdb", "cluster"),
    "search_opinion": ("opinion.duckdb", "opinion"),
    "search_opinionscited": ("cmap.duckdb", "cmap"),
    "search_citation": ("citation.duckdb", "citation"),
    "recap_fjcintegrateddatabase": ("idb.duckdb", "idb"),
    "audio_audio": ("oral_argument.duckdb", "oral_argument"),
}
SMALL = {
    "search_court": "courts", "search_courthouse": "courthouses", "people_db_person": "person", "people_db_position": "position",
    "people_db_education": "education", "people_db_school": "school", "people_db_politicalaffiliation": "political_affiliation",
    "people_db_person_race": "person_race", "people_db_race": "race", "people_db_retentionevent": "retention_event",
    "search_court_appeals_to": "court_appeals_to", "search_opinioncluster_non_participating_judges": "cluster_non_participating",
    "search_originatingcourtinformation": "originating_court", "search_opinioncluster_panel": "cluster_panel",
    "search_opinion_joined_by": "opinion_joined_by",
}


def done_ok(table: str) -> dict | None:
    """The completion marker of a full (not limit) ingest, else None."""
    path = os.path.join(DB, table + ".done.json")
    if not os.path.exists(path):
        return None
    meta = json.load(open(path))
    return meta if not meta.get("limit_mb") else None


def populated(db_file: str, table: str) -> tuple[int, list[dict]] | None:
    try:
        con = duckdb.connect(os.path.join(DB, db_file), read_only=True)
    except duckdb.Error:
        return None
    try:
        cols = [(r[0], r[1]) for r in con.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position").fetchall()]
        parts = ", ".join(f"count({c})" for c, _ in cols)
        row = con.execute(f"SELECT count(*), {parts} FROM {table}").fetchone()
        total = row[0]
        return total, [{"name": c, "type": t, "populated": row[i + 1], "populated_pct": cc.share(row[i + 1], total, 2)} for i, (c, t) in enumerate(cols)]
    finally:
        con.close()


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def build() -> dict:
    sql = open(os.path.join(ACQ, "schema-2026-09-30.sql")).read()
    script = open(os.path.join(ACQ, "load-bulk-data-2026-09-30.sh")).read()
    tables = sc.parse_schema(sql)
    bulk = sc.parse_bulk_files(script)
    small_done = json.load(open(os.path.join(DB, "small.done.json")))
    sizes = {}
    latest = json.load(open(os.path.join(ACQ, "latest_bulk.json")))
    for key, (date, size, path) in latest.items():
        sizes[key.split("|")[0]] = size
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()  # noqa: E731 - small files
    inputs = [{"url": SCHEMA_URL, "path": "private/acq/courtlistener/schema-2026-09-30.sql", "sha256": sha(os.path.join(ACQ, "schema-2026-09-30.sql"))},
              {"url": LOAD_URL, "path": "private/acq/courtlistener/load-bulk-data-2026-09-30.sh", "sha256": sha(os.path.join(ACQ, "load-bulk-data-2026-09-30.sh"))}]

    rows = []
    n_cols = sum(len(t["columns"]) for t in tables.values())
    commented = sum(1 for t in tables.values() for c in t["columns"] if c["comment"])
    fk_in = Counter(fk["references"] for t in tables.values() for fk in t["foreign_keys"])
    status_counts = Counter()
    for name, t in tables.items():
        b = bulk.get(name)
        in_bulk_cols = set(b["columns"]) if b else set()
        loaded_here = None
        profile = None
        loaded_state = "No public bulk file" if not b else "Public bulk file, not loaded here"
        if name in LOADED:
            db_file, tbl = LOADED[name]
            meta = done_ok(tbl)
            if meta:
                prof = populated(db_file, tbl)
                if prof:
                    profile = {"table": tbl, "rows": prof[0], "columns": prof[1], "skipped_invalid_rows": meta.get("skipped_invalid_rows", 0), "seconds": meta.get("seconds")}
                    loaded_state = "Public bulk file, loaded here (selected columns)"
            else:
                loaded_state = "Public bulk file, load in progress"
        elif name in SMALL:
            meta = small_done.get(SMALL[name])
            prof = populated("small.duckdb", SMALL[name]) if meta else None
            if prof:
                profile = {"table": SMALL[name], "rows": prof[0], "columns": prof[1], "skipped_invalid_rows": meta.get("rejected_records", 0), "seconds": meta.get("seconds")}
                loaded_state = "Public bulk file, loaded here (all columns, as text)"
        status_counts[loaded_state] += 1
        cols = []
        for c in t["columns"]:
            cols.append({"name": c["name"], "type": c["type"], "not_null": c["not_null"], "comment": c["comment"], "in_bulk_file": (c["name"] in in_bulk_cols) if b else False})
        group = group_of(name)
        label = table_label(name)
        fks = t["foreign_keys"]
        bulk_file = None
        if b:
            stem = b["file"]
            bulk_file = f"{stem}-2026-09-30.csv.bz2"
        size = sizes.get(b["file"]) if b else None
        sub = (f"{len(cols)} columns · {'bulk file ' + bulk_file if bulk_file else 'no public bulk file'}"
               + (f" · {profile['rows']:,} rows loaded" if profile else ""))
        rows.append(writer.record(
            "clb_bulk_schema", f"table:{name}", f"{name}: {label}", source_url=SCHEMA_URL, subtitle=sub,
            cells={"table": name, "group": group, "label": label, "columns": len(cols), "foreign_keys": len(fks), "referenced_by": fk_in.get(name, 0),
                   "bulk": "Yes" if b else "No", "loaded": loaded_state, "rows_loaded": profile["rows"] if profile else None,
                   "compressed_mb": round(size / 1e6, 1) if size else None},
            badges=["CourtListener database schema", "Bulk file" if b else "No bulk file"],
            facts=facts([("Table", name), ("What it holds (label by this project)", label), ("Columns in the published schema", len(cols)),
                         ("Columns with a description in the schema", sum(1 for c in cols if c["comment"])),
                         ("Foreign keys out / tables referencing it", f"{len(fks)} / {fk_in.get(name, 0)}"),
                         ("Public bulk file", bulk_file if bulk_file else "None: the bulk-data load script has no COPY for this table"),
                         ("Compressed size of the bulk file", f"{size / 1e6:,.1f} MB" if size else None),
                         ("Loaded in this project", loaded_state), ("Rows loaded", f"{profile['rows']:,}" if profile else None)]),
            text=f"courtlistener schema table {name} {label} {' '.join(c['name'] for c in cols)}",
            filters={"group": [group], "bulk": ["yes" if b else "no"]},
            links=[{"label": "Published schema (SQL)", "url": SCHEMA_URL}, {"label": "Bulk-data load script", "url": LOAD_URL}],
            extra={"profile": {"table": name, "group": group, "label": label, "columns": cols, "foreign_keys": fks, "bulk_file": bulk_file, "bulk_columns_in_load_order": b["columns"] if b else [],
                               "loaded": loaded_state, "load_profile": profile}}))
    missing_key = ["people_db_attorney", "people_db_attorneyorganization", "people_db_attorneyorganizationassociation", "people_db_party", "people_db_partytype", "people_db_role",
                   "search_docketentry", "search_recapdocument"]
    assert all(t in tables and t not in bulk for t in missing_key), "a table expected to lack a bulk file has one"
    summary = {
        "source": "CourtListener published database schema and bulk-data load script (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"tables_in_schema": len(tables), "tables_with_bulk_file": len(bulk), "tables_without_bulk_file": len(tables) - len(bulk), "columns": n_cols,
                   "columns_with_description": commented, "foreign_keys": sum(len(t["foreign_keys"]) for t in tables.values())},
        "load_status": dict(status_counts),
        "not_in_bulk": {"tables": missing_key,
                        "statement": "The published schema defines attorney, law-firm, party, role, docket-entry and RECAP-document tables, but the bulk-data load script contains no COPY statement for them, so they cannot be derived from the bulk files. They are available through CourtListener's API or its RECAP database, subject to its terms and rate limits."},
        "definitions": {"populated share": "non-null share of the loaded rows for each column kept in this project's slim table (dates and numbers that failed to parse count as not populated)",
                        "loaded here": "selected columns only for large tables; opinion text and other long fields are reduced to lengths or presence flags"},
        "grain": "one record per table in the published schema",
    }
    return {"clb_bulk_schema": {
        "dataset": "clb_bulk_schema", "label": "CourtListener database schema and bulk-file coverage (Sept 30, 2026)",
        "listing_block": writer.listing([("table", "Table"), ("group", "Group"), ("label", "What it holds"), ("columns", "Columns"), ("bulk", "Bulk file"), ("loaded", "Loaded here"), ("rows_loaded", "Rows loaded")],
                                         [("bulk", "Bulk file", {"yes": "Has a public bulk file", "no": "No public bulk file"}), ("group", "Group", {g: g for g in sorted({group_of(n) for n in tables})})]),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = build()
    for ds, spec in out.items():
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB", json.dumps(spec["summary"]["load_status"]))


if __name__ == "__main__":
    main()
