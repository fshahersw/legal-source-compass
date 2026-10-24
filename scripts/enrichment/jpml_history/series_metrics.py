"""Deterministic derived metrics for the JPML report series (no I/O; unit-tested in test_jpml_series.py).

Every input value is a figure printed in a JPML report; every output is a stated arithmetic function of those
figures. Nothing is interpolated: a value that needs a missing report is None ("Not recorded").
"""
from datetime import date

import analytics as an


def whole_months_between(start: str | None, end: str | None):
    """Completed calendar months from ISO date `start` to ISO date `end` (0 when end is in the same month or before
    the same day of the next month); None when either date is missing or end precedes start."""
    if not start or not end:
        return None
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if b < a:
        return None
    months = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day:
        months -= 1
    return months


def peak(points: list, field: str = "pending"):
    """Largest value of `field` among the points (dicts with 'date'); the earliest date holding it wins ties.
    Returns {value, date, points} or None when no point carries the field."""
    vals = [(p[field], p["date"]) for p in points if p.get(field) is not None]
    if not vals:
        return None
    top = max(v for v, _ in vals)
    first = min(d for v, d in vals if v == top)
    return {"value": top, "date": first, "points": len(vals)}


def consecutive_changes(points: list, sequence: list):
    """Changes between consecutive reports of one series.

    points: the entity's points, dicts with 'date', 'pending', 'total'.
    sequence: every report date of the series in order (the entity may be absent from some).
    Returns one entry per consecutive pair (sequence[i-1], sequence[i]) in which the entity is listed in BOTH reports:
    {from, to, days, pending_change, total_change}. `total_change` is the change in the printed 'Total Actions
    (Historical)': an increase is the number of actions added to the MDL between the two reports; a decrease means the
    Panel's historical count was lowered (kept as printed, flagged `total_decreased`). Pairs where the entity is
    missing from either report are skipped (a gap, not a zero)."""
    by = {p["date"]: p for p in points}
    out = []
    for prev, cur in zip(sequence, sequence[1:]):
        a, b = by.get(prev), by.get(cur)
        if a is None or b is None:
            continue
        entry = {
            "from": prev, "to": cur, "days": (date.fromisoformat(cur) - date.fromisoformat(prev)).days,
            "months_apart": an.month_diff(prev[:7], cur[:7]),
            "pending_change": None if a.get("pending") is None or b.get("pending") is None else b["pending"] - a["pending"],
            "total_change": None if a.get("total") is None or b.get("total") is None else b["total"] - a["total"],
        }
        entry["total_decreased"] = entry["total_change"] is not None and entry["total_change"] < 0
        out.append(entry)
    return out


def actions_added_sum(changes: list, adjacent_only: bool = False):
    """Sum of positive total-action changes (actions added) and the count of intervals in which the printed total
    fell; None when there is no interval. adjacent_only keeps intervals between reports of consecutive calendar
    months (months_apart == 1)."""
    if adjacent_only:
        changes = [c for c in changes if c.get("months_apart") == 1]
    if not changes:
        return None
    vals = [c["total_change"] for c in changes if c["total_change"] is not None]
    return {"added": sum(v for v in vals if v > 0), "intervals": len(vals), "decreases": sum(1 for v in vals if v < 0),
            "decrease_sum": sum(v for v in vals if v < 0)}


def group_sum(rows: list, key: str, field: str = "pending"):
    """{group value: (sum of field, row count)} for rows with a non-empty key."""
    out = {}
    for r in rows:
        k = r.get(key)
        if not k:
            continue
        s, n = out.get(k, (0, 0))
        out[k] = (s + (r.get(field) or 0), n + 1)
    return out


def concentration(rows: list, key: str, field: str = "pending"):
    """Concentration of `field` across the groups named by `key` (e.g. transferee district): number of groups, HHI
    (0-10,000), the largest group and its share, top-5 share, and HHI of row counts (MDLs per group).
    Ties for the largest group go to the alphabetically first key."""
    g = group_sum(rows, key, field)
    if not g:
        return None
    total = sum(s for s, _ in g.values())
    ranked = sorted(g.items(), key=lambda kv: (-kv[1][0], kv[0]))
    lead_key, (lead_sum, lead_n) = ranked[0]
    return {
        "groups": len(g),
        "total": total,
        "hhi": an.hhi([s for s, _ in g.values()]),
        "hhi_counts": an.hhi([n for _, n in g.values()]),
        "lead": lead_key,
        "lead_value": lead_sum,
        "lead_rows": lead_n,
        "lead_share_pct": an.share_pct(lead_sum, total),
        "top5_share_pct": an.top_n_share([s for s, _ in g.values()], 5),
    }


def flows(prev_rows: list | None, cur_rows: list):
    """National flows between two consecutive reports (rows: dicts with 'mdl', 'pending', 'total').
    entered / left: MDL numbers listed in only the later / only the earlier report;
    continuing_total_change: sum over MDLs in both of (total now - total before) = actions added to continuing
    MDLs, net of any lowered historical counts; entered_total: total actions of the MDLs first listed now;
    left_pending_before: pending actions the leaving MDLs had in the earlier report. None when there is no earlier
    report."""
    if prev_rows is None:
        return None
    a = {r["mdl"]: r for r in prev_rows}
    b = {r["mdl"]: r for r in cur_rows}
    both = sorted(set(a) & set(b))
    entered = sorted(set(b) - set(a))
    left = sorted(set(a) - set(b))
    return {
        "continuing": len(both),
        "entered": entered,
        "left": left,
        "continuing_total_change": sum(b[m]["total"] - a[m]["total"] for m in both),
        "continuing_pending_change": sum(b[m]["pending"] - a[m]["pending"] for m in both),
        "continuing_total_decreases": sum(1 for m in both if b[m]["total"] < a[m]["total"]),
        "entered_total": sum(b[m]["total"] for m in entered),
        "entered_pending": sum(b[m]["pending"] for m in entered),
        "left_pending_before": sum(a[m]["pending"] for m in left),
    }


def runs(values: list):
    """Run-length encoding of printed values in report order: [{value, from, to, reports}] (consecutive equal values
    merge; a value that comes back after another forms a new run). values: [(date, value)] sorted by date."""
    out = []
    for d, v in values:
        if out and out[-1]["value"] == v:
            out[-1]["to"] = d
            out[-1]["reports"] += 1
        else:
            out.append({"value": v, "from": d, "to": d, "reports": 1})
    return out
