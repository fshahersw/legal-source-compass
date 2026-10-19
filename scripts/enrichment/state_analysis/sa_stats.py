"""Statistics for the state_analysis stream (pure Python, deterministic).

* Spearman rho: Pearson correlation of average ranks (ties share the mean rank).
* 95% interval: Fisher z transform with standard error 1/sqrt(n-3) (as scripts/enrichment/courtlistener/clb_common.py).
* p-value: two-sided, from the t approximation t = rho * sqrt((n-2)/(1-rho^2)) with n-2 degrees of freedom (Student t
  distribution via the regularised incomplete beta function). Tests need n >= 10.
* Benjamini-Hochberg adjusted p-values within each family of tests; an association "holds" when the adjusted p < 0.05.
* Quantiles: linear interpolation between order statistics (type 7, the spreadsheet/NumPy default).
"""
from __future__ import annotations

import math

MIN_N = 10
ALPHA = 0.05


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
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def spearman(xs: list[float | None], ys: list[float | None]) -> tuple[float | None, int]:
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 3:
        return None, n
    return pearson(ranks([p[0] for p in pairs]), ranks([p[1] for p in pairs])), n


def fisher_ci(rho: float, n: int) -> tuple[float, float] | None:
    if n < 4 or abs(rho) >= 1:
        return None
    z = math.atanh(rho)
    se = 1.0 / math.sqrt(n - 3)
    return math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se)


def _betacf(a: float, b: float, x: float) -> float:
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > 1e-300 else 1e-300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > 1e-300 else 1e-300
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 3e-14:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    if x < (a + 1) / (a + b + 2):
        return math.exp(lbeta) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lbeta) * _betacf(b, a, 1 - x) / b


def t_two_sided_p(t: float, df: int) -> float:
    return betainc(df / 2.0, 0.5, df / (df + t * t))


def spearman_p(rho: float, n: int) -> float:
    if abs(rho) >= 1:
        return 0.0
    t = rho * math.sqrt((n - 2) / (1 - rho * rho))
    return t_two_sided_p(t, n - 2)


def bh_adjust(pvalues: list[float]) -> list[float]:
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 1.0
    for rank_from_end, i in enumerate(reversed(order)):
        k = m - rank_from_end
        running = min(running, pvalues[i] * m / k)
        adjusted[i] = min(running, 1.0)
    return adjusted


def strength(rho: float) -> str:
    a = abs(rho)
    return "very weak" if a < 0.2 else "weak" if a < 0.4 else "moderate" if a < 0.6 else "strong" if a < 0.8 else "very strong"


def quantile(values: list[float], q: float) -> float | None:
    v = sorted(values)
    if not v:
        return None
    pos = (len(v) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def median(values: list[float]) -> float | None:
    return quantile(values, 0.5)


def test_family(xs_by_id: dict[str, float | None], ys: dict[str, dict[str, float | None]], labels: dict[str, str]) -> list[dict]:
    """One x measure against several y measures over the same ids; returns tests with rho, ci, p (BH applied by caller)."""
    out = []
    ids = sorted(xs_by_id)
    for key, ymap in ys.items():
        x = [xs_by_id[i] for i in ids]
        y = [ymap.get(i) for i in ids]
        rho, n = spearman(x, y)
        if rho is None or n < MIN_N:
            out.append({"y": key, "label": labels.get(key, key), "rho": None, "n": n})
            continue
        ci = fisher_ci(rho, n)
        out.append({"y": key, "label": labels.get(key, key), "rho": rho, "n": n, "ci": list(ci) if ci else None, "p": spearman_p(rho, n)})
    return out


def apply_bh(tests: list[dict]) -> None:
    run = [t for t in tests if t.get("rho") is not None]
    adj = bh_adjust([t["p"] for t in run])
    for t, a in zip(run, adj):
        t["p_bh"] = a
        t["holds"] = a < ALPHA
    for t in tests:
        t.setdefault("holds", False)
        t.setdefault("p_bh", None)
