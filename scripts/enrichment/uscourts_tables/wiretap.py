"""Read the Wiretap report jurisdiction tables (Tables 2-6) into parsed table files, under strict gates.

Each of these tables prints one row per reporting jurisdiction and no indentation (the sums below use the count columns that
hold no text cell; "NP", no prosecutor's report, is kept as printed and takes part in no sum):

    Total
    Federal Total
    <federal districts, by name: "ALABAMA MIDDLE", "ARIZONA" ...>
    <state> ("CALIFORNIA")
    <its local jurisdictions> ("LOS ANGELES", "RIVERSIDE" ...)
    <next state> ...

The grouping is not marked by indentation, so it is read from the table's own sums, and a period is kept only when every one of
these holds exactly (count columns only; a blank cell counts as no orders in these sums, and stays blank in the data):

  * the rows after "Federal Total" up to some row add up to Federal Total in every count column (the federal section ends there,
    at the first such row);
  * the remaining rows split into blocks, each a state or territory name (from the list below) followed by one or more rows that
    are not state names and add up to it;
  * Federal Total plus the state rows equals Total;
  * no label repeats under the same parent with different figures.

The rows are written with their published labels as category rows (path ["Federal Total", district] or [state, jurisdiction]),
so the national builder, the reconciliation and the series index treat them like any other category table. A period that fails a
gate is listed with its reason in wiretap_report.json and nothing of it is used.

Tables 1 (statutes, text), 7 and 9 (multi-year summaries with repeated row labels), 8 (supplementary reports by year) and A-1/B-1
(one row per intercept order) are not read here; the coverage audit lists them.
Usage: python3 -I -B wiretap.py [--force]
"""
import gzip
import json
import re
import sys
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import reconcile as R  # noqa: E402
import utx_parse as P  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
WIRE_PARSER_VERSION = "wire-2026-10-24.3"
TABLES = {"Wire 2", "Wire 3", "Wire 4", "Wire 5", "Wire 6"}
STATES = {
    "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO", "CONNECTICUT", "DELAWARE", "DISTRICT OF COLUMBIA", "FLORIDA", "GEORGIA",
    "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA",
    "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO", "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA",
    "OHIO", "OKLAHOMA", "OREGON", "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
    "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING", "PUERTO RICO", "GUAM", "VIRGIN ISLANDS",
}


def key_of(label):
    return re.sub(r"\s+", " ", P.strip_marks(P.norm_text(label))).strip().upper()


def _vals(row, positions):
    """Values at the count positions, a blank or dash counting as 0 (for the structural sums only); None when a cell is text."""
    out = []
    for p in positions:
        v = (row["values"] or [None] * (p + 1))[p]
        flag = (row["flags"] or [None] * (p + 1))[p]
        if v is None:
            if flag in ("blank", "dash", None):
                out.append(0)
                continue
            return None
        if isinstance(v, float) and not v.is_integer():
            return None
        out.append(int(v))
    return out


def _add(a, b):
    return [x + y for x, y in zip(a, b)]


def structure(rows, positions):
    """([(row, path)], None) for the data rows of a jurisdiction table, or (None, reason)."""
    if len(rows) < 3:
        return None, "fewer than three data rows"
    total, fed = rows[0], rows[1]
    if key_of(total["label"]) != "TOTAL" or key_of(fed["label"]) != "FEDERAL TOTAL":
        return None, f"the first two rows are '{total['label']}' and '{fed['label']}', not Total and Federal Total"
    tv, fv = _vals(total, positions), _vals(fed, positions)
    if tv is None or fv is None:
        return None, "Total or Federal Total has a text cell in a count column"
    out = [(total, ["Total"]), (fed, ["Federal Total"])]
    acc, i, end_fed = [0] * len(positions), 2, None
    while i < len(rows):
        v = _vals(rows[i], positions)
        if v is None:
            return None, f"text cell in a count column at '{rows[i]['label']}'"
        acc = _add(acc, v)
        if acc == fv:
            end_fed = i
            break
        i += 1
    if end_fed is None:
        return None, "no run of rows after Federal Total adds up to Federal Total"
    for r in rows[2:end_fed + 1]:
        out.append((r, ["Federal Total", r["label"]]))
    state_sum = [0] * len(positions)
    i = end_fed + 1
    if i < len(rows) and key_of(rows[i]["label"]) not in STATES:
        # editions that print the local jurisdictions without their state rows (2016, 2017): kept flat, as printed, only when
        # Federal Total plus these rows equals Total and no label repeats (a label repeated in two states cannot be told apart)
        for r in rows[i:]:
            v = _vals(r, positions)
            if v is None:
                return None, f"text cell in a count column at '{r['label']}'"
            state_sum = _add(state_sum, v)
            out.append((r, [r["label"]]))
        i = len(rows)
    while i < len(rows):
        head = rows[i]
        if key_of(head["label"]) not in STATES:
            return None, f"'{head['label']}' opens a block in the state section but is not a state or territory name"
        hv = _vals(head, positions)
        if hv is None:
            return None, f"text cell in a count column at '{head['label']}'"
        state_sum = _add(state_sum, hv)
        # a block runs until its rows add up exactly to the state row; a county may carry a state's name ("WASHINGTON" in
        # Maryland, "NEW YORK" in New York), so names do not end a block, sums do
        acc, j, matched = [0] * len(positions), i + 1, None
        while j < len(rows):
            v = _vals(rows[j], positions)
            if v is None:
                return None, f"text cell in a count column at '{rows[j]['label']}'"
            acc = _add(acc, v)
            if acc == hv:
                matched = j
                break
            if any(a > h for a, h in zip(acc, hv)):
                break
            j += 1
        if matched is None:
            return None, f"the rows under '{head['label']}' do not add up to it"
        out.append((head, [head["label"]]))
        for r in rows[i + 1:matched + 1]:
            out.append((r, [head["label"], r["label"]]))
        i = matched + 1
    if _add(fv, state_sum) != tv:
        return None, "Federal Total plus the state rows does not equal Total"
    seen = {}
    for r, path in out:
        k = tuple(key_of(p) for p in path)
        if k in seen and seen[k] != r["values"]:
            return None, f"'{' / '.join(path)}' is printed twice with different figures"
        seen[k] = r["values"]
    return out, None


def clean_positions(rows, positions):
    """Count columns in which every data row prints a number, a dash or nothing: the grouping is read from these only. A column
    with a text cell ("NP": no prosecutor's report) keeps its cells as printed but cannot take part in a sum."""
    out = []
    for p in positions:
        flags = [(r["flags"] or [None] * (p + 1))[p] for r in rows]
        if all(f in (None, "blank", "dash", "textnum") for f in flags):
            out.append(p)
    return out


def to_norm(sheet, entry):
    norm = N.normalize(sheet, entry)
    data = [r for r in norm["rows"] if not r["section"]]
    positions = clean_positions(data, R.additive_positions(norm))
    if not positions:
        return None, "no count column without text cells (such as NP, no prosecutor's report) to read the grouping from"
    rows, why = structure(data, positions)
    if rows is None:
        return None, why
    new_rows = []
    for r, path in rows:
        clean = [P.strip_marks(P.norm_text(p)) for p in path]
        eid = "national" if clean == ["Total"] else "/".join(P.slug(p) for p in clean)
        new_rows.append({**r, "path": clean, "entity": "national" if eid == "national" else "category", "entity_id": eid, "indent": len(clean) - 1})
    norm["rows"] = new_rows
    norm["scope"] = "category"
    norm["problems"] = [p for p in norm["problems"] if "ambiguous" not in p]
    return norm, None


def main():
    force = "--force" in sys.argv
    index = json.loads((F.ACQ / "files_index.json").read_text())
    report = {"accepted": 0, "rejected": {}, "not_read": {}}
    warnings.filterwarnings("ignore")
    for key, entry in sorted(index.items()):
        if not key.startswith("WIRETAP|") or entry.get("status") != 200:
            continue
        if entry["table"] not in TABLES:
            report["not_read"][key] = "not a jurisdiction table (statutes, multi-year summary or order-by-order listing)"
            continue
        if entry.get("format") != "xlsx":
            report["not_read"][key] = "PDF only; the jurisdiction-table reader reads spreadsheets"
            continue
        target = PARSED / entry["pub"] / entry["period_end"] / (N.table_slug(entry["table"]) + ".json.gz")
        if target.exists() and not force:
            have = json.loads(gzip.decompress(target.read_bytes()))
            if have.get("parser_version") == WIRE_PARSER_VERSION and have["source"]["sha256"] == entry["sha256"]:
                report["accepted"] += 1
                continue
        try:
            sheets, problems = P.parse_workbook(F.read_stored(F.ROOT / entry["path"]))
        except Exception as error:  # a damaged workbook is reported, not repaired
            report["rejected"][key] = f"spreadsheet could not be opened: {str(error)[:80]}"
            continue
        if not sheets:
            report["rejected"][key] = "no sheet with data rows"
            continue
        norm, why = to_norm(sheets[0], entry)
        if norm is None:
            report["rejected"][key] = why
            target.unlink(missing_ok=True)
            continue
        printed = (norm["printed_table_id"] or "").upper().replace(" ", "")
        if printed and printed != entry["table"].upper().replace(" ", ""):
            report["rejected"][key] = f"title table {printed} != listing {entry['table']}"
            continue
        if sheets[0]["period_end_from_title"] and sheets[0]["period_end_from_title"] != entry["period_end"]:
            report["rejected"][key] = f"period in title {sheets[0]['period_end_from_title']} differs from listing {entry['period_end']}"
            continue
        norm["sheet_index"] = 0
        doc = {"parser_version": WIRE_PARSER_VERSION,
               "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                          "sha256": entry["sha256"], "bytes": entry["bytes"], "format": entry["format"]},
               "sheets": [norm], "rejected_sheets": []}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
        report["accepted"] += 1
    (BUILD / "wiretap_report.json").write_text(json.dumps(report, indent=1, sort_keys=True))
    print(json.dumps({"accepted": report["accepted"], "rejected": len(report["rejected"]), "not_read": len(report["not_read"])}))
    for k, v in sorted(report["rejected"].items())[:20]:
        print("  rejected", k, v)


if __name__ == "__main__":
    main()
