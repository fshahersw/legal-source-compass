"""Pure helpers for the CFPB complaint builders: key parsing, marginals, growth, shares, rates, rankings, name matching.

Every function is deterministic and side-effect free so the unittest suite can exercise it with synthetic fixtures.
"""
import calendar
import collections
import csv
import math

SEP = "\x1f"
NOT_RECORDED = "Not recorded"

# Company-response values the CFPB records. "Closed with relief" / "Closed without relief" / "Closed" are older values.
RELIEF_RESPONSES = ("Closed with monetary relief", "Closed with non-monetary relief", "Closed with relief")
OPEN_RESPONSES = ("In progress",)


def label(value):
    """Blank recorded values are shown as 'Not recorded' (never guessed)."""
    return value if value != "" else NOT_RECORDED


def split(key):
    return tuple(key.split(SEP))


def marginal(counter, project):
    """Sum counts of a {joined_key: n} map onto project(parts) -> new key; a None projection drops the entry."""
    out = collections.Counter()
    for key, n in counter.items():
        new = project(split(key))
        if new is not None:
            out[new] += n
    return out


def pct(part, whole, digits=2):
    """part/whole*100 rounded, or None when the denominator is zero/None.

    Rounding never hides a remainder: a value below 100% is never shown as 100 and a non-zero value is never shown as 0
    (extra decimals are added, up to 8, until the rounded value differs from the bound).
    """
    if not whole:
        return None
    exact = 100.0 * part / whole
    value = round(exact, digits)
    places = digits
    while places < 8 and ((part < whole and value >= 100.0) or (part > 0 and value <= 0.0)):
        places += 1
        value = round(exact, places)
    return value


def fmt_pct(x, digits=2):
    """Display a percentage with `digits` decimals, adding decimals when that would round a non-zero remainder to 0 or 100."""
    if x is None:
        return NOT_RECORDED
    text = f"{x:.{digits}f}"
    if 0 < x < 100 and float(text) in (0.0, 100.0):
        for places in range(digits + 1, 10):
            text = f"{x:.{places}f}"
            if float(text) not in (0.0, 100.0):
                break
    return text + "%"


def growth_pct(current, previous, digits=2):
    """Year-over-year (or period-over-period) change: (current - previous) / previous * 100; None if previous is 0/None."""
    if previous in (None, 0) or current is None:
        return None
    return round(100.0 * (current - previous) / previous, digits)


def cagr_pct(end, start, years, digits=2):
    """Compound annual growth rate: ((end / start) ** (1 / years) - 1) * 100; None when undefined."""
    if not start or end is None or years <= 0 or end < 0:
        return None
    return round(100.0 * ((end / start) ** (1.0 / years) - 1.0), digits)


def per_100k(count, population, digits=2):
    if not population or count is None:
        return None
    return round(count * 100000.0 / population, digits)


def shares(counts):
    """{name: n} -> {name: share pct of the total} (2 decimals)."""
    total = sum(counts.values())
    return {k: pct(v, total) for k, v in counts.items()}


def share_shift(counts_a, counts_b):
    """Share shift in percentage points between two periods for every name in either: share_b - share_a (4 decimals).

    Returns a list of {name, n_a, n_b, share_a, share_b, shift_pp} sorted by absolute shift, then name.
    """
    total_a, total_b = sum(counts_a.values()), sum(counts_b.values())
    rows = []
    for name in set(counts_a) | set(counts_b):
        a, b = counts_a.get(name, 0), counts_b.get(name, 0)
        sa = 100.0 * a / total_a if total_a else None
        sb = 100.0 * b / total_b if total_b else None
        shift = round(sb - sa, 4) if (sa is not None and sb is not None) else None
        rows.append({"name": name, "n_a": a, "n_b": b, "share_a": None if sa is None else round(sa, 4),
                     "share_b": None if sb is None else round(sb, 4), "shift_pp": shift})
    rows.sort(key=lambda r: (-(abs(r["shift_pp"]) if r["shift_pp"] is not None else -1), r["name"]))
    return rows


def hhi(counts):
    """Herfindahl-Hirschman index on 0-10,000 scale: sum over entities of (share pct)^2."""
    total = sum(counts.values())
    if not total:
        return None
    return round(sum((100.0 * n / total) ** 2 for n in counts.values()), 1)


def rank(items, key, reverse=True, tiebreak=None):
    """Dense 1..n ranking positions (ties broken by tiebreak, then input order); items with key None are unranked."""
    ranked = [it for it in items if key(it) is not None]
    ranked.sort(key=lambda it: ((-key(it) if reverse else key(it)),) + (tiebreak(it) if tiebreak else ()))
    return {id(it): pos for pos, it in enumerate(ranked, 1)}


def response_rates(responses):
    """Rates from a {company response: n} map.

    closed (stored key; read it as "responded complaints") = all recorded responses except 'In progress' and blank, so it
        also counts 'Closed', 'Closed without relief' and 'Untimely response'
    relief_rate = (monetary + non-monetary + 'Closed with relief') / closed * 100
    monetary_relief_rate = monetary / closed * 100
    explanation_rate = 'Closed with explanation' / closed * 100
    untimely_response_share = 'Untimely response' / all responses * 100 (all = every complaint, blanks included)
    """
    total = sum(responses.values())
    closed = sum(n for r, n in responses.items() if r not in OPEN_RESPONSES and r != "")
    relief = sum(responses.get(r, 0) for r in RELIEF_RESPONSES)
    return {
        "complaints": total,
        "closed": closed,
        "in_progress": responses.get("In progress", 0),
        "relief_rate": pct(relief, closed),
        "monetary_relief_rate": pct(responses.get("Closed with monetary relief", 0), closed),
        "non_monetary_relief_rate": pct(responses.get("Closed with non-monetary relief", 0), closed),
        "explanation_rate": pct(responses.get("Closed with explanation", 0), closed),
        "untimely_response_share": pct(responses.get("Untimely response", 0), total),
    }


def timely_rate(timely):
    """Timely response rate = Yes / (Yes + No) * 100; blanks are excluded and reported separately.

    `timely` is one {"Yes": n, "No": n, "": n} map for the whole period; map several periods into it with sum_counters first
    (a dict comprehension over periods would overwrite instead of adding).
    """
    yes, no = timely.get("Yes", 0), timely.get("No", 0)
    return {"yes": yes, "no": no, "not_recorded": timely.get("", 0), "rate": pct(yes, yes + no)}


def timely_exact(rate):
    """Unrounded Yes / (Yes + No) from a timely_rate() result, the key rankings sort on (None when there is no Yes/No)."""
    total = rate["yes"] + rate["no"]
    return rate["yes"] / total if total else None


def sum_counters(counters):
    """Add several {key: n} maps key by key into one Counter."""
    out = collections.Counter()
    for counter in counters:
        out.update(counter)
    return out


def month_range(start_day, end_day):
    """Calendar months ('YYYY-MM') lying entirely inside the inclusive ISO day range [start_day, end_day]."""
    y, m, d = (int(x) for x in start_day.split("-"))
    if d != 1:
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    ey, em, ed = (int(x) for x in end_day.split("-"))
    if ed != calendar.monthrange(ey, em)[1]:
        ey, em = (ey - 1, 12) if em == 1 else (ey, em - 1)
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def year_months_recorded(months, year):
    """How many of the 12 months of `year` appear in `months` (a mapping/set of 'YYYY-MM')."""
    return sum(1 for m in range(1, 13) if f"{year}-{m:02d}" in months)


def month_runs(months, max_gap=12):
    """Runs of months with complaints as [(first, last)]; a stretch of more than `max_gap` empty months starts a new run."""
    index = sorted(int(m[:4]) * 12 + int(m[5:7]) - 1 for m in months)
    if not index:
        return []
    runs, start, prev = [], index[0], index[0]
    for i in index[1:]:
        if i - prev - 1 > max_gap:
            runs.append((start, prev))
            start = i
        prev = i
    runs.append((start, prev))
    return [(f"{a // 12:04d}-{a % 12 + 1:02d}", f"{b // 12:04d}-{b % 12 + 1:02d}") for a, b in runs]


def is_credit_reporting(product):
    """Rule for the 'excluding credit reporting' series: recorded product name starts with 'Credit reporting'."""
    return product.startswith("Credit reporting")


def normalize_name(name):
    """Documented, deterministic normalisation for exact name matching: case-fold and collapse whitespace only."""
    return " ".join(name.split()).casefold()


def build_name_index(rows):
    """rows: [{id, title}] -> {normalized title: sorted list of ids}."""
    index = collections.defaultdict(set)
    for row in rows:
        if row.get("title"):
            index[normalize_name(row["title"])].add(row["id"])
    return {k: sorted(v) for k, v in index.items()}


def match_name(name, index):
    """Return (status, id): ('matched', id) on a unique exact normalized match, ('ambiguous', None) when the
    normalized name maps to several ids, ('unmatched', None) otherwise."""
    ids = index.get(normalize_name(name), [])
    if len(ids) == 1:
        return "matched", ids[0]
    if len(ids) > 1:
        return "ambiguous", None
    return "unmatched", None


def slugify(text, limit=80):
    out, dash = [], False
    for ch in text.casefold():
        if ch.isascii() and ch.isalnum():
            out.append(ch)
            dash = False
        elif not dash:
            out.append("-")
            dash = True
    return "".join(out).strip("-")[:limit].strip("-") or "x"


def census_population(path, years, fips_to_usps):
    """Read a Census NST-EST*-ALLDATA.csv: {usps: {year: POPESTIMATE<year>}} for SUMLEV 040 rows of known FIPS."""
    with open(path, newline="", encoding="latin-1") as handle:
        return census_population_rows(csv.DictReader(handle), years, fips_to_usps)


def census_population_rows(rows, years, fips_to_usps):
    """Same as census_population for already-parsed csv.DictReader rows (state rows only: SUMLEV 040)."""
    out = collections.defaultdict(dict)
    for row in rows:
        if row["SUMLEV"] != "040":
            continue
        usps = fips_to_usps.get(row["STATE"].zfill(2))
        if not usps:
            continue
        for year in years:
            value = row.get(f"POPESTIMATE{year}")
            if value not in (None, ""):
                out[usps][year] = int(value)
    return dict(out)


def year_complete(year, min_day, max_day):
    """A calendar year counts as complete only when the data covers Jan 1 through Dec 31 of it."""
    return min_day <= f"{year}-01-01" and max_day >= f"{year}-12-31"


def sum_days(day_counts, start, end):
    """Sum daily counts with start <= day <= end (ISO strings)."""
    return sum(n for d, n in day_counts.items() if start <= d <= end)


def is_finite(x):
    return x is not None and not (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))
