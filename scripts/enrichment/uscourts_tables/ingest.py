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
import reconcile as R  # noqa: E402
import utx_parse as P  # noqa: E402

OUT = F.ROOT / "private" / "build" / "uscourts_tables" / "parsed"
# Bump when utx_parse / normalize / the gates change: parsed files written by another version are parsed again.
# Judicial Facts and Figures, Federal Court Management Statistics and Civil Justice Reform Act files are read and published by other
# streams (court_jff_series, fcms_*, court_cjra_*); this stream does not publish them again
OTHER_STREAM_PUBS = ("JFF", "FCMS", "CJRA")
PARSER_VERSION = "2026-10-25.2"


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


def hierarchy_eval(sheet, entry, auto):
    """How a category sheet reads both ways: repeated labels under indentation, the indentation tree's failed row-total tests, and
    whether the printed sums form a tree (with the sums tree's tests where a printed part exceeds its total)."""
    indent = auto if auto["hierarchy"] == "indent" else N.normalize(sheet, entry, "indent")
    sums = auto if auto["hierarchy"] == "sums" else N.normalize(sheet, entry, "sums")
    tree_kinds = ("parent", "depth0")
    indent_bad = sum(1 for t in R.period_tests(indent) if not t["ok"] and t["kind"] in tree_kinds)
    ev = {"ambiguous": bool(N.repeated_entities(indent["rows"])), "indent_bad": indent_bad, "sums": sums["hierarchy"] == "sums", "used": auto["hierarchy"]}
    if ev["sums"]:
        ev["sums_hard"] = sum(1 for t in R.period_tests(sums) if not t["ok"] and t["kind"] in tree_kinds and t["sum"] > t["printed"])
    return ev


def decide_modes(evals):
    """One way of reading the row hierarchy per category table, so every edition keys its rows the same way: from the sums when an
    edition repeats labels under indentation (those editions are read from the sums already), or when the indentation tree breaks
    its own row totals in at least half the editions and the sums form a tree with no part exceeding its total in each of them."""
    modes = {}
    for tkey, items in evals.items():
        if any(e["used"] == "sums" for e in items):
            modes[tkey] = "sums"
            continue
        bad = [e for e in items if e["indent_bad"]]
        if bad and len(bad) * 2 >= len(items) and all(e["sums"] and e.get("sums_hard") == 0 for e in bad):
            modes[tkey] = "sums"
        else:
            modes[tkey] = "indent"
    return modes


def drop_own(target):
    """Remove a parsed file this reader wrote; a file another reader wrote for the same table-period (bf_legacy.py for the Bankruptcy
    Filings printouts this reader rejects) is left alone."""
    if not target.exists():
        return
    try:
        have = json.loads(gzip.decompress(target.read_bytes()))
    except Exception:
        have = {}
    if not have.get("reader"):
        target.unlink()


def read_workbook(entry, report, key):
    if entry["format"] == "xls":
        converted = F.ROOT / "private" / "build" / "uscourts_tables" / "xls_converted" / f"{entry['sha256']}.xlsx"
        if not converted.exists():
            report["unreadable"].append({"key": key, "error": "xls not converted yet"})
            return None
        return converted.read_bytes()
    return F.read_stored(F.ROOT / entry["path"])


def process(key, entry, report, evals, modes=None):
    """Parse one workbook, normalise its sheets (with the per-table hierarchy mode when given), apply the gates, write the parsed file."""
    target = out_path(entry)
    data = read_workbook(entry, report, key)
    if data is None:
        return
    try:
        sheets, problems = P.parse_workbook(data)
    except Exception as error:  # a damaged workbook is reported, not repaired
        report["unreadable"].append({"key": key, "error": str(error)[:200]})
        drop_own(target)  # never leave a file written by an earlier parser version for an entry that no longer passes
        return
    if not sheets:
        report["rejected"].append({"key": key, "reasons": ["no sheets with data"] + problems})
        drop_own(target)
        return
    parsed_sheets = []
    for position, sheet in enumerate(sheets):
        tkey = N.table_slug(entry["table"]) + (f"-s{position + 1}" if position else "")
        mode = (modes or {}).get(tkey)
        norm = N.normalize(sheet, entry, mode)
        norm["sheet_index"] = position
        if position:  # a second sheet is a second table of the same workbook (for example F-2 with chapters 9, 12 and 15)
            norm["table_key"] = f"{norm['table_key']}-s{position + 1}"
        if norm["scope"] == "category" and modes is None:
            ev = hierarchy_eval(sheet, entry, norm)
            evals.setdefault(norm["table_key"], []).append({**ev, "key": key, "sheet": position})
            norm["hier_eval"] = ev
        reasons = accept(norm)
        parsed_sheets.append((norm, reasons))
    good = [(n, r) for n, r in parsed_sheets if not r]
    if not good:
        report["rejected"].append({"key": key, "title": entry["title"][:80], "reasons": parsed_sheets[0][1]})
        drop_own(target)
        return
    doc = {
        "parser_version": PARSER_VERSION,
        "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                   "sha256": entry["sha256"], "bytes": entry["bytes"], "format": entry["format"]},
        "sheets": [n for n, _ in good],
        "rejected_sheets": [{"sheet": n["sheet"], "reasons": r} for n, r in parsed_sheets if r],
        "hier_evals": [n.get("hier_eval") for n, _ in parsed_sheets],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
    return doc


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    only_pub = args[0].split(",") if args and args[0] else None
    index = json.loads((F.ACQ / "files_index.json").read_text())
    report = {"accepted": 0, "rejected": [], "unreadable": [], "by_scope": {}}
    evals_path = F.ROOT / "private" / "build" / "uscourts_tables" / "hierarchy_evals.json"
    stored = json.loads(evals_path.read_text()) if evals_path.exists() else {}
    stored = stored if stored.get("parser_version") == PARSER_VERSION else {}
    evals = {}
    todo = []
    for key, entry in sorted(index.items()):
        if entry.get("status") != 200 or entry.get("format") not in ("xlsx", "xls"):
            continue
        if only_pub and entry["pub"] not in only_pub:
            continue
        if entry["pub"] == "WIRETAP":  # the Wiretap tables are read by wiretap.py (its own gates), which writes the same parsed paths
            continue
        if entry["pub"] in OTHER_STREAM_PUBS:  # published by the streams that own them (coverage.py counts them there)
            continue
        target = out_path(entry)
        cached = (stored.get("by_entry") or {}).get(key)
        if target.exists() and not force and cached and cached.get("sha256") == entry["sha256"]:
            try:
                have = json.loads(gzip.decompress(target.read_bytes()))
            except Exception:
                have = None
            if have and have.get("parser_version") == PARSER_VERSION and have["source"]["sha256"] == entry["sha256"]:
                for item in cached["evals"]:
                    evals.setdefault(item["tkey"], []).append(item["ev"])
                todo.append((key, entry, True))
                continue
        todo.append((key, entry, False))
    by_entry = {}
    for key, entry, cached in todo:
        if cached:
            by_entry[key] = stored["by_entry"][key]
            continue
        before = {k: len(v) for k, v in evals.items()}
        process(key, entry, report, evals)
        by_entry[key] = {"sha256": entry["sha256"], "evals": [{"tkey": k, "ev": e} for k, v in evals.items() for e in v[before.get(k, 0):]]}
    modes = decide_modes(evals)
    # second pass: an edition read one way while its table is read the other way is read again with the table's mode
    redo = 0
    for key, entry, _ in todo:
        target = out_path(entry)
        items = [it for it in by_entry[key]["evals"]]
        if not items:
            continue
        if any(modes.get(it["tkey"]) and modes[it["tkey"]] != it["ev"]["used"] and (modes[it["tkey"]] == "indent" or it["ev"]["sums"]) for it in items):
            report["rejected"] = [r for r in report["rejected"] if r["key"] != key]
            process(key, entry, report, {}, modes)
            redo += 1
    for key, entry, _ in todo:
        target = out_path(entry)
        if not target.exists():
            continue
        try:
            have = json.loads(gzip.decompress(target.read_bytes()))
        except Exception:
            continue
        report["accepted"] += 1
        for n in have["sheets"]:
            report["by_scope"][n["scope"]] = report["by_scope"].get(n["scope"], 0) + 1
    report["hierarchy_modes"] = {k: v for k, v in sorted(modes.items()) if v == "sums"}
    report["hierarchy_reread"] = redo
    evals_path.write_text(json.dumps({"parser_version": PARSER_VERSION, "by_entry": by_entry, "modes": modes}, indent=0, sort_keys=True))
    path = F.ROOT / "private" / "build" / "uscourts_tables" / "ingest_report.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1))
    print(json.dumps({"accepted": report["accepted"], "rejected": len(report["rejected"]), "unreadable": len(report["unreadable"]), "by_scope": report["by_scope"],
                      "sums_tables": len(report["hierarchy_modes"]), "reread": redo}))


if __name__ == "__main__":
    main()
