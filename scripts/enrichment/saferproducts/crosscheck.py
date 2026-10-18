"""Recall/repair cross-check and exact-key cross-references (pure functions).

Everything here matches on EXACT keys only: a recall number string, a normalised company name key (spdb_lib.company_key),
or an exact normalised product string. No fuzzy matching, no inferred MDL membership.
"""
import collections
import json
import os
import re

import spdb_lib as L


def text_key(value):
    """Exact comparison key for free product text: casefolded, punctuation -> single spaces."""
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_psv(path):
    with open(path, encoding="utf-8") as fh:
        return [line.rstrip("\n") for line in fh if line.strip()]


# ------------------------------------------------------------------ recall numbers

def compare_recalls(export_rows, corpus_rows, aggregate_years):
    """Export recalls/repairs vs the corpus recall dataset (agency_safety_cpsc_recalls_api) and the per-year aggregates."""
    exp, dup_numbers = {}, []
    for row in export_rows:
        if row["number"] in exp:
            dup_numbers.append(row["number"])
        exp[row["number"]] = row
    corp = {r["recall_number"]: r for r in corpus_rows}
    matched = sorted(exp.keys() & corp.keys())
    exp_only = sorted(exp.keys() - corp.keys())
    corp_only = sorted(corp.keys() - exp.keys())
    folded = {n.upper() for n in corp_only}
    case_only = [n for n in exp_only if n.upper() in folded]
    date_mismatch = [n for n in matched if exp[n]["date"].isoformat() != corp[n]["date"]]
    title_mismatch = [n for n in matched if L.clean(exp[n]["title"]).casefold() != L.clean(corp[n]["title"]).casefold()]
    url_mismatch = [n for n in matched if exp[n].get("url") and (corp[n].get("url") or "") != exp[n]["url"]]
    years = {}
    for row in export_rows:
        y = years.setdefault(row["date"].year, {"export_recalls": 0, "export_repairs": 0, "corpus": 0, "aggregates": None})
        y["export_repairs" if row["kind"] == "repair" else "export_recalls"] += 1
    for row in corpus_rows:
        years.setdefault(int(row["date"][:4]), {"export_recalls": 0, "export_repairs": 0, "corpus": 0, "aggregates": None})["corpus"] += 1
    for line in aggregate_years:
        year, recalls = line.split("|")[:2]
        years.setdefault(int(year), {"export_recalls": 0, "export_repairs": 0, "corpus": 0, "aggregates": None})["aggregates"] = int(recalls)
    return {
        "export_rows": len(export_rows), "export_recalls": sum(1 for r in export_rows if r["kind"] == "recall"),
        "export_repairs": sum(1 for r in export_rows if r["kind"] == "repair"), "export_duplicate_numbers": sorted(set(dup_numbers)),
        "corpus_rows": len(corpus_rows), "matched": len(matched), "export_only": exp_only, "corpus_only": corp_only,
        "case_only_differences": case_only, "date_mismatch": date_mismatch, "title_mismatch": title_mismatch, "url_mismatch": url_mismatch,
        "export_rows_with_url": sum(1 for r in export_rows if r.get("url")), "matched_numbers": matched,
        "years": [{"year": y, **v, "agree": (v["export_recalls"] + v["export_repairs"] == v["corpus"]) and (v["aggregates"] in (None, v["corpus"]))} for y, v in sorted(years.items())],
    }


# ------------------------------------------------------------------ companies with both reports and recalls

def recall_name_maps(corpus_rows):
    """exact / normalised / location-stripped name maps over recall firm names (manufacturers, importers, distributors)."""
    exact, norm, strip = [collections.defaultdict(lambda: collections.defaultdict(set)) for _ in range(3)]
    for row in corpus_rows:
        for role in ("manufacturers", "importers", "distributors"):
            for name in row.get(role) or []:
                name = L.clean(name)
                if not name:
                    continue
                num = row["recall_number"]
                exact[name][num].add(role[:-1])
                k = L.company_key(name)
                if k:
                    norm[k][name].add(num)
                ks = L.company_key(L.strip_location(name))
                if ks:
                    strip[ks][name].add(num)
    return exact, norm, strip


def match_company(name, exact, norm, strip):
    """(level, {recall firm name: set(recall numbers)}) at the strongest level, or (None, {})."""
    if name in exact:
        return "exact_string", {name: set(exact[name])}
    key = L.company_key(name)
    if key and key in norm:
        return "normalised", {n: set(v) for n, v in norm[key].items()}
    if key and key in strip:
        return "normalised_after_location_strip", {n: set(v) for n, v in strip[key].items()}
    return None, {}


def product_pairs(reports, recall_rows_by_number, recall_numbers):
    """Exact product keys shared by a company's reports and its matched recalls: the report's Product Description, or
    'Brand Model', equal (text_key) to a recall product name. Returns [(report, recall_number)]."""
    recall_keys = collections.defaultdict(set)
    for num in recall_numbers:
        for p in recall_rows_by_number[num].get("products") or []:
            k = text_key(p.get("name"))
            if len(k) >= 4:
                recall_keys[k].add(num)
    pairs = []
    if not recall_keys:
        return pairs
    for r in reports:
        for k in {text_key(r.product_desc), text_key((r.brand + " " + r.model).strip())}:
            for num in recall_keys.get(k, ()):
                pairs.append((r, num))
    return pairs


# ------------------------------------------------------------------ MDL products (exact product-name keys only)

_STOP = {
    "implant", "implants", "hernia", "mesh", "hip", "stem", "stems", "vaccine", "formula", "infant", "food", "valve", "device", "system", "products",
    "liability", "recalled", "chemical", "synthetic", "textured", "breast", "port", "catheters", "catheter", "polyethylene", "femoral", "head",
    "forced", "warming", "heater", "cooler", "spinal", "cord", "stimulators", "cartilage", "baby", "preterm", "airbag", "inflators", "control",
    "units", "transmission", "emissions", "diesel", "clean", "hair", "straighteners", "relaxers", "metals", "unintended", "acceleration",
    "vehicle", "theft", "plug", "hybrid", "taper", "versys", "milk", "based", "cow", "film", "like", "receptor", "agonists", "pump", "proton",
    "inhibitors", "eye", "injury", "live", "zoster", "polypropylene", "ivc", "filter", "filters", "heavy", "toyota", "kia", "hyundai",
}


def mdl_names(product):
    """Candidate exact names inside an MDL product label: the whole label, the part before '(', and each parenthetical."""
    names = {product}
    main = product.split("(")[0].strip()
    if main:
        names.add(main)
    names.update(m.strip() for m in re.findall(r"\(([^)]*)\)", product) if m.strip())
    return {text_key(n) for n in names if text_key(n)}


def mdl_exact_pairs(mdl_items, reports):
    """MDL product label equal (text_key) to a report Brand, Product Type title, Sub Category, Category or Product Description."""
    fields = collections.defaultdict(collections.Counter)
    for r in reports:
        fields["brand"][text_key(r.brand)] += 1
        fields["product_type"][text_key(re.sub(r"\s*\(\d+\)\s*$", "", r.ptype))] += 1
        fields["sub_category"][text_key(r.subcategory)] += 1
        fields["category"][text_key(r.category)] += 1
        fields["product_description"][text_key(r.product_desc)] += 1
    pairs = []
    for item in mdl_items:
        for name in sorted(mdl_names(item["product"])):
            for field, counter in fields.items():
                if name in counter:
                    pairs.append({"mdl": item["mdl"], "product": item["product"], "matched_name": name, "field": field, "reports": counter[name]})
    return pairs


def mdl_candidates(mdl_items, reports):
    """Review list (never linked): distinctive words of each MDL product label that equal a whole word of a report Brand or
    manufacturer string. Counts and the product categories involved only."""
    results = []
    word_index = collections.defaultdict(list)
    for r in reports:
        words = set(text_key(r.brand).split()) | set(text_key(r.mfr).split())
        for w in words:
            word_index[w].append(r)
    for item in mdl_items:
        tokens = {w for name in mdl_names(item["product"]) for w in name.split() if len(w) >= 4 and w.isalpha() and w not in _STOP}
        for token in sorted(tokens):
            hits = word_index.get(token, [])
            if hits:
                cats = collections.Counter(r.ptype for r in hits)
                results.append({"mdl": item["mdl"], "product": item["product"], "word": token, "reports": len(hits), "top_report_product_types": [list(c) for c in cats.most_common(3)]})
    return results
