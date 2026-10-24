"""Read the PDF-only editions of court tables into parsed/ documents, under the strict gates of pdf_ingest.parse_pdf_table.

Before spreadsheets were published, a table exists only as a PDF. For tables with one row per court (Total, circuit roll-ups,
districts or bankruptcy courts) the PDF text layer is read row by row and the columns are named by a LATER spreadsheet
edition of the same table (the nearest one whose layout the PDF fits). An edition is kept only when every gate holds (same table
id and period as the listing, the same court set, the same figure count per row, every roll-up identity, the heading words of
the reference); otherwise it is listed with its reasons in pdf_ingest_report.json and nothing of it is used.

Run after acquire.py --pdf-only and ingest.py:   python3 -I -B pdf_backfill.py [--tables C,D,...] [--force]
"""
import gzip
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import pdf_ingest as I  # noqa: E402
import pdf_rows as R  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
PDF_PARSER_VERSION = "pdf-2026-10-24.2"
COURT_SCOPES = ("district", "bankruptcy", "appeals")
MAX_REFERENCES = 4


def load_references():
    """{table_key: [(period_end, pub, normalized first sheet)]} from the spreadsheet editions already parsed."""
    refs = defaultdict(list)
    for path in sorted(PARSED.glob("*/*/*.json.gz")):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        if doc["source"].get("format") == "pdf":
            continue
        for sheet in doc["sheets"]:
            if sheet.get("sheet_index", 0) == 0 and sheet["scope"] in COURT_SCOPES:
                refs[sheet["table_key"]].append((sheet["period_end"], sheet["pub"], sheet))
    return refs


def candidates(refs, entry):
    key = N.table_slug(entry["table"])
    later = [r for r in refs.get(key, []) if r[0] > entry["period_end"]]
    later.sort(key=lambda r: (r[1] != entry["pub"], r[0]))
    out, seen = [], set()
    for end, pub, sheet in later:
        signature = tuple((c["key"], c["prior"]) for c in sheet["columns"])
        if signature in seen:
            continue
        seen.add(signature)
        out.append(sheet)
        if len(out) >= MAX_REFERENCES:
            break
    return out


def main():
    want = set()
    if "--tables" in sys.argv:
        want = {t.strip().upper() for t in sys.argv[sys.argv.index("--tables") + 1].split(",") if t.strip()}
    force = "--force" in sys.argv
    index = json.loads((F.ACQ / "files_index.json").read_text())
    refs = load_references()
    report = {"accepted": 0, "rejected": [], "no_reference": [], "by_table": {}}
    tmp_dir = BUILD / "pdf_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    entries = sorted((k, e) for k, e in index.items() if e.get("format") == "pdf" and e.get("status") == 200)
    for key, entry in entries:
        if want and entry["table"].upper() not in want:
            continue
        target = PARSED / entry["pub"] / entry["period_end"] / (N.table_slug(entry["table"]) + ".json.gz")
        if target.exists() and not force:
            try:
                have = json.loads(gzip.decompress(target.read_bytes()))
            except Exception:
                have = None
            if have and have.get("parser_version") == PDF_PARSER_VERSION and have["source"]["sha256"] == entry["sha256"]:
                report["accepted"] += 1
                report["by_table"][entry["table"]] = report["by_table"].get(entry["table"], 0) + 1
                continue
        cands = candidates(refs, entry)
        if not cands:
            report["no_reference"].append(key)
            continue
        with tempfile.NamedTemporaryFile(dir=tmp_dir, suffix=".pdf") as handle:
            handle.write(F.read_stored(F.ROOT / entry["path"]))
            handle.flush()
            try:
                text = R.pdf_text(handle.name)
            except Exception as error:  # a damaged PDF is reported, not repaired
                report["rejected"].append({"key": key, "reasons": [f"pdftotext failed: {str(error)[:100]}"]})
                continue
        tried = []
        norm = None
        for ref in cands:
            norm, reasons = I.parse_pdf_table(text, ref, entry)
            tried.append({"reference": f"{ref['pub']} {ref['period_end']}", "reasons": reasons})
            if norm:
                norm["reference"] = {"pub": ref["pub"], "period_end": ref["period_end"]}
                break
        if not norm:
            report["rejected"].append({"key": key, "tried": tried})
            continue
        norm["sheet_index"] = 0
        norm["note_marks"] = {}
        norm["warnings"] = norm.get("warnings", []) + [f"Rows were read from the PDF text layer; column names come from the {norm['reference']['pub']} spreadsheet edition of {norm['reference']['period_end']}."]
        for c in norm["columns"]:
            c["marks"] = []
        doc = {
            "parser_version": PDF_PARSER_VERSION,
            "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                       "sha256": entry["sha256"], "bytes": entry["bytes"], "format": "pdf"},
            "sheets": [norm],
            "rejected_sheets": [],
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
        report["accepted"] += 1
        report["by_table"][entry["table"]] = report["by_table"].get(entry["table"], 0) + 1
    path = BUILD / "pdf_ingest_report.json"
    path.write_text(json.dumps(report, indent=1))
    print(json.dumps({"accepted": report["accepted"], "rejected": len(report["rejected"]), "no_reference": len(report["no_reference"]), "by_table": report["by_table"]}))


if __name__ == "__main__":
    main()
