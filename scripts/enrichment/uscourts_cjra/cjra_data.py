"""Assemble the parsed CJRA reports into per-period district, circuit and national figures with their cross-checks.

Inputs are the extraction cache (extract_cjra.py: Appendix A rows of every report), the hash-checked summary tables (cjra_tables.py:
Tables 1-4) and the court lookup. Nothing here reads the network or the corpus.

For every report period the module produces
  districts[court_id]  the district's five counts as printed on its district-total row; when no total row is printed, the sum of its
                       printed judge rows is used only if it equals the value implied by the report's own circuit table (circuit minus
                       the other districts), otherwise the district is "not recorded" for that period with the reason. Also the judge
                       rows, whether they add up to the printed total, and the endnotes printed for their counts.
  circuits[key]        Table 2 (current period) next to the printed Appendix A circuit total and the sum of the districts
  national             Table 1 next to the printed Appendix A national row (2020 onward) and the sum of the districts
Differences between printed figures are kept and labelled, never smoothed.
"""
import json
import re
from pathlib import Path

import cjra_parse as P
import cjra_sources as S
import cjra_tables as T
import extract_cjra as X

HERE = Path(__file__).resolve().parent
LOOKUPS = S.BUILD / "lookups"
MEASURES = P.MEASURES


def load_courts():
    path = LOOKUPS / "court_spine_districts.json"
    data = json.loads(path.read_text())
    courts = data["courts"]
    if len(courts) != 94 or set(courts) != set(P.CIRCUIT_OF):
        raise SystemExit("court lookup must hold exactly the 94 districts of the CJRA reports")
    return data


def period_tables(period, slot):
    """Parsed Tables 1-4 of one report: {"table1": (rows, ok), ...} and the table PDFs read."""
    if slot["tables"]:
        by = {n: T.pdf_text_lines(S.verified(entry)) for n, entry in slot["tables"].items()}
        files = [slot["tables"][n] for n in sorted(slot["tables"])]
    else:
        lines = T.pdf_text_lines(S.verified(slot["main"]), pages=set(range(1, 14)))
        by = T.locate_tables(lines)
        files = [slot["main"]]
    return T.parse_report_tables(by), files


def sum_values(items):
    out = {m: 0 for m in MEASURES}
    for it in items:
        for m in MEASURES:
            out[m] += it[m]
    return out


def diff(a, b):
    return {m: a[m] - b[m] for m in MEASURES if a[m] != b[m]}


def exemption_text(rows, abbreviation):
    """The report paragraph that exempts a district from reporting (used when the district is absent from Appendix A), or None."""
    labels = [r["label"] for r in rows[:120] if r["page"] <= 3]
    for i, text in enumerate(labels):
        if "exempt" in text.lower() and (abbreviation in text or any(abbreviation in labels[j] for j in range(max(0, i - 2), min(len(labels), i + 2)))):
            lo = i
            while lo > 0 and not re.search(r"(?i)hurricane|exceptional disruption|storm", labels[lo]):
                lo -= 1
            hi = i
            while hi < len(labels) - 1 and not labels[hi].rstrip().endswith("."):
                hi += 1
            hi = min(len(labels) - 1, hi + 2)
            while hi < len(labels) - 1 and not labels[hi].rstrip().endswith("."):
                hi += 1
            text = " ".join(labels[max(0, lo - 1):hi + 1])
            return re.sub(r"(\w)- (\w)", r"\1\2", re.sub(r"\s+", " ", text)).strip()
    return None


def confirm_missing_totals(districts, t2):
    """Districts with judge rows but no printed district total: the judge-row sum is accepted only when the report's own Table 2 circuit
    row implies the same value (circuit value minus the other districts' values, all of which must be recorded). Otherwise the district
    stays "not recorded" with the reason. Mutates `districts`."""
    for cid, entry in districts.items():
        if entry["source"] != "not_recorded" or entry["reconciliation"]["status"] != "no_total_row":
            continue
        ckey = P.CIRCUIT_OF[cid]
        others = [districts[c] for c in P.CIRCUITS[ckey] if c != cid and c in districts]
        if t2 and ckey in t2 and all(o["values"] is not None for o in others):
            implied = {m: t2[ckey][m] - sum(o["values"][m] for o in others) for m in MEASURES}
            if implied == entry["reconciliation"]["judge_rows_sum"]:
                entry["values"], entry["source"] = dict(implied), "judge_rows_sum_matches_circuit_table"
                continue
            entry["reason"] = ("no district total row is printed and the listed judge rows do not match the value implied by the report's Table 2 "
                               f"circuit row (judge rows add to {entry['reconciliation']['judge_rows_sum']}, Table 2 implies {implied})")
        else:
            entry["reason"] = "no district total row is printed and the circuit table could not confirm the sum of the listed judge rows"


def build_period(period, slot, courts):
    data = X.load_rows(period)
    parsed = P.parse_period(data["rows"], courts)
    checks = P.validate(parsed)
    lookup = P.note_lookup(data["rows"])
    rows_by_court = {}
    for r in parsed["rows"]:
        r["notes"] = [{"column": MEASURES[c], "marker": m, "text": lookup(r["page"], m)} for c, m in r["markers"]]
        rows_by_court.setdefault(r["court_id"], []).append(r)
    printed, type_totals = {}, {}
    for t in parsed["totals"]:
        if t["level"] == "district" and t["key"] and t["key"] not in printed:
            printed[t["key"]] = t
        elif t["level"] == "type":
            type_totals.setdefault(t["key"], t)
    tables, table_files = period_tables(period, slot)
    t2 = tables["table2"][0]
    districts = {}
    for cid in courts:
        rows = rows_by_court.get(cid, [])
        tot = printed.get(cid)
        persons = [r for r in rows if r["kind"] == "person"]
        entry = {
            "values": None, "source": "not_recorded", "reason": None, "rows": rows, "persons": len(persons),
            "assignments": len(rows) - len(persons),
            "district_judges": sum(1 for r in persons if r["group"] == "district"),
            "magistrate_judges": sum(1 for r in persons if r["group"] == "magistrate"),
            "by_type": {g: type_totals.get(f"{cid}|{g}", {}).get("values") for g in ("district", "magistrate")},
            "pages": sorted({r["page"] for r in rows} | ({tot["page"]} if tot else set())),
            "reconciliation": {"status": "not_listed", "difference": {}}, "district_notes": [],
        }
        summed = sum_values([r["values"] for r in rows]) if rows else None
        if tot is not None:
            entry["values"], entry["source"] = dict(tot["values"]), "printed_total"
            if rows:
                d = diff(tot["values"], summed)
                entry["reconciliation"] = {"status": "reconciled" if not d else "judge_rows_differ", "difference": d, "judge_rows_sum": summed}
            else:
                entry["reconciliation"] = {"status": "no_judge_rows", "difference": {}}
        elif rows:
            entry["reconciliation"] = {"status": "no_total_row", "difference": {}, "judge_rows_sum": summed}
        districts[cid] = entry
    confirm_missing_totals(districts, t2)
    for cid, entry in districts.items():
        if entry["reconciliation"]["status"] == "not_listed":
            abbreviation = {"laed": "LA-E"}.get(cid)
            text = exemption_text(data["rows"], abbreviation) if abbreviation else None
            entry["reason"] = ("exempted by the Administrative Office from this report: " + text) if text else "the district has no rows in this report's Appendix A"
    circuits, printed_circuit = {}, {}
    for t in parsed["totals"]:
        if t["level"] == "circuit" and t["key"] and t["key"] != "?":
            printed_circuit.setdefault(t["key"], t)
    for ckey, members in P.CIRCUITS.items():
        listed = [districts[c]["values"] for c in members if districts[c]["values"] is not None]
        circuits[ckey] = {
            "table2": {m: t2[ckey][m] for m in MEASURES} if t2 and ckey in t2 else None,
            "table2_shares": {k: v for k, v in t2[ckey].items() if k not in MEASURES} if t2 and ckey in t2 else None,
            "printed": printed_circuit[ckey]["values"] if ckey in printed_circuit else None,
            "sum_of_districts": sum_values(listed) if listed else None, "districts_listed": len(listed),
            "table3": {m: tables["table3"][0][ckey][m] for m in MEASURES} if tables["table3"][0] else None,
            "table4": tables["table4"][0].get(ckey) if tables["table4"][0] else None,
        }
    nat = next((t for t in parsed["totals"] if t["level"] == "national"), None)
    t1 = tables["table1"][0]
    listed_all = [d["values"] for d in districts.values() if d["values"] is not None]
    national = {"printed": nat["values"] if nat else None, "sum_of_districts": sum_values(listed_all), "districts_listed": len(listed_all),
                "table1": {m: {k: t1[m]["total"][k] for k in ("previous", "current", "pct_change")} for m in MEASURES} if t1 else None,
                "table1_judge_type": {m: {"district": t1[m]["district"], "magistrate": t1[m]["magistrate"]} for m in MEASURES} if t1 else None,
                "table4_total": (tables["table4"][0] or {}).get("total"), "persons": sum(d["persons"] for d in districts.values())}
    table_flags = {k: {"parsed": v[0] is not None, "checks_ok": v[1]} for k, v in tables.items()}
    return {"period": period, "districts": districts, "circuits": circuits, "national": national, "tables_ok": table_flags,
            "table_files": table_files, "main_file": slot["main"], "checks": checks, "incomplete": parsed["incomplete"], "warnings": parsed["warnings"],
            "shifted_rows": sum(1 for r in data["rows"] if r.get("shifted")),
            "extractor": data.get("extractor"), "appendix_pdf_sha256": data.get("pdf_sha256")}


def build_all(only=None):
    lookup = load_courts()
    courts = lookup["courts"]
    periods = S.periods()
    out = {}
    for period in sorted(periods):
        if only and period not in only:
            continue
        out[period] = build_period(period, periods[period], courts)
    return lookup, out
