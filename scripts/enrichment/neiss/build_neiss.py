"""Build the NEISS datasets (CPSC National Electronic Injury Surveillance System) from the cached design-based aggregates.

Inputs (all under private/): acq/neiss/tsv/neissYYYY.tsv.gz (raw annual files, 1997-2025), acq/neiss/docs/* (data dictionary, coding
manuals, comparability table, CPSC explanation of estimates), acq/neiss/_manifest.jsonl, and the aggregates that
run_aggregation.py computed from those files (build/neiss/cache). Nothing here reads a network or writes to a remote service.

Publishes AGGREGATES ONLY (national estimates with CV): no case record, narrative text or excerpt is written.

  neiss_national_years     one record per treatment year 1997-2025 + a series record + a method record
  neiss_product_estimates  one record per NEISS product code seen in the data (annual series 1997-2025, pooled 2021-2025 splits)
  neiss_injury_dimensions  one record per body part / diagnosis / disposition / location / age group / sex / month value
  neiss_narrative_themes   one record per narrative keyword theme (this builder's classification, not a CPSC category)

  python3 -I -B scripts/enrichment/neiss/build_neiss.py            writes private/build/neiss/<dataset>.json + build_report.json
"""
import collections
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import aggregate as A  # noqa: E402
import codes as C  # noqa: E402
import corpus_writer as writer  # noqa: E402
import neiss_lib as L  # noqa: E402
import pooling  # noqa: E402
import render as R  # noqa: E402
import themes as T  # noqa: E402

ROOT = A.ROOT
ACQ = os.path.join(ROOT, "private", "acq", "neiss")
DOCS = os.path.join(ACQ, "docs")
OUT = os.path.join(ROOT, "private", "build", "neiss")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")

YEARS = list(range(1997, 2026))
POOL_YEARS = YEARS[-5:]
POOL_LABEL = f"{POOL_YEARS[0]}-{POOL_YEARS[-1]}"
LATEST = YEARS[-1]

DS_YEARS = "neiss_national_years"
DS_PRODUCTS = "neiss_product_estimates"
DS_DIMS = "neiss_injury_dimensions"
DS_THEMES = "neiss_narrative_themes"

CPSC_QUERY_URL = "https://www.cpsc.gov/cgibin/NEISSQuery/home.aspx"
EXPLAIN_URL = "https://www.cpsc.gov/cgibin/NEISSQuery/webestimates.html"
FAQ_URL = "https://www.cpsc.gov/Research--Statistics/NEISS-Injury-Data/Neiss-Frequently-Asked-Questions"
DESIGN_URL = "https://www.cpsc.gov/s3fs-public/2001d010-6b6.pdf"

FORMULAS = (
    "Estimate of a domain = sum of the CPSC case weight (Weight) over the sample cases in the domain. "
    "Variance (with-replacement ultimate-cluster estimator for a stratified single-stage cluster sample; the hospital is the PSU "
    "within a stratum): V = sum over strata h of n_h/(n_h-1) * sum over hospitals j of (t_hj - tbar_h)^2, where t_hj is the sum of "
    "weights of the domain's cases at hospital j (0 when the hospital has no case in the domain) and n_h is the number of hospitals "
    "of stratum h that report any case in the period. CV = sqrt(V)/estimate. 95% confidence interval = estimate +/- 1.96 x estimate "
    "x CV (CPSC's formula). A share Y/X (e.g. admitted to hospital) uses Taylor linearisation, V(R) = V(y - R x)/X^2, and is shown "
    "only when both Y and X are reliable. Reliability (CPSC): an estimate is unstable when it is below 1,200, rests on fewer than 20 "
    "sample cases, or has a CV above 33%; unstable estimates are not shown (as CPSC's online query withholds them) and only their "
    "unweighted sample case count is kept. Sample case counts are never national estimates."
)
SEGMENTS = [[2021, 2022, 2023], [2024, 2025]]


def break_note(db):
    """Plain statement of the 2024 stratum change, from the stratum/PSU pairs in the 2023 and 2024 files."""
    s3, s4 = db["strata_2023"], db["strata_2024"]
    return (f"Sample design break in 2024: the stratum structure in the files changed ({db['changed_stratum']} of the {db['in_both_years']} hospital "
            f"identifiers present in both 2023 and 2024 are in a different stratum; very-large-ED (V) hospitals {s3.get('V', 0)} to {s4.get('V', 0)}, "
            f"medium (M) {s3.get('M', 0)} to {s4.get('M', 0)}) and the per-stratum weights changed, so a comparison of 2024 or 2025 with 2023 "
            "or earlier mixes two stratifications. CPSC's FAQ says the sample is periodically updated and warns that system changes affect "
            "comparisons over time; ICPSR's description of the NEISS series (quoting CDC and CPSC) adds that CPSC began redesigning the sample "
            "in 2019 with a resample from American Hospital Association hospital lists, that the prior sample was drawn in 1997 and that "
            "hospital recruitment is ongoing.")


def pool_note(db):
    return (f"Pooled {POOL_LABEL} figures are five-year totals (average per year = total / 5, same CV). Because the stratum structure changed in "
            f"2024 ({db['changed_stratum']} of {db['in_both_years']} hospital identifiers moved stratum), years are pooled inside two design "
            "segments, 2021-2023 and 2024-2025: within a segment a hospital is ONE cluster across its years, which keeps the correlation of the "
            "same hospital's cases from year to year (treating the years as independent would roughly halve the CV). The two segment totals "
            "are then added and the variance of the sum is bounded by (SE_2021-2023 + SE_2024-2025)^2, which assumes the two periods are "
            "perfectly correlated, so the pooled CV is an UPPER bound. CPSC publishes no multi-year CV rule: this is the builder's conservative "
            "extension of the single-year formula.")
CAVEATS = (
    "NEISS counts emergency-department visits for injuries associated with (not necessarily caused by) consumer products, treated "
    "in a probability sample of about 100 U.S. hospitals; it is not a count of all injuries, people or incidents. A case with up to "
    "three product codes (two before 2019) is counted under each code, so product estimates overlap and must not be added. CPSC "
    "advises that system updates and coding changes affect comparisons of estimates over time. Credit: U.S. Consumer Product Safety "
    "Commission (NEISS public-use files); the estimates, intervals and shares are computed by this builder from those files and CPSC "
    "has not endorsed them."
)
DICT_NAME = "DataDictionary042022.xlsx"


# ----------------------------------------------------------------------------------------------------------------------
# inputs

def read_manifest():
    """Latest successful manifest entry per local path (superseded and failed retrievals are skipped)."""
    by_path = {}
    with open(MANIFEST, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            d = json.loads(line)
            if d.get("superseded") or not d.get("path") or not d.get("sha256"):
                continue
            by_path[d["path"]] = d
    return by_path


def design_break(segs):
    """Facts about the 2023 -> 2024 re-stratification from the stratum/PSU pairs of the two design segments."""
    pairs23 = dict((p, h) for h, p in segs[0]["info"]["year_pairs"][2023])
    pairs24 = dict((p, h) for h, p in segs[1]["info"]["year_pairs"][2024])
    if len(pairs23) != len(segs[0]["info"]["year_pairs"][2023]) or len(pairs24) != len(segs[1]["info"]["year_pairs"][2024]):
        raise SystemExit("a hospital identifier appears in two strata in one year")
    both = sorted(set(pairs23) & set(pairs24))
    moved = [p for p in both if pairs23[p] != pairs24[p]]
    return {"hospitals_2023": len(pairs23), "hospitals_2024": len(pairs24), "in_both_years": len(both), "changed_stratum": len(moved),
            "strata_2023": dict(collections.Counter(pairs23.values())), "strata_2024": dict(collections.Counter(pairs24.values()))}


def input_ref(manifest, rel):
    d = manifest[rel]
    return {"url": d["url"], "path": rel, "sha256": d["sha256"]}


def check_cache(d, what, themes_hash=None):
    if d.get("version") != A.AGG_VERSION:
        raise SystemExit(f"{what}: cache version {d.get('version')!r} is not {A.AGG_VERSION!r}; re-run run_aggregation.py")
    if themes_hash is not None and d.get("themes_hash") != themes_hash:
        raise SystemExit(f"{what}: theme definitions changed since the cache was computed; re-run run_aggregation.py themes")


def load_context():
    manifest = read_manifest()
    ctx = {"manifest": manifest, "core": {}, "themes_year": {}}
    for y in YEARS:
        p = A.cache_path("core", [y])
        d = A.load_cache(p)
        check_cache(d, p)
        tsv = os.path.join(ACQ, "tsv", f"neiss{y}.tsv.gz")
        if os.path.getmtime(p) < os.path.getmtime(tsv):
            raise SystemExit(f"{p} is older than {tsv}; re-run run_aggregation.py")
        ctx["core"][y] = d
    segs = []
    for s in SEGMENTS:
        d = A.load_cache(A.cache_path("poolseg", s))
        check_cache(d, f"poolseg {s}")
        if d["info"]["psu_multi_stratum"]:
            raise SystemExit(f"poolseg {s}: a hospital identifier changes stratum inside the segment")
        segs.append(d)
    ctx["pool"] = {"res": pooling.combine_results([d["res"] for d in segs]), "segments": [d["info"] for d in segs]}
    ctx["design_break"] = design_break(segs)
    th_hash = T.definitions_hash()
    for y in YEARS:
        d = A.load_cache(A.cache_path("themes", [y]))
        check_cache(d, f"themes {y}", th_hash)
        ctx["themes_year"][y] = d
    tsegs = []
    for s in SEGMENTS:
        d = A.load_cache(A.cache_path("themepoolseg", s))
        check_cache(d, f"themepoolseg {s}", th_hash)
        tsegs.append(d)
    ctx["themes_pool"] = {"res": pooling.combine_results([d["res"] for d in tsegs])}
    ctx["labels"] = R.Labels(
        C.load_dictionary(os.path.join(DOCS, DICT_NAME)),
        C.product_labels(C.pdf_to_text(os.path.join(DOCS, "NEISS-Coding-Manual-2025-01-Rev1.pdf")),
                         C.pdf_to_text(os.path.join(DOCS, "NEISS-Coding-Manual-2024-01.pdf")),
                         C.pdf_to_text(os.path.join(DOCS, "Comparability-Table-2025.pdf"))))
    ctx["tsv_url"] = {y: manifest[f"private/acq/neiss/tsv/neiss{y}.tsv.gz"]["url"] for y in YEARS}
    ctx["tsv_sha_raw"] = {y: manifest[f"private/acq/neiss/tsv/neiss{y}.tsv.gz"].get("sha256_raw") for y in YEARS}
    return ctx


def inputs_for(ctx, docs):
    refs = [input_ref(ctx["manifest"], f"private/acq/neiss/tsv/neiss{y}.tsv.gz") for y in YEARS]
    refs += [input_ref(ctx["manifest"], f"private/acq/neiss/docs/{name}") for name in docs]
    return refs


# ----------------------------------------------------------------------------------------------------------------------
# small helpers

def compact(fig):
    f = dict(fig)
    if not f.get("reasons"):
        f.pop("reasons", None)
    return f


def decade(y):
    return f"{y // 10 * 10}s"


def rid_url(dataset, rid):
    return f"/records/{dataset}/{rid}"


def facts_pairs(items):
    return [[k, v] for k, v in items]


def rec(dataset, rid, title, *, source_url, subtitle, cells, facts, text, filters, badges=(), links=(), extra=None):
    row = writer.record(dataset, rid, title, source_url=source_url, subtitle=subtitle, cells=cells, facts=facts_pairs(facts), text=text,
                        filters=filters, badges=badges, links=list(links), extra=extra)
    return row


def src_links(ctx, years):
    return [{"label": f"CPSC NEISS public-use file {y} (neiss{y}.tsv)", "url": ctx["tsv_url"][y]} for y in years]


TERMS_URL = "https://www.cpsc.gov/About-CPSC/Policies-Statements-and-Directives/Privacy-Policy"
ICPSR_URL = "https://www.icpsr.umich.edu/web/ICPSR/series/198"
DOC_LINKS = [
    {"label": "CPSC: Explanation of NEISS estimates (CV, confidence interval, unstable estimates)", "url": EXPLAIN_URL},
    {"label": "CPSC: NEISS frequently asked questions (sample, strata, updates)", "url": FAQ_URL},
    {"label": "CPSC: The NEISS sample (design and implementation) 1979 to 1996", "url": DESIGN_URL},
]


def tab_entries(res, prefix, label_fn, total_fig, key_len=2, code_fn=None, drop_absent=True):
    """Figures for every domain key (prefix, code) in res, largest first. code_fn maps a key to (code, label)."""
    out = []
    for key, t in res.items():
        if key[0] != prefix or len(key) != key_len:
            continue
        code = key[1] if code_fn is None else code_fn(key)[0]
        label = label_fn(key[1]) if code_fn is None else code_fn(key)[1]
        fig = R.figure(t[0], t[1], t[2])
        e = {"code": code, "label": label, **compact(fig), "share": R.share_of(fig, total_fig)}
        out.append(e)
    return R.ordered(out)


# ----------------------------------------------------------------------------------------------------------------------
# dataset 1: national years

def year_profile(ctx, y):
    lab = ctx["labels"]
    d = ctx["core"][y]
    res, info = d["res"], d["info"]
    nat = res[("nat",)]
    total, adm, doa = R.from_tuple(nat)
    prev = ctx["core"].get(y - 1)
    chg = R.change(prev["res"][("nat",)] if prev else None, nat)
    quality = info["files"][y]
    st, meta = quality["stats"], quality["meta"]
    if abs(meta["weight_sum"] - nat[0]) > 1e-6 * nat[0]:
        raise SystemExit(f"{y}: sum of weights {meta['weight_sum']} differs from the national estimate {nat[0]}")

    def band_entry(res_prefix, order):
        ents = tab_entries(res, res_prefix, lambda b: lab.band(b), total)
        rank = {b: i for i, b in enumerate(order)}
        return sorted(ents, key=lambda e: rank.get(e["code"], 99))

    sexage = []
    for key, t in res.items():
        if key[0] == "sexage":
            fig = R.figure(t[0], t[1], t[2])
            sexage.append({"code": f"{key[1]}:{key[2]}", "sex": lab.coded("Sex", key[1]), "age_group": lab.band(key[2]),
                           **compact(fig), "share": R.share_of(fig, total)})
    sexage = R.ordered(sexage)
    fire_entries = tab_entries(res, "fire", lambda c: lab.coded("Fire_Involvement", c), total)
    products = []
    for key, t in res.items():
        if key[0] == "prod":
            fig = R.figure(t[0], t[1], t[2])
            if fig["reliable"]:
                products.append({"code": key[1], "label": lab.product(key[1])[0], **compact(fig), "share": R.share_of(fig, total)})
    products = R.ordered(products)[:25]
    return {
        "year": y, "total": compact(total), "admitted_to_hospital": adm, "hospitalized_or_died_in_ed": doa, "change_from_previous_year": chg,
        "hospitals": {"total": info["hospitals"], "by_stratum": {h: info["n_h"][h] for h in L.STRATA}},
        "sex": tab_entries(res, "sex", lambda c: lab.coded("Sex", c), total),
        "age_group": band_entry("age", list(L.COARSE_BANDS) + [L.BAND_NR]),
        "age_group_fine": band_entry("agef", list(L.FINE_BANDS) + [L.BAND_NR]),
        "sex_by_age_group": sexage,
        "disposition": tab_entries(res, "disp", lambda c: lab.coded("Disposition", c), total),
        "location": tab_entries(res, "loc", lambda c: lab.coded("Location", c), total),
        "body_part": tab_entries(res, "body", lambda c: lab.coded("Body_Part", c), total),
        "diagnosis": tab_entries(res, "diag", lambda c: lab.coded("Diagnosis", c), total),
        "fire_involvement": fire_entries,
        "month": sorted(tab_entries(res, "month", lambda m: lab.month(m), total), key=lambda e: e["code"]),
        "top_products": products,
        "quality": {"physical_lines": st["physical_lines"], "records_read": st["records"], "records_used": meta["rows"],
                    "rejected": st["rejected"], "split_records_rejoined": st["joined_records"], "quoted_tab_fields_merged": st["quote_merged"],
                    "excess_tab_records_merged": st["excess_tab_merged"], "duplicate_case_numbers": st["duplicates"],
                    "treatment_date_outside_file_year": st["date_year_mismatch"], "narrative_max_length": meta["narrative_max_len"],
                    "narrative_mean_length": round(meta["narrative_mean_len"], 1), "narrative_empty": meta["narrative_empty"],
                    "age_not_recorded": meta["age_not_recorded"], "age_invalid": meta["age_invalid"],
                    "race_recorded": meta["nonzero"].get("race", 0), "hispanic_recorded": meta["nonzero"].get("hispanic", 0)},
    }


def year_rows(ctx, product_ids):
    rows, profiles = [], {}
    for y in YEARS:
        p = year_profile(ctx, y)
        profiles[y] = p
        tot, adm, doa = p["total"], p["admitted_to_hospital"], p["hospitalized_or_died_in_ed"]
        chg = p["change_from_previous_year"]
        top_links = [{"label": f"{e['label']} (NEISS product code {e['code']})", "url": rid_url(DS_PRODUCTS, e["code"])}
                     for e in p["top_products"][:10] if e["code"] in product_ids]
        facts = [
            ("Source", f"CPSC NEISS public-use annual data file neiss{y}.tsv (hospital emergency-department cases coded by NEISS hospital coordinators)"),
            ("Period", f"Treatment year {y}"),
            ("Units", "Estimated number of consumer-product-related injuries treated in U.S. hospital emergency departments (sum of CPSC case weights)"),
            ("National estimate", R.fig_text(tot)),
            ("Hospitals in the sample", f"{p['hospitals']['total']} reporting hospitals (by stratum: " + ", ".join(f"{h} {n}" for h, n in p["hospitals"]["by_stratum"].items()) + ")"),
            ("Admitted to hospital (disposition 4)", R.share_text(adm)),
            ("Hospitalized & DOA, CPSC's \"Hosp. & DOA\" grouping (dispositions 2 transferred, 4 admitted, 5 held for observation, 8 fatality incl. DOA)", R.share_text(doa)),
            ("Change from previous year", "Not applicable (first year in the archive)" if chg is None else
             f"{chg['difference']:+,} ({R.pct(chg['percent'])}); " + ("larger than twice the sampling error under an independence test (conservative)" if chg["exceeds_sampling_error"]
                                                                       else "within the sampling error of the two estimates")),
            ("Records", f"{p['quality']['records_used']:,} cases used of {p['quality']['records_read']:,} records read; rejected: " +
             (", ".join(f"{k} {v}" for k, v in p["quality"]["rejected"].items()) or "none") +
             f"; split records rejoined {p['quality']['split_records_rejoined']}, quoted-tab fields merged {p['quality']['quoted_tab_fields_merged']}"),
            ("Top products (reliable estimates)", "; ".join(f"{e['label']} {e['estimate']:,}" for e in p["top_products"][:5]) or "Not recorded"),
            ("Reliability rule", "CPSC: unstable when the estimate is below 1,200, fewer than 20 sample cases, or CV above 33%; unstable figures are not shown"),
            ("Source file hash", f"SHA-256 of the file as served by CPSC: {ctx['tsv_sha_raw'][y]}"),
            ("Caveat", CAVEATS),
        ]
        if y >= 2024:
            facts.insert(5, ("Sample design", break_note(ctx["design_break"])))
        rows.append(rec(
            DS_YEARS, str(y), f"NEISS {y}: national estimate of consumer-product injuries treated in emergency departments",
            source_url=ctx["tsv_url"][y],
            subtitle=f"{tot['estimate']:,} estimated injuries (CV {R.pct(tot['cv'])}) · {tot['cases']:,} sample cases · {p['hospitals']['total']} hospitals",
            cells={"year": y, "estimate": tot["estimate"], "cv_pct": round(tot["cv"] * 100, 2), "ci_low": tot["ci95"][0], "ci_high": tot["ci95"][1],
                   "cases": tot["cases"], "hospitals": p["hospitals"]["total"],
                   "admitted_pct": None if not adm["reliable"] else round(adm["share"] * 100, 2),
                   "change_pct": None if chg is None else round(chg["percent"] * 100, 2)},
            facts=facts, text=f"NEISS {y} national estimate emergency department consumer product injuries CPSC",
            filters={"kind": ["year"], "decade": [decade(y)]}, badges=[f"CV {R.pct(tot['cv'])}", "Weighted national estimate"],
            links=[{"label": "NEISS series 1997-2025", "url": rid_url(DS_YEARS, "series")}, {"label": "NEISS method and reliability rule", "url": rid_url(DS_YEARS, "method")}]
            + top_links + src_links(ctx, [y]) + DOC_LINKS[:2],
            extra={"kind": "year", "year": p}))
    # series
    pts = []
    for y in YEARS:
        p = profiles[y]
        pts.append({"year": y, "estimate": p["total"]["estimate"], "cv": p["total"]["cv"], "ci95": p["total"]["ci95"], "cases": p["total"]["cases"],
                    "hospitals": p["hospitals"]["total"], "admitted_share": p["admitted_to_hospital"], "hospitalized_or_died_share": p["hospitalized_or_died_in_ed"],
                    "change_from_previous_year": p["change_from_previous_year"]})
    first, last = pts[0], pts[-1]
    peak = max(pts, key=lambda q: q["estimate"])
    series_facts = [
        ("Source", "CPSC NEISS public-use annual data files neiss1997.tsv to neiss2025.tsv"),
        ("Period", f"Treatment years {YEARS[0]}-{YEARS[-1]}"),
        ("Units", "Estimated consumer-product-related injuries treated in U.S. hospital emergency departments (sum of CPSC case weights)"),
        ("First year", f"{first['year']}: {first['estimate']:,} (CV {R.pct(first['cv'])})"),
        ("Latest year", f"{last['year']}: {last['estimate']:,} (CV {R.pct(last['cv'])}; {last['cases']:,} sample cases)"),
        ("Highest year", f"{peak['year']}: {peak['estimate']:,} (CV {R.pct(peak['cv'])})"),
        ("Hospitals reporting", f"{min(q['hospitals'] for q in pts)} to {max(q['hospitals'] for q in pts)} per year ({first['hospitals']} in {first['year']}, {last['hospitals']} in {last['year']}); national CV {R.pct(first['cv'])} in {first['year']} and {R.pct(last['cv'])} in {last['year']}"),
        ("Sample design break", break_note(ctx["design_break"])),
        ("Estimates by year", ", ".join(f"{q['year']}: {q['estimate']:,}" for q in pts)),
        ("Caveat", CAVEATS),
    ]
    rows.append(rec(
        DS_YEARS, "series", f"NEISS national estimates by year, {YEARS[0]}-{YEARS[-1]}", source_url=CPSC_QUERY_URL,
        subtitle=f"{first['estimate']:,} in {first['year']} to {last['estimate']:,} in {last['year']} · CV {R.pct(first['cv'])} to {R.pct(last['cv'])}",
        cells={"year": f"{YEARS[0]}-{YEARS[-1]}", "estimate": last["estimate"], "cv_pct": round(last["cv"] * 100, 2), "ci_low": last["ci95"][0],
               "ci_high": last["ci95"][1], "cases": last["cases"], "hospitals": last["hospitals"], "admitted_pct": None, "change_pct": None},
        facts=series_facts, text="NEISS national series all years estimates coefficient of variation hospitals",
        filters={"kind": ["series"], "decade": ["all"]}, badges=["Series"],
        links=[{"label": f"NEISS {y}", "url": rid_url(DS_YEARS, str(y))} for y in (YEARS[0], YEARS[-1])] + [{"label": "NEISS method", "url": rid_url(DS_YEARS, "method")}] + DOC_LINKS[:2],
        extra={"kind": "series", "series": pts, "design_break": ctx["design_break"]}))
    return rows, profiles


def method_row(ctx, profiles, counts):
    q = collections.Counter()
    rej = collections.Counter()
    for y in YEARS:
        qq = profiles[y]["quality"]
        q["records_read"] += qq["records_read"]
        q["records_used"] += qq["records_used"]
        q["rejoined"] += qq["split_records_rejoined"]
        q["quote_merged"] += qq["quoted_tab_fields_merged"]
        q["excess_tab"] += qq["excess_tab_records_merged"]
        q["dup"] += qq["duplicate_case_numbers"]
        for k, v in qq["rejected"].items():
            rej[k] += v
    facts = [
        ("Source", "CPSC National Electronic Injury Surveillance System (NEISS), public-use annual files neiss1997.tsv to neiss2025.tsv; documentation from cpsc.gov"),
        ("What NEISS is", "A probability sample of about 100 U.S. hospitals (of more than 5,000 with emergency departments) in five strata - four emergency-department sizes and a children's-hospital stratum; coordinators code each consumer-product-related injury visit (CPSC FAQ)."),
        ("Sample updates", "CPSC redesigned the sample in 1978, updated it in 1990, enlarged it from 65 to 91 hospitals in 1991 and updated it again in 1997 (CPSC FAQ). This dataset starts in 1997, the first year of the archive CPSC serves. ICPSR's NEISS series description (a third-party page quoting CDC and CPSC) says CPSC began a redesign of the sample in 2019 (resample from American Hospital Association hospital lists; prior sample drawn in 1997; recruitment ongoing); the stratum structure in the files changes in 2024."),
        ("Format change", "Effective 1 January 2019 CPSC added Diagnosis_2, Other_Diagnosis_2, Body_Part_2, Product_3, Ethnicity, Alcohol_Involved and Drug_Involved and raised the narrative limit from 142 to 400 characters (CPSC FAQ)."),
        ("Weights", "Each case carries a CPSC statistical weight. CPSC's 1979-1996 design document defines the basic hospital weight as the inverse of the hospital's selection probability in its stratum, adjusted for non-response and hospital mergers; CPSC's 1997-to-present design document is no longer served at its former address, so the weights are used exactly as released."),
        ("Estimates and variance", FORMULAS),
        ("Pooled years", pool_note(ctx["design_break"])),
        ("Sample design break", break_note(ctx["design_break"])),
        ("Change between years", "A year-over-year change is flagged as larger than the sampling error when |difference| > 1.96 x sqrt(V_a + V_b). The test assumes the two years are independent; the same hospitals report in both years, so it is conservative."),
        ("Product codes", "A case lists up to three product codes (two before 2019) and counts under each, so product estimates overlap. Labels come from the CPSC coding manuals (January 2025, January 2024) and the January 2025 comparability table; a code with no label stays Not recorded."),
        ("Not published", "Case-level records, narratives and excerpts are never published. Race, ethnicity, alcohol and drug involvement are not analysed here: race is Not Stated in the ED record or blank for about 31% of cases (blank in 1997-1999) and ethnicity, alcohol and drug exist only from 2019."),
        ("Data quality", f"{q['records_read']:,} records read and {q['records_used']:,} used across {len(YEARS)} files; rejected {sum(rej.values())} ({', '.join(f'{k}: {v}' for k, v in rej.items()) or 'none'}); {q['rejoined']} narratives split by stray line breaks were rejoined and {q['quote_merged'] + q['excess_tab']} records with tabs inside a field were repaired; duplicate case numbers {q['dup']}."),
        ("Terms", "Public-use data and documentation published by the U.S. Consumer Product Safety Commission. CPSC's Privacy and Security Notice (Copyright) says content on its websites is public information that may be freely distributed or copied, asks that CPSC be credited, and forbids use that states or implies CPSC endorsement. No account, licence or data-use agreement was accepted to obtain the files."),
        ("Cross-references", "Links go only to other records of these NEISS datasets on exact keys (product code, year, dimension code, theme id) and every target is checked at build time; NEISS carries no state, court, company or MDL key, so no external links are made."),
    ]
    return rec(
        DS_YEARS, "method", "NEISS method: estimates, variance, reliability rule and caveats", source_url=EXPLAIN_URL,
        subtitle="How the figures are computed and when CPSC calls an estimate unstable",
        cells={"year": "Method", "estimate": None, "cv_pct": None, "ci_low": None, "ci_high": None, "cases": None, "hospitals": None, "admitted_pct": None, "change_pct": None},
        facts=facts, text="NEISS method weights variance coefficient of variation unstable estimates reliability",
        filters={"kind": ["method"], "decade": ["all"]}, badges=["Method"], links=DOC_LINKS + [{"label": "CPSC NEISS query", "url": CPSC_QUERY_URL}, {"label": "CPSC Privacy and Security Notice (copyright and reuse)", "url": TERMS_URL},
                                                                      {"label": "ICPSR: NEISS series description (third-party text on the 2019 sample redesign)", "url": ICPSR_URL}],
        extra={"kind": "method", "formulas": FORMULAS, "pooled_note": pool_note(ctx["design_break"]), "design_break": ctx["design_break"],
               "caveats": CAVEATS, "quality_totals": dict(q), "rejected_totals": dict(rej)})


# ----------------------------------------------------------------------------------------------------------------------
# dataset 2: products

POOL_SPLITS = (("sex", "psex", "Sex", lambda lab, c: lab.coded("Sex", c)),
               ("age_group", "page", None, lambda lab, c: lab.band(c)),
               ("body_part", "pbody", "Body_Part", lambda lab, c: lab.coded("Body_Part", c)),
               ("diagnosis", "pdiag", "Diagnosis", lambda lab, c: lab.coded("Diagnosis", c)),
               ("disposition", "pdisp", "Disposition", lambda lab, c: lab.coded("Disposition", c)),
               ("location", "ploc", "Location", lambda lab, c: lab.coded("Location", c)),
               ("fire_involvement", "pfire", "Fire_Involvement", lambda lab, c: lab.coded("Fire_Involvement", c)),
               ("month", "pmonth", None, lambda lab, c: lab.month(c)))


def pooled_index(pool_res):
    """{product code: {split name: [(code, tuple)]}} and {product: pooled tuple}."""
    splits = collections.defaultdict(lambda: collections.defaultdict(list))
    totals = {}
    prefix_to_split = {p: s for s, p, _, _ in POOL_SPLITS}
    for key, t in pool_res.items():
        if key[0] == "prod":
            totals[key[1]] = t
        elif key[0] in prefix_to_split:
            splits[key[1]][prefix_to_split[key[0]]].append((key[2], t))
    return totals, splits


def product_universe(ctx):
    codes = set()
    for y in YEARS:
        for key in ctx["core"][y]["res"]:
            if key[0] == "prod":
                codes.add(key[1])
    return sorted(codes)


def theme_products():
    out = collections.defaultdict(list)
    for tid, d in T.DEFS.items():
        for c in d["related_products"]:
            out[c].append(tid)
    return out


def product_row(ctx, code, pooled_total, pooled_splits, year_pts, nat_pool):
    lab = ctx["labels"]
    label, source, in_use, comp = lab.product(code)
    alt = ctx["labels"].products.get(code, {}).get("alternates", [])
    annual = []
    for y in YEARS:
        t = ctx["core"][y]["res"].get(("prod", code))
        annual.append({"year": y, **compact(R.figure(t[0], t[1], t[2]))} if t else {"year": y, **compact(R.absent_figure())})
    seen = [a["year"] for a in annual if a["cases"] > 0]
    first_y, last_y = (seen[0], seen[-1]) if seen else (None, None)
    annual = [a for a in annual if first_y is not None and first_y <= a["year"] <= last_y]
    reliable_years = [a for a in annual if a["reliable"]]
    peak = max(reliable_years, key=lambda a: a["estimate"]) if reliable_years else None
    latest = next((a for a in annual if a["year"] == LATEST), {"year": LATEST, **compact(R.absent_figure())})
    prev = next((a for a in annual if a["year"] == LATEST - 1), None)
    chg = None
    if prev and prev["reliable"] and latest["reliable"]:
        pt, lt = ctx["core"][LATEST - 1]["res"][("prod", code)], ctx["core"][LATEST]["res"][("prod", code)]
        chg = R.change(pt, lt)
    pooled = None
    if pooled_total is not None:
        tot, adm, doa = R.from_tuple(pooled_total)
        pooled = {"total": compact(tot), "average_per_year": None if not tot["reliable"] else {
            "estimate": int(round(pooled_total[0] / len(POOL_YEARS))), "ci95": [int(round(tot["ci95"][0] / len(POOL_YEARS))), int(round(tot["ci95"][1] / len(POOL_YEARS)))]},
            "admitted_to_hospital": adm, "hospitalized_or_died_in_ed": doa}
        pooled["share_of_all_injuries"] = None if not tot["reliable"] else round(tot["estimate"] / nat_pool, 5)
    splits = {}
    for name, _prefix, _var, label_fn in POOL_SPLITS:
        ents = []
        for c, t in pooled_splits.get(name, []):
            fig = R.figure(t[0], t[1], t[2])
            share = None
            if pooled and pooled["total"]["reliable"] and fig["reliable"]:
                share = round(fig["estimate"] / pooled["total"]["estimate"], 5)
            ents.append({"code": c, "label": label_fn(lab, c), **compact(fig), "share_of_product": share})
        ents = R.ordered(ents) if name != "month" else sorted(ents, key=lambda e: e["code"])
        splits[name] = ents
    themes = theme_products().get(code, [])
    profile = {"code": code, "label": label, "label_source": source, "alternate_titles": alt, "in_use": in_use, "comparability_table": comp,
               "first_year_with_cases": first_y, "last_year_with_cases": last_y, "annual": annual, "latest_year": latest, "latest_vs_previous": chg,
               "peak_reliable_year": None if not peak else {"year": peak["year"], "estimate": peak["estimate"], "cv": peak["cv"]},
               "pooled": pooled, "pooled_years": POOL_LABEL, "pooled_splits": splits, "related_themes": themes,
               "sample_cases_all_years": sum(a["cases"] for a in annual)}
    return profile


def product_rows(ctx):
    lab = ctx["labels"]
    codes = product_universe(ctx)
    pool_res = ctx["pool"]["res"]
    totals, splits = pooled_index(pool_res)
    nat_pool = pool_res[("nat",)][0]
    rows, profiles = [], {}
    ids = set(str(c) for c in codes)
    theme_ids = set(T.DEFS)
    for code in codes:
        p = product_row(ctx, code, totals.get(code), splits.get(code, {}), None, nat_pool)
        profiles[code] = p
        latest, pooled = p["latest_year"], p["pooled"]
        pt = pooled["total"] if pooled else None
        avg = pooled["average_per_year"] if pooled else None
        label = p["label"]
        status = "stable_latest" if latest["reliable"] else ("unstable_latest" if latest["cases"] > 0 else "not_observed_latest")
        pool_status = "stable" if (pt and pt["reliable"]) else ("unstable" if pt else "no_cases")
        n_reliable = sum(1 for a in p["annual"] if a["reliable"])
        facts = [
            ("Source", f"CPSC NEISS public-use annual files 1997-{LATEST}; product label from {p['label_source'] or 'no CPSC document'}"),
            ("Product code", f"{code} - {label}" + ("" if p["in_use"] is None else (" (code in use)" if p["in_use"] else " (code deleted or retired)"))),
            ("Code history", "Not recorded" if not p["comparability_table"] else
             f"Comparability table: {'deleted' if p['comparability_table']['deleted'] else 'current'}; years in use as printed: {p['comparability_table']['span'] or 'Not recorded'}"),
            ("Years with sample cases", "Not recorded" if p["first_year_with_cases"] is None else f"{p['first_year_with_cases']}-{p['last_year_with_cases']} ({p['sample_cases_all_years']:,} sample cases; {n_reliable} years with a reliable estimate)"),
            (f"{LATEST} estimate", R.fig_text(latest)),
            (f"Pooled {POOL_LABEL} (five-year total)", "No sample cases in these years" if pt is None else R.fig_text(pt)),
            (f"Average per year {POOL_LABEL}", "Unstable (not shown)" if not avg else f"{avg['estimate']:,} (95% CI {avg['ci95'][0]:,} to {avg['ci95'][1]:,})"),
            (f"Admitted to hospital {POOL_LABEL}", R.share_text(pooled["admitted_to_hospital"]) if pooled else "Not recorded"),
            ("Change from previous year", "Not shown (needs a reliable estimate in both years)" if not p["latest_vs_previous"] else
             f"{p['latest_vs_previous']['difference']:+,} ({R.pct(p['latest_vs_previous']['percent'])}); " + ("larger than the sampling error (conservative test)" if p["latest_vs_previous"]["exceeds_sampling_error"] else "within the sampling error")),
            ("Highest reliable year", "None" if not p["peak_reliable_year"] else f"{p['peak_reliable_year']['year']}: {p['peak_reliable_year']['estimate']:,} (CV {R.pct(p['peak_reliable_year']['cv'])})"),
            ("Reliability rule", "CPSC: unstable when the estimate is below 1,200, fewer than 20 sample cases, or CV above 33%; unstable figures are not shown"),
            ("Overlap", "A case with several product codes counts under each, so this estimate overlaps other products and cannot be added to them"),
            ("Caveat", CAVEATS),
        ]
        links = [{"label": f"NEISS {LATEST} national estimate", "url": rid_url(DS_YEARS, str(LATEST))}] + \
                [{"label": f"Theme: {T.DEFS[t]['label']}", "url": rid_url(DS_THEMES, t)} for t in p["related_themes"] if t in theme_ids] + \
                src_links(ctx, [LATEST]) + DOC_LINKS[:1]
        rows.append(rec(
            DS_PRODUCTS, str(code), f"{label} (NEISS product code {code})", source_url=ctx["tsv_url"][LATEST],
            subtitle=(f"{LATEST}: {latest['estimate']:,} estimated injuries (CV {R.pct(latest['cv'])})" if latest["reliable"]
                      else f"{LATEST}: {R.UNSTABLE if latest['cases'] else 'no sample cases'}") +
            (f" · {POOL_LABEL} total {pt['estimate']:,}" if pt and pt["reliable"] else ""),
            cells={"code": code, "product": label, "latest_year": LATEST, "estimate_latest": R.cell_estimate(latest), "cv_latest_pct": R.cell_cv(latest),
                   "cases_latest": latest["cases"], "estimate_5yr": R.cell_estimate(pt), "cv_5yr_pct": R.cell_cv(pt),
                   "cases_5yr": 0 if pt is None else pt["cases"], "first_year": p["first_year_with_cases"], "last_year": p["last_year_with_cases"]},
            facts=facts, text=" ".join([str(code), label] + [a[0] for a in p["alternate_titles"]]),
            filters={"latest": [status], "pooled": [pool_status], "code_status": ["current" if p["in_use"] else ("retired" if p["in_use"] is False else "unknown")],
                     "last_decade": [decade(p["last_year_with_cases"]) if p["last_year_with_cases"] else "none"]},
            badges=[f"Code {code}", "Weighted estimate with CV"] + (["Unstable" if not latest["reliable"] else "Reliable"]),
            links=links, extra={"kind": "product", "product": p}))
    return rows, profiles


# ----------------------------------------------------------------------------------------------------------------------
# dataset 3: injury dimensions

DIMENSIONS = (
    # name, title word, core/pool domain prefix, product-split prefix, label function, dictionary variable
    ("sex", "sex", "sex", "psex", lambda lab, c: lab.coded("Sex", c)),
    ("age_group", "age group", "age", "page", lambda lab, c: lab.band(c)),
    ("body_part", "body part", "body", "pbody", lambda lab, c: lab.coded("Body_Part", c)),
    ("diagnosis", "diagnosis", "diag", "pdiag", lambda lab, c: lab.coded("Diagnosis", c)),
    ("disposition", "disposition", "disp", "pdisp", lambda lab, c: lab.coded("Disposition", c)),
    ("location", "location of the incident", "loc", "ploc", lambda lab, c: lab.coded("Location", c)),
    ("month", "treatment month", "month", "pmonth", lambda lab, c: lab.month(c)),
)


def dimension_rows(ctx, product_ids):
    lab = ctx["labels"]
    pool_res = ctx["pool"]["res"]
    nat_pool = R.figure(*pool_res[("nat",)][:3])
    rows, profiles = [], {}
    # product x dimension index from the pooled aggregates
    by_dim = collections.defaultdict(lambda: collections.defaultdict(list))
    for key, t in pool_res.items():
        for name, _t, dom, pre, _fn in DIMENSIONS:
            if key[0] == pre:
                by_dim[name][key[2]].append((key[1], t))
    for name, word, dom, pre, fn in DIMENSIONS:
        codes = sorted({k[1] for y in YEARS for k in ctx["core"][y]["res"] if k[0] == dom} | {k[1] for k in pool_res if k[0] == dom},
                       key=lambda c: (str(type(c)), c if isinstance(c, (int, str)) else 0))
        for code in codes:
            label = fn(lab, code)
            annual = []
            for y in YEARS:
                res = ctx["core"][y]["res"]
                t = res.get((dom, code))
                nat_t = res[("nat",)]
                if t:
                    fig = R.figure(t[0], t[1], t[2])
                    natfig = R.figure(nat_t[0], nat_t[1], nat_t[2])
                    annual.append({"year": y, **compact(fig), "share_of_all": R.share_of(fig, natfig)})
                else:
                    annual.append({"year": y, **compact(R.absent_figure()), "share_of_all": None})
            first = next((a["year"] for a in annual if a["cases"] > 0), None)
            last = next((a["year"] for a in reversed(annual) if a["cases"] > 0), None)
            annual = [a for a in annual if first is not None and first <= a["year"] <= last]
            pt = pool_res.get((dom, code))
            pooled = None
            if pt:
                tot, adm, doa = R.from_tuple(pt)
                if name == "disposition":
                    adm = doa = None   # the share admitted within a disposition group is a tautology (100% or 0%)
                pooled = {"total": compact(tot), "share_of_all": R.share_of(tot, nat_pool), "admitted_to_hospital": adm, "hospitalized_or_died_in_ed": doa,
                          "average_per_year": None if not tot["reliable"] else int(round(pt[0] / len(POOL_YEARS)))}
            prods = []
            for pcode, t in by_dim[name].get(code, []):
                fig = R.figure(t[0], t[1], t[2])
                if fig["reliable"]:
                    prods.append({"code": pcode, "label": lab.product(pcode)[0], **compact(fig),
                                  "share_of_group": None if not (pooled and pooled["total"]["reliable"]) else round(fig["estimate"] / pooled["total"]["estimate"], 5)})
            prods = R.ordered(prods)[:20]
            rid = f"{name}:{code}"
            profile = {"dimension": name, "code": code, "label": label, "first_year_with_cases": first, "last_year_with_cases": last, "annual": annual,
                       "pooled": pooled, "pooled_years": POOL_LABEL, "top_products": prods}
            profiles[rid] = profile
            latest = annual[-1] if annual and annual[-1]["year"] == LATEST else {"year": LATEST, **compact(R.absent_figure()), "share_of_all": None}
            pt_fig = pooled["total"] if pooled else None
            facts = [
                ("Source", f"CPSC NEISS public-use annual files 1997-{LATEST}; label from the CPSC data dictionary ({DICT_NAME})"),
                ("Dimension", f"Injuries by {word}: {label}"),
                (f"{LATEST} estimate", R.fig_text(latest)),
                (f"Pooled {POOL_LABEL} (five-year total)", "No sample cases in these years" if pt_fig is None else R.fig_text(pt_fig)),
                (f"Share of all injuries {POOL_LABEL}", R.pct(pooled["share_of_all"]) if pooled and pooled["share_of_all"] is not None else "Not shown (unstable)"),
                (f"Admitted to hospital {POOL_LABEL}", "Not applicable (this dimension is the disposition)" if name == "disposition"
                 else (R.share_text(pooled["admitted_to_hospital"]) if pooled else "Not recorded")),
                ("Top products", "; ".join(f"{e['label']} {e['estimate']:,}" for e in prods[:5]) or "None with a reliable estimate"),
                ("Reliability rule", "CPSC: unstable when the estimate is below 1,200, fewer than 20 sample cases, or CV above 33%; unstable figures are not shown"),
                ("Overlap", "Product estimates inside a group overlap (a case can carry up to three product codes), so their shares can add to more than 100%"),
                ("Caveat", CAVEATS),
            ]
            links = [{"label": f"{e['label']} (NEISS product code {e['code']})", "url": rid_url(DS_PRODUCTS, e["code"])} for e in prods[:10] if e["code"] in product_ids]
            links += [{"label": f"NEISS {LATEST} national estimate", "url": rid_url(DS_YEARS, str(LATEST))}] + src_links(ctx, [LATEST])
            rows.append(rec(
                DS_DIMS, rid, f"NEISS injuries by {word}: {label}", source_url=ctx["tsv_url"][LATEST],
                subtitle=(f"{LATEST}: {latest['estimate']:,} (CV {R.pct(latest['cv'])})" if latest["reliable"] else f"{LATEST}: {R.UNSTABLE if latest['cases'] else 'no sample cases'}")
                + (f" · {POOL_LABEL} total {pt_fig['estimate']:,}" if pt_fig and pt_fig["reliable"] else ""),
                cells={"dimension": word, "value": label, "estimate_latest": R.cell_estimate(latest), "cv_latest_pct": R.cell_cv(latest),
                       "cases_latest": latest["cases"], "estimate_5yr": R.cell_estimate(pt_fig), "cv_5yr_pct": R.cell_cv(pt_fig),
                       "share_5yr_pct": None if not (pooled and pooled["share_of_all"] is not None) else round(pooled["share_of_all"] * 100, 2),
                       "admitted_pct": None if not (pooled and pooled["admitted_to_hospital"] and pooled["admitted_to_hospital"]["reliable"])
                       else round(pooled["admitted_to_hospital"]["share"] * 100, 2)},
                facts=facts, text=f"NEISS {word} {label}", filters={"dimension": [name]}, badges=[word.capitalize(), "Weighted estimate with CV"],
                links=links, extra={"kind": "dimension", "dimension": profile}))
    return rows, profiles


# ----------------------------------------------------------------------------------------------------------------------
# dataset 4: narrative themes

THEME_SPLITS = (("sex", "thsex", lambda lab, c: lab.coded("Sex", c)), ("age_group", "thage", lambda lab, c: lab.band(c)),
                ("disposition", "thdisp", lambda lab, c: lab.coded("Disposition", c)), ("location", "thloc", lambda lab, c: lab.coded("Location", c)),
                ("body_part", "thbody", lambda lab, c: lab.coded("Body_Part", c)), ("diagnosis", "thdiag", lambda lab, c: lab.coded("Diagnosis", c)),
                ("month", "thmonth", lambda lab, c: lab.month(c)))
THEME_CAVEAT = (
    "A narrative keyword theme is this builder's own classification of the free-text narrative, not a CPSC product category. It counts "
    "cases whose narrative contains the listed words, so it misses cases whose narrative omits them and can include off-topic mentions. "
    "Narratives were limited to 142 characters before 2019 (400 from 2019), so counts before 2019 are not comparable with later years."
)


def theme_rows(ctx, product_ids):
    lab = ctx["labels"]
    pool_res = ctx["themes_pool"]["res"]
    rows, profiles = [], {}
    for tid, d in T.DEFS.items():
        annual = []
        for y in YEARS:
            res = ctx["themes_year"][y]["res"]
            nat = ctx["core"][y]["res"][("nat",)]
            t = res.get(("th", tid))
            if t:
                tot, adm, doa = R.from_tuple(t)
                annual.append({"year": y, **compact(tot), "share_of_all": R.share_of(tot, R.figure(nat[0], nat[1], nat[2])),
                               "admitted_to_hospital": adm})
            else:
                annual.append({"year": y, **compact(R.absent_figure()), "share_of_all": None, "admitted_to_hospital": None})
        first = next((a["year"] for a in annual if a["cases"] > 0), None)
        last = next((a["year"] for a in reversed(annual) if a["cases"] > 0), None)
        pt = pool_res.get(("th", tid))
        pooled = None
        if pt:
            tot, adm, doa = R.from_tuple(pt)
            pooled = {"total": compact(tot), "average_per_year": None if not tot["reliable"] else int(round(pt[0] / len(POOL_YEARS))),
                      "admitted_to_hospital": adm, "hospitalized_or_died_in_ed": doa}
        splits = {}
        for name, pre, fn in THEME_SPLITS:
            ents = []
            for key, t in pool_res.items():
                if key[0] == pre and key[1] == tid:
                    fig = R.figure(t[0], t[1], t[2])
                    share = round(fig["estimate"] / pooled["total"]["estimate"], 5) if (pooled and pooled["total"]["reliable"] and fig["reliable"]) else None
                    ents.append({"code": key[2], "label": fn(lab, key[2]), **compact(fig), "share_of_theme": share})
            splits[name] = sorted(ents, key=lambda e: e["code"]) if name == "month" else R.ordered(ents)
        related = [{"code": c, "label": lab.product(c)[0], "in_dataset": str(c) in product_ids} for c in d["related_products"]]
        profile = {"theme": tid, "label": d["label"], "description": d["description"],
                   "definition": {"prefilter_substrings": list(d["prefilter"]), "strip_phrases": d["strip"], "include_patterns": d["include"],
                                 "exclude_patterns": d["exclude"], "definitions_hash": T.definitions_hash()},
                   "annual": annual, "first_year_with_cases": first, "last_year_with_cases": last, "pooled": pooled, "pooled_years": POOL_LABEL,
                   "pooled_splits": splits, "related_product_codes": related, "comparable_from_year": 2019}
        profiles[tid] = profile
        latest = annual[-1]
        pt_fig = pooled["total"] if pooled else None
        facts = [
            ("Source", f"CPSC NEISS public-use annual files 1997-{LATEST}; classification of the narrative field by this builder (not a CPSC category)"),
            ("Theme", f"{d['label']}: {d['description']}"),
            (f"{LATEST} estimate", R.fig_text(latest)),
            (f"Pooled {POOL_LABEL} (five-year total)", "No sample cases in these years" if pt_fig is None else R.fig_text(pt_fig)),
            (f"Admitted to hospital {POOL_LABEL}", R.share_text(pooled["admitted_to_hospital"]) if pooled else "Not recorded"),
            ("Definition", "Include: " + " | ".join(d["include"]) + ("; strip first: " + " | ".join(d["strip"]) if d["strip"] else "") + ("; exclude: " + " | ".join(d["exclude"]) if d["exclude"] else "")),
            ("Related product codes", "; ".join(f"{r['code']} {r['label']}" for r in related) or "None named"),
            ("Comparability", "Counts before 2019 used a 142-character narrative and are not comparable with later years"),
            ("Reliability rule", "CPSC: unstable when the estimate is below 1,200, fewer than 20 sample cases, or CV above 33%; unstable figures are not shown"),
            ("Caveat", THEME_CAVEAT),
        ]
        links = [{"label": f"{r['label']} (NEISS product code {r['code']})", "url": rid_url(DS_PRODUCTS, r["code"])} for r in related if r["in_dataset"]]
        links += [{"label": f"NEISS {LATEST} national estimate", "url": rid_url(DS_YEARS, str(LATEST))}] + src_links(ctx, [LATEST])
        rows.append(rec(
            DS_THEMES, tid, f"NEISS narrative theme: {d['label']}", source_url=ctx["tsv_url"][LATEST],
            subtitle=(f"{LATEST}: {latest['estimate']:,} (CV {R.pct(latest['cv'])})" if latest["reliable"] else f"{LATEST}: {R.UNSTABLE if latest['cases'] else 'no sample cases'}")
            + (f" · {POOL_LABEL} total {pt_fig['estimate']:,}" if pt_fig and pt_fig["reliable"] else ""),
            cells={"theme": d["label"], "estimate_latest": R.cell_estimate(latest), "cv_latest_pct": R.cell_cv(latest), "cases_latest": latest["cases"],
                   "estimate_5yr": R.cell_estimate(pt_fig), "cv_5yr_pct": R.cell_cv(pt_fig), "first_year": first, "last_year": last},
            facts=facts, text=f"NEISS narrative theme {d['label']} {d['description']}", filters={"kind": ["narrative_theme"]},
            badges=["Narrative keyword theme", "Not a CPSC category"], links=links, extra={"kind": "theme", "theme": profile}))
    return rows, profiles


# ----------------------------------------------------------------------------------------------------------------------
# listing blocks and output

def listing_years():
    return writer.listing([("year", "Year"), ("estimate", "Estimated injuries"), ("cv_pct", "CV (%)"), ("ci_low", "95% CI low"), ("ci_high", "95% CI high"),
                           ("cases", "Sample cases (unweighted)"), ("hospitals", "Hospitals"), ("admitted_pct", "Admitted (%)"), ("change_pct", "Change vs previous year (%)")],
                          [("kind", "Record", {"year": "Year", "series": "Series", "method": "Method"}),
                           ("decade", "Decade", {f"{d}s": f"{d}s" for d in (1990, 2000, 2010, 2020)})])


def listing_products():
    return writer.listing([("code", "Product code"), ("product", "Product"), ("estimate_latest", f"{LATEST} estimated injuries"), ("cv_latest_pct", f"{LATEST} CV (%)"),
                           ("cases_latest", f"{LATEST} sample cases"), ("estimate_5yr", f"{POOL_LABEL} total"), ("cv_5yr_pct", "5-year CV (%)"), ("cases_5yr", "5-year sample cases"),
                           ("first_year", "First year"), ("last_year", "Last year")],
                          [("latest", f"{LATEST} estimate", {"stable_latest": "Reliable", "unstable_latest": "Unstable (not shown)", "not_observed_latest": "No sample cases"}),
                           ("pooled", f"{POOL_LABEL} estimate", {"stable": "Reliable", "unstable": "Unstable (not shown)", "no_cases": "No sample cases"}),
                           ("code_status", "Code status", {"current": "In use", "retired": "Deleted or retired", "unknown": "Not recorded"})])


def listing_dims():
    return writer.listing([("dimension", "Dimension"), ("value", "Value"), ("estimate_latest", f"{LATEST} estimated injuries"), ("cv_latest_pct", f"{LATEST} CV (%)"),
                           ("cases_latest", f"{LATEST} sample cases"), ("estimate_5yr", f"{POOL_LABEL} total"), ("cv_5yr_pct", "5-year CV (%)"),
                           ("share_5yr_pct", "Share of all injuries (%)"), ("admitted_pct", "Admitted (%)")],
                          [("dimension", "Dimension", {n: w.capitalize() for n, w, *_ in DIMENSIONS})])


def listing_themes():
    return writer.listing([("theme", "Theme"), ("estimate_latest", f"{LATEST} estimated injuries"), ("cv_latest_pct", f"{LATEST} CV (%)"), ("cases_latest", f"{LATEST} sample cases"),
                           ("estimate_5yr", f"{POOL_LABEL} total"), ("cv_5yr_pct", "5-year CV (%)"), ("first_year", "First year"), ("last_year", "Last year")], [])


def summary_common(now, db):
    return {"source": "U.S. Consumer Product Safety Commission, National Electronic Injury Surveillance System (NEISS) public-use annual files",
            "source_urls": [CPSC_QUERY_URL, FAQ_URL, EXPLAIN_URL], "years": f"{YEARS[0]}-{YEARS[-1]}", "formulas": FORMULAS, "caveats": CAVEATS,
            "pooled_note": pool_note(db), "design_break": break_note(db), "reliability_rule": "unstable when estimate < 1,200, or sample cases < 20, or CV > 33% (CPSC; estimate withheld)",
            "published": "aggregates only (no case records, narratives or excerpts)", "terms": TERMS_URL,
            "credit": "U.S. Consumer Product Safety Commission, NEISS public-use files; computed by this builder; not endorsed by CPSC", "generated_at": now}


def write_build(dataset, label, listing_block, summary, rows, inputs, now):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate record ids")
    for r in rows:
        r.pop("ordinal", None)
    if json.loads(json.dumps(rows)) != rows:
        raise SystemExit(f"{dataset}: rows are not JSON round-trip stable")
    path = os.path.join(OUT, f"{dataset}.json")
    blob = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows, "built_at": now, "inputs": inputs}
    os.makedirs(OUT, exist_ok=True)
    with open(path + ".part", "w", encoding="utf-8") as fh:
        json.dump(blob, fh, ensure_ascii=False)
    os.replace(path + ".part", path)
    h = hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()
    return {"dataset": dataset, "rows": len(rows), "bytes": os.path.getsize(path), "rows_sha256": h, "file": os.path.relpath(path, ROOT)}


def check_links(all_rows):
    ids = {ds: {r["id"] for r in rows} for ds, rows in all_rows.items()}
    total = ok = 0
    bad = []
    for ds, rows in all_rows.items():
        for r in rows:
            for link in r["item"]["links"] + r["detail"]["links"]:
                u = link["url"]
                if u.startswith("/records/"):
                    _, _, target_ds, rid = u.split("/", 3)
                    total += 1
                    if rid in ids.get(target_ds, ()):
                        ok += 1
                    else:
                        bad.append((r["id"], u))
    return total, ok, bad


def main():
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ctx = load_context()
    codes = product_universe(ctx)
    product_ids = {c for c in codes}
    p_rows, p_prof = product_rows(ctx)
    y_rows, y_prof = year_rows(ctx, product_ids)
    d_rows, d_prof = dimension_rows(ctx, product_ids)
    t_rows, t_prof = theme_rows(ctx, {str(c) for c in codes})
    y_rows.append(method_row(ctx, y_prof, None))
    all_rows = {DS_YEARS: y_rows, DS_PRODUCTS: p_rows, DS_DIMS: d_rows, DS_THEMES: t_rows}
    tot, ok, bad = check_links(all_rows)
    if bad:
        raise SystemExit(f"{len(bad)} cross-reference links point at records that do not exist, e.g. {bad[:5]}")
    common = summary_common(now, ctx["design_break"])
    doc_files = [DICT_NAME, "NEISS-Coding-Manual-2025-01-Rev1.pdf", "NEISS-Coding-Manual-2024-01.pdf", "Comparability-Table-2025.pdf",
                 "NEISS-Explanation-of-Estimates.html", "NEISS-FAQ.html", "NEISS-Sample-Design-1979-1996.pdf", "CPSC-Privacy-and-Security-Notice.html"]
    inputs = inputs_for(ctx, doc_files)
    out = []
    out.append(write_build(DS_YEARS, f"NEISS national injury estimates by year ({YEARS[0]}-{YEARS[-1]})", listing_years(),
                           {**common, "grain": "one record per treatment year, one series record and one method record",
                            "fields": "year profile: national estimate, CV, 95% CI, sample cases, hospitals by stratum, admitted-to-hospital shares, sex, age group, sex by age, disposition, location, body part, diagnosis, fire involvement, month and top products, each with CV and the CPSC reliability flag"},
                           y_rows, inputs, now))
    out.append(write_build(DS_PRODUCTS, "NEISS estimates by consumer product code", listing_products(),
                           {**common, "grain": "one record per NEISS product code that appears in the data", "codes": len(p_rows),
                            "fields": f"annual estimate, CV, CI and sample cases {YEARS[0]}-{YEARS[-1]}; pooled {POOL_LABEL} five-year total, average per year, admitted share, and splits by sex, age group, body part, diagnosis, disposition, location, fire involvement and month",
                            "labels": "CPSC NEISS Coding Manual (January 2025, January 2024) and the January 2025 comparability table; unlabelled codes stay Not recorded"},
                           p_rows, inputs, now))
    out.append(write_build(DS_DIMS, "NEISS estimates by body part, diagnosis, disposition, location, age, sex and month", listing_dims(),
                           {**common, "grain": "one record per value of each dimension", "dimensions": [w for _n, w, *_ in DIMENSIONS],
                            "fields": f"annual series {YEARS[0]}-{YEARS[-1]} with share of all injuries; pooled {POOL_LABEL}; top 20 products with reliable estimates",
                            "labels": f"CPSC NEISS data dictionary ({DICT_NAME}); codes without a label stay Not recorded"},
                           d_rows, inputs, now))
    out.append(write_build(DS_THEMES, "NEISS narrative keyword themes (builder classification, not CPSC categories)", listing_themes(),
                           {**common, "grain": "one record per narrative keyword theme", "themes": list(T.DEFS), "theme_definitions_hash": T.definitions_hash(),
                            "classification": THEME_CAVEAT},
                           t_rows, inputs, now))
    report = {"built_at": now, "datasets": out, "links_total": tot, "links_found": ok, "products": len(codes),
              "labels_missing_for_products": [c for c in codes if ctx["labels"].products.get(c) is None],
              "products_with_alternate_titles": sum(1 for c in codes if ctx["labels"].products.get(c, {}).get("alternates"))}
    with open(os.path.join(OUT, "build_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
