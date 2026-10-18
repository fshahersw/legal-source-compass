"""Independent spot check of displayed NEISS figures against the raw annual files.

Shares NO estimation code with the builder: this script has its own raw-file parser, accumulator, variance, share and pooling routines
(only the theme regular expressions and the CPSC Highlights PDF text parser are imported, because those are definitions / input parsing).
It reads the published build files (private/build/neiss/<dataset>.json), recomputes each chosen displayed figure from
private/acq/neiss/tsv/neissYYYY.tsv.gz and reports match / explained / MISMATCH.

  python3 -I -B scripts/enrichment/neiss/spot_check_neiss.py          writes private/build/neiss/spot_check_results.json

Rules: counts must be equal; estimates equal after rounding to an integer; CV within 0.00006 of the displayed 4-decimal value; a share
within 0.00006. "explained" is used only for a displayed value that is withheld as unstable when the recomputed value breaks CPSC's rule
(estimate < 1,200 or cases < 20 or CV > 33%) and for the CPSC-benchmark section (published tables vs the archive files).
"""
import collections
import gzip
import json
import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import highlights as H  # noqa: E402  (parses CPSC's published PDF tables: input parsing only)
import themes as T  # noqa: E402  (theme pattern strings only)

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "neiss")
TSV = os.path.join(ROOT, "private", "acq", "neiss", "tsv")
DOCS = os.path.join(ROOT, "private", "acq", "neiss", "docs")
YEARS_READ = [1997, 2013, 2019, 2021, 2022, 2023, 2024, 2025]
SEG_A, SEG_B = (2021, 2022, 2023), (2024, 2025)
STRATA = "SMLVC"


# ----------------------------------------------------------------------------------------------------------------------
# raw reading (own implementation)

def parse_file(year):
    """Yield tuples (month, age, sex, body, diag, disp, loc, p1, p2, p3, narrative, stratum, psu, weight) for valid records."""
    text = gzip.open(os.path.join(TSV, f"neiss{year}.tsv.gz"), "rb").read().decode("cp1252", errors="replace")
    lines = text.split("\r\n")
    pending = None
    out = []
    dropped = 0

    def emit(f):
        nonlocal dropped
        try:
            stratum = f[22].strip().strip('"')
            psu = int(f[23].strip())
            weight = float(f[24])
            m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", f[1].strip())
            int(f[0].strip())
        except (ValueError, IndexError):
            dropped += 1
            return
        if stratum not in STRATA or not weight > 0 or m is None:
            dropped += 1
            return

        def num(s):
            s = s.strip()
            return int(s) if s.isdigit() else None
        out.append((int(m.group(1)), num(f[2]), num(f[3]), num(f[7]), num(f[8]), num(f[13]), num(f[14]), num(f[16]), num(f[17]), num(f[18]),
                    f[21], stratum, psu, weight))

    for ln in lines[1:]:
        if pending is not None:
            pending += ln
            f = pending.split("\t")
            if len(f) == 25:
                emit(f)
                pending = None
            elif len(f) > 25:
                pending = None
                dropped += 1
            continue
        if ln == "":
            continue
        f = ln.split("\t")
        if len(f) == 25:
            emit(f)
        elif len(f) < 25:
            pending = ln
        else:
            merged, i = [], 0
            while i < len(f):
                if len(merged) < 21 and f[i].startswith('"') and not (len(f[i]) > 1 and f[i].endswith('"')):
                    j = i + 1
                    buf = f[i]
                    while j < len(f) and not f[j].endswith('"'):
                        buf += "\t" + f[j]
                        j += 1
                    if j < len(f):
                        merged.append((buf + "\t" + f[j]).strip('"'))
                        i = j + 1
                        continue
                merged.append(f[i])
                i += 1
            if len(merged) == 25:
                emit(merged)
            else:
                emit(f[:21] + ["\t".join(f[21:-3])] + f[-3:])
    return out, dropped


def age_years(a):
    if a is None:
        return None
    if 201 <= a <= 223:
        return 0 if a <= 211 else 1
    if 2 <= a <= 120:
        return a
    return None


def band(a):
    y = age_years(a)
    if y is None:
        return "Not recorded"
    for hi, name in ((4, "0-4"), (14, "5-14"), (24, "15-24"), (44, "25-44"), (64, "45-64")):
        if y <= hi:
            return name
    return "65+"


# ----------------------------------------------------------------------------------------------------------------------
# estimation (own implementation)

class Dom:
    """One domain over one pass: per (stratum, psu) sums of weight, cases, admitted weight and admitted cases."""

    def __init__(self):
        self.x = collections.defaultdict(float)
        self.n = collections.defaultdict(int)
        self.y = collections.defaultdict(float)
        self.ny = collections.defaultdict(int)

    def add(self, key, w, admitted):
        self.x[key] += w
        self.n[key] += 1
        if admitted:
            self.y[key] += w
            self.ny[key] += 1


def n_h(pairs):
    c = collections.Counter(h for h, _ in pairs)
    return {h: c.get(h, 0) for h in STRATA}


def variance(totals, nh):
    by = collections.defaultdict(list)
    for (h, _p), t in totals.items():
        by[h].append(t)
    v = 0.0
    for h, n in nh.items():
        if n < 2:
            continue
        ts = by.get(h, [])
        s1 = sum(ts)
        s2 = sum(t * t for t in ts)
        v += n / (n - 1) * (s2 - s1 * s1 / n)
    return v


def z_variance(dom, r, nh):
    """Variance of sum(y - r x) with the design variance formula."""
    keys = set(dom.x) | set(dom.y)
    z = {k: dom.y.get(k, 0.0) - r * dom.x.get(k, 0.0) for k in keys}
    return variance(z, nh)


def summarize(dom, nh):
    est = sum(dom.x.values())
    cases = sum(dom.n.values())
    var = variance(dom.x, nh)
    cv = math.sqrt(var) / est if est > 0 else None
    return {"est": est, "cases": cases, "var": var, "cv": cv}


def unstable(est, cases, cv):
    return est < 1200 or cases < 20 or cv is None or cv > 0.33


def share(dom, nh):
    x, y = sum(dom.x.values()), sum(dom.y.values())
    r = y / x
    se = math.sqrt(max(z_variance(dom, r, nh), 0.0)) / x
    return r, se


# ----------------------------------------------------------------------------------------------------------------------
# domain definitions: tag -> (years/segment, predicate over a record tuple)
# record tuple: 0 month 1 age 2 sex 3 body 4 diag 5 disp 6 loc 7 p1 8 p2 9 p3 10 narrative 11 stratum 12 psu 13 weight

def has_prod(r, code):
    return r[7] == code or r[8] == code or r[9] == code


def has_any(r, codes):
    return any(c in codes for c in (r[7], r[8], r[9]))


def build_domains():
    d = {}
    for y in (1997, 2013, 2019, 2024, 2025):
        d[("nat", y)] = (y, lambda r: True)
    d[("sex1", 2019)] = (2019, lambda r: r[2] == 1)
    d[("age514", 2013)] = (2013, lambda r: band(r[1]) == "5-14")
    d[("head", 2025)] = (2025, lambda r: r[3] == 75)
    d[("fracture", 2019)] = (2019, lambda r: r[4] == 57)
    d[("treated_released", 2013)] = (2013, lambda r: r[5] == 1)
    d[("home", 2024)] = (2024, lambda r: r[6] == 1)
    for y in (2013, 2019, 2024):
        for code in (1205, 1211, 1233, 1411):
            d[(f"prod{code}", y)] = (y, lambda r, c=code: has_prod(r, c))
    d[("prod5022", 2025)] = (2025, lambda r: has_prod(r, 5022))
    d[("golf_union", 2023)] = (2023, lambda r: has_any(r, {1212, 1213}))
    d[("golf_union", 2024)] = (2024, lambda r: has_any(r, {1212, 1213}))
    for code in (1233, 5022):
        d[(f"prod{code}", "A")] = (SEG_A, lambda r, c=code: has_prod(r, c))
        d[(f"prod{code}", "B")] = (SEG_B, lambda r, c=code: has_prod(r, c))
    d[("head", "A")] = (SEG_A, lambda r: r[3] == 75)
    d[("head", "B")] = (SEG_B, lambda r: r[3] == 75)
    d[("july", "A")] = (SEG_A, lambda r: r[0] == 7)
    d[("july", "B")] = (SEG_B, lambda r: r[0] == 7)
    d[("nat", "A")] = (SEG_A, lambda r: True)
    d[("nat", "B")] = (SEG_B, lambda r: True)
    return d


THEME_CACHE = {}


def theme_match(tid, narrative):
    """Independent implementation of the documented rule: strip phrases, any include pattern, no exclude pattern."""
    d = T.DEFS[tid]
    t = narrative.lower()
    if not any(s in t for s in d["prefilter"]):
        return False
    for s in d["strip"]:
        t = re.sub(s, " ", t)
    return any(re.search(p, t) for p in d["include"]) and not any(re.search(p, t) for p in d["exclude"])


def run_pass(domains):
    """Read each needed year once; returns ({pass key: Dom per tag}, {pass key: pair set})."""
    results = {}
    pairs = {}
    # pass keys: single years and the two segments
    for y in YEARS_READ:
        recs, dropped = parse_file(y)
        print(f"read {y}: {len(recs):,} valid records, {dropped} dropped", flush=True)
        results[("rows", y)] = (len(recs), dropped)
        py = set((r[11], r[12]) for r in recs)
        pairs[y] = py
        for tag, (yrs, pred) in domains.items():
            if isinstance(yrs, int) and yrs == y:
                dom = Dom()
                for r in recs:
                    if pred(r):
                        dom.add((r[11], r[12]), r[13], r[5] == 4)
                results[tag] = dom
            elif isinstance(yrs, tuple) and y in yrs:
                dom = results.setdefault(tag, Dom())
                for r in recs:
                    if pred(r):
                        dom.add((r[11], r[12]), r[13], r[5] == 4)
        # narrative theme domains (e-scooter): per year 2025 and the two design segments
        if y in (2021, 2022, 2023, 2024, 2025):
            keys = []
            if y == 2025:
                keys.append(("theme_escooter", 2025))
            keys.append(("theme_escooter", "A" if y in SEG_A else "B"))
            doms = [results.setdefault(k, Dom()) for k in keys]
            for r in recs:
                if theme_match("escooter", r[10]):
                    for dom in doms:
                        dom.add((r[11], r[12]), r[13], r[5] == 4)
        if y == 2024:
            results["recs2024"] = recs
        # per-year national dom also feeds the segment pair sets
    results["pairs_A"] = set().union(*(pairs[y] for y in SEG_A))
    results["pairs_B"] = set().union(*(pairs[y] for y in SEG_B))
    results["pairs_year"] = pairs
    return results


# ----------------------------------------------------------------------------------------------------------------------
# checks

class Checks:
    def __init__(self):
        self.rows = []

    def add(self, cid, desc, shown, recomputed, kind="exact", tol=0.0, note=""):
        if kind == "unstable":
            ok = recomputed["unstable"] and shown["estimate"] is None and shown["cases"] == recomputed["cases"]
            status = "explained" if ok else "MISMATCH"
        elif kind == "count":
            status = "match" if shown == recomputed else "MISMATCH"
        else:
            status = "match" if abs(shown - recomputed) <= tol else "MISMATCH"
        self.rows.append({"id": cid, "description": desc, "displayed": shown, "recomputed": recomputed, "status": status, "note": note})

    def summary(self):
        c = collections.Counter(r["status"] for r in self.rows)
        return {"figures_checked": len(self.rows), **{k: v for k, v in c.items()}}


def main():
    t0 = time.time()
    rows = {}
    for ds in ("neiss_national_years", "neiss_product_estimates", "neiss_injury_dimensions", "neiss_narrative_themes"):
        with open(os.path.join(BUILD, ds + ".json"), encoding="utf-8") as fh:
            rows[ds] = {r["id"]: r for r in json.load(fh)["rows"]}
    domains = build_domains()
    res = run_pass(domains)
    ck = Checks()
    pairs_year = res["pairs_year"]

    def year_nh(y):
        return n_h(pairs_year[y])

    # ---- national years: estimate, CV, cases; hospitals; row counts
    for y in (1997, 2013, 2019, 2024, 2025):
        p = rows["neiss_national_years"][str(y)]["item"]["year"]
        s = summarize(res[("nat", y)], year_nh(y))
        ck.add(f"year{y}.estimate", f"National estimate {y}", p["total"]["estimate"], round(s["est"]), "exact", 0)
        ck.add(f"year{y}.cv", f"National CV {y}", p["total"]["cv"], round(s["cv"], 4), "exact", 0.00006)
        ck.add(f"year{y}.cases", f"Sample cases {y}", p["total"]["cases"], s["cases"], "count")
        ck.add(f"year{y}.records_used", f"Records used {y}", p["quality"]["records_used"], res[("rows", y)][0] if ("rows", y) in res else None, "count")
    p24 = rows["neiss_national_years"]["2024"]["item"]["year"]
    ck.add("year2024.hospitals", "Hospitals by stratum 2024", p24["hospitals"]["by_stratum"], year_nh(2024), "count")
    # ---- admitted share and CV
    for y in (2013, 2024):
        d = domains[("nat", y)]
        dom = res[("nat", y)]
        r, se = share(dom, year_nh(y))
        p = rows["neiss_national_years"][str(y)]["item"]["year"]["admitted_to_hospital"]
        ck.add(f"year{y}.admitted_share", f"Share admitted to hospital {y}", p["share"], round(r, 5), "exact", 0.00006)
        ck.add(f"year{y}.admitted_cv", f"CV of the admitted share {y}", p["cv"], round(se / r, 4), "exact", 0.00006)

    # ---- annual tables inside the year records
    def table_entry(year, table, code):
        for e in rows["neiss_national_years"][str(year)]["item"]["year"][table]:
            if e["code"] == code:
                return e
        raise KeyError((year, table, code))

    for tag, y, table, code, label in (("sex1", 2019, "sex", 1, "Male"), ("age514", 2013, "age_group", "5-14", "age 5-14"),
                                       ("head", 2025, "body_part", 75, "Head"), ("fracture", 2019, "diagnosis", 57, "Fracture"),
                                       ("treated_released", 2013, "disposition", 1, "Treated/Examined and Released"), ("home", 2024, "location", 1, "Home")):
        e = table_entry(y, table, code)
        s = summarize(res[(tag, y)], year_nh(y))
        ck.add(f"{tag}{y}.estimate", f"{label} estimate {y}", e["estimate"], round(s["est"]), "exact", 0)
        ck.add(f"{tag}{y}.cv", f"{label} CV {y}", e["cv"], round(s["cv"], 4), "exact", 0.00006)
        ck.add(f"{tag}{y}.cases", f"{label} cases {y}", e["cases"], s["cases"], "count")

    # ---- product annual entries
    def product_annual(code, year):
        for a in rows["neiss_product_estimates"][str(code)]["item"]["product"]["annual"]:
            if a["year"] == year:
                return a
        raise KeyError((code, year))

    for code, y in ((1233, 2019), (1205, 2024), (1411, 2013), (5022, 2025), (1211, 2013), (1233, 2024)):
        a = product_annual(code, y)
        s = summarize(res[(f"prod{code}", y)], year_nh(y))
        ck.add(f"prod{code}.{y}.estimate", f"Product {code} estimate {y}", a["estimate"], round(s["est"]), "exact", 0)
        ck.add(f"prod{code}.{y}.cv", f"Product {code} CV {y}", a["cv"], round(s["cv"], 4), "exact", 0.00006)
        ck.add(f"prod{code}.{y}.cases", f"Product {code} cases {y}", a["cases"], s["cases"], "count")

    # ---- pooled figures: two design segments, hospital = one cluster inside a segment, SE bound across segments
    nhA, nhB = n_h(res["pairs_A"]), n_h(res["pairs_B"])

    def pooled(tagA, tagB):
        a, b = res[tagA], res[tagB]
        sa, sb = summarize(a, nhA), summarize(b, nhB)
        est = sa["est"] + sb["est"]
        se = math.sqrt(sa["var"]) + math.sqrt(sb["var"])
        # share with the combined ratio
        x, y = est, sum(a.y.values()) + sum(b.y.values())
        r = y / x if x > 0 else None
        shse = None
        if r is not None:
            shse = (math.sqrt(max(z_variance(a, r, nhA), 0.0)) + math.sqrt(max(z_variance(b, r, nhB), 0.0))) / x
        return {"est": est, "cases": sa["cases"] + sb["cases"], "cv": se / est if est > 0 else None, "share": r, "share_se": shse}

    p = pooled(("prod1233", "A"), ("prod1233", "B"))
    pr = rows["neiss_product_estimates"]["1233"]["item"]["product"]["pooled"]
    ck.add("pool.prod1233.estimate", "Trampolines pooled 2021-2025 estimate", pr["total"]["estimate"], round(p["est"]), "exact", 0)
    ck.add("pool.prod1233.cv", "Trampolines pooled CV (upper bound)", pr["total"]["cv"], round(p["cv"], 4), "exact", 0.00006)
    ck.add("pool.prod1233.cases", "Trampolines pooled cases", pr["total"]["cases"], p["cases"], "count")
    ck.add("pool.prod1233.admitted", "Trampolines pooled share admitted", pr["admitted_to_hospital"]["share"], round(p["share"], 5), "exact", 0.00006)
    ck.add("pool.prod1233.admitted_cv", "Trampolines pooled admitted-share CV", pr["admitted_to_hospital"]["cv"], round(p["share_se"] / p["share"], 4), "exact", 0.00006)
    p = pooled(("prod5022", "A"), ("prod5022", "B"))
    pr = rows["neiss_product_estimates"]["5022"]["item"]["product"]["pooled"]
    ck.add("pool.prod5022.estimate", "Powered scooters pooled estimate", pr["total"]["estimate"], round(p["est"]), "exact", 0)
    ck.add("pool.prod5022.cv", "Powered scooters pooled CV (upper bound)", pr["total"]["cv"], round(p["cv"], 4), "exact", 0.00006)
    p = pooled(("head", "A"), ("head", "B"))
    pr = rows["neiss_injury_dimensions"]["body_part:75"]["item"]["dimension"]["pooled"]
    ck.add("pool.head.estimate", "Head injuries pooled estimate", pr["total"]["estimate"], round(p["est"]), "exact", 0)
    ck.add("pool.head.cv", "Head injuries pooled CV (upper bound)", pr["total"]["cv"], round(p["cv"], 4), "exact", 0.00006)
    ck.add("pool.head.admitted", "Head injuries pooled admitted share", pr["admitted_to_hospital"]["share"], round(p["share"], 5), "exact", 0.00006)
    p = pooled(("july", "A"), ("july", "B"))
    pr = rows["neiss_injury_dimensions"]["month:7"]["item"]["dimension"]["pooled"]
    ck.add("pool.july.estimate", "July pooled estimate", pr["total"]["estimate"], round(p["est"]), "exact", 0)
    pn = pooled(("nat", "A"), ("nat", "B"))
    ck.add("pool.head.share_of_all", "Head share of all injuries pooled", pr_share(rows, "body_part:75"), round(pooled(("head", "A"), ("head", "B"))["est"] / pn["est"], 5), "exact", 0.00006)

    # ---- narrative theme (definition shared, weights and variance recomputed)
    th = rows["neiss_narrative_themes"]["escooter"]["item"]["theme"]
    s25 = summarize(res[("theme_escooter", 2025)], year_nh(2025))
    a25 = [a for a in th["annual"] if a["year"] == 2025][0]
    ck.add("theme.escooter.2025.estimate", "E-scooter theme 2025 estimate", a25["estimate"], round(s25["est"]), "exact", 0)
    ck.add("theme.escooter.2025.cv", "E-scooter theme 2025 CV", a25["cv"], round(s25["cv"], 4), "exact", 0.00006)
    ck.add("theme.escooter.2025.cases", "E-scooter theme 2025 cases", a25["cases"], s25["cases"], "count")
    p = pooled(("theme_escooter", "A"), ("theme_escooter", "B"))
    ck.add("theme.escooter.pooled.estimate", "E-scooter theme pooled estimate", th["pooled"]["total"]["estimate"], round(p["est"]), "exact", 0)
    ck.add("theme.escooter.pooled.cv", "E-scooter theme pooled CV (upper bound)", th["pooled"]["total"]["cv"], round(p["cv"], 4), "exact", 0.00006)

    # ---- design break facts
    db = rows["neiss_national_years"]["method"]["item"]["design_break"]
    s23 = {p_: h for h, p_ in pairs_year[2023]}
    s24 = {p_: h for h, p_ in pairs_year[2024]}
    both = set(s23) & set(s24)
    ck.add("design.in_both", "Hospital ids present in both 2023 and 2024", db["in_both_years"], len(both), "count")
    ck.add("design.moved", "Hospital ids that changed stratum 2023 to 2024", db["changed_stratum"], sum(1 for p_ in both if s23[p_] != s24[p_]), "count")

    # ---- unstable entries are withheld exactly when CPSC's rule fires (found from the displayed annual entries, recomputed from raw)
    unstable_found = []
    for code in sorted(rows["neiss_product_estimates"], key=int):
        a = [x for x in rows["neiss_product_estimates"][code]["item"]["product"]["annual"] if x["year"] == 2024 and not x["reliable"] and x["cases"] > 0]
        if a and len(unstable_found) < 3 and int(code) not in (1233, 1205, 1411, 5022, 1211):
            unstable_found.append((code, a[0]))
    extra_dom = {}
    if unstable_found:
        recs24 = res["recs2024"]
        for code, a in unstable_found:
            dom = Dom()
            for r in recs24:
                if has_prod(r, int(code)):
                    dom.add((r[11], r[12]), r[13], r[5] == 4)
            s = summarize(dom, year_nh(2024))
            cv = s["cv"]
            ck.add(f"unstable.prod{code}.2024", f"Product {code} 2024 withheld as unstable (CPSC rule)", a,
                   {"unstable": unstable(s["est"], s["cases"], cv), "cases": s["cases"], "est": round(s["est"]), "cv": cv}, "unstable")

    # ---- CPSC benchmark (not counted as spot checks): published Highlights tables vs the raw archive files
    bench = []
    single = {"Basketball": 1205, "Football": 1211, "Trampolines": 1233, "Chain Saws": 1411}
    for y in (2013, 2019, 2024):
        pub = {r["group"]: r for r in H.parse_highlights(H.pdf_text(os.path.join(DOCS, f"NEISS-Data-Highlights-{y}.pdf")))}
        for g, code in single.items():
            tag = (f"prod{code}", y)
            if tag not in res or g not in pub:
                continue
            s = summarize(res[tag], year_nh(y))
            pb = pub[g]
            d_cases = s["cases"] - pb["cases"]
            d_est = round(s["est"]) - pb["estimate"]
            cv_ok = abs(round(s["cv"], 2) - pb["cv"]) < 1e-9 or abs(math.floor(s["cv"] * 100 + 1e-9) / 100 - pb["cv"]) < 1e-9
            exact = d_cases == 0 and abs(d_est) <= 1 and cv_ok
            near = abs(d_cases) <= 3 and abs(d_est) <= 0.001 * pb["estimate"] and abs(s["cv"] - pb["cv"]) <= 0.011
            bench.append({"year": y, "group": g, "recomputed": {"estimate": round(s["est"]), "cases": s["cases"], "cv": round(s["cv"], 4)},
                          "published": pb, "status": "exact" if exact else ("near" if near else "differs")})
    for y in (2023, 2024):
        pub = {r["group"]: r for r in H.parse_highlights(H.pdf_text(os.path.join(DOCS, f"NEISS-Data-Highlights-{y}.pdf")))}
        tag = ("golf_union", y)
        if tag in res and "Golf" in pub:
            s = summarize(res[tag], year_nh(y))
            pb = pub["Golf"]
            exact = s["cases"] == pb["cases"] and abs(round(s["est"]) - pb["estimate"]) <= 1
            bench.append({"year": y, "group": "Golf (product codes 1212 + 1213, union)",
                          "recomputed": {"estimate": round(s["est"]), "cases": s["cases"], "cv": round(s["cv"], 4)}, "published": pb,
                          "status": "exact" if exact else "differs"})

    out = {"summary": ck.summary(), "elapsed_seconds": round(time.time() - t0, 1), "checks": ck.rows, "cpsc_benchmark": bench,
           "benchmark_summary": dict(collections.Counter(b["status"] for b in bench)), "files_read": YEARS_READ}
    with open(os.path.join(BUILD, "spot_check_results.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, default=str)
    for r in ck.rows:
        print(f"{r['status']:9s} {r['id']:36s} displayed={r['displayed']!s:>22.22} recomputed={r['recomputed']!s:>22.22}")
    print(json.dumps(out["summary"]), "benchmark", json.dumps(out["benchmark_summary"]))
    if out["summary"].get("MISMATCH"):
        raise SystemExit(1)


def pr_share(rows, rid):
    return rows["neiss_injury_dimensions"][rid]["item"]["dimension"]["pooled"]["share_of_all"]


if __name__ == "__main__":
    main()
