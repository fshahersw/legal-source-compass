"""Arithmetic checks on a normalised table-period (no value is ever changed by a check).

District, bankruptcy and appeals tables print roll-up rows: the "Total" row is the sum of the circuit rows and each
circuit row is the sum of its districts (the D.C. row is both a circuit and a district). For every column that is a
count (its heading has no percent / median / mean / average / rate / per words) the identities below are tested:
    sum(circuit rows incl. DC) == Total        and        sum(districts of a circuit) == that circuit row
A published table can break an identity for a stated reason (a footnote saying a court is excluded), so a failure is
reported, never repaired; the builder records the failure count per table.
"""
import re

NON_ADDITIVE = re.compile(r"percent|median|mean|average|\bper\b|rate|weighted|ratio|%|months|days|time|length|interval|index|share|\bpct\b|\bjudges\b", re.I)


def additive_columns(norm):
    return [i for i, c in enumerate(norm["columns"]) if not c.get("prior") and not NON_ADDITIVE.search(" ".join(c["path"]))]


def rollup_failures(norm):
    """[(column key, entity, published, summed)] for count columns where a roll-up row differs from the sum of its parts."""
    if norm["scope"] not in ("district", "bankruptcy"):
        return []
    cols = additive_columns(norm)
    rows = [r for r in norm["rows"] if not r["section"]]
    total = next((r for r in rows if r["entity"] == "national"), None)
    circuits, current = [], None
    for r in rows:
        if r["entity"] == "circuit":
            current = {"row": r, "districts": []}
            circuits.append(current)
        elif r["entity"] == "district":
            if r["entity_id"] in ("dcd", "dcb") and current is None:
                circuits.append({"row": r, "districts": [r], "is_dc": True})
                continue
            if current is not None:
                current["districts"].append(r)
    fails = []

    def value(row, i):
        return row["values"][i] if row["values"] else None

    for ci in cols:
        key = norm["columns"][ci]["key"]
        for c in circuits:
            if c.get("is_dc"):
                continue
            parts = [value(d, ci) for d in c["districts"]]
            published = value(c["row"], ci)
            if published is None or any(p is None and (d["flags"] or [None])[ci] != "dash" for p, d in zip(parts, c["districts"])):
                continue
            summed = sum(p for p in parts if p is not None)
            if abs(summed - published) > 1e-9:
                fails.append((key, c["row"]["entity_id"], published, summed))
        if total is not None and value(total, ci) is not None:
            # a table without circuit roll-up rows (X-1A prints districts only) adds its districts straight to the Total
            circuits_used = circuits if any(not c.get("is_dc") for c in circuits) else [{"row": d} for d in rows if d["entity"] == "district"]
            vals = [value(c["row"], ci) for c in circuits_used]
            if all(v is not None for v in vals) or all(v is not None or (c["row"]["flags"] or [None])[ci] == "dash" for v, c in zip(vals, circuits_used)):
                summed = sum(v for v in vals if v is not None)
                if abs(summed - value(total, ci)) > 1e-9:
                    fails.append((key, "national", value(total, ci), summed))
    return fails
