"""Statistics helpers for the matter cross-analysis: permutation p-values and Benjamini-Hochberg adjustment.

Spearman rho, its Fisher interval and strength labels come from scripts/enrichment/courtlistener/clb_common.py; these helpers add
the multiplicity control the analysis reports beside every family of tests.
"""
from __future__ import annotations

import random


def ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def pearson(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb) ** 0.5


def permutation_p(xs: list[float], ys: list[float], rho: float, n_perm: int = 5000, seed: int = 1019) -> float:
    """Two-sided permutation p-value for a Spearman rho: share of shuffles with |rho| at least as large (with the +1 correction)."""
    rx, ry = ranks(xs), ranks(ys)
    rng = random.Random(seed)
    hits = 0
    perm = ry[:]
    for _ in range(n_perm):
        rng.shuffle(perm)
        r = pearson(rx, perm)
        if r is not None and abs(r) >= abs(rho) - 1e-12:
            hits += 1
    return (hits + 1) / (n_perm + 1)


def bh_adjust(pvalues: list[float]) -> list[float]:
    """Benjamini-Hochberg adjusted p-values (monotone, capped at 1), in the input order."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 1.0
    for rank_from_end, i in enumerate(reversed(order)):
        k = m - rank_from_end
        running = min(running, pvalues[i] * m / k)
        adjusted[i] = min(running, 1.0)
    return adjusted
