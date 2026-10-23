"""Parse every acquired workbook into a normalised table-period file under private/build/uscourts_tables/parsed/.

Reads private/acq/uscourts_tables/files_index.json (acquire.py), parses each XLSX with utx_parse, normalises it
(normalize.py), applies the acceptance gates below and writes parsed/<pub>/<period_end>/<table_key>.json.gz. Files that
fail a gate are listed in ingest_report.json with the reason and are NOT used by the builders.

Gates (a table-period is accepted only when all hold):
  * the workbook has at least one sheet with data rows;
  * the table number printed in the title matches the listing's table number (after normalising spaces/case), or the
    listing number is a variant label of it ("D Cases", "C-9 Retired" print their base id);
  * the period end in the title equals the listing's period end (titles that print a range are checked on the last year);
  * every value cell is a number, a dash or blank (text values are kept as flags but must be < 5 percent of cells).
"""
import gzip
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import utx_parse as P  # noqa: E402

OUT = F.ROOT / "private" / "build" / "uscourts_tables" / "parsed"
# Bump when utx_parse / normalize / the gates change: parsed files written by another version are parsed again.
PARSER_VERSION = "2026-10-23.12"


def accept(norm):
    reasons = []
    if not norm["rows"]:
        reasons.append("no data rows")
    printed = (norm["printed_table_id"] or "").upper().replace(" ", "")
    listed = norm["table"].upper().replace(" ", "")
    base = re.sub(r"\(.*?\)|CASES$|RETIRED$", "", listed)
    if printed and printed not in (listed, base):
        # a table whose workbook prints another table number (a publisher typo) is kept only when its title words equal the
        # listing's title; the mismatch is recorded in the table's own problems list
        sig = lambda t: re.sub(r"[^a-z]+", " ", t.lower()).strip()  # noqa: E731
        if sig(norm["title"]) and sig(norm["title"]) == sig(norm["title_listing"]):
            norm.setdefault("warnings", []).append(f"the workbook prints Table {printed}; the listing and the title words say {listed}")
        else:
            reasons.append(f"title table {printed} != listing {listed}")
    reasons.extend(norm["problems"])
    # A column that cannot be told apart from another one, or that has figures but no heading, cannot be read without guessing.
    shared = [c["key"] for c in norm["columns"] if "~" in c["key"]]
    if shared:
        reasons.append(f"ambiguous column headings: {len(shared)} columns share a heading path with another column, first {shared[0]}")
    if norm["scope"] == "category":
        # a category table that repeats a label under the same parent ("Franchise" in each of four blocks that are not marked by an
        # indented heading) cannot say which block a figure belongs to
        first_values, repeated = {}, set()
        for r in norm["rows"]:
            if r["entity_id"] in first_values and first_values[r["entity_id"]] != r["values"]:
                repeated.add(r["entity_id"])
            first_values.setdefault(r["entity_id"], r["values"])
        if repeated:
            reasons.append(f"ambiguous row labels: {len(repeated)} labels repeat under the same parent with different figures, first {sorted(repeated)[0]}")
    for position, c in enumerate(norm["columns"]):
        if not c["path"] and any((r["values"] or [None] * len(norm["columns"]))[position] is not None for r in norm["rows"]):
            reasons.append(f"column {c['index'] + 1} has figures but no heading")
            break
    cells = texts = 0
    for r in norm["rows"]:
        for f in r["flags"] or []:
            cells += 1
            if f and f.startswith("text:"):
                texts += 1
    if cells and texts / cells > 0.05:
        reasons.append(f"{texts}/{cells} text cells")
    return reasons


def out_path(entry):
    return OUT / entry["pub"] / entry["period_end"] / (N.table_slug(entry["table"]) + ".json.gz")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    only_pub = args[0].split(",") if args and args[0] else None
    index = json.loads((F.ACQ / "files_index.json").read_text())
    report = {"accepted": 0, "rejected": [], "unreadable": [], "by_scope": {}}
    for key, entry in sorted(index.items()):
        if entry.get("status") != 200 or entry.get("format") not in ("xlsx", "xls"):
            continue
        if only_pub and entry["pub"] not in only_pub:
            continue
        target = out_path(entry)
        if target.exists() and not force:
            try:
                have = json.loads(gzip.decompress(target.read_bytes()))
            except Exception:
                have = None
            if have and have.get("parser_version") == PARSER_VERSION and have["source"]["sha256"] == entry["sha256"]:
                report["accepted"] += 1
                for n in have["sheets"]:
                    report["by_scope"][n["scope"]] = report["by_scope"].get(n["scope"], 0) + 1
                continue
        if entry["format"] == "xls":
            converted = F.ROOT / "private" / "build" / "uscourts_tables" / "xls_converted" / f"{entry['sha256']}.xlsx"
            if not converted.exists():
                report["unreadable"].append({"key": key, "error": "xls not converted yet"})
                continue
            data = converted.read_bytes()
        else:
            data = F.read_stored(F.ROOT / entry["path"])
        try:
            sheets, problems = P.parse_workbook(data)
        except Exception as error:  # a damaged workbook is reported, not repaired
            report["unreadable"].append({"key": key, "error": str(error)[:200]})
            target.unlink(missing_ok=True)  # never leave a file written by an earlier parser version for an entry that no longer passes
            continue
        if not sheets:
            report["rejected"].append({"key": key, "reasons": ["no sheets with data"] + problems})
            target.unlink(missing_ok=True)
            continue
        parsed_sheets = []
        for position, sheet in enumerate(sheets):
            norm = N.normalize(sheet, entry)
            norm["sheet_index"] = position
            if position:  # a second sheet is a second table of the same workbook (for example F-2 with chapters 9, 12 and 15)
                norm["table_key"] = f"{norm['table_key']}-s{position + 1}"
            reasons = accept(norm)
            parsed_sheets.append((norm, reasons))
        good = [(n, r) for n, r in parsed_sheets if not r]
        if not good:
            report["rejected"].append({"key": key, "title": entry["title"][:80], "reasons": parsed_sheets[0][1]})
            target.unlink(missing_ok=True)
            continue
        doc = {
            "parser_version": PARSER_VERSION,
            "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                       "sha256": entry["sha256"], "bytes": entry["bytes"], "format": entry["format"]},
            "sheets": [n for n, _ in good],
            "rejected_sheets": [{"sheet": n["sheet"], "reasons": r} for n, r in parsed_sheets if r],
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
        report["accepted"] += 1
        for n, _ in good:
            report["by_scope"][n["scope"]] = report["by_scope"].get(n["scope"], 0) + 1
    path = F.ROOT / "private" / "build" / "uscourts_tables" / "ingest_report.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1))
    print(json.dumps({"accepted": report["accepted"], "rejected": len(report["rejected"]), "unreadable": len(report["unreadable"]), "by_scope": report["by_scope"]}))


if __name__ == "__main__":
    main()
