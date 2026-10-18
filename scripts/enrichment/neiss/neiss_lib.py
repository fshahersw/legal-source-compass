"""NEISS parsing, design-based estimation and CPSC reliability rules (standard library only).

Source files are CPSC's annual public-use NEISS TSVs (neissYYYY.tsv). Every year 1997-2025 in the CPSC archive uses the same
25-column layout (the archive was re-issued in that layout; columns that did not exist before 2019 are blank or 0 in older years).

Estimation (documented in every dataset summary):
  estimate of a domain D      = sum of Weight over cases in D
  cases                       = number of cases in D (unweighted)
  variance (with-replacement ultimate-cluster, stratified single-stage cluster sample; PSU = hospital):
      V = sum over strata h of  n_h/(n_h-1) * sum_j (t_hj - tbar_h)^2
      t_hj = sum of Weight over cases of D in PSU j of stratum h (0 when the hospital has no case in D)
      n_h  = number of PSUs of stratum h that report any case in the year
  CV = sqrt(V)/estimate;  95% CI = estimate +/- 1.96 * estimate * CV  (CPSC's formula)
  ratio R = Y/X (e.g. hospitalized share) uses Taylor linearisation: z = y - R*x per PSU, V(R) = V(z)/X^2
CPSC's unstable rule: unstable if estimate < 1,200, or cases < 20, or CV > 33%.
"""
import collections
import gzip
import io
import math
import re

NOT_RECORDED = "Not recorded"
STRATA = ("S", "M", "L", "V", "C")
N_COLS = 25
UNSTABLE_MIN_ESTIMATE = 1200
UNSTABLE_MIN_CASES = 20
UNSTABLE_MAX_CV = 0.33
Z95 = 1.96

CANON = ["case", "date", "age", "sex", "race", "other_race", "hispanic", "body", "diag", "other_diag", "body2", "diag2",
         "other_diag2", "disp", "loc", "fire", "p1", "p2", "p3", "alcohol", "drug", "narrative", "stratum", "psu", "weight"]
# header spellings seen in the archive -> canonical column name
HEADER_ALIASES = {
    "cpsc_case_number": "case", "treatment_date": "date", "age": "age", "sex": "sex", "race": "race", "other_race": "other_race",
    "hispanic": "hispanic", "hispanic_origin": "hispanic", "body_part": "body", "diagnosis": "diag", "other_diagnosis": "other_diag",
    "body_part_2": "body2", "diagnosis_2": "diag2", "other_diagnosis_2": "other_diag2", "disposition": "disp", "location": "loc",
    "fire_involvement": "fire", "product_1": "p1", "product_2": "p2", "product_3": "p3", "alcohol": "alcohol",
    "alcohol_involved": "alcohol", "drug": "drug", "drug_involved": "drug", "narrative": "narrative", "narrative_1": "narrative",
    "stratum": "stratum", "psu": "psu", "weight": "weight",
}


def norm_header(name):
    return re.sub(r"[\s]+", "_", name.strip().strip('"').strip()).lower()


# ----------------------------------------------------------------------------------------------------------------------
# age bands

COARSE_BANDS = ("0-4", "5-14", "15-24", "25-44", "45-64", "65+")
FINE_BANDS = ("<1", "1", "2", "3", "4", "5-9", "10-14", "15-19", "20-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85+")
BAND_NR = NOT_RECORDED


def age_years(code):
    """Age in whole years from the NEISS Age code, or None when not recorded/invalid.

    0 = not recorded; 2..120 = age in years; 201..223 = 1..23 months (so 201..211 are under one year and 212..223 are age 1).
    Code 1 is not a valid years code in the data dictionary; it and anything outside the documented ranges are None.
    """
    if code is None:
        return None
    if 201 <= code <= 223:
        return 0 if code <= 211 else 1
    if 2 <= code <= 120:
        return code
    return None


def coarse_band(code):
    a = age_years(code)
    if a is None:
        return BAND_NR
    if a <= 4:
        return "0-4"
    if a <= 14:
        return "5-14"
    if a <= 24:
        return "15-24"
    if a <= 44:
        return "25-44"
    if a <= 64:
        return "45-64"
    return "65+"


def fine_band(code):
    a = age_years(code)
    if a is None:
        return BAND_NR
    if a == 0:
        return "<1"
    if a <= 4:
        return str(a)
    for lo, hi, name in ((5, 9, "5-9"), (10, 14, "10-14"), (15, 19, "15-19"), (20, 24, "20-24"), (25, 34, "25-34"),
                         (35, 44, "35-44"), (45, 54, "45-54"), (55, 64, "55-64"), (65, 74, "65-74"), (75, 84, "75-84")):
        if lo <= a <= hi:
            return name
    return "85+"


# ----------------------------------------------------------------------------------------------------------------------
# reliability rule and interval

def reliability(est, cases, cv):
    """CPSC rule: unstable if estimate < 1,200, or cases < 20, or CV > 33%. Returns (reliable, [reasons])."""
    reasons = []
    if est is None or est < UNSTABLE_MIN_ESTIMATE:
        reasons.append("estimate below 1,200")
    if cases is None or cases < UNSTABLE_MIN_CASES:
        reasons.append("fewer than 20 cases")
    if cv is None or cv > UNSTABLE_MAX_CV:
        reasons.append("CV above 33%")
    return (not reasons), reasons


def ci95(est, cv):
    """CPSC 95% confidence interval: estimate +/- 1.96 * estimate * CV (lower bound floored at 0)."""
    if est is None or cv is None:
        return None
    half = Z95 * est * cv
    return [max(0.0, est - half), est + half]


def cv_of(est, var):
    if est is None or est <= 0 or var is None or var < 0:
        return None
    return math.sqrt(var) / est


# ----------------------------------------------------------------------------------------------------------------------
# variance machinery

class StratumSums:
    """Per-stratum sums of PSU totals for a domain: S1 = sum t, S2 = sum t^2 over PSUs that have cases (others contribute 0)."""
    __slots__ = ("s1", "s2")

    def __init__(self):
        self.s1 = 0.0
        self.s2 = 0.0


def stratum_variance(psu_totals, n_h):
    """Variance contribution of one stratum: n_h/(n_h-1) * sum_j (t_j - tbar)^2 over all n_h PSUs (missing PSUs have t = 0).

    psu_totals: iterable of the t_j of PSUs with cases in the domain. A stratum with a single PSU contributes 0 (cannot be estimated).
    """
    if n_h < 2:
        return 0.0
    ts = list(psu_totals)
    s1 = sum(ts)
    s2 = sum(t * t for t in ts)
    ss = s2 - (s1 * s1) / n_h
    return (n_h / (n_h - 1)) * max(ss, 0.0)


def design_variance(psu_stratum_totals, n_by_stratum):
    """psu_stratum_totals: {stratum: [t_j,...]} for PSUs with cases; n_by_stratum: {stratum: n_h}. Returns variance of the total."""
    return sum(stratum_variance(psu_stratum_totals.get(h, ()), n) for h, n in n_by_stratum.items())


def ratio_variance(x_by_stratum, y_by_stratum, n_by_stratum):
    """Variance of R = sum y / sum x by Taylor linearisation.

    x_by_stratum / y_by_stratum: {stratum: {psu: total}} (y totals may be missing for PSUs with no y). Returns (R, var_R) or (None, None).
    """
    X = sum(sum(d.values()) for d in x_by_stratum.values())
    Y = sum(sum(d.values()) for d in y_by_stratum.values())
    if X <= 0:
        return None, None
    R = Y / X
    var = 0.0
    for h, n_h in n_by_stratum.items():
        if n_h < 2:
            continue
        xs = x_by_stratum.get(h, {})
        ys = y_by_stratum.get(h, {})
        zs = [ys.get(j, 0.0) - R * xs.get(j, 0.0) for j in set(xs) | set(ys)]
        s1 = sum(zs)
        s2 = sum(z * z for z in zs)
        var += (n_h / (n_h - 1)) * max(s2 - s1 * s1 / n_h, 0.0)
    return R, var / (X * X)


# ----------------------------------------------------------------------------------------------------------------------
# TSV reading

class YearStats:
    """Data-quality counters for one file."""

    def __init__(self):
        self.physical_lines = 0
        self.records = 0          # logical records emitted (valid + rejected)
        self.joined_records = 0   # records rebuilt from split physical lines
        self.quote_merged = 0     # records whose tab-bearing quoted field was merged
        self.excess_tab_merged = 0
        self.rejected = collections.Counter()
        self.duplicates = 0
        self.date_year_mismatch = 0

    def as_dict(self):
        return {"physical_lines": self.physical_lines, "records": self.records, "joined_records": self.joined_records,
                "quote_merged": self.quote_merged, "excess_tab_merged": self.excess_tab_merged,
                "rejected": dict(self.rejected), "duplicates": self.duplicates, "date_year_mismatch": self.date_year_mismatch}


def _fix_excess_tabs(fields):
    """More than 25 fields: a quoted pre-narrative field holding a tab (e.g. "SYNCOPE, SEIZURE-LIKE ACTIVITY<TAB>") or a tab in the
    narrative. Returns (fields25 or None, how)."""
    out, i, merged = [], 0, False
    while i < len(fields):
        f = fields[i]
        if len(out) < 21 and f.startswith('"') and not (len(f) > 1 and f.endswith('"')):
            j = i + 1
            buf = f
            while j < len(fields) and not fields[j].endswith('"'):
                buf += "\t" + fields[j]
                j += 1
            if j < len(fields):
                buf += "\t" + fields[j]
                out.append(buf.strip('"'))
                i = j + 1
                merged = True
                continue
        out.append(f)
        i += 1
    if len(out) == N_COLS:
        return out, "quote"
    if len(fields) > N_COLS:
        return fields[:21] + ["\t".join(fields[21:-3])] + fields[-3:], "narrative"
    return None, None


def _int(s):
    s = s.strip()
    if s.isdigit():
        return int(s)
    return None


DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def make_record(fields, header_idx, stats, year):
    """fields: list of strings in file order (25). Returns a dict of parsed values, or None (counted in stats.rejected)."""
    g = lambda name: fields[header_idx[name]] if name in header_idx else ""
    stratum = g("stratum").strip().strip('"')
    psu = _int(g("psu"))
    try:
        weight = float(g("weight"))
    except ValueError:
        weight = None
    case = _int(g("case"))
    m = DATE_RE.match(g("date").strip())
    if stratum not in STRATA:
        stats.rejected["stratum not S/M/L/V/C"] += 1
        return None
    if psu is None:
        stats.rejected["PSU not numeric"] += 1
        return None
    if weight is None or not (weight > 0) or math.isinf(weight):
        stats.rejected["Weight missing or not positive"] += 1
        return None
    if case is None:
        stats.rejected["case number not numeric"] += 1
        return None
    if not m:
        stats.rejected["treatment date not mm/dd/yyyy"] += 1
        return None
    if int(m.group(3)) != year:
        stats.date_year_mismatch += 1
    return {
        "case": case, "month": int(m.group(1)), "year": int(m.group(3)), "age": _int(g("age")), "sex": _int(g("sex")),
        "race": _int(g("race")), "hispanic": _int(g("hispanic")), "body": _int(g("body")), "diag": _int(g("diag")),
        "body2": _int(g("body2")), "diag2": _int(g("diag2")), "disp": _int(g("disp")), "loc": _int(g("loc")),
        "fire": _int(g("fire")), "p1": _int(g("p1")), "p2": _int(g("p2")), "p3": _int(g("p3")), "alcohol": _int(g("alcohol")),
        "drug": _int(g("drug")), "narrative": g("narrative"), "stratum": stratum, "psu": psu, "weight": weight,
    }


def parse_header(line):
    cols = [norm_header(c) for c in line.rstrip("\r\n").split("\t")]
    idx = {}
    for i, c in enumerate(cols):
        canon = HEADER_ALIASES.get(c)
        if canon and canon not in idx:
            idx[canon] = i
    return cols, idx


def iter_records(lines, year, stats=None):
    """Yield parsed records from an iterable of physical lines (record terminator already removed).

    Repairs: (1) a narrative split by a stray record break (a 22-field line followed by blank and/or 4-field lines) is rejoined
    directly (no separator inserted); (2) >25 fields from a quoted tab-bearing field are merged.
    Records without a valid Stratum/PSU/Weight/case/date are rejected and counted, never repaired by guessing.
    """
    stats = stats if stats is not None else YearStats()
    it = iter(lines)
    try:
        header = next(it)
    except StopIteration:
        return
    cols, idx = parse_header(header)
    ncols = len(cols)
    ntab = ncols - 1
    seen = set()
    buf = None
    buf_lines = 0

    def finish(fields, how=None):
        stats.records += 1
        rec = make_record(fields, idx, stats, year)
        if rec is None:
            return None
        if rec["case"] in seen:
            stats.duplicates += 1
        seen.add(rec["case"])
        return rec

    for line in it:
        stats.physical_lines += 1
        if buf is None and line == "":
            continue
        if buf is not None:
            t = buf.count("\t")
            if line.count("\t") == ntab and t < ntab:
                # the pending piece never completed and a full record follows: reject the fragment, do not guess
                stats.records += 1
                stats.rejected["incomplete record fragment"] += 1
                buf = None
            else:
                buf += line
                buf_lines += 1
                t = buf.count("\t")
                if t == ntab:
                    stats.joined_records += 1
                    rec = finish(buf.split("\t"))
                    buf = None
                    if rec is not None:
                        yield rec
                elif t > ntab or buf_lines > 80:
                    stats.records += 1
                    stats.rejected["unrepairable split record"] += 1
                    buf = None
                continue
        t = line.count("\t")
        if t == ntab:
            rec = finish(line.split("\t"))
            if rec is not None:
                yield rec
        elif t < ntab:
            buf = line
            buf_lines = 0
        else:
            fields, how = _fix_excess_tabs(line.split("\t"))
            if fields is None or len(fields) != ncols:
                stats.records += 1
                stats.rejected["unrepairable extra tabs"] += 1
                continue
            if how == "quote":
                stats.quote_merged += 1
            else:
                stats.excess_tab_merged += 1
            rec = finish(fields)
            if rec is not None:
                yield rec
    if buf is not None:
        stats.records += 1
        stats.rejected["incomplete record fragment"] += 1


def open_lines(path):
    """Physical lines of a (gzip) TSV; the record terminator is CRLF, bare LF inside a narrative stays in the record."""
    raw = gzip.open(path, "rb") if path.endswith(".gz") else open(path, "rb")
    text = io.TextIOWrapper(raw, encoding="cp1252", errors="replace", newline="\r\n")
    for line in text:
        yield line[:-2] if line.endswith("\r\n") else line.rstrip("\n")
    text.close()


def read_year(path, year):
    """Return (generator of records, stats). Iterate fully before reading stats."""
    stats = YearStats()
    return iter_records(open_lines(path), year, stats), stats
