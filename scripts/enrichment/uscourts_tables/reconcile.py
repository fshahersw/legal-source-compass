"""Reconcile every parsed table-period against the totals it prints, and decide which table-periods are held.

No value is ever changed here. A table prints totals in two directions:

  rows     a "Total" row over its circuit roll-ups (court tables) or over its top-level categories (category tables), a
           circuit row over its districts, a district row over its counties (Table F-5A), a category row over the indented
           rows under it;
  columns  a "Total" column inside a heading group over the other columns of that group ("Business Filings / Total" over
           "Business Filings / Chapter 7, 11, 13 ..."), and a top-level "Total" column over the top-level groups.

Every such relation is a candidate identity, tested only on count columns (no percent, median, average, rate, per-judgeship,
time or judge-count columns) with exact integer arithmetic; a printed dash counts as no cases in a sum and any other missing
figure makes that one test not applicable.

A candidate is one of the table's printed totals only when the table's own editions show it: across all periods of the
series it holds in at least three of every four tests where it can be applied (`established`). That keeps relations a table
does not claim (B-3 prints a Total that includes appeals with no district row; the circuit rows of V-1 count services of
circuit judges that no district row shows) from holding every period, while a period that breaks an identity the table keeps
everywhere else is a real failure. The test is made at two levels: the kind of relation for one column ("circuit rows over
districts, column Filed") and the same for one entity ("the Second Circuit row ..."); a failure holds its period only when both
levels are established (the entity level is skipped for an entity with fewer than four tests, which then follows its kind).

A period whose own footnotes say that its totals include something the rows do not show ("Totals include reopened ...")
does not hold on a row-total failure; the failure is listed as explained.

Rows the table prints twice with the same figures (the D.C. row printed as a circuit and again as a district since 2023) are
counted once; a circuit printed twice in a row with different figures ("2nd" and "2ND") passes when one of its printed rows
equals the sum of its districts, and the national sum uses every distinct printed circuit row.
"""
import re
from collections import defaultdict

import build_tables as B

# Whole words only: "misdemeanor" holds "mean" and "corporate" holds "rate", and neither is a non-count column.
NON_ADDITIVE = re.compile(
    r"\bpercent(?:age)?s?\b|\bmedians?\b|\bmeans?\b|\baverages?\b|\bper\b|\brates?\b|\bweighted\b|\bratios?\b|%|\bmonths?\b|\bdays?\b|"
    r"\btimes?\b|\blength\b|\bintervals?\b|\bindex\b|\bshares?\b|\bpct\b|\bjudges?\b|\bjudgeships?\b|\bvacan(?:t|cy|cies)\b|\bage\b|"
    r"\bdollars?\b|\$|\bamounts?\b|\bcosts?\b|\bfees?\b",
    re.I,
)
TOTAL_WORD = re.compile(r"^total\b", re.I)
NOTE_EXPLAINS = re.compile(
    r"\btotals?\s+(?:also\s+)?(?:include|includes|may include|reflect|reflects)\b|\b(?:does|do|may|will) not (?:sum|add|equal)\b|"
    r"\bnot (?:sum|add) to\b|\bsum of the (?:circuits|districts|rows) (?:does|may) not\b",
    re.I,
)
MIN_ENTITY_TESTS = 4
SPECIAL_COURTS = {"CIT", "FED", "INTERNATIONAL TRADE", "FEDERAL CIRCUIT", "COURT OF INTERNATIONAL TRADE"}


# ------------------------------------------------------------------------------------------------------------- columns

def additive_positions(norm):
    """Positions (in norm['columns']) of the count columns a sum may be tested on."""
    out = []
    for i, c in enumerate(norm["columns"]):
        if c.get("prior"):
            continue
        path = " ".join(c.get("path") or [])
        if NON_ADDITIVE.search(path):
            continue
        if B.unit_of(c.get("path") or [], c.get("fmt")) != "count":
            continue
        out.append(i)
    return out


def _num(row, pos):
    """(value, usable): a printed number; a dash is 0; any other gap is not usable."""
    values = row.get("values") or []
    if pos >= len(values):
        return None, False
    v = values[pos]
    if v is not None:
        if isinstance(v, float) and not v.is_integer():
            return None, False
        return int(v), True
    flag = (row.get("flags") or [None] * (pos + 1))[pos]
    return (0, True) if flag == "dash" else (None, False)


def _sum(rows, pos):
    total = 0
    for r in rows:
        v, ok = _num(r, pos)
        if not ok:
            return None
        total += v
    return total


def data_rows(norm):
    """Data rows in order with exact duplicates (same entity, same figures, adjacent or not) read once."""
    out, seen = [], set()
    for r in norm["rows"]:
        if r.get("section"):
            continue
        key = (r.get("entity"), r.get("entity_id"), tuple(r.get("values") or []))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# ------------------------------------------------------------------------------------------------------------- tests

def _test(results, kind, entity, col, printed, parts_sum):
    if printed is None or parts_sum is None:
        return
    results.append({"kind": kind, "entity": entity, "col": col, "printed": printed, "sum": parts_sum, "ok": printed == parts_sum})


def court_tests(norm, positions, results):
    """Total over circuits (or over districts when no circuit row is printed) and each circuit over its districts."""
    rows = data_rows(norm)
    total = next((r for r in rows if r["entity"] == "national"), None)
    groups, current, has_circuit = [], None, False
    for r in rows:
        if r["entity"] == "circuit":
            has_circuit = True
            if current is not None and not current.get("dc") and current["cid"] == r["entity_id"] and not current["districts"]:
                current["rows"].append(r)  # the same circuit printed twice before its districts
            else:
                current = {"cid": r["entity_id"], "rows": [r], "districts": []}
                groups.append(current)
        elif r["entity"] == "district":
            if r["entity_id"] in ("dcd", "dcb") and (current is None or norm["scope"] == "appeals"):
                groups.append({"cid": "cadc", "rows": [r], "districts": [r], "dc": True})
            elif current is not None:
                current["districts"].append(r)
    for pos in positions:
        key = norm["columns"][pos]["key"]
        for g in groups:
            if g.get("dc") or not g["districts"]:
                continue
            parts = _sum(g["districts"], pos)
            printed = [v for v, ok in (_num(r, pos) for r in g["rows"]) if ok]
            if parts is None or not printed:
                continue
            match = parts if parts in printed else printed[0]
            _test(results, "circuit", g["cid"], key, match, parts)
        if total is not None:
            t, ok = _num(total, pos)
            if not ok:
                continue
            if has_circuit:
                parts_rows = [r for g in groups for r in g["rows"]]
            else:
                parts_rows = [r for r in rows if r["entity"] == "district"]
            # the Court of International Trade and the Federal Circuit rows some district tables print (V-1) are in the Total, and so
            # are the rows a table names in its own "total_includes" (the state judges' row of the delayed-notice warrant reports)
            included = set(norm.get("total_includes") or ())
            parts_rows = parts_rows + [r for r in rows if r["entity"] == "other" and (r["label"].strip().upper().rstrip(".") in SPECIAL_COURTS or r["entity_id"] in included)]
            _test(results, "national", "national", key, t, _sum(parts_rows, pos) if parts_rows else None)


def appeals_tests(norm, positions, results):
    rows = data_rows(norm)
    total = next((r for r in rows if r["entity"] == "national"), None)
    circuits = [r for r in rows if r["entity"] == "circuit"]
    if total is None or not circuits:
        return
    for pos in positions:
        t, ok = _num(total, pos)
        if ok:
            _test(results, "national", "national", norm["columns"][pos]["key"], t, _sum(circuits, pos))


def county_tests(norm, positions, results):
    rows = data_rows(norm)
    total = next((r for r in rows if r["entity"] == "national"), None)
    districts, by_district = [], defaultdict(list)
    for r in rows:
        if r["entity"] == "district":
            districts.append(r)
        elif r["entity"] == "county":
            by_district[r.get("district") or "unknown"].append(r)
    for pos in positions:
        key = norm["columns"][pos]["key"]
        for d in districts:
            counties = by_district.get(d["entity_id"])
            if counties:
                v, ok = _num(d, pos)
                if ok:
                    _test(results, "district", d["entity_id"], key, v, _sum(counties, pos))
        if total is not None and districts:
            t, ok = _num(total, pos)
            if ok:
                _test(results, "national", "national", key, t, _sum(districts, pos))


def category_tests(norm, positions, results):
    """A row over the rows indented directly under it; the Total row over the top-level rows."""
    rows = data_rows(norm)
    children = defaultdict(list)
    by_path = {}
    for r in rows:
        by_path.setdefault(tuple(r.get("path") or [r["label"]]), r)
    for r in rows:
        path = tuple(r.get("path") or [r["label"]])
        # a row's parent is its nearest ancestor that is a row with figures; section headings between them ("Contract Actions"
        # inside "Federal Question") are path elements, not terms
        for cut in range(len(path) - 1, 0, -1):
            if path[:cut] in by_path:
                children[path[:cut]].append(r)
                break
    total = next((r for r in rows if r["entity"] == "national"), None)
    top = [r for r in rows if r is not total and len(r.get("path") or []) == 1]
    if total is not None and children.get(tuple(total.get("path") or [total["label"]])):
        # the Total row has rows of its own under it (a hierarchy read from the table's sums): the parent test covers it
        top = []
    for pos in positions:
        key = norm["columns"][pos]["key"]
        for parent_path, kids in children.items():
            parent = by_path.get(parent_path)
            if parent is None:
                continue
            v, ok = _num(parent, pos)
            if ok:
                _test(results, "parent", parent["entity_id"], key, v, _sum(kids, pos))
        if total is not None and len(top) >= 2:
            t, ok = _num(total, pos)
            if ok:
                _test(results, "depth0", "national", key, t, _sum(top, pos))


def _group_parts(prefix, total_pos, positions, paths):
    """Positions whose sum a "Total" column at prefix + [Total] should equal: for each other heading under the prefix, its own
    column, else its own "Total" column, else (one level down only) all its columns; None when a subgroup is deeper."""
    depth = len(prefix)
    heads = []
    for j in positions:
        path = paths[j]
        if j == total_pos or len(path) <= depth or path[:depth] != prefix:
            continue
        g = path[depth]
        if TOTAL_WORD.match(g) and len(path) == depth + 1:
            continue
        if g not in heads:
            heads.append(g)
    parts = []
    for g in heads:
        inside = [j for j in positions if len(paths[j]) > depth and paths[j][:depth] == prefix and paths[j][depth] == g]
        leaf = [j for j in inside if len(paths[j]) == depth + 1]
        own_total = [j for j in inside if len(paths[j]) == depth + 2 and TOTAL_WORD.match(paths[j][depth + 1])]
        if leaf:
            parts.append(leaf[0])
        elif own_total:
            parts.append(own_total[0])
        elif inside and all(len(paths[j]) == depth + 2 for j in inside):
            parts.extend(inside)
        else:
            return None
    return parts


def column_identities(norm, positions):
    """[(total position, [part positions], identity name)] for "Total" columns over the other headings of their group."""
    cols = norm["columns"]
    paths = {i: tuple(cols[i].get("path") or []) for i in positions}
    out = []
    for i in positions:
        path = paths[i]
        if not path or not TOTAL_WORD.match(path[-1]):
            continue
        parts = _group_parts(path[:-1], i, positions, paths)
        if parts and len(parts) >= 2:
            out.append((i, parts, cols[i]["key"]))
    return out


def column_tests(norm, positions, results):
    for total_pos, parts, name in column_identities(norm, positions):
        for r in data_rows(norm):
            t, ok = _num(r, total_pos)
            if not ok:
                continue
            s = 0
            for j in parts:
                v, okj = _num(r, j)
                if not okj:
                    s = None
                    break
                s += v
            _test(results, "coltotal", r.get("entity_id") or r["label"], name, t, s)


def period_tests(norm):
    """Every identity test of one table-period: [{kind, entity, col, printed, sum, ok}]."""
    positions = additive_positions(norm)
    results = []
    if not positions:
        return results
    scope = norm["scope"]
    if scope in ("district", "bankruptcy"):
        court_tests(norm, positions, results)
    elif scope == "appeals":
        appeals_tests(norm, positions, results)
    elif scope == "county":
        county_tests(norm, positions, results)
    else:
        category_tests(norm, positions, results)
    column_tests(norm, positions, results)
    return results


ROW_KINDS = {"national", "depth0"}
COURT_SCOPES = {"district", "bankruptcy", "appeals", "county"}
# Roll-ups over a complete set of courts: every court of the set is printed, so a printed total LARGER than its courts is as
# much a failure as a smaller one.
COMPLETE_KINDS = {"national", "circuit"}


def note_explains(norm):
    return any(NOTE_EXPLAINS.search(line) for line in norm.get("notes") or [])


def failure_kind(test, scope):
    """'hard' or 'shortfall' for a failed test.

    Hard: the printed parts add up to MORE than the printed total (never possible for counts), or a roll-up over a complete
    set of courts differs in either direction. Shortfall: a category or column total larger than its printed parts, which
    means the total also counts parts the table does not print (F-2 prints chapters 7, 11 and 13 under a Total that also
    counts the few cases filed under other chapters); it is recorded and does not hold the period."""
    if test["sum"] > test["printed"]:
        return "hard"
    if scope in COURT_SCOPES and test["kind"] in COMPLETE_KINDS:
        return "hard"
    return "shortfall"


# ------------------------------------------------------------------------------------------------------------- series

def _established(tally):
    passed, failed = tally
    return passed >= 1 and failed * 3 <= passed


def reconcile_series(norms):
    """Decide, for the table-periods of one series (same table key and scope, any order), which are held.

    Returns {"periods": [{"pub", "end", "status", "tests", "passed", "failures", "explained"}], "identities": {...}, "status"}
    where a period's status is "reconciled" (every established identity holds), "held" (an established identity fails),
    "no_totals" (nothing to test) and the series status summarises them."""
    per_period = [period_tests(n) for n in norms]
    kind_tally = defaultdict(lambda: [0, 0])
    entity_tally = defaultdict(lambda: [0, 0])
    for tests in per_period:
        for t in tests:
            kind_tally[(t["kind"], t["col"])][0 if t["ok"] else 1] += 1
            entity_tally[(t["kind"], t["entity"], t["col"])][0 if t["ok"] else 1] += 1

    def established(t):
        if not _established(kind_tally[(t["kind"], t["col"])]):
            return False
        ent = entity_tally[(t["kind"], t["entity"], t["col"])]
        if sum(ent) >= MIN_ENTITY_TESTS:
            return _established(ent)
        return True

    periods = []
    for n, tests in zip(norms, per_period):
        explains = note_explains(n)
        failures, explained, short, passed, used = [], [], [], 0, 0
        for t in tests:
            if not established(t):
                continue
            used += 1
            if t["ok"]:
                passed += 1
            elif explains and t["kind"] in ROW_KINDS:
                explained.append(t)
            elif failure_kind(t, n["scope"]) == "shortfall":
                short.append(t)
            else:
                failures.append(t)
        status = "held" if failures else ("reconciled" if used else ("not_sums" if tests else "no_totals"))
        pick = lambda items: [{k: f[k] for k in ("kind", "entity", "col", "printed", "sum")} for f in items[:20]]  # noqa: E731
        periods.append({"pub": n["pub"], "end": n["period_end"], "status": status, "tests": used, "passed": passed,
                        "failures": pick(failures), "failure_count": len(failures), "explained": len(explained),
                        "total_exceeds_parts": len(short), "total_exceeds_parts_examples": pick(short[:3])})
    kinds = {}
    for (kind, col), (p, f) in sorted(kind_tally.items()):
        kinds.setdefault(kind, {"established": 0, "not_established": 0, "examples": []})
        if _established((p, f)):
            kinds[kind]["established"] += 1
        else:
            kinds[kind]["not_established"] += 1
            if len(kinds[kind]["examples"]) < 3:
                kinds[kind]["examples"].append({"col": col, "passed": p, "failed": f})
    statuses = {p["status"] for p in periods}
    if "held" in statuses:
        status = "held_periods"
    elif "reconciled" in statuses:
        status = "reconciled"
    elif "not_sums" in statuses:
        status = "not_sums"  # the table prints totals, but none of them is the sum of the rows or columns it prints
    else:
        status = "no_totals"
    return {"periods": periods, "identities": kinds, "status": status}
