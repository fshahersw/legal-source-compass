"""Combine NEISS aggregates over sample-design periods (pure functions, standard library only).

CPSC re-stratified the sample in 2024: 19 hospital identifiers changed stratum between the 2023 and 2024 files and the per-stratum
weights changed, so one (stratum, hospital) cluster structure cannot span 2023 and 2024. Years are therefore pooled INSIDE a design
segment (a hospital is one cluster across the segment's years, which keeps its year-to-year correlation) and the segments are added.

Variance of a sum of two segment totals: V = V_A + V_B + 2 Cov(A, B), and |Cov(A, B)| <= sqrt(V_A V_B), so
    V <= (SE_A + SE_B)^2        (perfect correlation between the periods: an UPPER bound, never an understatement).
For a share R = Y/X over the combined periods the linearised variable z = y - R x (R from the combined totals) is bounded the same way:
    V(R) <= (SE_A(z) + SE_B(z))^2 / X^2,  V_s(z) = V_s(y) - 2 R Cov_s(x, y) + R^2 V_s(x).
"""
import math


def _bound(variances):
    return sum(math.sqrt(max(v, 0.0)) for v in variances) ** 2


def combine(tuples):
    """Combine per-segment aggregate tuples into one 11-tuple (est, cases, var, est4, cases4, var4, rvar4, est2, cases2, var2, rvar2).

    Each input is the 13-tuple of aggregate.Acc.reduce() for one design segment, or None when the domain has no case in that segment.
    Returns None when no segment has the domain.
    """
    segs = [t for t in tuples if t is not None]
    if not segs:
        return None
    x = sum(t[0] for t in segs)
    n = sum(t[1] for t in segs)
    y4 = sum(t[3] for t in segs)
    n4 = sum(t[4] for t in segs)
    y2 = sum(t[7] for t in segs)
    n2 = sum(t[8] for t in segs)
    var = _bound(t[2] for t in segs)
    var4 = _bound(t[5] for t in segs)
    var2 = _bound(t[9] for t in segs)
    rvar4 = rvar2 = None
    if x > 0:
        r4, r2 = y4 / x, y2 / x
        rvar4 = _bound(t[5] - 2 * r4 * t[11] + r4 * r4 * t[2] for t in segs) / (x * x)
        rvar2 = _bound(t[9] - 2 * r2 * t[12] + r2 * r2 * t[2] for t in segs) / (x * x)
    return (x, n, var, y4, n4, var4, rvar4, y2, n2, var2, rvar2)


def combine_results(results):
    """results: list of {key: 13-tuple} (one per design segment). Returns {key: 11-tuple} over the union of keys."""
    keys = set()
    for res in results:
        keys.update(res)
    return {k: combine([res.get(k) for res in results]) for k in keys}
