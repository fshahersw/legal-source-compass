"""Emerging-tort radar: products whose published safety counts are rising and that have NO MDL LINKED.

Dataset: agency_safety_tort_radar (one record per candidate unit + `summary:overview`). Every number is a count the source
published (openFDA FAERS monthly series stored in safety.series, NHTSA ODI complaints in safety.nhtsa_complaints, NHTSA
investigations and recalls, JPML hearing-session matters, SEC 10-K legal-proceedings paragraphs). The score is a sum of
small integer points, and every component that produced a point is stored with its observed and expected counts, so the
page can show it and recompute the total.

Units
  drug:faers:<subject>          one FAERS product (openFDA harmonised generic name); subjects whose window counts are
                                identical are one unit (every published spelling listed), never counted twice
  vehicle:<make>-<model>-<component>   NHTSA complaints as NHTSA lists make, model and component on the complaint
  jpml:<mdl number>             a products-liability motion to create an MDL that is pending or was denied (no MDL)

Score (points; families A-D; see METHOD for the wording the page shows)
  A reports    O = last 12 complete months; E = (prior 36 months / 3) x national factor (FAERS) or prior 12 months x
               national factor (NHTSA). Rated only when O >= 50 and the baseline covers >= 24 months.
               Exact Poisson 95% lower bound of O, divided by E: <= 1 -> 0; <= 1.5 -> 1; > 1.5 -> 2.
  B severity   FAERS: 1 if the death-report lower bound ratio > 1 (deaths), 1 if the serious share >= the national share
               and serious reports rose (lower bound ratio > 1). NHTSA: 1 if crash/fire/injury complaints rose (lower
               bound ratio > 1), 1 if deaths rose (lower bound ratio > 1, prior deaths > 0).
  C regulator  last 24 months, exact keys only: NHTSA open EA 2, open PE/RQ/DP 1, recall campaign 1 (make + model +
               component in NHTSA's own vocabulary); reviewed recalls for JPML matters (FDA Class I 2, other 1,
               CPSC 1). Capped at 3. FDA recalls carry no exact product key in the corpus, so drugs score 0 here.
  D litigation JPML motion pending 3, centralization denied within 36 months 2 (reviewed links only for products);
               a 10-K paragraph that names the product AND a products-liability term 1.
  Ranking: families with points (0-4), then points, then excess reports (O - E).

Exclusion ("No MDL linked" errs toward "in an MDL"): the union of safety.mdl_subjects links; the MDL title's names
matched exactly to the openFDA generic name (or the name followed by a salt/form word); Drugs@FDA brand -> active
ingredient (exact strings) for names the title prints; openFDA NDC pharm_class_epc equal to the class a class-MDL
title names; the reviewed class-member list in radar_reviewed_links.json; MDLs centralized after the last pending
report (JPML transfer orders in mdl_intel_hearing_orders); NHTSA vehicle MDL rules (scripts/safety_v2/mdl_map.py).
A unit linked to a pending MDL is `pending_mdl` (kept in the dataset, left out of the emerging list); one linked only
to terminated MDLs is `terminated_mdl` (shown with a flag); otherwise `none_linked`.

Modes (read-only unless publishing):
  python -B scripts/enrichment/build_emerging_tort_radar.py ndc-classes <drug-ndc-0001-of-0001.json.zip> <out.json>
  python -B scripts/enrichment/build_emerging_tort_radar.py build --inputs private/acq/radar/inputs --dry-run
  python -B scripts/enrichment/build_emerging_tort_radar.py build --live [--no-rpc] --ndc <ndc_epc.json> --dry-run
  python -B scripts/enrichment/build_emerging_tort_radar.py build --live --ndc <ndc_epc.json>       (lead: publishes)
--live reads with EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment: the RPCs
safety_series_window_v1 / safety_nhtsa_complaint_windows_v1 (database/contracts/safety-radar-v1.sql) when present,
otherwise (or with --no-rpc) the slower existing RPCs safety_subject_v1 / safety_records_v1. --dry-run writes the
packet (records.json, summary.json, top.md) to --out (default private/acq/radar/packet) and never writes the corpus.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts" / "safety_v2"))
import mdl_map  # noqa: E402

DATASET = "agency_safety_tort_radar"
LABEL = "Emerging-tort radar: rising safety reports with no MDL linked"
REVIEWED = HERE / "radar_reviewed_links.json"
FAERS_URL = "https://open.fda.gov/apis/drug/event/"
NHTSA_URL = "https://www.nhtsa.gov/nhtsa-datasets-and-apis"
JPML_URL = "https://www.jpml.uscourts.gov/"
SEC_URL = "https://www.sec.gov/edgar/search/"
NDC_URL = "https://download.open.fda.gov/drug/ndc/drug-ndc-0001-of-0001.json.zip"
MIN_REPORTS = 50
MIN_BASELINE_MONTHS = 24
CAVEAT = ("Reports are voluntary and unverified; a rise in reports does not show that a product caused harm, and a high "
          "score is not a judgment on the merits of any claim. 'No MDL linked' means no MDL is linked by the exact keys "
          "listed, not that no litigation exists.")
# Products-liability words only: "MDL" / "multidistrict" alone also cover antitrust and securities MDLs.
PL_TERMS = re.compile(r"products?[- ]liability|personal[- ]injur|bodily injur|wrongful death|mass tort", re.I)
QUALITY_TERMS = re.compile(
    r"ADHESION|^PRODUCT .*(ISSUE|ERROR|COMPLAINT)$|^DEVICE .*(ISSUE|ERROR|FAILURE|MALFUNCTION)$|^PRODUCT QUALITY|"
    r"DOSE OMISSION|WRONG TECHNIQUE|INCORRECT DOSE|OFF LABEL USE|PRODUCT USE IN UNAPPROVED|UNDERDOSE|EXTRA DOSE|"
    r"INAPPROPRIATE SCHEDULE|ACCIDENTAL EXPOSURE TO PRODUCT|NO ADVERSE EVENT|INTERCEPTED|EXPIRED PRODUCT", re.I)
INVESTIGATION_POINTS = {"EA": 2, "PE": 1, "RQ": 1, "DP": 1}
FAMILY_LABEL = {"A": "Reports", "B": "Severity", "C": "Regulator", "D": "Litigation"}


# ---------------------------------------------------------------------------------------------------- statistics
def _gammainc_lower(a, x):
    """Regularized lower incomplete gamma P(a, x) (series for x < a+1, continued fraction otherwise)."""
    if x <= 0:
        return 0.0
    gln = math.lgamma(a)
    if x < a + 1:
        term = total = 1.0 / a
        ap = a
        for _ in range(100000):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-15:
                break
        return min(1.0, total * math.exp(-x + a * math.log(x) - gln))
    b = x + 1 - a
    c = 1 / 1e-300
    d = 1 / b
    h = d
    for i in range(1, 100000):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c
        c = 1e-300 if abs(c) < 1e-300 else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-15:
            break
    return max(0.0, 1.0 - math.exp(-x + a * math.log(x) - gln) * h)


def _solve(f, lo, hi):
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(mid):
            hi = mid
        else:
            lo = mid
        if hi - lo <= 1e-9 * max(1.0, hi):
            break
    return (lo + hi) / 2


def poisson_lower(observed, alpha=0.05):
    """Exact (Garwood) lower confidence limit of a Poisson count: P(X >= observed | mu) = alpha/2."""
    if observed <= 0:
        return 0.0
    hi = observed + 20 * math.sqrt(observed) + 20
    return _solve(lambda mu: _gammainc_lower(observed, mu) >= alpha / 2, 0.0, hi)


def poisson_upper(observed, alpha=0.05):
    """Exact (Garwood) upper confidence limit: P(X <= observed | mu) = alpha/2."""
    hi = observed + 20 * math.sqrt(observed + 1) + 20
    return _solve(lambda mu: _gammainc_lower(observed + 1, mu) >= 1 - alpha / 2, 0.0, hi)


def ratio_points(lb_ratio):
    if lb_ratio is None or lb_ratio <= 1:
        return 0
    return 1 if lb_ratio <= 1.5 else 2


# ---------------------------------------------------------------------------------------------------- dates
def month_add(month, n):
    y, m = divmod(month.year * 12 + month.month - 1 + n, 12)
    return dt.date(y, m + 1, 1)


def last_complete_month(max_date):
    """The last month the source fully covers: the month of max_date when it is that month's last day, else the
    month before (a partial month is never compared with complete ones)."""
    if isinstance(max_date, str):
        max_date = dt.date.fromisoformat(max_date[:10])
    nxt = max_date + dt.timedelta(days=1)
    first = dt.date(max_date.year, max_date.month, 1)
    return first if nxt.month != max_date.month else month_add(first, -1)


def ym(d):
    return d.strftime("%Y-%m")


def window_label(end, months):
    return f"{ym(month_add(end, -(months - 1)))} to {ym(end)}"


# ---------------------------------------------------------------------------------------------------- components
def rate_component(family, metric, observed, baseline, baseline_months, *, recent_months=12, factor=1.0, window="",
                   source="", source_url="", min_observed=MIN_REPORTS, annualise=True, max_points=2, point_rule=None):
    """One rate-ratio component: O vs E with the exact Poisson lower bound. Never rates a partial window, a short
    baseline, an expected count of 0 or an O below the minimum; those carry a note and 0 points."""
    c = {"family": family, "metric": metric, "observed": observed, "expected": None, "ratio": None, "ci_low": None,
         "ci_high": None, "points": 0, "max_points": max_points, "window": window, "source": source,
         "source_url": source_url, "rated": False, "note": None}
    if observed is None or baseline is None:
        c["note"] = "Not recorded"
        return c
    if recent_months < 12:
        c["note"] = "Partial window: not rated"
        return c
    if annualise:
        if baseline_months < MIN_BASELINE_MONTHS:
            c["note"] = f"Baseline covers {baseline_months} months: not rated"
            return c
        expected = baseline * 12 / baseline_months * factor
    else:
        expected = baseline * factor
    c["expected"] = round(expected, 1)
    if observed < min_observed:
        c["note"] = "Too few reports to rate" if min_observed > 1 else "Not recorded"
        return c
    if expected <= 0:
        c["note"] = "No reports in the baseline: not rated"
        return c
    lo, hi = poisson_lower(observed), poisson_upper(observed)
    c.update(ratio=round(observed / expected, 3), ci_low=round(lo / expected, 3), ci_high=round(hi / expected, 3), rated=True)
    c["points"] = (point_rule or ratio_points)(c["ci_low"])
    return c


def one_if_above_one(lb):
    return 1 if lb is not None and lb > 1 else 0


def fixed_component(family, metric, points, *, max_points, observed=None, window="", source="", source_url="", note=None):
    return {"family": family, "metric": metric, "observed": observed, "expected": None, "ratio": None, "ci_low": None,
            "ci_high": None, "points": points, "max_points": max_points, "window": window, "source": source,
            "source_url": source_url, "rated": points > 0 or observed is not None, "note": note}


def totals(components):
    points = sum(c["points"] for c in components)
    families = sorted({c["family"] for c in components if c["points"] > 0})
    return points, families


# ---------------------------------------------------------------------------------------------------- text keys
def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().upper())


def generic_parts(generic):
    """The ingredient names inside an openFDA generic name ('A, B AND C' -> A, B, C)."""
    return [p.strip() for p in re.split(r",\s*|\s+AND\s+|\s*/\s*", norm(generic)) if p.strip()]


def name_matches(generic, name):
    """Exact: the generic (or one of its ingredients) is the name, or the name followed by a salt/form word."""
    n = norm(name)
    if not n:
        return False
    return any(p == n or p.startswith(n + " ") for p in [norm(generic)] + generic_parts(generic))


def norm_component(s):
    return re.sub(r"\s*:\s*", ":", norm(s))


def component_matches(unit_component, other):
    """NHTSA's component vocabulary is hierarchical ('ELECTRICAL SYSTEM:INSTRUMENT CLUSTER/PANEL'): two components
    match when they are equal or one is the other's parent heading."""
    a, b = norm_component(unit_component), norm_component(other)
    return a == b or a.startswith(b + ":") or b.startswith(a + ":")


VEHICLE_YEARS = re.compile(r"\s+(\d{4}(\s*[-–]\s*\d{4})?|UNKNOWN)$")


def vehicle_key(vehicle):
    """'TESLA MODEL Y 2021–2023' -> 'TESLA MODEL Y' (NHTSA's make + model, years dropped)."""
    return VEHICLE_YEARS.sub("", norm(vehicle))


def slug(*parts):
    s = "-".join(re.sub(r"[^a-z0-9]+", "-", str(p).lower()).strip("-") for p in parts if p is not None)
    return re.sub(r"-{2,}", "-", s)[:90].strip("-")


def word_pattern(name):
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.I)


# ---------------------------------------------------------------------------------------------------- inputs
def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def parse_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.startswith("["):
        try:
            return json.loads(value)
        except ValueError:
            return []
    return [value] if value else []


class SnapshotInputs:
    """Read-only inputs saved as JSON in the shapes the RPCs and REST reads return (see the packet README)."""

    def __init__(self, directory, ndc=None):
        d = Path(directory)
        self.dir = d
        subjects = load_json(d / "safety_subjects.json")
        self.subjects = subjects["subjects"]
        self.mdl_links = subjects["mdl_links"]
        self.faers_windows = load_json(d / "faers_windows.json")
        ctx = load_json(d / "mdl_context.json")
        self.mdls, self.terminated, self.hearing_orders = ctx["mdls"], ctx["terminated"], ctx["hearing_orders"]
        self.drugsfda = load_json(d / "drugsfda.json")
        self.nhtsa_windows = load_json(d / "nhtsa_windows.json")
        reg = load_json(d / "nhtsa_regulator.json")
        self.nhtsa_max_received = reg["complaints_max_received"]
        self.investigations, self.recalls = reg["investigations"], reg["recalls"]
        self.sec = load_json(d / "sec_paragraphs.json")
        self.term_quarters = load_json(d / "term_quarters.json") if (d / "term_quarters.json").exists() else []
        ndc_path = Path(ndc) if ndc else d / "ndc_epc.json"
        self.ndc = load_json(ndc_path) if ndc_path.exists() else None
        self.basis = "snapshot"


# ---------------------------------------------------------------------------------------------------- context
class Context:
    """Lookups shared by every unit: MDL statuses, exclusion keys, identifiers, evidence."""

    def __init__(self, inp, reviewed, as_of):
        self.inp, self.reviewed, self.as_of = inp, reviewed, as_of
        self.mdl = {}  # mdl -> {status, title, source, url, date}
        for r in inp.terminated:
            m = ((r.get("item") or {}).get("history") or {}).get("mdl")
            if isinstance(m, int):
                self.mdl[m] = {"status": "terminated", "title": r.get("title"), "source": "mdl_terminated_history",
                               "url": r.get("source_url") or JPML_URL, "date": None,
                               "year": ((r.get("item") or {}).get("history") or {}).get("termination_year")}
        for r in inp.mdls:
            if str(r.get("id", "")).isdigit():
                item = r.get("item") or {}
                self.mdl[int(r["id"])] = {"status": "pending", "title": r.get("title"), "source": "mdls",
                                          "url": r.get("source_url") or JPML_URL, "date": item.get("date_transferred")}
        self.matters = [r for r in inp.hearing_orders if (r.get("item") or {}).get("kind") == "matter"]
        # Centralized by a JPML transfer order after the last pending report (not yet in dataset `mdls`).
        for r in self.matters:
            m = r["item"].get("matter") or {}
            mdl = m.get("mdl")
            if m.get("outcome") == "granted" and isinstance(mdl, int) and mdl not in self.mdl and is_pl(r):
                ev = m.get("evidence") or {}
                self.mdl[mdl] = {"status": "pending", "title": m.get("title"), "source": "mdl_intel_hearing_orders",
                                 "url": ev.get("url") or r.get("source_url"), "date": ev.get("date") or m.get("session"),
                                 "record_id": r.get("id"), "after_report": True}
        for e in getattr(mdl_map, "MDLS_SINCE_PENDING_REPORT", []):
            ev = e.get("jpml_evidence") or {}
            if e["mdl"] not in self.mdl:
                self.mdl[e["mdl"]] = {"status": "pending", "title": ev.get("title"), "source": ev.get("dataset"),
                                      "url": ev.get("order_url"), "date": ev.get("order_date"), "after_report": True}
        self.links_by_subject = {}
        for l in inp.mdl_links:
            self.links_by_subject.setdefault(l["subject_id"], []).append(l)
        self.drug_entries = [e for e in mdl_map.MDLS + list(getattr(mdl_map, "MDLS_SINCE_PENDING_REPORT", []))
                             if e["kind"] == mdl_map.DRUG]
        self.vehicle_entries = [e for e in mdl_map.MDLS if e["kind"] == "vehicle"]
        self.fda = []
        for r in inp.drugsfda:
            f = r.get("fields") or {}
            self.fda.append({"application_number": f.get("application_number"), "sponsor": f.get("sponsor_name"),
                             "brands": [norm(b) for b in parse_list(f.get("brand_names")) if b],
                             "ingredients": [norm(a) for a in parse_list(f.get("active_ingredients")) if a]})
        self.ndc = inp.ndc or {}
        self.ndc_classes = {norm(k): v for k, v in (self.ndc.get("classes") or {}).items()}

    def brand_ingredients(self, name):
        """Active ingredients (exact Drugs@FDA strings) of applications whose brand name is the title's name, or the
        name followed by more words ('PARAGARD T 380A' for 'Paragard')."""
        cache = self.__dict__.setdefault("_brand_cache", {})
        nn = norm(name)
        if nn not in cache:
            found = {}
            for app in self.fda:
                if any(b == nn or b.startswith(nn + " ") for b in app["brands"]):
                    for ing in app["ingredients"]:
                        found.setdefault(ing, app)
            cache[nn] = found
        return cache[nn]

    def mdl_info(self, mdl):
        return self.mdl.get(mdl) or {"status": "unknown", "title": None, "source": None, "url": JPML_URL, "date": None}

    # ------------------------------------------------------------------ drugs
    def drug_links(self, subject_ids, generics):
        links = []

        def add(mdl, basis, note, source_url=None):
            if not any(x["mdl"] == mdl and x["basis"] == basis for x in links):
                info = self.mdl_info(mdl)
                links.append({"mdl": mdl, "basis": basis, "note": note, "status": info["status"], "title": info["title"],
                              "source_url": source_url or info["url"], "date": info.get("date")})

        for sid in subject_ids:
            for l in self.links_by_subject.get(sid, []):
                add(l["mdl"], "safety_mdl_subjects", f"Linked in safety.mdl_subjects ({l.get('basis')}).", l.get("title_source_url"))
        for e in self.drug_entries:
            names = list(e.get("names", [])) + list(e.get("generics", []))
            for g in generics:
                hit = next((n for n in names if name_matches(g, n)), None)
                if hit:
                    add(e["mdl"], "title_names_generic", f"The MDL title names '{hit}'; the openFDA generic name is '{g}'.")
                for epc in e.get("epc", []):
                    classes = self.ndc_classes.get(norm(g)) or []
                    if epc in classes:
                        add(e["mdl"], "epc_class", f"openFDA NDC pharm_class_epc of '{g}' is '{epc}', the class the title names.", NDC_URL)
                parts = {norm(g)} | set(generic_parts(g))
                for n in e.get("names", []):
                    for ing, app in self.brand_ingredients(n).items():
                        if ing in parts:
                            add(e["mdl"], "brand_active_ingredient",
                                f"Drugs@FDA {app['application_number']}: brand {app['brands'][0]} (the title names '{n}') has active ingredient '{ing}'.")
                            break
        for x in self.reviewed.get("class_members", []):
            for g in generics:
                hit = next((n for n in x["generic_names"] if name_matches(g, n)), None)
                if hit:
                    add(x["mdl"], "reviewed_class_member", f"Reviewed list: '{hit}' is a member of the class the title names ({x['class']}).")
        return links

    def identifiers(self, generics):
        apps = [a for a in self.fda if a["ingredients"] and len(a["ingredients"]) == 1 and a["ingredients"][0] in {norm(g) for g in generics}]
        apps.sort(key=lambda a: a["application_number"] or "")
        return {"application_numbers": [a["application_number"] for a in apps][:10],
                "brand_names": sorted({b for a in apps for b in a["brands"]})[:10],
                "sponsors": sorted({a["sponsor"] for a in apps if a["sponsor"]})[:6]}

    # ------------------------------------------------------------------ vehicles
    def vehicle_links(self, make, model, component):
        links, notes = [], []
        for e in self.vehicle_entries:
            rule = e.get("nhtsa") or {}
            makes = [norm(m) for m in rule.get("make", [])]
            models = [norm(m) for m in rule.get("model", [])]
            comps = rule.get("component", [])
            if makes and make not in makes:
                continue
            info = self.mdl_info(e["mdl"])
            base = {"mdl": e["mdl"], "status": info["status"], "title": info["title"], "source_url": info["url"], "date": info.get("date")}
            if comps and any(component_matches(component, c) for c in comps) and (not models or any(m in model for m in models)):
                links.append({**base, "basis": "vehicle_rule_component",
                              "note": f"MDL {e['mdl']}'s complaint rule covers {', '.join(makes) or 'every make'} / {', '.join(comps)}; the rule's text terms cannot be checked per unit, so the unit is treated as in that MDL."})
            elif models and any(m in model for m in models):
                links.append({**base, "basis": "vehicle_rule_model", "note": f"MDL {e['mdl']}'s complaint rule names {', '.join(makes)} {', '.join(models)}."})
            elif makes and not comps and not models:
                notes.append({"mdl": e["mdl"], "status": info["status"], "rule": rule})
        return links, notes


def is_pl(matter_row):
    item = matter_row.get("item") or {}
    m = item.get("matter") or {}
    t = (item.get("cells") or {}).get("type")
    return t == "Products Liability" or bool(re.search(r"PRODUCTS?\s+[LI]?IABILITY", (m.get("title") or "").upper()))


def mdl_status(links):
    statuses = {l["status"] for l in links}
    if not links:
        return "none_linked"
    if statuses & {"pending", "unknown"}:
        return "pending_mdl"
    return "terminated_mdl"


# ---------------------------------------------------------------------------------------------------- FAERS
def faers_window_index(rows):
    out = {}
    for r in rows:
        out.setdefault(r["subject_id"], {})[r["series"]] = r
    return out


def group_duplicates(subject_ids, windows):
    """Subjects whose windowed counts are identical in every series are one unit (the counts are the same reports
    under several published spellings)."""
    groups = {}
    for sid in subject_ids:
        w = windows.get(sid) or {}
        key = tuple((s, (w.get(s) or {}).get("values_hash"), (w.get(s) or {}).get("recent"), (w.get(s) or {}).get("baseline"))
                    for s in ("faers_reports", "faers_serious", "faers_death"))
        groups.setdefault(key, []).append(sid)
    return list(groups.values())


def term_trends(quarter_rows, recent_quarters, prior_quarters):
    """Rising MedDRA preferred terms from the stored top-N per quarter. A term missing from a quarter's stored list is
    'Not recorded' for that window (never 0)."""
    by = {r["period"]: {t: v for t, v in (r.get("rows") or [])} for r in quarter_rows}
    limit = max([r.get("limit_n") or 0 for r in quarter_rows] or [0])
    if not all(q in by for q in recent_quarters):
        return [], limit

    def window_sum(term, quarters):
        if not all(q in by for q in quarters):
            return None
        vals = [by[q].get(term) for q in quarters]
        return None if any(v is None for v in vals) else sum(vals)

    terms = set.intersection(*[set(by[q]) for q in recent_quarters])
    out = []
    for t in terms:
        rec = window_sum(t, recent_quarters)
        pri = window_sum(t, prior_quarters)
        out.append({"term": t, "recent": rec, "prior": pri, "quality": bool(QUALITY_TERMS.search(t))})
    out.sort(key=lambda x: (-(x["recent"] - x["prior"]) if x["prior"] is not None else -x["recent"], x["term"]))
    return out[:8], limit


def quarters_of(end, months):
    qs = []
    for i in range(months):
        m = month_add(end, -i)
        q = f"{m.year}-Q{(m.month - 1) // 3 + 1}"
        if q not in qs:
            qs.append(q)
    return list(reversed(qs))


# ---------------------------------------------------------------------------------------------------- SEC
def sec_hits(names, filings):
    """10-K paragraphs naming the product AND a products-liability term (patent/ANDA-only paragraphs never count)."""
    pats = [(n, word_pattern(n)) for n in names if len(n) >= 4]
    hits = []
    for f in filings:
        for p in f.get("paragraphs") or []:
            text = p.get("text") or ""
            if not PL_TERMS.search(text):
                continue
            named = [n for n, pat in pats if pat.search(text)]
            if named:
                fil = f.get("filing") or {}
                hits.append({"dataset": "company_sec_legal_proceedings", "id": f.get("id"), "url": f.get("source_url"),
                             "date": fil.get("filed"), "label": f"{fil.get('company')} {fil.get('form') or '10-K'} ({p.get('section')})",
                             "basis": f"Names {', '.join(named)} in a paragraph with a products-liability term",
                             "excerpt": excerpt(text, named[0])})
                break
    return hits


def excerpt(text, name, width=220):
    m = word_pattern(name).search(text)
    if not m:
        return text[:width]
    start = max(0, m.start() - width // 2)
    return ("…" if start else "") + text[start:start + width].strip() + ("…" if start + width < len(text) else "")


# ---------------------------------------------------------------------------------------------------- build
class Radar:
    def __init__(self, inp, reviewed, as_of):
        self.inp = inp
        self.as_of = as_of if isinstance(as_of, dt.date) else dt.date.fromisoformat(as_of)
        self.ctx = Context(inp, reviewed, self.as_of)
        self.reviewed = reviewed
        self.units = []

    # ------------------------------------------------------------------ drugs
    def build_drugs(self):
        win = faers_window_index(self.inp.faers_windows)
        nat = win.get("national:faers") or {}
        nr, ns, nd = nat.get("faers_reports"), nat.get("faers_serious"), nat.get("faers_death")
        if not nr:
            raise SystemExit("national:faers series missing from the window read")
        end = dt.date.fromisoformat(str(nr["coverage_to"])[:10])
        end = min(end, last_complete_month(self.as_of))
        self.faers_end = end
        factor = nr["recent"] / (nr["baseline"] / nr["baseline_months"] * 12)
        death_factor = nd["recent"] / (nd["baseline"] / nd["baseline_months"] * 12) if nd else 1.0
        serious_factor = ns["recent"] / (ns["baseline"] / ns["baseline_months"] * 12) if ns else 1.0
        serious_share = ns["recent"] / nr["recent"] if ns and nr["recent"] else None
        self.national = {"faers": {"recent": nr["recent"], "baseline": nr["baseline"], "baseline_months": nr["baseline_months"],
                                   "factor": round(factor, 4), "death_factor": round(death_factor, 4),
                                   "serious_factor": round(serious_factor, 4),
                                   "serious_share": round(serious_share, 4) if serious_share else None,
                                   "window": window_label(end, 12), "baseline_window": window_label(month_add(end, -12), 36),
                                   "series": {"unit": "FAERS reports per month (all products)", "values": nr.get("tail") or [],
                                              "start": ym(month_add(end, -(len(nr.get("tail") or []) - 1)))}}}
        subjects = {s["id"]: s for s in self.inp.subjects if s["id"].startswith("faers:")}
        with_series = sorted(sid for sid in win if sid.startswith("faers:") and "faers_reports" in win[sid])
        self.coverage_faers = {"indexed": len(subjects), "with_series": len(with_series)}
        quarters = {}
        for r in self.inp.term_quarters:
            quarters.setdefault(r["subject_id"], []).append(r)
        recent_q, prior_q = quarters_of(end, 12), quarters_of(month_add(end, -12), 12)
        for group in group_duplicates(with_series, win):
            group.sort(key=lambda sid: (-(subjects.get(sid, {}).get("reports_total") or 0), sid))
            sid = group[0]
            s = subjects.get(sid, {"id": sid, "label": sid.split(":", 1)[1], "keys": {}})
            w = win[sid]
            r, se, de = w.get("faers_reports"), w.get("faers_serious"), w.get("faers_death")
            generics = sorted({norm((subjects.get(g) or {}).get("keys", {}).get("generic_name") or g.split(":", 1)[1].replace("-", " ")) for g in group})
            window = window_label(end, 12)
            comps = [rate_component("A", "FAERS reports", r["recent"], r["baseline"], r["baseline_months"], recent_months=r["recent_months"],
                                    factor=factor, window=window, source="FDA FAERS via openFDA", source_url=FAERS_URL)]
            dc = rate_component("B", "FAERS death reports", de["recent"] if de else None, de["baseline"] if de else None,
                                de["baseline_months"] if de else 0, recent_months=de["recent_months"] if de else 0,
                                factor=death_factor, window=window, source="FDA FAERS via openFDA", source_url=FAERS_URL,
                                min_observed=10, max_points=1, point_rule=one_if_above_one)
            comps.append(dc)
            sc = rate_component("B", "FAERS serious reports", se["recent"] if se else None, se["baseline"] if se else None,
                                se["baseline_months"] if se else 0, recent_months=se["recent_months"] if se else 0,
                                factor=serious_factor, window=window, source="FDA FAERS via openFDA", source_url=FAERS_URL,
                                max_points=1, point_rule=one_if_above_one)
            share = se["recent"] / r["recent"] if se and r["recent"] else None
            sc["share"] = round(share, 4) if share is not None else None
            sc["national_share"] = self.national["faers"]["serious_share"]
            if sc["points"] and (share is None or serious_share is None or share < serious_share):
                sc["points"] = 0
                sc["note"] = "Serious share below the national share"
            comps.append(sc)
            ids = self.ctx.identifiers(generics)
            links = self.ctx.drug_links(group, generics)
            # Brand names only (exact Drugs@FDA NDA/BLA brands of this ingredient): a generic name is printed in many
            # companies' filings (generic makers, distributors) and would credit the wrong product.
            names = [b for b in ids["brand_names"] if b not in set(generics) and re.match(r"^[A-Z][A-Z0-9-]{3,}", b)]
            hits = sec_hits(sorted(set(names)), self.inp.sec)
            comps.append(fixed_component("C", "FDA recalls (exact product key)", 0, max_points=3, window="last 24 months",
                                         source="openFDA drug enforcement", source_url="https://open.fda.gov/apis/drug/enforcement/",
                                         note="Not recorded: FDA recall records in the corpus carry no exact product key"))
            comps.append(fixed_component("D", "10-K paragraph names the product with a products-liability term", 1 if hits else 0,
                                         max_points=1, observed=len(hits), source="SEC EDGAR 10-K legal proceedings", source_url=SEC_URL))
            term_sid = next((g for g in group if quarters.get(g)), sid)
            terms, limit = term_trends(quarters.get(term_sid, []), recent_q, prior_q)
            flags = []
            if terms and sum(1 for t in terms[:3] if t["quality"]) >= 2:
                flags.append({"key": "quality_driver", "label": "Product-quality terms lead the rise",
                              "detail": "Two of the three fastest-rising MedDRA terms describe product or use problems, not injuries: " +
                                        ", ".join(t["term"] for t in terms[:3] if t["quality"])})
            unit = self.unit("drug", f"drug:faers:{sid.split(':', 1)[1]}", s.get("label") or sid, comps, links,
                             identifiers={"faers_subjects": group, "generic_names": generics,
                                          "spellings": sorted({(subjects.get(g) or {}).get("label") or g for g in group}), **ids},
                             series={"unit": "FAERS reports per month", "start": ym(month_add(end, -(len(r.get("tail") or []) - 1))),
                                     "values": r.get("tail") or [], "source": "FDA FAERS via openFDA", "source_url": FAERS_URL},
                             evidence=hits, flags=flags, window={"recent": window, "baseline": window_label(month_add(end, -12), 36)})
            unit["top_rising_terms"] = terms
            unit["terms_window"] = {"recent": f"{recent_q[0]} to {recent_q[-1]}", "prior": f"{prior_q[0]} to {prior_q[-1]}", "top_n": limit}
            self.post_filing(unit, links, end)
            self.units.append(unit)

    # ------------------------------------------------------------------ vehicles
    def build_vehicles(self):
        end = last_complete_month(self.inp.nhtsa_max_received)
        rows = self.inp.nhtsa_windows
        nat = next((r for r in rows if r["scope"] == "national"), None)
        if not nat:
            raise SystemExit("national NHTSA row missing from the window read")
        factor = nat["recent"] / nat["prior"]
        sev_factor = nat["recent_severe"] / nat["prior_severe"] if nat["prior_severe"] else 1.0
        death_factor = nat["recent_deaths"] / nat["prior_deaths"] if nat["prior_deaths"] else 1.0
        self.nhtsa_end = end
        self.national["nhtsa"] = {"recent": nat["recent"], "prior": nat["prior"], "factor": round(factor, 4),
                                  "severe_factor": round(sev_factor, 4), "death_factor": round(death_factor, 4),
                                  "window": window_label(end, 12), "baseline_window": window_label(month_add(end, -12), 12),
                                  "latest_received": str(self.inp.nhtsa_max_received),
                                  "series": {"unit": "NHTSA complaints per month (all vehicles)", "values": nat.get("months") or [],
                                             "start": ym(month_add(end, -(len(nat.get("months") or []) - 1)))}}
        window = window_label(end, 12)
        since = month_add(end, -23)
        invs, recalls = self.inp.investigations, self.inp.recalls
        units = [r for r in rows if r["scope"] == "unit"]
        self.coverage_vehicles = {"units": len(units), "min_recent": MIN_REPORTS}
        for r in units:
            make, model, comp = r["make"], r["model"], r["component"]
            key = f"{make} {model}"
            comps = [rate_component("A", "NHTSA complaints", r["recent"], r["prior"], 12, factor=factor, annualise=False, window=window,
                                    source="NHTSA ODI complaints", source_url=NHTSA_URL)]
            comps.append(rate_component("B", "Complaints with a crash, fire or injury", r["recent_severe"], r["prior_severe"], 12,
                                        factor=sev_factor, annualise=False, window=window, source="NHTSA ODI complaints",
                                        source_url=NHTSA_URL, min_observed=10, max_points=1, point_rule=one_if_above_one))
            dc = rate_component("B", "Deaths reported in complaints", r["recent_deaths"], r["prior_deaths"], 12, factor=death_factor,
                                annualise=False, window=window, source="NHTSA ODI complaints", source_url=NHTSA_URL,
                                min_observed=1, max_points=1, point_rule=one_if_above_one)
            comps.append(dc)
            evidence, c_points, recall_dates = [], 0, []
            for inv in invs:
                i = (inv.get("item") or {}).get("investigation") or {}
                opened = i.get("opened") or ""
                if not any(vehicle_key(v) == key for v in i.get("vehicles") or []):
                    continue
                if not any(component_matches(comp, c) for c in i.get("components") or []):
                    continue
                is_open = not i.get("closed")
                if not is_open and opened < since.isoformat():
                    continue
                pts = INVESTIGATION_POINTS.get((i.get("action") or "")[:2], 0) if is_open else 0
                c_points += pts
                evidence.append({"dataset": "agency_safety_nhtsa_investigations", "id": inv["id"], "url": inv.get("source_url"),
                                 "date": opened, "label": f"{i.get('action')} {i.get('type_label') or ''} — {i.get('subject') or ''}".strip(),
                                 "basis": f"{'Open' if is_open else 'Closed'}; vehicle and component match exactly", "points": pts})
            for rc in recalls:
                item = rc.get("item") or {}
                rec, cells = item.get("recall") or {}, item.get("cells") or {}
                date = cells.get("date") or ""
                if date < since.isoformat():
                    continue
                if not any(vehicle_key(v) == key for v in rec.get("vehicles") or []):
                    continue
                if not any(component_matches(comp, c) for c in rec.get("components") or [cells.get("component") or ""]):
                    continue
                c_points += 1
                recall_dates.append(date)
                evidence.append({"dataset": "agency_safety_nhtsa_recalls", "id": rc["id"], "url": rc.get("source_url"), "date": date,
                                 "label": f"Recall {rec.get('campaign') or rc['id']} ({cells.get('component')})",
                                 "basis": "Vehicle and component match exactly", "points": 1})
            comps.append(fixed_component("C", "NHTSA investigations and recalls (exact make, model, component)", min(3, c_points), max_points=3,
                                         observed=len(evidence), window=f"since {ym(since)}", source="NHTSA", source_url=NHTSA_URL,
                                         note=None if evidence else "None found"))
            comps.append(fixed_component("D", "JPML motion (reviewed link)", 0, max_points=3, note="None linked"))
            links, overlaps = self.ctx.vehicle_links(make, model, comp)
            flags = []
            if any(month_add(end, -14).isoformat() <= d <= f"{ym(end)}-31" for d in recall_dates):
                flags.append({"key": "recall_preceded_surge", "label": "A recall came first",
                              "detail": "A recall of this vehicle and component was announced shortly before or during the window; owner notices often prompt complaints."})
            for o in overlaps:
                flags.append({"key": "shares_make_with_mdl", "label": f"Same make as MDL {o['mdl']}",
                              "detail": f"MDL {o['mdl']} counts complaints of this make by text terms that cannot be checked per unit."})
            months = r.get("months") or []
            unit = self.unit("vehicle", f"vehicle:{slug(make, model, comp)}", f"{make} {model} — {comp}", comps, links,
                             identifiers={"make": make, "model": model, "component": comp},
                             series={"unit": "NHTSA complaints per month", "start": ym(month_add(end, -(len(months) - 1))), "values": months,
                                     "source": "NHTSA ODI complaints", "source_url": NHTSA_URL},
                             evidence=evidence, flags=flags, window={"recent": window, "baseline": window_label(month_add(end, -12), 12)})
            self.units.append(unit)

    # ------------------------------------------------------------------ JPML lane
    def build_jpml(self):
        cutoff = month_add(dt.date(self.as_of.year, self.as_of.month, 1), -36).isoformat()
        reviewed = {x["mdl"]: x for x in self.reviewed.get("jpml_links", [])}
        initial = {}
        for r in self.ctx.matters:
            m = r["item"].get("matter") or {}
            mdl = m.get("mdl")
            if not isinstance(mdl, int) or not is_pl(r):
                continue
            initial.setdefault(mdl, []).append(r)
        lanes = []
        for mdl, rows in sorted(initial.items()):
            info = self.ctx.mdl.get(mdl)
            rows.sort(key=lambda r: r["item"]["matter"].get("session") or "")
            if info is not None and not info.get("after_report"):
                # Inside an existing MDL only the motion that created it is a path to the Panel: the granted matter
                # whose order date is the MDL's transfer date (tag-alongs and CTO oppositions are not).
                created = [r for r in rows if r["item"]["matter"].get("outcome") == "granted"
                           and ((r["item"]["matter"].get("evidence") or {}).get("date") or "") == (info.get("date") or "-")]
                if not created:
                    continue
                rows = created
            last = rows[-1]["item"]["matter"]
            outcome = last.get("outcome")
            session = last.get("session") or ""
            if outcome not in ("scheduled", "denied", "granted") or session < cutoff:
                continue
            ev = last.get("evidence") or {}
            rv = reviewed.get(mdl) or {}
            events = [{"kind": "recall", "date": x["date"], "label": x["label"], "url": x["url"], "id": x["id"], "dataset": x["dataset"]}
                      for x in rv.get("recalls", [])]
            events.append({"kind": "hearing", "date": session, "label": "Hearing session", "url": rows[-1].get("source_url"),
                           "id": rows[-1]["id"], "dataset": "mdl_intel_hearing_orders"})
            if ev.get("date"):
                events.append({"kind": "order", "date": ev["date"], "label": {"denied": "Centralization denied", "granted": "Centralized"}.get(outcome, "Order"),
                               "url": ev.get("url"), "id": rows[-1]["id"], "dataset": "mdl_intel_hearing_orders"})
            status = {"scheduled": "pending", "denied": "denied", "granted": "centralized"}[outcome]
            lanes.append({"mdl": mdl, "title": re.sub(r"^MDL\s+\d+\s+—\s+", "", rows[-1].get("title") or last.get("title") or ""), "status": status, "session": session, "events": sorted(events, key=lambda e: e["date"]),
                          "district": (rows[-1]["item"].get("cells") or {}).get("district")})
            if outcome == "granted":
                continue  # centralized after the last pending report: in an MDL (excluded), shown on the lane only
            comps = [fixed_component("A", "Product reports", 0, max_points=2, note="Not recorded: no product series is linked to this matter"),
                     fixed_component("B", "Severity", 0, max_points=2, note="Not recorded")]
            c_points = 0
            evidence = []
            for x in rv.get("recalls", []):
                pts = 2 if x.get("classification") == "Class I" else 1
                if x["date"] >= month_add(dt.date(self.as_of.year, self.as_of.month, 1), -24).isoformat():
                    c_points += pts
                evidence.append({**{k: x[k] for k in ("dataset", "id", "url", "date", "label")},
                                 "basis": f"Reviewed link ({rv.get('reviewed_on')}): {rv.get('note')}", "points": pts})
            comps.append(fixed_component("C", "Recalls (reviewed link)", min(3, c_points), max_points=3, observed=len(rv.get("recalls", [])),
                                         window="last 24 months", source="CPSC / FDA / NHTSA", note=None if rv else "No reviewed link"))
            pts = 3 if outcome == "scheduled" else 2
            comps.append(fixed_component("D", "JPML motion to create an MDL", pts, max_points=3, observed=1,
                                         source="JPML hearing session and orders", source_url=ev.get("url") or rows[-1].get("source_url"),
                                         note="Pending before the Panel" if outcome == "scheduled" else f"Centralization denied {ev.get('date') or session}"))
            evidence.append({"dataset": "mdl_intel_hearing_orders", "id": rows[-1]["id"], "url": ev.get("url") or rows[-1].get("source_url"),
                             "date": ev.get("date") or session, "label": f"MDL No. {mdl}: {status}", "basis": "JPML hearing session matter", "points": pts})
            title = (last.get("title") or f"MDL {mdl}")
            printed = re.sub(r"^MDL\s+\d+\s+—\s+", "", rows[-1].get("title") or title)  # the notice's own mixed-case caption
            unit = self.unit("jpml", f"jpml:{mdl}", re.sub(r"^IN RE:?\s*", "", printed, flags=re.I), comps, [],
                             identifiers={"mdl_number": mdl, "caption": title, "recall_numbers": [x["id"] for x in rv.get("recalls", [])]},
                             series=None, evidence=evidence, flags=[], window={"recent": f"since {cutoff[:7]}", "baseline": None})
            unit["jpml_status"] = status
            self.units.append(unit)
        self.lanes = lanes

    # ------------------------------------------------------------------ shared
    def unit(self, kind, uid, label, comps, links, *, identifiers, series, evidence, flags, window):
        status = mdl_status(links)
        points, families = totals(comps)
        a = next((c for c in comps if c["family"] == "A"), None)
        excess = round(a["observed"] - a["expected"], 1) if a and a.get("expected") is not None and a.get("observed") is not None else None
        if status == "terminated_mdl":
            flags = flags + [{"key": "terminated_mdl", "label": "Earlier MDL closed",
                              "detail": "Linked only to MDLs the JPML lists as terminated: " + ", ".join(str(l["mdl"]) for l in links)}]
        return {"unit_id": uid, "kind": kind, "label": label, "identifiers": identifiers,
                "mdl_status": {"status": status, "links": links}, "components": comps, "points": points,
                "families_present": len(families), "families": families, "excess": excess, "series": series,
                "evidence": evidence, "flags": flags, "window": window, "caveat": CAVEAT, "as_of": self.as_of.isoformat()}

    def post_filing(self, unit, links, end):
        a = unit["components"][0]
        lo = month_add(end, -35).isoformat()
        dates = [l["date"] for l in links if l.get("date")]
        if a.get("ci_low") and a["ci_low"] > 1 and any(lo <= d <= f"{ym(end)}-31" for d in dates):
            unit["flags"].append({"key": "post_filing_surge", "label": "Rise follows the litigation",
                                  "detail": "An MDL linked to this product was created during the comparison windows; filings and advertising can drive reports."})

    def build(self):
        self.national = {}
        self.build_drugs()
        self.build_vehicles()
        self.build_jpml()
        eligible = [u for u in self.units if u["mdl_status"]["status"] != "pending_mdl"]
        eligible.sort(key=lambda u: (-u["families_present"], -u["points"], -(u["excess"] or 0), u["unit_id"]))
        for i, u in enumerate(eligible, 1):
            u["rank"] = i
        for u in self.units:
            u.setdefault("rank", None)
        return self.units

    def summary(self):
        units = self.units
        el = [u for u in units if u["mdl_status"]["status"] != "pending_mdl"]

        def lb(u):
            a = next((c for c in u["components"] if c["family"] == "A"), {})
            return a.get("ci_low")

        lanes = getattr(self, "lanes", [])
        cutoff36 = month_add(dt.date(self.as_of.year, self.as_of.month, 1), -36).isoformat()
        return {
            "as_of": self.as_of.isoformat(), "basis": self.inp.basis,
            "windows": {"faers": self.national["faers"]["window"], "faers_baseline": self.national["faers"]["baseline_window"],
                        "nhtsa": self.national["nhtsa"]["window"], "nhtsa_baseline": self.national["nhtsa"]["baseline_window"]},
            "national": self.national,
            "coverage": {"faers_products_with_series": self.coverage_faers["with_series"], "faers_products_indexed": self.coverage_faers["indexed"],
                         "maude_codes_with_series": 0, "maude_codes_indexed": 1841,
                         "nhtsa_units_rated": self.coverage_vehicles["units"], "nhtsa_min_recent": MIN_REPORTS,
                         "ndc_classes": bool(self.ctx.ndc_classes), "ndc_source": self.ctx.ndc.get("source"),
                         "devices": "Recalls only: no MAUDE monthly series and no exact product key on FDA recalls; no device unit is rated in v1."},
            "counts": {"units": len(units), "drug": sum(u["kind"] == "drug" for u in units), "vehicle": sum(u["kind"] == "vehicle" for u in units),
                       "jpml": sum(u["kind"] == "jpml" for u in units),
                       "pending_mdl": sum(u["mdl_status"]["status"] == "pending_mdl" for u in units),
                       "terminated_mdl": sum(u["mdl_status"]["status"] == "terminated_mdl" for u in units),
                       "none_linked": sum(u["mdl_status"]["status"] == "none_linked" for u in units)},
            "kpis": {"three_plus_families": sum(u["families_present"] >= 3 for u in el),
                     "pending_motions_no_mdl": sum(1 for l in lanes if l["status"] == "pending"),
                     "denied_36m": sum(1 for l in lanes if l["status"] == "denied" and l["session"] >= cutoff36),
                     "rising_no_mdl": sum(1 for u in el if u["kind"] != "jpml" and (lb(u) or 0) > 1.5),
                     "open_investigations_no_mdl": sum(1 for u in el for e in u["evidence"] if e["dataset"] == "agency_safety_nhtsa_investigations" and e.get("points"))},
            "jpml_lanes": lanes,
            "method": METHOD, "caveat": CAVEAT,
        }


METHOD = {
    "reports": "Reports in the last 12 complete months (O) against the prior period scaled to 12 months and by the national change (E). Rated only when O is at least 50; the exact Poisson 95% lower bound of O divided by E gives 0 points at 1 or below, 1 point up to 1.5, 2 points above 1.5.",
    "severity": "FAERS: 1 point when death reports rose (lower bound above 1), 1 point when serious reports rose and their share is at least the national share. NHTSA: 1 point when crash, fire or injury complaints rose, 1 point when deaths rose.",
    "regulator": "Last 24 months, exact keys only: NHTSA open engineering analysis 2, open preliminary evaluation, recall query or defect petition 1, recall campaign 1; reviewed recall links for JPML matters. At most 3. FDA recalls carry no exact product key in the corpus, so drugs score 0 here.",
    "litigation": "JPML motion to create an MDL pending 3, denied within 36 months 2 (reviewed links only for products); a 10-K paragraph naming the product with a products-liability term 1.",
    "ranking": "Families with points (0-4), then total points, then excess reports (O minus E).",
    "exclusion": "Linked to an MDL by any of: the safety product-MDL links, the title's own names matched exactly to the openFDA generic name, Drugs@FDA brand to active ingredient, the openFDA NDC pharmacologic class the title names, the reviewed class-member list, JPML transfer orders after the last pending report, NHTSA vehicle MDL rules. 'No MDL linked' is not 'no MDL exists'.",
}


# ---------------------------------------------------------------------------------------------------- records
def to_record(u):
    from corpus_writer import record  # local import: the writer needs no credentials to build rows
    a = next((c for c in u["components"] if c["family"] == "A"), {})
    status = u["mdl_status"]["status"]
    cells = {"rank": str(u["rank"]) if u["rank"] else "—", "kind": u["kind"], "label": u["label"], "families": str(u["families_present"]),
             "points": str(u["points"]), "observed": "Not recorded" if a.get("observed") is None else f"{a['observed']:,}",
             "ratio": "Not rated" if a.get("ratio") is None else f"{a['ratio']:.2f}", "mdl_status": status}
    facts = [["Kind", u["kind"]], ["MDL status", {"none_linked": "No MDL linked", "pending_mdl": "In an MDL", "terminated_mdl": "Earlier MDL closed"}[status]],
             ["Points", f"{u['points']} ({u['families_present']} families)"]] + \
            [[f"{FAMILY_LABEL[c['family']]}: {c['metric']}", f"{c['points']} pt" + (f" · O {c['observed']:,} / E {c['expected']:,}" if c.get("expected") is not None and c.get("observed") is not None else "") + (f" · {c['note']}" if c.get("note") else "")]
             for c in u["components"]] + [["Caveat", CAVEAT]]
    links = [{"url": e["url"], "label": e["label"]} for e in u["evidence"] if e.get("url")][:12]
    source = (u.get("series") or {}).get("source_url") or (u["evidence"][0]["url"] if u["evidence"] else JPML_URL)
    return record(DATASET, u["unit_id"], u["label"], source_url=source, subtitle=f"{u['points']} points · {u['families_present']} families · {cells['mdl_status']}",
                  cells=cells, facts=facts, links=links, text=" ".join([u["label"]] + [str(v) for v in u["identifiers"].values() if isinstance(v, (str, int))]),
                  filters={"kind": [u["kind"]], "mdl_status": [status], "families": [str(u["families_present"])]},
                  badges=[cells["mdl_status"]], extra={"kind": "radar", "radar": u})


def summary_record(summary):
    from corpus_writer import record
    return record(DATASET, "summary:overview", "Emerging-tort radar — overview", source_url=FAERS_URL,
                  subtitle=f"As of {summary['as_of']}", cells={"rank": "—", "kind": "summary", "label": "Overview"},
                  facts=[[k, json.dumps(v)] for k, v in summary["counts"].items()], links=[], text="emerging tort radar overview",
                  filters={"kind": ["summary"]}, extra={"kind": "radar_summary", "summary": summary})


# ---------------------------------------------------------------------------------------------------- NDC classes
def ndc_classes(zip_path, out_path):
    """Reduce the openFDA NDC directory bulk file to generic name -> Established Pharmacologic Classes (exact strings)."""
    raw = Path(zip_path).read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.endswith(".json"))
        data = json.loads(z.read(name))
    classes = {}
    for r in data.get("results", []):
        epc = set((r.get("openfda") or {}).get("pharm_class_epc") or [])
        epc |= {p[:-6] for p in r.get("pharm_class") or [] if p.endswith(" [EPC]")}
        epc = {e[:-6] if e.endswith(" [EPC]") else e for e in epc}
        if not epc:
            continue
        names = set((r.get("openfda") or {}).get("generic_name") or []) | ({r["generic_name"]} if r.get("generic_name") else set())
        for n in names:
            classes.setdefault(norm(n), set()).update(epc)
    out = {"source": NDC_URL, "last_updated": (data.get("meta") or {}).get("last_updated"), "sha256": hashlib.sha256(raw).hexdigest(),
           "licence": "openFDA data: CC0 / public domain", "classes": {k: sorted(v) for k, v in sorted(classes.items())}}
    Path(out_path).write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(json.dumps({"generic_names": len(out["classes"]), "sha256": out["sha256"], "last_updated": out["last_updated"]}))


# ---------------------------------------------------------------------------------------------------- live reads
class LiveInputs:
    """Read-only reads with EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY (never written, never logged)."""

    def __init__(self, ndc, use_rpc=True):
        import corpus_writer as cw
        self.cw = cw
        self.basis = "live-rpc" if use_rpc else "live-fallback"
        self.ndc = load_json(ndc) if ndc else None
        self.subjects = self._paged_rpc("safety_subjects_v1", {"p_type": "product", "p_kind": "drug"}) + \
            self._paged_rpc("safety_subjects_v1", {"p_type": "national"})
        self.mdls = cw.fetch_all("mdls", "id,title,source_url,item")
        self.terminated = cw.fetch_all("mdl_terminated_history", "id,title,source_url,item")
        self.hearing_orders = [r for r in cw.fetch_all("mdl_intel_hearing_orders", "id,title,source_url,item") if (r.get("item") or {}).get("kind") == "matter"]
        self.drugsfda = [{"id": r["id"], "fields": r.get("fields") or {}} for r in cw.fetch_all("agency_safety_openfda_drugsfda", "id,fields:detail->fields")
                         if (r.get("fields") or {}).get("application_type") in ("NDA", "BLA")]
        reg_i = cw.fetch_all("agency_safety_nhtsa_investigations", "id,source_url,item")
        reg_r = cw.fetch_all("agency_safety_nhtsa_recalls", "id,source_url,item")
        def inv(r):
            return (r.get("item") or {}).get("investigation") or {}

        self.investigations = [r for r in reg_i if (inv(r).get("opened") or "") >= "2023-01-01" or not inv(r).get("closed")]
        self.recalls = [r for r in reg_r if (((r.get("item") or {}).get("cells") or {}).get("date") or "") >= "2023-01-01"]
        self.sec = self._sec()
        self.mdl_links = []
        mdl_numbers = sorted({int(r["id"]) for r in self.mdls if str(r["id"]).isdigit()} | {e["mdl"] for e in mdl_map.MDLS})
        for m in mdl_numbers:
            self.mdl_links += [{**x, "subject_id": x["subject_id"]} for x in (self._rpc("safety_mdl_products_v1", {"p_mdl": str(m)}) or [])]
        self.nhtsa_max_received = self._nhtsa_max()
        end_n = last_complete_month(self.nhtsa_max_received)
        if use_rpc:
            try:
                end_f = self._faers_end().isoformat()
                args = {"p_series": ["faers_reports", "faers_serious", "faers_death"], "p_end": end_f,
                        "p_recent_months": 12, "p_baseline_months": 36, "p_tail_months": 24}
                self.faers_windows = self._rpc("safety_series_window_v1", {"p_prefix": "faers:", **args}) + \
                    self._rpc("safety_series_window_v1", {"p_prefix": "national:", **args})
                self.nhtsa_windows = self._rpc("safety_nhtsa_complaint_windows_v1", {"p_end": end_n.isoformat(), "p_months": 12, "p_min_recent": MIN_REPORTS})
            except RuntimeError as e:
                if "404" not in str(e) and "PGRST202" not in str(e):
                    raise
                use_rpc = False
                self.basis = "live-fallback"
        if not use_rpc:
            self.faers_windows = self._faers_fallback()
            self.nhtsa_windows = self._nhtsa_fallback(end_n)
        self.term_quarters = self._quarters()

    def _rpc(self, name, args):
        return self.cw._call("POST", f"rpc/{name}", args, prefer="return=representation")

    def _paged_rpc(self, name, args):
        out, offset = [], 0
        while True:
            page = self._rpc(name, {**args, "p_limit": 200, "p_offset": offset}) or {}
            rows = page.get("rows") or []
            out += rows
            if len(rows) < 200:
                return out
            offset += 200

    def _faers_end(self):
        nat = self._rpc("safety_subject_v1", {"p_id": "national:faers"}) or {}
        ends = [s["coverage_to"] for s in nat.get("series") or [] if s["series"] == "faers_reports"]
        return dt.date.fromisoformat(ends[0] + "-01")

    def _faers_fallback(self):
        """Slower path: one safety_subject_v1 call per subject; the same window arithmetic as the RPC."""
        end = self._faers_end()
        rows = []
        for s in self.subjects:
            prof = self._rpc("safety_subject_v1", {"p_id": s["id"]}) or {}
            for se in prof.get("series") or []:
                if se["series"] in ("faers_reports", "faers_serious", "faers_death"):
                    rows.append(window_from_values(s["id"], se["series"], se["vals"], se["coverage_from"], se["coverage_to"], end))
            for l in prof.get("mdls") or []:
                self.mdl_links.append({**l, "subject_id": s["id"]})
        return [r for r in rows if r]

    def _nhtsa_max(self):
        page = self._rpc("safety_records_v1", {"p_source": "nhtsa", "p_limit": 1, "p_offset": 0}) or {}
        rows = page.get("rows") or []
        return rows[0]["date"] if rows else None

    def _nhtsa_fallback(self, end):
        """Slower path: page safety_records_v1 one received day at a time (100 rows a page) and count in Python."""
        start = month_add(end, -23)
        records, day = [], start
        stop = month_add(end, 1)
        while day < stop:
            offset = 0
            while True:
                page = self._rpc("safety_records_v1", {"p_source": "nhtsa", "p_from": day.isoformat(), "p_to": day.isoformat(), "p_limit": 100, "p_offset": offset}) or {}
                rows = page.get("rows") or []
                records += rows
                if len(rows) < 100:
                    break
                offset += 100
            day += dt.timedelta(days=1)
        return nhtsa_windows_from_records(records, end, 12, MIN_REPORTS)

    def _sec(self):
        out = []
        for r in self.cw.fetch_all("company_sec_legal_proceedings", "id,source_url,item"):
            item = r.get("item") or {}
            texts = [("Item 3", (item.get("item3") or {}).get("text") or "")] + [(n.get("label") or "Notes", n.get("text") or "") for n in item.get("notes") or [] if isinstance(n, dict)]
            paras = [{"section": sec, "text": p[:2000]} for sec, t in texts for p in re.split(r"\n+", t) if PL_TERMS.search(p)]
            if paras:
                out.append({"id": r["id"], "source_url": r.get("source_url"), "filing": item.get("filing") or {}, "paragraphs": paras})
        return out

    def _quarters(self):
        """safety_term_quarters_v1 returns the 50 most reported terms of the 8 quarters; a term outside them is absent
        (treated as Not recorded), so live term lists can be shorter than the snapshot's per-quarter top 25."""
        out = []
        end = self._faers_end()
        q_from, q_to = quarters_of(month_add(end, -12), 12)[0], quarters_of(end, 12)[-1]
        with_series = {w["subject_id"] for w in self.faers_windows}
        for s in self.subjects:
            if not s["id"].startswith("faers:") or s["id"] not in with_series:
                continue
            got = self._rpc("safety_term_quarters_v1", {"p_id": s["id"], "p_dim": "meddra_pt", "p_from": q_from, "p_to": q_to, "p_top": 50}) or {}
            cells = {}
            for period, term, value, _serious in got.get("cells") or []:
                cells.setdefault(period, []).append([term, value])
            for p in got.get("periods") or []:
                out.append({"subject_id": s["id"], "period": p["period"], "limit_n": p.get("limit_n"), "returned": p.get("returned"),
                            "rows": cells.get(p["period"], [])})
        return out


def window_from_values(subject_id, series, vals, coverage_from, coverage_to, end, recent=12, baseline=36, tail=24):
    """Python twin of safety_series_window_v1 for one stored series (the fallback path and the tests)."""
    cf = dt.date.fromisoformat(coverage_from[:7] + "-01")
    ct = dt.date.fromisoformat(coverage_to[:7] + "-01")
    if ct < end or cf > end:
        return None
    e = (end.year - cf.year) * 12 + end.month - cf.month + 1

    def sl(a, b):
        return vals[max(0, a - 1):max(0, b)]

    r = sl(e - recent + 1, e)
    b = sl(e - recent - baseline + 1, e - recent)
    win = sl(max(1, e - recent - baseline + 1), e)
    return {"subject_id": subject_id, "series": series, "recent": sum(r) if r else None, "baseline": sum(b) if b else None,
            "recent_months": min(recent, e), "baseline_months": max(0, min(baseline, e - recent)),
            "coverage_from": cf.isoformat(), "coverage_to": ct.isoformat(),
            "values_hash": hashlib.md5(",".join(str(v) for v in win).encode()).hexdigest(), "tail": sl(max(1, e - tail + 1), e)}


def nhtsa_windows_from_records(records, end, months, min_recent):
    """Python twin of safety_nhtsa_complaint_windows_v1 over safety_records_v1 rows."""
    split = month_add(end, -(months - 1))
    start = month_add(split, -months)
    stop = month_add(end, 1)
    nat = {"scope": "national", "make": None, "model": None, "component": None, "recent": 0, "prior": 0, "recent_severe": 0, "prior_severe": 0,
           "recent_deaths": 0, "prior_deaths": 0, "recent_injured": 0, "prior_injured": 0, "months": [0] * (2 * months)}
    units = {}
    for r in records:
        d = dt.date.fromisoformat(str(r["date"])[:10])
        if not (start <= d < stop):
            continue
        rec = d >= split
        mi = (d.year - start.year) * 12 + d.month - start.month
        severe = bool(r.get("crash")) or bool(r.get("fire")) or (r.get("injured") or 0) > 0 or (r.get("deaths") or 0) > 0
        pre = "recent" if rec else "prior"
        nat[pre] += 1
        nat[f"{pre}_severe"] += severe
        nat[f"{pre}_deaths"] += r.get("deaths") or 0
        nat[f"{pre}_injured"] += r.get("injured") or 0
        nat["months"][mi] += 1
        keys = {(norm(i.get("make")), norm(i.get("model")), norm(i.get("component"))) for i in r.get("items") or []}
        for k in keys:
            if not all(k):
                continue
            u = units.setdefault(k, {"scope": "unit", "make": k[0], "model": k[1], "component": k[2], "recent": 0, "prior": 0, "recent_severe": 0,
                                     "prior_severe": 0, "recent_deaths": 0, "prior_deaths": 0, "recent_injured": 0, "prior_injured": 0, "months": [0] * (2 * months)})
            u[pre] += 1
            u[f"{pre}_severe"] += severe
            u[f"{pre}_deaths"] += r.get("deaths") or 0
            u[f"{pre}_injured"] += r.get("injured") or 0
            u["months"][mi] += 1
    return [nat] + [u for u in units.values() if u["recent"] >= min_recent]


# ---------------------------------------------------------------------------------------------------- main
def top_markdown(units, summary, n=25):
    el = [u for u in units if u["rank"]]
    el.sort(key=lambda u: u["rank"])
    lines = [f"# Emerging-tort radar dry run — as of {summary['as_of']} ({summary['basis']})", "",
             f"FAERS window {summary['windows']['faers']} vs {summary['windows']['faers_baseline']} (national factor {summary['national']['faers']['factor']}); "
             f"NHTSA window {summary['windows']['nhtsa']} vs {summary['windows']['nhtsa_baseline']} (national factor {summary['national']['nhtsa']['factor']}).", "",
             f"Counts: {json.dumps(summary['counts'])}", f"KPIs: {json.dumps(summary['kpis'])}", "",
             "| Rank | Unit | Kind | Families | Points | O | E | RR (95% lower) | Flags |", "|---|---|---|---|---|---|---|---|---|"]
    for u in el[:n]:
        a = next((c for c in u["components"] if c["family"] == "A"), {})
        rr = f"{a['ratio']:.2f} ({a['ci_low']:.2f})" if a.get("ratio") is not None else a.get("note") or "—"
        lines.append(f"| {u['rank']} | {u['label']} | {u['kind']} | {''.join(u['families'])} | {u['points']} | {a.get('observed') if a.get('observed') is not None else '—'} | "
                     f"{a.get('expected') if a.get('expected') is not None else '—'} | {rr} | {', '.join(f['key'] for f in u['flags']) or '—'} |")
    lines += ["", "## Excluded (in an MDL) among the 15 largest risers", ""]
    risers = sorted([u for u in units if u["mdl_status"]["status"] == "pending_mdl" and u["components"][0].get("ci_low")],
                    key=lambda u: -u["components"][0]["ci_low"])[:15]
    for u in risers:
        lines.append(f"- {u['label']}: lower-bound ratio {u['components'][0]['ci_low']:.2f}; MDL " +
                     ", ".join(f"{l['mdl']} ({l['basis']})" for l in u["mdl_status"]["links"][:3]))
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("ndc-classes")
    n.add_argument("zip")
    n.add_argument("out")
    b = sub.add_parser("build")
    src = b.add_mutually_exclusive_group(required=True)
    src.add_argument("--inputs")
    src.add_argument("--live", action="store_true")
    b.add_argument("--no-rpc", action="store_true")
    b.add_argument("--ndc")
    b.add_argument("--as-of", default=dt.date.today().isoformat())
    b.add_argument("--dry-run", action="store_true")
    b.add_argument("--out", default=str(ROOT / "private" / "acq" / "radar" / "packet"))
    args = ap.parse_args(argv)
    if args.cmd == "ndc-classes":
        return ndc_classes(args.zip, args.out)
    inp = SnapshotInputs(args.inputs, args.ndc) if args.inputs else LiveInputs(args.ndc, use_rpc=not args.no_rpc)
    reviewed = load_json(REVIEWED)
    radar = Radar(inp, reviewed, args.as_of)
    units = radar.build()
    summary = radar.summary()
    rows = [summary_record(summary)] + [to_record(u) for u in sorted(units, key=lambda u: (u["rank"] or 10**6, u["unit_id"]))]
    if args.dry_run:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        body = json.dumps(rows, ensure_ascii=False, sort_keys=True)
        (out / "records.json").write_text(body, encoding="utf-8")
        (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        (out / "top.md").write_text(top_markdown(units, summary), encoding="utf-8")
        print(json.dumps({"dry_run": True, "records": len(rows), "sha256": hashlib.sha256(body.encode()).hexdigest(), "out": str(out),
                          "counts": summary["counts"], "kpis": summary["kpis"]}))
        return None
    import corpus_writer as cw
    cw.publish(DATASET, LABEL, rows,
               listing_block=cw.listing([("rank", "Rank"), ("label", "Unit"), ("kind", "Kind"), ("families", "Families"), ("points", "Points"),
                                         ("observed", "Reports (12 mo)"), ("ratio", "Rate ratio"), ("mdl_status", "MDL status")],
                                        [("kind", "Kind", {"drug": "Drug", "vehicle": "Vehicle", "jpml": "JPML matter", "summary": "Summary"}),
                                         ("mdl_status", "MDL status", {"none_linked": "No MDL linked", "terminated_mdl": "Earlier MDL closed", "pending_mdl": "In an MDL"})]),
               summary={"as_of": summary["as_of"], "method": METHOD, "caveat": CAVEAT, "coverage": summary["coverage"]})
    return None


if __name__ == "__main__":
    main()
