"""Single-pass NEISS aggregation with design-based variance (stdlib only).

Two kinds of pass over the annual TSVs (private/acq/neiss/tsv/neissYYYY.tsv.gz):
  * year pass   one year at a time (annual series): hospitals (stratum, PSU) are the clusters of that year
  * pooled pass several consecutive years together: a hospital (stratum, PSU) is ONE cluster across the pooled years, so the
                between-year correlation of the same hospital is kept (45 of 113 hospitals in 2021-2025 appear in all five years;
                treating the years as independent would roughly halve the CV)
Every domain (a tuple key such as ("prod", 1233) or ("psex", 1233, 1)) accumulates, per hospital: sum of Weight, cases, and the
weights of cases whose disposition is 4 (admitted) and in {2, 4, 5, 8} (CPSC "Hosp. & DOA" grouping). reduce() turns those into
estimate, cases and with-replacement ultimate-cluster variances, plus Taylor-linearised ratio variances for the two shares.
"""
import collections
import gzip
import os
import pickle
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import neiss_lib as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TSV_DIR = os.path.join(ROOT, "private", "acq", "neiss", "tsv")
CACHE_DIR = os.path.join(ROOT, "private", "build", "neiss", "cache")
AGG_VERSION = "1"

HOSP_ADMITTED = frozenset({4})
HOSP_DOA = frozenset({2, 4, 5, 8})   # CPSC Highlights "Hosp. & DOA": transferred, admitted, held for observation, fatality incl. DOA
PAIR_BITS = 10


def tsv_path(year):
    return os.path.join(TSV_DIR, f"neiss{year}.tsv.gz")


def nz(v):
    """Code for a possibly blank field: -1 stands for a blank value."""
    return -1 if v is None else v


class Acc:
    """Per-(domain, hospital) sums. Entry = [w, n, w4, n4, w2, n2] (weights and cases overall / disposition 4 / dispositions 2,4,5,8)."""

    def __init__(self):
        self.ids = {}
        self.keys = []
        self.e = {}
        self.pairs = {}
        self.pair_stratum = []

    def pair(self, stratum, psu):
        key = (stratum, psu)
        i = self.pairs.get(key)
        if i is None:
            i = len(self.pairs)
            if i >= (1 << PAIR_BITS):
                raise ValueError("too many hospitals for the pair index")
            self.pairs[key] = i
            self.pair_stratum.append(stratum)
        return i

    def add_all(self, keys, pair, w, disp):
        a4 = 1 if disp == 4 else 0
        a2 = 1 if disp in HOSP_DOA else 0
        ids, e, ks = self.ids, self.e, self.keys
        for key in keys:
            did = ids.get(key)
            if did is None:
                did = len(ks)
                ids[key] = did
                ks.append(key)
            k = (did << PAIR_BITS) | pair
            ent = e.get(k)
            if ent is None:
                e[k] = [w, 1, w if a4 else 0.0, a4, w if a2 else 0.0, a2]
            else:
                ent[0] += w
                ent[1] += 1
                if a4:
                    ent[2] += w
                    ent[3] += 1
                if a2:
                    ent[4] += w
                    ent[5] += 1

    def n_by_stratum(self):
        c = collections.Counter(self.pair_stratum)
        return {h: c[h] for h in L.STRATA}

    def reduce(self):
        """Return {key: (est, cases, var, est4, cases4, var4, rvar4, est2, cases2, var2, rvar2, cov4, cov2)} for every domain.

        est/est4/est2 = sum of weights of all / admitted (disposition 4) / hospital-or-DOA (2,4,5,8) cases; var* = design variance of
        those totals; rvar4/rvar2 = Taylor variance of the shares est4/est and est2/est; cov4/cov2 = design covariance of (x, y4) and
        (x, y2), kept so that several sample-design periods can be combined later (see pooling.combine).
        """
        n_h = self.n_by_stratum()
        mask = (1 << PAIR_BITS) - 1
        # per (domain, stratum) sums: x, y4, y2 first and second moments and cross products
        sums = {}
        tot = {}
        for k, ent in self.e.items():
            did, p = k >> PAIR_BITS, k & mask
            h = self.pair_stratum[p]
            x, y4, y2 = ent[0], ent[2], ent[4]
            s = sums.get((did, h))
            if s is None:
                s = sums[(did, h)] = [0.0] * 8
            s[0] += x
            s[1] += x * x
            s[2] += y4
            s[3] += y4 * y4
            s[4] += y2
            s[5] += y2 * y2
            s[6] += x * y4
            s[7] += x * y2
            t = tot.get(did)
            if t is None:
                t = tot[did] = [0.0, 0, 0.0, 0, 0.0, 0]
            t[0] += x
            t[1] += ent[1]
            t[2] += y4
            t[3] += ent[3]
            t[4] += y2
            t[5] += ent[5]
        var = {}
        for (did, h), s in sums.items():
            n = n_h.get(h, 0)
            if n < 2:
                continue
            f = n / (n - 1)
            v = var.get(did)
            if v is None:
                v = var[did] = [0.0] * 7
            # variance pieces of the totals (x, y4, y2) and the ratio pieces are finished after R is known: keep centred sums
            v[0] += f * max(s[1] - s[0] * s[0] / n, 0.0)          # var x
            v[1] += f * max(s[3] - s[2] * s[2] / n, 0.0)          # var y4
            v[2] += f * max(s[5] - s[4] * s[4] / n, 0.0)          # var y2
            v[3] += f * (s[6] - s[0] * s[2] / n)                   # cov x,y4
            v[4] += f * (s[7] - s[0] * s[4] / n)                   # cov x,y2
        out = {}
        for did, t in tot.items():
            x, y4, y2 = t[0], t[2], t[4]
            v = var.get(did, [0.0] * 7)
            r4 = y4 / x if x > 0 else 0.0
            r2 = y2 / x if x > 0 else 0.0
            rv4 = (v[1] - 2 * r4 * v[3] + r4 * r4 * v[0]) / (x * x) if x > 0 else None
            rv2 = (v[2] - 2 * r2 * v[4] + r2 * r2 * v[0]) / (x * x) if x > 0 else None
            out[self.keys[did]] = (x, t[1], v[0], y4, t[3], v[1], max(rv4, 0.0) if rv4 is not None else None,
                                   y2, t[5], v[2], max(rv2, 0.0) if rv2 is not None else None, v[3], v[4])
        return out


# ----------------------------------------------------------------------------------------------------------------------
# domain keys

def common_keys(r):
    band = L.coarse_band(r["age"])
    sex, disp, loc, body, diag = nz(r["sex"]), nz(r["disp"]), nz(r["loc"]), nz(r["body"]), nz(r["diag"])
    return band, sex, disp, loc, body, diag


def year_keys(r):
    """Domains of the annual series."""
    band, sex, disp, loc, body, diag = common_keys(r)
    keys = [("nat",), ("sex", sex), ("age", band), ("agef", L.fine_band(r["age"])), ("sexage", sex, band), ("disp", disp), ("loc", loc),
            ("body", body), ("diag", diag), ("fire", nz(r["fire"])), ("alc", nz(r["alcohol"])), ("drug", nz(r["drug"])),
            ("race", nz(r["race"])), ("hisp", nz(r["hispanic"])), ("month", r["month"]), ("pat", band, body, diag)]
    if r["body2"] is not None:
        keys.append(("body2", r["body2"]))
    if r["diag2"] is not None:
        keys.append(("diag2", r["diag2"]))
    prods = {c for c in (r["p1"], r["p2"], r["p3"]) if c}
    for c in prods:
        keys.append(("prod", c))
    if r["p1"]:
        keys.append(("prod1", r["p1"]))
    return keys


def pool_keys(r):
    """Domains of the pooled latest-years profiles."""
    band, sex, disp, loc, body, diag = common_keys(r)
    keys = [("nat",), ("sex", sex), ("age", band), ("agef", L.fine_band(r["age"])), ("disp", disp), ("loc", loc), ("body", body),
            ("diag", diag), ("pat", band, body, diag), ("month", r["month"])]
    prods = {c for c in (r["p1"], r["p2"], r["p3"]) if c}
    month = r["month"]
    fire = nz(r["fire"])
    for c in prods:
        keys += [("prod", c), ("psex", c, sex), ("page", c, band), ("pbody", c, body), ("pdiag", c, diag), ("pdisp", c, disp),
                 ("ploc", c, loc), ("pmonth", c, month), ("pfire", c, fire)]
    return keys


def theme_year_keys_factory(themes):
    def fn(r):
        hits = themes.match(r["narrative"], r["p1"], r["p2"], r["p3"])
        return [("th", t) for t in hits]
    return fn


def theme_pool_keys_factory(themes):
    def fn(r):
        hits = themes.match(r["narrative"], r["p1"], r["p2"], r["p3"])
        if not hits:
            return ()
        band, sex, disp, loc, body, diag = common_keys(r)
        keys = []
        for t in hits:
            keys += [("th", t), ("thsex", t, sex), ("thage", t, band), ("thdisp", t, disp), ("thloc", t, loc), ("thbody", t, body),
                     ("thdiag", t, diag), ("thmonth", t, r["month"])]
        return keys
    return fn


# ----------------------------------------------------------------------------------------------------------------------
# passes

class Meta:
    """Per-file data-quality and format facts."""

    def __init__(self):
        self.rows = 0
        self.weight = 0.0
        self.nonblank = collections.Counter()
        self.nonzero = collections.Counter()
        self.narr_len_sum = 0
        self.narr_len_max = 0
        self.narr_empty = 0
        self.age_invalid = 0
        self.age_not_recorded = 0

    def add(self, r):
        self.rows += 1
        self.weight += r["weight"]
        for f in ("race", "hispanic", "body2", "diag2", "alcohol", "drug", "p2", "p3", "fire", "loc", "sex", "age"):
            v = r[f]
            if v is not None:
                self.nonblank[f] += 1
                if v != 0:
                    self.nonzero[f] += 1
        n = len(r["narrative"])
        self.narr_len_sum += n
        if n > self.narr_len_max:
            self.narr_len_max = n
        if n == 0:
            self.narr_empty += 1
        a = r["age"]
        if a in (None, 0):
            self.age_not_recorded += 1
        elif L.age_years(a) is None:
            self.age_invalid += 1

    def as_dict(self):
        return {"rows": self.rows, "weight_sum": self.weight, "nonblank": dict(self.nonblank), "nonzero": dict(self.nonzero),
                "narrative_mean_len": (self.narr_len_sum / self.rows if self.rows else None), "narrative_max_len": self.narr_len_max,
                "narrative_empty": self.narr_empty, "age_not_recorded": self.age_not_recorded, "age_invalid": self.age_invalid}


def run_pass(years, keyfn, collect_meta=False):
    """Read the given years (records of all years feed one accumulator) and return (reduced results, info)."""
    acc = Acc()
    info = {"years": list(years), "files": {}, "year_pairs": {}}
    for y in years:
        recs, stats = L.read_year(tsv_path(y), y)
        meta = Meta() if collect_meta else None
        seen = set()
        for r in recs:
            pair = acc.pair(r["stratum"], r["psu"])
            seen.add((r["stratum"], r["psu"]))
            if meta is not None:
                meta.add(r)
            acc.add_all(keyfn(r), pair, r["weight"], r["disp"])
        info["files"][y] = {"stats": stats.as_dict(), "meta": meta.as_dict() if meta else None}
        info["year_pairs"][y] = sorted(seen)
    n_h = acc.n_by_stratum()
    info["n_h"] = n_h
    info["hospitals"] = len(acc.pairs)
    info["lonely_strata"] = [h for h, n in n_h.items() if n < 2]
    info["entries"] = len(acc.e)
    strata_of = {}
    for h, p in acc.pairs:
        strata_of.setdefault(p, set()).add(h)
    # a hospital identifier seen in two strata inside one pass would be split into two clusters; the pooled design segments avoid this
    info["psu_multi_stratum"] = {p: sorted(hs) for p, hs in strata_of.items() if len(hs) > 1}
    return acc.reduce(), info


def cache_path(kind, years, tag=""):
    ys = f"{years[0]}-{years[-1]}" if len(years) > 1 else str(years[0])
    return os.path.join(CACHE_DIR, f"{kind}_{ys}{tag}_v{AGG_VERSION}.pkl.gz")


def save_cache(path, obj):
    import safeio
    import io
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=3, mtime=0) as gz:
        pickle.dump(obj, gz, protocol=4)
    safeio.write_bytes(path, buf.getvalue())


def load_cache(path):
    with gzip.open(path, "rb") as fh:
        return pickle.load(fh)
