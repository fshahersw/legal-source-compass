"""Arithmetic checks on a normalised table-period (no value is ever changed by a check).

District, bankruptcy and appeals tables print roll-up rows: the "Total" row is the sum of the circuit rows and each
circuit row is the sum of its districts (the D.C. row is both a circuit and a district). For every column that is a
count (its heading has no percent / median / mean / average / rate / per words) the identities below are tested:
    sum(circuit rows incl. DC) == Total        and        sum(districts of a circuit) == that circuit row
A published table can break an identity for a stated reason (a footnote saying a court is excluded), so a failure is
reported, never repaired. The tests themselves live in reconcile.py (which also tests category and column totals and
decides which table-periods are held); this module keeps the court roll-up view the PDF gates and the build report use.

Two corrections of 2026-10-24: heading words are matched as whole words ("misdemeanor" no longer reads as "mean"), and a
row printed twice with the same figures (the D.C. row printed as a circuit and as a district since 2023) is counted once.
"""
import reconcile as R

NON_ADDITIVE = R.NON_ADDITIVE


def additive_columns(norm):
    return [i for i, c in enumerate(norm["columns"]) if not c.get("prior") and not NON_ADDITIVE.search(" ".join(c["path"]))]


def rollup_failures(norm):
    """[(column key, entity, published, summed)] for count columns where a roll-up row differs from the sum of its parts."""
    if norm["scope"] not in ("district", "bankruptcy"):
        return []
    results = []
    R.court_tests(norm, additive_columns(norm), results)
    return [(t["col"], t["entity"], t["printed"], t["sum"]) for t in results if not t["ok"]]
