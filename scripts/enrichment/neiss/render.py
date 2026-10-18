"""Pure helpers for the NEISS builder: figures that obey CPSC's reliability rule, shares, labels and number formatting (no I/O)."""
import math

import neiss_lib as L

NOT_RECORDED = L.NOT_RECORDED
UNSTABLE = "Unstable (not shown)"
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


# ----------------------------------------------------------------------------------------------------------------------
# figures

def figure(est, cases, var):
    """One published figure: estimate, CV and CPSC 95% interval, or - when CPSC's rule calls it unstable - no estimate at all.

    est: sum of weights; cases: unweighted sample cases; var: design variance of the total (None when not computable).
    Unstable estimates (estimate < 1,200, cases < 20 or CV > 33%) keep only `cases` and the reasons, as CPSC's online query does.
    """
    cv = L.cv_of(est, var)
    ok, reasons = L.reliability(est, cases, cv)
    if not ok:
        return {"estimate": None, "cv": None, "ci95": None, "cases": int(cases or 0), "reliable": False, "reasons": reasons}
    lo, hi = L.ci95(est, cv)
    return {"estimate": int(round(est)), "cv": round(cv, 4), "ci95": [int(round(lo)), int(round(hi))], "cases": int(cases),
            "reliable": True, "reasons": []}


def absent_figure():
    """A domain with no sample case in the period: not 'zero injuries', just not observed."""
    return {"estimate": None, "cv": None, "ci95": None, "cases": 0, "reliable": False, "reasons": ["no sample cases"]}


def share_figure(num_fig, den_fig, num_est, den_est, ratio_var):
    """Share Y/X with the Taylor-linearised variance; reliable only when numerator and denominator estimates are both reliable."""
    if not (num_fig["reliable"] and den_fig["reliable"]) or den_est is None or den_est <= 0 or ratio_var is None:
        return {"share": None, "cv": None, "ci95": None, "reliable": False}
    r = num_est / den_est
    se = math.sqrt(max(ratio_var, 0.0))
    cv = se / r if r > 0 else None
    return {"share": round(r, 5), "cv": None if cv is None else round(cv, 4),
            "ci95": [round(max(0.0, r - L.Z95 * se), 5), round(min(1.0, r + L.Z95 * se), 5)], "reliable": True}


def from_tuple(t):
    """core/pool result tuple -> (total figure, admitted share, hospital+DOA share).

    t = (est, cases, var, est4, cases4, var4, rvar4, est2, cases2, var2, rvar2) as produced by aggregate.Acc.reduce().
    """
    total = figure(t[0], t[1], t[2])
    adm_fig = figure(t[3], t[4], t[5])
    doa_fig = figure(t[7], t[8], t[9])
    return total, share_figure(adm_fig, total, t[3], t[0], t[6]), share_figure(doa_fig, total, t[7], t[0], t[10])


def share_of(part_fig, total_fig):
    """Descriptive share of a total (no interval): part estimate / total estimate when both are shown."""
    if part_fig["estimate"] is None or total_fig["estimate"] in (None, 0):
        return None
    return round(part_fig["estimate"] / total_fig["estimate"], 5)


def change(prev_t, cur_t):
    """Year-over-year change of two annual totals with a conservative sampling-error test.

    The test treats the two years as independent. The same hospitals report in both years, so the true variance of the
    difference is smaller than var_a + var_b and this test is conservative (it flags fewer changes than a paired test would).
    """
    a, b = prev_t, cur_t
    if a is None or b is None or a[0] <= 0:
        return None
    diff = b[0] - a[0]
    se = math.sqrt(max(a[2], 0.0) + max(b[2], 0.0))
    return {"difference": int(round(diff)), "percent": round(diff / a[0], 4), "exceeds_sampling_error": bool(se > 0 and abs(diff) > L.Z95 * se)}


# ----------------------------------------------------------------------------------------------------------------------
# formatting

def num(n):
    return "Not recorded" if n is None else f"{int(round(n)):,}"


def pct(x, digits=1):
    return "Not recorded" if x is None else f"{x * 100:.{digits}f}%"


def fig_text(fig, unit="injuries"):
    """Human text for a figure: estimate with CV and interval, or the instability reason with the unweighted case count."""
    if fig is None:
        return "Not recorded"
    if not fig["reliable"]:
        why = "; ".join(fig["reasons"]) or "unstable"
        return f"{UNSTABLE}: {why}; {fig['cases']:,} sample cases (unweighted, not a national estimate)"
    lo, hi = fig["ci95"]
    return f"{fig['estimate']:,} {unit} (CV {pct(fig['cv'])}; 95% CI {lo:,} to {hi:,}; {fig['cases']:,} sample cases)"


def share_text(sh):
    if sh is None or not sh["reliable"]:
        return UNSTABLE
    lo, hi = sh["ci95"]
    return f"{pct(sh['share'])} (CV {pct(sh['cv'])}; 95% CI {pct(lo)} to {pct(hi)})"


def cell_estimate(fig):
    return UNSTABLE if (fig is None or fig["estimate"] is None) else fig["estimate"]


def cell_cv(fig):
    return UNSTABLE if (fig is None or fig["cv"] is None) else round(fig["cv"] * 100, 1)


def ordered(entries):
    """Entries sorted by estimate (largest first); unstable ones last by sample cases then code."""
    return sorted(entries, key=lambda e: (e["estimate"] is None, -(e["estimate"] or 0), -e["cases"], str(e["code"])))


# ----------------------------------------------------------------------------------------------------------------------
# labels

class Labels:
    """Official labels. Anything without a label in the CPSC documents shows as Not recorded with the code kept visible."""

    def __init__(self, dictionary, products):
        self.dictionary = dictionary
        self.products = products

    def coded(self, variable, code):
        if code is None or code == -1:
            return NOT_RECORDED
        label = self.dictionary.get(variable, {}).get(code)
        return label if label else f"{NOT_RECORDED} (code {code} has no label in the CPSC data dictionary)"

    def product(self, code):
        """(label, source, in_use, comparability) for an exact product code, or the Not recorded form."""
        p = self.products.get(code)
        if not p:
            return (f"{NOT_RECORDED} (product code {code} is in no CPSC coding manual or comparability table)", None, None, None)
        return (p["label"], p["source"], p["in_use"], p.get("comparability"))

    def band(self, band):
        return NOT_RECORDED if band == L.BAND_NR else f"{band} years"

    def month(self, m):
        return MONTHS[m - 1] if isinstance(m, int) and 1 <= m <= 12 else NOT_RECORDED


def code_sort_key(code):
    return (1, 0) if code in (None, -1) else (0, code if isinstance(code, int) else 0)
