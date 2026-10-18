"""Build the US Courts Federal Court Management Statistics (FCMS) corpus datasets from the unchanged profile PDFs.

Inputs (no network, no remote writes)
  private/acq/uscourts_fcms/parsed/*.json.gz      derived by extract.py from the PDFs listed in editions.json (sha256 recorded in each file)
  private/acq/uscourts_fcms/definitions/*         publisher's explanation-of-terms files (cited, not parsed)
  private/build/uscourts_fcms/lookups/*.json      read-only corpus lookups (court_spine, places, court_analytics ids)

Outputs (private/build/uscourts_fcms/<dataset>.json, rows exactly as corpus_writer.publish would receive them)
  fcms_court_profiles   one record per court (94 districts, 12 regional circuits) and per national page, per edition
  fcms_circuit_rollups  one record per regional circuit and per edition: district profiles summed by circuit + appeals profile; national reconciliation
  fcms_analytics        per edition rankings, biggest changes, distributions; definitions, editions, revisions, data-quality results

Usage: python3 -I -B scripts/enrichment/uscourts_fcms/build_uscourts_fcms.py
"""
import errno
import hashlib
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import corpus_writer as cw  # noqa: E402
import courts  # noqa: E402
import fcms_meta as meta  # noqa: E402
import fcms_model as fm  # noqa: E402
import jsonio  # noqa: E402
import measures  # noqa: E402
import ocr_assessment  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_fcms"
PARSED = ACQ / "parsed"
BUILD = ROOT / "private" / "build" / "uscourts_fcms"
LOOKUPS = BUILD / "lookups"
NR = fm.NOT_RECORDED
DASH = "—"  # not applicable to this kind of court (never used for an unknown value)

DS_PROFILES = "fcms_court_profiles"
DS_ROLLUPS = "fcms_circuit_rollups"
DS_ANALYTICS = "fcms_analytics"
KIND_LABEL = {"district": "District court", "circuit": "Court of appeals", "national_district": "National, district courts", "national_circuit": "National, courts of appeals"}
KIND_ORDER = {"national_district": 0, "national_circuit": 1, "circuit": 2, "district": 3}
CIRCUIT_FACT_MEASURES = ["filings", "filings_prisoner", "filings_other", "filings_criminal", "filings_administrative", "pct_change_filings", "terminations", "merits_terminations",
                         "pending", "judgeships", "panels", "senior_judges", "vacant_judgeship_months", "pp_filings", "pp_terminations", "pp_merits_terminations", "pp_pending",
                         "median_months_notice_to_disposition", "paj_merits_terminations", "paj_written_decisions", "merits_pct_by_active_judges"]
DISTRICT_ORDER = [k for k, *_ in measures.DISTRICT]
CIRCUIT_ORDER = [k for k, *_ in measures.CIRCUIT_LEFT] + [k for k, *_ in measures.CIRCUIT_RIGHT]


# ------------------------------------------------------------------ formatting
def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fmt(value, decimals=0, unit=None):
    """Display string of a number; None -> 'Not recorded'."""
    if value is None:
        return NR
    text = f"{value:,.{decimals}f}"
    return text + ("%" if unit == "percent" else "")


def token_decimals(token):
    token = (token or "").replace("%", "")
    return len(token.split(".")[1]) if "." in token else 0


def measure_meta(kind, key):
    table = meta.DISTRICT_MEASURES if kind.endswith("district") else meta.CIRCUIT_MEASURES
    return table.get(key) or (key, "count", 0, "", "")


def shown(cell, kind, key, period):
    """The figure as displayed for one period column, never a guess: number with the printed number of decimals, or Not recorded
    (with the reason when the page printed a dash or the cell could not be read unambiguously)."""
    label, unit, decimals, *_ = measure_meta(kind, key)
    value = cell["values"].get(key, {}).get(period)
    if value is not None:
        token = cell["raw"].get(key, {}).get("tokens", {}).get(period)
        return fmt(value, max(decimals, token_decimals(token)) if isinstance(value, float) else decimals, unit)
    flag = cell["flags"].get(key, {}).get(period)
    why = {"dash": " (printed as a dash)", "ambiguous": " (the printed cell holds more than one figure per period column; none is assumed)",
           "inconsistent": " (printed figure contradicts the printed number of panels)",
           "bad": " (printed token could not be read)"}.get(flag, "")
    return NR + why


def sign(value, decimals=1, suffix=""):
    return NR if value is None else f"{value:+,.{decimals}f}{suffix}"


# ------------------------------------------------------------------ context
class Context:
    def __init__(self):
        spine_doc = json.loads((LOOKUPS / "court_spine.json").read_text())
        self.spine = {r[0]: (r[1], r[2]) for r in spine_doc["rows"]}
        self.places = set(json.loads((LOOKUPS / "places_usps.json").read_text())["usps"])
        self.ca_ids = set(json.loads((LOOKUPS / "court_analytics_ids.json").read_text())["ids"])
        self.circuit_of = fm.circuit_membership()
        self.lookup_inputs = [{"url": f"corpus:{name} (read-only SELECT)", "path": str((LOOKUPS / f"{name}.json").relative_to(ROOT)), "sha256": sha256_file(LOOKUPS / f"{name}.json")}
                              for name in ("court_spine", "places_usps", "court_analytics_ids")]
        self.xref = Counter()
        self.xref_unmatched = defaultdict(set)

    def title(self, kind, cid):
        if kind == "national_district":
            return "All U.S. district courts (national profile)"
        if kind == "national_circuit":
            return "All U.S. courts of appeals (national profile of the 12 regional circuits)"
        row = self.spine.get(cid)
        if row is None:  # never reached with extracted data (pages whose court is not in court_spine are dropped); kept explicit rather than raising
            return f"{cid} (not found in court_spine)"
        base = row[0]
        return base if base.startswith(("United States", "U.S.")) else f"U.S. {base}"

    def court_link_ok(self, kind, cid):
        """/courts/<id> only when the id exists in court_spine with the expected court type (and, for districts, the expected state)."""
        row = self.spine.get(cid)
        if not row:
            return False
        if kind == "district":
            return "District Court" in row[0]
        return "Court of Appeals" in row[0]


def links_for(ctx, kind, cid, usps, source_url, source_label):
    links = []
    if kind in ("district", "circuit"):
        if ctx.court_link_ok(kind, cid):
            links.append({"url": f"/courts/{cid}", "label": "Court profile"})
            ctx.xref[f"{kind}_courts_linked"] += 1
        else:
            ctx.xref[f"{kind}_courts_unmatched"] += 1
            ctx.xref_unmatched[kind].add(cid)
    if kind == "district":
        if usps in ctx.places:
            links.append({"url": f"/places/{usps}", "label": f"State page ({usps})"})
            ctx.xref["district_places_linked"] += 1
        else:
            ctx.xref["district_places_no_state_page"] += 1
            ctx.xref_unmatched["places"].add(usps or "?")
        if cid in ctx.ca_ids:
            links.append({"url": f"/records/court_analytics/{cid}", "label": "District caseload analytics (June 2026 profile)"})
            ctx.xref["district_court_analytics_linked"] += 1
    links.append({"url": source_url, "label": source_label})
    return links


# ------------------------------------------------------------------ profile records
def current_values(cell, current):
    return {m: v.get(current) for m, v in cell["values"].items()}


def edition_rank_tables(editions):
    """rank[(ek, kind)][measure] = ({court_id: rank}, n) for the ranked measures at each edition's current period (national pages excluded)."""
    out = {}
    for ek, ed in editions.items():
        for kind, ranked in (("district", [m for m, *_ in meta.DISTRICT_RANKED]), ("circuit", [m for m, *_ in meta.CIRCUIT_RANKED])):
            cells = {c: cell for c, cell in ed["cells"].get(kind, {}).items() if c != "national"}
            tab = {}
            for m in ranked:
                vals = {c: cell["values"].get(m, {}).get(ek) for c, cell in cells.items()}
                tab[m] = fm.competition_ranks(vals, descending=True)
            out[(ek, kind)] = tab
    return out


def build_history(editions, kind, cid, headline):
    """Long series of the headline measures for one court: every period any edition prints, first print wins (earliest edition)."""
    per_measure = {m: fm.first_print_series(editions, kind, cid, m) for m in headline}
    periods = sorted({p for s in per_measure.values() for p in s})
    return {"periods": periods,
            "edition": [min(s[p][1] for s in per_measure.values() if p in s) for p in periods],
            "series": {m: [per_measure[m][p][0] if p in per_measure[m] else None for p in periods] for m in headline},
            "rule": "each period is taken from the earliest edition that prints it (its own edition when it has one); 'edition' names that edition"}


def profile_record(ctx, ed, kind, rk_kind, cid, cell, basis, ranks, history):
    ek = ed["period_end"]
    cur = ek
    periods = sorted(cell["periods"])
    is_national = cid == "national"
    table = measure_meta
    title = ctx.title(rk_kind, cid)
    fiscal = fm.is_fiscal_year_end(ek)
    pdf = ed["files"]["district" if kind == "district" else "circuit"]
    page = cell["pages"][0]
    src_url = f"{pdf['url']}#page={page}"
    src_label = f"US Courts FCMS {fm.edition_title(ek)} {'district' if kind == 'district' else 'courts of appeals'} profiles (PDF, page {page})"
    usps = cell.get("usps") if kind == "district" and not is_national else None
    circuit = ctx.circuit_of.get(cid) if kind == "district" and not is_national else (cid if kind == "circuit" and not is_national else None)
    order = DISTRICT_ORDER if kind == "district" else CIRCUIT_ORDER
    present = [m for m in order if m in cell["values"]]
    headline = meta.DISTRICT_HEADLINE if kind == "district" else meta.CIRCUIT_HEADLINE
    series = {m: [cell["values"][m].get(p) for p in periods] for m in present}
    flags = {m: {p: f for p, f in cell["flags"].get(m, {}).items()} for m in present if cell["flags"].get(m)}
    standing = {m: s for m, s in cell["standing"].items() if m in present and s}
    changes = {m: fm.within_edition_changes(cell, m, cur) for m in headline if m in cell["values"]}
    rank = {m: [tab_ranks[0].get(cid), tab_ranks[1]] for m, tab_ranks in ranks.items() if not is_national and tab_ranks[0].get(cid) is not None}
    fact_measures = [m for m in present if kind == "district" or m in CIRCUIT_FACT_MEASURES]  # every measure stays in fcms.series
    period_text = fm.period_text(cur)
    # ---- facts
    facts = [["Court", title]]
    if not is_national:
        facts.append(["Court ID (court_spine)", cid if ctx.court_link_ok(kind, cid) else NR])
    if usps:
        facts.append(["State", usps])
    if circuit:
        facts.append(["Regional circuit", meta.CIRCUIT_LABEL[circuit]])
    facts += [["Reporting period", f"12 months ending {period_text}"], ["FCMS edition", fm.edition_title(ek) + (" (fiscal-year edition)" if fiscal else "")],
              ["Printed court name", cell["name"] or NR]]
    if kind == "district":
        facts.append(["Criminal counts in this edition", f"{'defendants' if basis['basis'] == 'defendants' else 'cases (earlier method)' if basis['basis'] == 'cases' else NR}: {basis['evidence']}"])
    for m in fact_measures:
        label, unit, *_ = table(rk_kind, m)
        if m == "pct_change_filings":
            prior = fm.prior_year_key(cur)
            facts.append([f"{label}: over {prior[:4]} (printed)", shown(cell, rk_kind, m, prior) if prior in cell["values"][m] else NR])
            continue
        suffix = ""
        st = standing.get(m)
        if st:
            suffix = " (standing as printed: " + ", ".join(f"{('U.S.' if k == 'us' else 'circuit')} {st[k]}" for k in ("us", "circuit") if k in st) + ")"
        facts.append([f"{label} ({unit})", shown(cell, rk_kind, m, cur) + suffix])
    for m in headline:
        ch = changes.get(m)
        if not ch or ch["current"] is None:
            continue
        label, unit, decimals, *_ = table(rk_kind, m)
        y = ch["yoy"]
        if y["base_period"] and y["base"] is not None:
            pct_text = sign(y["pct"], 1, "%") if y["pct"] is not None else ("percent change not defined: base is 0" if y["base"] == 0 else NR)
            facts.append([f"{label}: change from {y['base_period'][:4]} (derived)", f"{sign(y['abs'], decimals)} ({pct_text}); {fmt(y['base'], decimals)} to {fmt(ch['current'], decimals)}"])
    if rank:
        facts.append(["Rank among courts of this kind, computed (1 = highest value; ties share a rank)",
                      "; ".join(f"{table(rk_kind, m)[0]}: {r[0]} of {r[1]}" for m, r in sorted(rank.items()) if m in headline)])
    qa_text = "; ".join(f"{q['measure']} {q['period'][:4]}: {q['detail']}" for q in cell["qa"][:4])
    if qa_text:
        facts.append(["Data-quality checks that did not pass (values shown as printed)", qa_text])
    facts.append(["Source", f"{src_label}: {src_url}"])
    facts.append(["Source file sha256", pdf["sha256"]])
    # ---- cells
    def one(m, unit_override=None):
        return shown(cell, rk_kind, m, cur) if m in cell["values"] else NR

    if kind == "district":
        cells = {"court": title, "period": ek, "edition": fm.edition_title(ek), "filings": one("filings"), "terminations": one("terminations"), "pending": one("pending"),
                 "judgeships": one("judgeships"), "load": one("pj_weighted_filings"), "median": one("median_months_civil"), "over3": one("civil_over_3y_pct")}
    else:
        cells = {"court": title, "period": ek, "edition": fm.edition_title(ek), "filings": one("filings"), "terminations": one("terminations"), "pending": one("pending"),
                 "judgeships": one("judgeships"), "load": one("pp_filings"), "median": one("median_months_notice_to_disposition"), "over3": DASH}
    badges = [KIND_LABEL[rk_kind], fm.edition_title(ek) + " edition"] + (["Fiscal-year edition"] if fiscal else [])
    subtitle = f"12 months ending {period_text} · {'weighted filings per judgeship' if kind == 'district' else 'appeals filed per panel'} {cells['load']} · FCMS {fm.edition_title(ek)}"
    fcms = {"kind": rk_kind, "court_id": cid, "name_printed": cell["name"], "usps": usps, "circuit": circuit, "edition": ed["edition"], "period_end": ek,
            "edition_title": fm.edition_title(ek), "fiscal_year_end": fiscal, "periods": periods, "labels": [p[:4] for p in periods], "series": series, "flags": flags,
            "standing": standing, "rank": rank,
            # change[m] = {"yoy": [base period, absolute change, percent change], "y5": [base period, percent change]} from the edition's own printed columns
            "change": {m: {"yoy": [ch["yoy"]["base_period"], ch["yoy"]["abs"], ch["yoy"]["pct"]], "y5": [ch["five_year"]["base_period"], ch["five_year"]["pct"]]} for m, ch in changes.items()},
            "source": {"url": pdf["url"], "page": page, "pages": cell["pages"], "sha256": pdf["sha256"]},
            "qa": cell["qa"], "match": cell.get("match")}
    if kind == "district":
        fcms["criminal_count_basis"] = basis
    if history:
        fcms["history"] = history
    rid = f"{cid}:{ek}" if not is_national else f"{rk_kind.replace('_', '-')}:{ek}"
    links = links_for(ctx, rk_kind, cid, usps, src_url, src_label)
    return cw.record(
        DS_PROFILES, rid, f"{title} · FCMS {fm.edition_title(ek)}", source_url=src_url, subtitle=subtitle, cells=cells, facts=facts, badges=badges, links=links,
        text=f"{title} {cell['name']} {circuit or ''} {usps or ''} caseload profile {ek} FCMS {fm.edition_title(ek)} judicial caseload statistics",
        filters={"kind": [rk_kind], "court": [cid if not is_national else rk_kind], "circuit": [circuit or "none"], "period": [ek], "year": [ek[:4]],
                 "fiscal": ["yes" if fiscal else "no"], "date": ek, "basis": [basis["basis"] if kind == "district" and basis["basis"] else "not_applicable"]},
        state=(usps or "") if kind == "district" and not is_national else "", extra={"kind": rk_kind, "fcms": fcms})


# ------------------------------------------------------------------ roll-ups
ROLLUP_SUMS = ["filings", "terminations", "pending", "judgeships", "vacant_judgeship_months", "civil_over_3y_count"]
ROLLUP_MEDIANS = ["median_months_civil", "median_months_civil_to_trial", "median_months_felony"]
ROLLUP_APPEALS = ["filings", "terminations", "pending", "judgeships", "vacant_judgeship_months", "pp_filings", "pp_pending", "pp_merits_terminations",
                  "median_months_notice_to_disposition", "merits_terminations"]


def rollup_record(ctx, ed, circuit_id, basis):
    """District figures of one regional circuit (or of the nation) summed per period column, with the circuit's appeals profile beside them."""
    ek = ed["period_end"]
    dcells = {c: cell for c, cell in ed["cells"].get("district", {}).items() if c != "national"}
    nat = ed["cells"].get("district", {}).get("national")
    acells = ed["cells"].get("circuit", {})
    periods = sorted(nat["periods"] if nat else next(iter(dcells.values()))["periods"])
    members = sorted(dcells) if circuit_id is None else sorted(c for c in dcells if ctx.circuit_of.get(c) == circuit_id)
    sums = {}
    for m in ROLLUP_SUMS:
        row = []
        for p in periods:
            vals = [dcells[c]["values"].get(m, {}).get(p) for c in members]
            known = [v for v in vals if v is not None]
            row.append({"sum": round(sum(known), 1 if m == "vacant_judgeship_months" else 0) if members and len(known) == len(members) else None, "known": len(known), "of": len(members)})
        sums[m] = row
    derived = {}

    def ratio(num, den, digits=1):
        out = []
        for a, b in zip(sums[num], sums[den]):
            out.append(round(a["sum"] / b["sum"], digits) if a["sum"] is not None and b["sum"] else None)
        return out

    derived["filings_per_judgeship"] = ratio("filings", "judgeships")
    derived["terminations_per_judgeship"] = ratio("terminations", "judgeships")
    derived["pending_per_judgeship"] = ratio("pending", "judgeships")
    weighted, weighted_known = [], []
    for i, p in enumerate(periods):
        pairs = [(dcells[c]["values"].get("pj_weighted_filings", {}).get(p), dcells[c]["values"].get("judgeships", {}).get(p)) for c in members]
        weighted_known.append(sum(1 for a, b in pairs if a is not None and b is not None))
        if members and all(a is not None and b is not None for a, b in pairs) and sum(b for _, b in pairs):
            weighted.append(round(sum(a * b for a, b in pairs) / sum(b for _, b in pairs), 1))
        else:
            weighted.append(None)  # never a partial mean: one district without a printed value (a dash) leaves the circuit's figure unknown
    derived["weighted_filings_per_judgeship_approx"] = weighted
    derived["weighted_filings_districts_with_value"] = weighted_known
    medians = {}
    for m in ROLLUP_MEDIANS:
        out = []
        for p in periods:
            vals = [dcells[c]["values"].get(m, {}).get(p) for c in members]
            d = fm.distribution(vals)
            out.append({"median": d["median"], "n": d["n"], "min": d["min"], "max": d["max"]})
        medians[m] = out
    appeals = {}
    ac = acells.get(circuit_id) if circuit_id else acells.get("national")
    if ac:
        for m in ROLLUP_APPEALS:
            if m in ac["values"]:
                appeals[m] = [ac["values"][m].get(p) for p in periods]
    recon = None
    if circuit_id is None and nat:
        recon = {}
        for m in ("filings", "terminations", "pending", "judgeships"):
            rows = []
            for i, p in enumerate(periods):
                pub = nat["values"].get(m, {}).get(p)
                s = sums[m][i]["sum"]
                rows.append({"period": p, "sum_of_districts": s, "published_national": pub, "difference": (s - pub) if s is not None and pub is not None else None})
            recon[m] = rows
    kind = "national_district" if circuit_id is None else "circuit_rollup"
    label = "All 94 district courts" if circuit_id is None else meta.CIRCUIT_LABEL[circuit_id]
    pdfs = {k: ed["files"].get(k) for k in ("district", "circuit")}
    src_url = pdfs["district"]["url"]
    cur_i = periods.index(ek) if ek in periods else len(periods) - 1
    cell_f = lambda key: fmt(sums[key][cur_i]["sum"]) if sums[key][cur_i]["sum"] is not None else NR  # noqa: E731
    cells = {"circuit": label, "period": ek, "edition": fm.edition_title(ek), "districts": str(len(members)), "filings": cell_f("filings"),
             "terminations": cell_f("terminations"), "pending": cell_f("pending"), "judgeships": cell_f("judgeships"),
             "per_judgeship": fmt(derived["filings_per_judgeship"][cur_i], 1), "appeals_filed": fmt(appeals.get("filings", [None] * len(periods))[cur_i]),
             "appeals_pending": fmt(appeals.get("pending", [None] * len(periods))[cur_i])}
    facts = [["Scope", label + ("" if circuit_id is None else f": {len(members)} district courts ({', '.join(members)})")],
             ["Reporting period", f"12 months ending {fm.period_text(ek)}"], ["FCMS edition", fm.edition_title(ek)],
             ["District filings (sum of district profiles, derived)", cell_f("filings")], ["District terminations (sum, derived)", cell_f("terminations")],
             ["District pending cases (sum, derived)", cell_f("pending")], ["Authorized district judgeships (sum, derived)", cell_f("judgeships")],
             ["Filings per judgeship (sum of filings / sum of judgeships, derived)", fmt(derived["filings_per_judgeship"][cur_i], 1)],
             ["Weighted filings per judgeship (judgeship-weighted mean of the printed district values, approximate), derived",
              fmt(derived["weighted_filings_per_judgeship_approx"][cur_i], 1) if weighted[cur_i] is not None
              else f"Not recorded ({weighted_known[cur_i]} of {len(members)} districts printed a weighted-filings value; no partial mean is formed)"],
             ["Median of district median months, civil filing to disposition (n districts)", f"{fmt(medians['median_months_civil'][cur_i]['median'], 1)} ({medians['median_months_civil'][cur_i]['n']})"]]
    if appeals:
        facts += [["Appeals filed (appeals profile)", fmt(appeals.get("filings", [None] * len(periods))[cur_i])], ["Appeals pending (appeals profile)", fmt(appeals.get("pending", [None] * len(periods))[cur_i])],
                  ["Median months, notice of appeal to disposition (appeals profile)", fmt(appeals.get("median_months_notice_to_disposition", [None] * len(periods))[cur_i], 1)]]
    if recon:
        diff = recon["filings"][cur_i]["difference"]
        facts.append(["Sum of district filings minus the national page's printed filings", NR if diff is None else f"{diff:+,}"])
    facts.append(["Criminal counts in this edition", f"{basis['basis'] or NR}: {basis['evidence']}"])
    facts.append(["Source", f"US Courts FCMS {fm.edition_title(ek)} district profiles: {src_url}"])
    links = []
    if circuit_id and ctx.court_link_ok("circuit", circuit_id):
        links.append({"url": f"/courts/{circuit_id}", "label": "Court of appeals profile"})
        ctx.xref["rollup_circuits_linked"] += 1
    links.append({"url": src_url, "label": f"US Courts FCMS {fm.edition_title(ek)} district profiles (PDF)"})
    fcms = {"kind": kind, "circuit": circuit_id, "label": label, "edition": ed["edition"], "period_end": ek, "periods": periods, "districts": members,
            "sums": sums, "derived": derived, "district_medians": medians, "appeals": appeals, "reconciliation": recon, "criminal_count_basis": basis,
            "source": {"district_pdf": pdfs["district"], "circuit_pdf": pdfs["circuit"]}}
    rid = f"{circuit_id}:{ek}" if circuit_id else f"national:{ek}"
    return cw.record(
        DS_ROLLUPS, rid, f"{label} · district roll-up · FCMS {fm.edition_title(ek)}", source_url=src_url,
        subtitle=f"12 months ending {fm.period_text(ek)} · {len(members)} districts · {cells['filings']} filings", cells=cells, facts=facts,
        badges=["Roll-up (derived)", fm.edition_title(ek) + " edition"], links=links,
        text=f"{label} circuit roll-up district courts caseload {ek} FCMS", filters={"circuit": [circuit_id or "national"], "period": [ek], "year": [ek[:4]], "date": ek, "fiscal": ["yes" if fm.is_fiscal_year_end(ek) else "no"]},
        extra={"kind": kind, "fcms": fcms})


# ------------------------------------------------------------------ analytics
def entity(ctx, kind, cid, cell, value, rank):
    link = f"/courts/{cid}" if ctx.court_link_ok(kind, cid) else None
    return {"court_id": cid, "name": ctx.title(kind, cid), "value": value, "rank": rank, "link": link}


def extreme_text(ctx, kind, entries, ties, decimals, unit):
    """The five most extreme courts as text; when two or more courts share the extreme value the text says so (the listed order is then court-id order)."""
    if not entries:
        return NR
    names = "; ".join(f"{ctx.title(kind, c).replace('U.S. ', '').replace('District Court, ', '')} {fmt(v, decimals, unit)}" for c, v in entries[:5])
    if ties > 1:
        return f"{ties} courts tie at {fmt(entries[0][1], decimals, unit)} (tied courts listed in court-id order): {names}"
    return names


def rankings_record(ctx, ed, kind, ranks_tab):
    ek = ed["period_end"]
    cells = {c: cell for c, cell in ed["cells"].get(kind, {}).items() if c != "national"}
    ranked = meta.DISTRICT_RANKED if kind == "district" else meta.CIRCUIT_RANKED
    changes_spec = meta.DISTRICT_CHANGES if kind == "district" else meta.CIRCUIT_CHANGES
    lists, facts = [], []
    for m, hi_label, lo_label in ranked:
        vals = {c: cell["values"].get(m, {}).get(ek) for c, cell in cells.items()}
        high, low = fm.extremes(vals, 10)
        ranks, n = ranks_tab[m]
        label, unit, decimals, *_ = measure_meta(kind, m)
        known = [v for v in vals.values() if v is not None]
        ties_high = sum(1 for v in known if high and v == high[0][1])
        ties_low = sum(1 for v in known if low and v == low[0][1])
        lists.append({"measure": m, "label": label, "unit": unit, "n": n, "not_ranked": len(cells) - n, "high_label": hi_label, "low_label": lo_label,
                      "tied_at_highest": ties_high, "tied_at_lowest": ties_low,
                      "high": [entity(ctx, kind, c, cells[c], v, ranks[c]) for c, v in high], "low": [entity(ctx, kind, c, cells[c], v, ranks[c]) for c, v in low],
                      "distribution": fm.distribution(vals.values(), 2 if decimals else 0)})
        facts.append([f"{hi_label} ({label}, {unit}); n={n}", extreme_text(ctx, kind, high, ties_high, decimals, unit)])
        facts.append([f"{lo_label} ({label}, {unit}); n={n}", extreme_text(ctx, kind, low, ties_low, decimals, unit)])
    changes = []
    for m, min_base in changes_spec:
        cur_vals, prior_vals, pct, absd, usable = {}, {}, {}, {}, 0
        for c, cell in cells.items():
            ch = fm.within_edition_changes(cell, m, ek)
            cur_vals[c] = ch["current"]
            base = ch["yoy"]["base"]
            prior_vals[c] = base
            if ch["current"] is not None and base is not None and abs(base) >= min_base and ch["yoy"]["pct"] is not None:
                pct[c] = ch["yoy"]["pct"]
                absd[c] = ch["yoy"]["abs"]
                usable += 1
        up, down = fm.extremes(pct, 10)
        label, unit, decimals, *_ = measure_meta(kind, m)
        changes.append({"measure": m, "label": label, "unit": unit, "min_base_value": min_base, "n": usable, "base_period": fm.prior_year_key(ek),
                        "increases": [dict(entity(ctx, kind, c, cells[c], cur_vals[c], None), prior=prior_vals[c], pct=v, abs=absd[c]) for c, v in up if v > 0],
                        "decreases": [dict(entity(ctx, kind, c, cells[c], cur_vals[c], None), prior=prior_vals[c], pct=v, abs=absd[c]) for c, v in down if v < 0]})
        if up and up[0][1] > 0:
            c, v = up[0]
            facts.append([f"Largest increase in {label}, {fm.prior_year_key(ek)[:4]} to {ek[:4]} (base at least {min_base}); n={usable}", f"{ctx.title(kind, c).replace('U.S. ', '')}: {sign(v, 1, '%')} ({fmt(prior_vals[c], decimals)} to {fmt(cur_vals[c], decimals)})"])
        if down and down[0][1] < 0:
            c, v = down[0]
            facts.append([f"Largest decrease in {label}, {fm.prior_year_key(ek)[:4]} to {ek[:4]} (base at least {min_base}); n={usable}", f"{ctx.title(kind, c).replace('U.S. ', '')}: {sign(v, 1, '%')} ({fmt(prior_vals[c], decimals)} to {fmt(cur_vals[c], decimals)})"])
    pdf = ed["files"][kind]
    noun = "district courts" if kind == "district" else "courts of appeals (12 regional circuits)"
    fcms = {"kind": f"rankings_{kind}", "edition": ed["edition"], "period_end": ek, "n_courts": len(cells), "lists": lists, "changes": changes,
            "formulas": {"rank": "competition rank among the courts of this kind at the edition's own period: 1 = highest value, ties share the lowest rank number; courts with no printed value are not ranked",
                         "slowest_fastest": "slowest = highest median months, fastest = lowest median months (time measures only); courts that printed a dash (for example no civil trials) are not ranked",
                         "change": f"(value for {ek} - value for {fm.prior_year_key(ek)}) / |value for {fm.prior_year_key(ek)}| x 100, both read from the same edition's printed columns; listed only when the prior value is at least the stated minimum base value; ties broken by court id",
                         "distribution": "n, min, quartiles (inclusive), median and max of the courts' printed values"},
            "source": {"url": pdf["url"], "sha256": pdf["sha256"]}}
    rid = f"rankings:{kind}:{ek}"
    return cw.record(
        DS_ANALYTICS, rid, f"Rankings and changes, {noun}, FCMS {fm.edition_title(ek)}", source_url=pdf["url"],
        subtitle=f"12 months ending {fm.period_text(ek)} · {len(cells)} courts", cells={"scope": f"Rankings: {noun}", "period": ek, "edition": fm.edition_title(ek), "courts": str(len(cells))},
        facts=[["Edition", fm.edition_title(ek)], ["Reporting period", f"12 months ending {fm.period_text(ek)}"], *facts,
               ["Method", fcms["formulas"]["rank"] + ". " + fcms["formulas"]["change"] + "."], ["Source", pdf["url"]]],
        badges=["Derived rankings", fm.edition_title(ek) + " edition"], links=[{"url": pdf["url"], "label": f"US Courts FCMS {fm.edition_title(ek)} profiles (PDF)"}],
        text=f"rankings slowest fastest biggest changes {noun} {ek} FCMS", filters={"kind": [f"rankings_{kind}"], "period": [ek], "year": [ek[:4]], "date": ek, "_listing": ["yes"]},
        extra={"kind": f"rankings_{kind}", "fcms": fcms})


# ------------------------------------------------------------------ main
def edition_inventory(editions, skipped, basis):
    rows = []
    for ek in sorted(editions):
        ed = editions[ek]
        rows.append({"period_end": ek, "edition": ed["edition"], "title": fm.edition_title(ek), "page_url": ed["page_url"],
                     "district_pdf": {**ed["files"].get("district", {}), "courts": len([c for c in ed["cells"].get("district", {}) if c != "national"]), "national_page": "national" in ed["cells"].get("district", {}), "excluded_pages": len(ed["excluded"].get("district", []))},
                     "circuit_pdf": {**ed["files"].get("circuit", {}), "courts": len([c for c in ed["cells"].get("circuit", {}) if c != "national"]), "national_page": "national" in ed["cells"].get("circuit", {}), "excluded_pages": len(ed["excluded"].get("circuit", []))},
                     "criminal_count_basis": basis[ek], "page1_notes": ed["notes"]})
    return rows, skipped


def main():
    t0 = time.time()
    BUILD.mkdir(parents=True, exist_ok=True)
    ctx = Context()
    editions, skipped = fm.load_editions(PARSED)
    index = jsonio.load(PARSED / "_index.json")
    for ed in editions.values():
        for cell in ed["cells"].get("circuit", {}).values():
            fm.apply_inconsistent_judgeships(cell)
        for kind, cells in ed["cells"].items():
            for cell in cells.values():
                cell["qa"] = fm.qa_flags(kind, cell)
    basis = fm.determine_basis(editions)
    keys = sorted(editions)
    latest = keys[-1]
    for ek in keys:
        d = editions[ek]["cells"].get("district", {})
        n = len([c for c in d if c != "national"])
        if n != 94 or "national" not in d:
            raise SystemExit(f"{ek}: expected 94 districts and a national page, found {n}")
        if len(editions[ek]["cells"].get("circuit", {})) not in (12, 13):
            raise SystemExit(f"{ek}: expected 12 circuits (+ national), found {len(editions[ek]['cells'].get('circuit', {}))}")
    missing_circuit = [c for c in editions[latest]["cells"]["district"] if c != "national" and c not in ctx.circuit_of]
    if missing_circuit:
        raise SystemExit(f"districts without a regional circuit: {missing_circuit}")
    rank_tables = edition_rank_tables(editions)

    profile_rows = []
    for ek in keys:
        ed = editions[ek]
        for kind in ("district", "circuit"):
            for cid, cell in sorted(ed["cells"].get(kind, {}).items()):
                rk_kind = (f"national_{kind}" if cid == "national" else kind)
                history = build_history(editions, kind, cid, meta.DISTRICT_HEADLINE if kind == "district" else meta.CIRCUIT_HEADLINE) if (ek == latest and cid != "national") else None
                b = basis[ek] if kind == "district" else {"basis": None, "evidence": "not applicable to appeals"}
                profile_rows.append((ek, rk_kind, cid, profile_record(ctx, ed, kind, rk_kind, cid, cell, b, rank_tables[(ek, kind)], history)))
    # newest period first, then national, circuits, districts, id order
    profile_rows = sorted(profile_rows, key=lambda t: (-int(t[0].replace("-", "")), KIND_ORDER[t[1]], t[2]))
    profiles = [r for *_, r in profile_rows]

    rollups = []
    for ek in reversed(keys):
        ed = editions[ek]
        rollups.append(rollup_record(ctx, ed, None, basis[ek]))
        for circuit_id in sorted(meta.CIRCUIT_LABEL):
            rollups.append(rollup_record(ctx, ed, circuit_id, basis[ek]))

    analytics = []
    for ek in reversed(keys):
        analytics.append(rankings_record(ctx, editions[ek], "district", rank_tables[(ek, "district")]))
        analytics.append(rankings_record(ctx, editions[ek], "circuit", rank_tables[(ek, "circuit")]))
    inventory, skipped_list = edition_inventory(editions, skipped, basis)
    ocr = ocr_assessment.compare(PARSED, index)
    revisions = {k: fm.revision_cells(editions, k, basis) for k in ("district", "circuit")}
    qa_counts = Counter()
    for ed in editions.values():
        for kind, cells in ed["cells"].items():
            for cell in cells.values():
                for q in cell["qa"]:
                    qa_counts[(kind, q["check"])] += 1
    analytics += summary_records(ctx, editions, keys, basis, inventory, skipped_list, ocr, revisions, qa_counts, latest)

    inputs = []
    seen = set()
    for ek in keys:
        for kind, f in editions[ek]["files"].items():
            if f["url"] in seen:
                continue
            seen.add(f["url"])
            inputs.append({"url": f["url"], "path": f["path"], "sha256": f["sha256"]})
    for name in ("explanation-of-selected-terms-2025.pdf", "explanation_of_judicial_caseload_profiles_district.xlsx", "explanation_of_judicial_caseload_profiles_appeals.xlsx"):
        p = ACQ / "definitions" / name
        inputs.append({"url": [u for u in meta.DEFINITION_URLS.values() if u.endswith(name)][0], "path": str(p.relative_to(ROOT)), "sha256": sha256_file(p)})
    inputs += ctx.lookup_inputs

    common = {"source": meta.LANDING_URL, "terms": meta.SOURCE_TERMS, "publisher": "Administrative Office of the U.S. Courts",
              "editions": len(keys), "first_edition": keys[0], "last_edition": latest, "notes": meta.COMPARABILITY_BREAKS, "standing_rule": meta.STANDING_RULE}
    periods_all = sorted({p for ed in editions.values() for cells in ed["cells"].values() for cell in cells.values() for p in cell["periods"]})
    stats = {"editions": len(keys), "periods_printed": [periods_all[0], periods_all[-1]], "cross_references": dict(ctx.xref),
             "unmatched": {k: sorted(v) for k, v in ctx.xref_unmatched.items()}}
    profile_listing = cw.listing(
        [("court", "Court"), ("period", "Period ending"), ("filings", "Filings"), ("terminations", "Terminations"), ("pending", "Pending"), ("judgeships", "Judgeships"),
         ("load", "Weighted filings / judgeship (appeals: filed / panel)"), ("median", "Median months (civil; appeals: notice to disposition)"), ("over3", "Civil cases over 3 yrs")],
        [("kind", "Kind", KIND_LABEL),
         ("circuit", "Circuit", {**meta.CIRCUIT_LABEL, "none": "National"}),
         ("fiscal", "Edition", {"yes": "September (fiscal-year) editions", "no": "Other editions"}),
         ("period", "Period ending", {k: fm.period_text(k) for k in reversed(keys)}),
         ("basis", "Criminal counts", {"defendants": "Defendants", "cases": "Cases (earlier method)", "not_applicable": "Not applicable"})])
    write_build(DS_PROFILES, "Federal court caseload profiles by court and period (US Courts FCMS, 2004–2026)", profiles, profile_listing,
                {**common, "grain": "one record per court and edition: 94 district courts, 12 regional courts of appeals, and the national page of each file; each carries the edition's six printed period columns (series), printed standing, computed ranks and changes, and PDF page and row coordinates",
                 "stats": stats, "definitions": measure_definitions(), "periods": "each edition is a 12-month period ending March 31, June 30, September 30 or December 31; editions are listed in fcms_analytics summary:editions",
                 "excluded": [{"edition": s["edition"], "kind": s["kind"], "status": s["status"]} for s in skipped_list],
                 "formulas": formulas()}, inputs)
    write_build(DS_ROLLUPS, "Federal circuit and national roll-ups by period (US Courts FCMS district profiles summed by circuit)", rollups,
                cw.listing([("circuit", "Circuit"), ("period", "Period ending"), ("districts", "Districts"), ("filings", "District filings"), ("terminations", "District terminations"),
                            ("pending", "District pending"), ("judgeships", "District judgeships"), ("per_judgeship", "Filings per judgeship"), ("appeals_filed", "Appeals filed"), ("appeals_pending", "Appeals pending")],
                           [("circuit", "Circuit", {**meta.CIRCUIT_LABEL, "national": "National"}), ("fiscal", "Edition", {"yes": "September (fiscal-year) editions", "no": "Other editions"}),
                            ("period", "Period ending", {k: fm.period_text(k) for k in reversed(keys)})]),
                {**common, "grain": "one record per regional circuit and edition, plus one national record per edition", "stats": stats,
                 "circuit_membership": {"rule": "district -> regional circuit by 28 U.S.C. 41 and 81-131 (courts.CIRCUIT_OF); every one of the 94 districts is assigned", "districts": {c: ctx.circuit_of[c] for c in sorted(ctx.circuit_of)}},
                 "formulas": formulas()}, inputs)
    write_build(DS_ANALYTICS, "Federal court caseload analytics: rankings, changes and methods (US Courts FCMS)", analytics,
                cw.listing([("scope", "Scope"), ("period", "Period ending"), ("edition", "Edition"), ("courts", "Courts")],
                           [("kind", "Kind", {"rankings_district": "District court rankings", "rankings_circuit": "Court of appeals rankings", "summary": "Summaries and methods"}),
                            ("period", "Period ending", {k: fm.period_text(k) for k in reversed(keys)})]),
                {**common, "grain": "per edition: rankings of the 94 districts and 12 circuits with biggest changes and distributions; summary records for definitions, editions, national series, revisions and data quality",
                 "stats": stats, "formulas": formulas()}, inputs)
    print(json.dumps({"editions": len(keys), "profiles": len(profiles), "rollups": len(rollups), "analytics": len(analytics), "seconds": round(time.time() - t0, 1), "xref": dict(ctx.xref)}))


def formulas():
    return {"yoy_pct": "(value for the period - value for the same period one year earlier) / |value one year earlier| x 100, both from the same edition's printed columns; not recorded when the edition does not print the column one year earlier",
            "five_year_pct": "same, against the column five years earlier",
            "rank": "competition rank among the courts of the same kind in the same edition at the edition's own period: 1 = highest value, ties share the lowest rank number",
            "filings_per_judgeship_rollup": "sum of district filings / sum of authorized district judgeships in the circuit, for each period column; a sum is shown only when every district has a printed value",
            "weighted_filings_per_judgeship_rollup": "sum over districts of (printed weighted filings per judgeship x printed judgeships) / sum of judgeships; approximate because the printed per-judgeship values are rounded",
            "district_medians": "median of the districts' printed median months (districts with a printed value only); a pooled median of cases cannot be formed from published medians",
            "reconciliation": "sum of the 94 districts' printed value minus the national page's printed value for the same period"}


def measure_definitions():
    out = {"district": {}, "circuit": {}}
    for kind, table in (("district", meta.DISTRICT_MEASURES), ("circuit", meta.CIRCUIT_MEASURES)):
        for k, (label, unit, decimals, definition, src) in table.items():
            out[kind][k] = {"label": label, "unit": unit, "definition": definition, "definition_source": src}
    return out


def summary_records(ctx, editions, keys, basis, inventory, skipped, ocr, revisions, qa_counts, latest):
    """Summary records of fcms_analytics: definitions, editions, national series, revisions, data quality."""
    rows = []
    srcs = {"EST": meta.DEFINITION_URLS["EST"], "DX": meta.DEFINITION_URLS["DX"], "AX": meta.DEFINITION_URLS["AX"]}

    def summary(rid, title, subtitle, facts, fcms, links=None):
        return cw.record(DS_ANALYTICS, rid, title, source_url=meta.LANDING_URL, subtitle=subtitle, cells={"scope": title, "period": latest, "edition": fm.edition_title(latest), "courts": ""},
                         facts=facts, badges=["Summary"], links=links or [{"url": meta.LANDING_URL, "label": "US Courts Federal Court Management Statistics"}],
                         text=f"{title} FCMS methods definitions", filters={"kind": ["summary"], "period": [latest], "year": [latest[:4]], "date": latest, "_listing": ["no"]},
                         extra={"kind": "summary", "fcms": fcms})

    rows.append(summary(
        "summary:definitions", "FCMS measures, formulas and comparability", "Definitions copied from the publisher's explanation files",
        [["Measures", f"{len(meta.DISTRICT_MEASURES)} district and {len(meta.CIRCUIT_MEASURES)} appeals measures; definitions are the publisher's wording (explanation-of-selected-terms and the two explanation workbooks)"],
         ["Standing rule", meta.STANDING_RULE], ["Source of definitions", "; ".join(srcs.values())],
         *[[f"Comparability: {b['measure']} (from {b['from']})", b["statement"]] for b in meta.COMPARABILITY_BREAKS],
         ["Not recorded", "A value is shown as Not recorded when the page prints a dash, the row could not be read unambiguously, or the edition does not print that measure; no value is estimated or carried over from another edition."]],
        {"measures": measure_definitions(), "formulas": formulas(), "comparability": meta.COMPARABILITY_BREAKS, "standing_rule": meta.STANDING_RULE, "definition_files": srcs, "terms": meta.SOURCE_TERMS}))
    rows.append(summary(
        "summary:editions", "FCMS editions, files and extraction status", f"{len(keys)} editions extracted; {len(skipped)} files not used",
        [["Editions extracted", f"{len(keys)}: {keys[0]} to {keys[-1]}"], ["Files not used", "; ".join(f"{s['edition']} {s['kind']}: {s['status']}" for s in skipped[:40]) or "none"],
         ["Criminal-count basis", "; ".join(f"{k}: {basis[k]['basis']}" for k in keys if k in (keys[0], keys[-1])) + " (see each edition)"]],
        {"editions": inventory, "not_used": skipped, "ocr_assessment": ocr,
         "reason_not_used": {"ocr_text_layer": "1997-2003 files are scans with an OCR text layer whose numbers and court names are unreliable (match rate against the born-digital editions in ocr_assessment); none of their values is published",
                             "image_only": "the June 2004 files have no text layer; extracting them needs OCR, which is not available here"}}))
    # national series: first print of each period
    nat = {}
    for kind, key, headline in (("district", "national_district", meta.DISTRICT_HEADLINE), ("circuit", "national_circuit", meta.CIRCUIT_HEADLINE)):
        h = build_history(editions, kind, "national", headline)
        nat[key] = h
    rows.append(summary(
        "summary:national_series", "National caseload series from every FCMS edition", "District courts and the 12 regional courts of appeals",
        [["Periods", f"{nat['national_district']['periods'][0]} to {nat['national_district']['periods'][-1]} ({len(nat['national_district']['periods'])} periods)"],
         ["Rule", nat["national_district"]["rule"]], ["Break to read with the series", "criminal counts changed from cases to defendants; see summary:definitions and each edition's criminal_count_basis"]],
        {"series": nat, "criminal_count_basis_by_edition": {k: basis[k]["basis"] for k in keys}}))
    rev_rows = []
    for kind, stats in revisions.items():
        for m, s in sorted(stats.items()):
            rev_rows.append({"kind": kind, "measure": m, "compared": s["compared"], "changed": s["changed"], "share_changed": round(s["changed"] / s["compared"], 4) if s["compared"] else None})
    rows.append(summary(
        "summary:revisions", "How often later editions restate earlier figures", "Cells printed by two or more editions of the same criminal-count basis",
        [["Rule", "every (court, measure, period) printed by two or more editions is compared; district comparisons are made only between editions of the same criminal-count basis, so a change of counting method is not counted as a revision"],
         ["Cells compared", f"{sum(r['compared'] for r in rev_rows):,}"], ["Cells restated", f"{sum(r['changed'] for r in rev_rows):,}"]],
        {"by_measure": rev_rows}))
    qa_rows = [{"kind": k, "check": c, "failures": n} for (k, c), n in sorted(qa_counts.items())]
    rows.append(summary(
        "summary:data_quality", "FCMS extraction checks", "Identity checks on every extracted court page; values are never altered by them",
        [["Checks", "district: per-judgeship figures against total / judgeships (4% tolerance); appeals: components against totals; judgeships / 3 against printed panels"],
         ["Failures", "; ".join(f"{r['kind']} {r['check']}: {r['failures']}" for r in qa_rows) or "none"]],
        {"failures": qa_rows}))
    return rows


def write_build(dataset, label, rows, listing_block, summary, inputs):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        dup = [k for k, n in Counter(ids).items() if n > 1][:5]
        raise SystemExit(f"{dataset}: duplicate ids {dup}")
    payload = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
               "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "inputs": inputs}
    write_plain(BUILD / f"{dataset}.json", payload)
    print(dataset, len(rows), "rows", (BUILD / f"{dataset}.json").stat().st_size, "bytes", file=sys.stderr, flush=True)


def write_plain(path, payload):
    """Compact JSON (natural key order), written to a temp file and renamed; waits and retries when the shared disk is momentarily full."""
    tmp = path.with_name(path.name + ".tmp")
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    for attempt in range(120):
        try:
            tmp.write_bytes(data)
            os.replace(tmp, path)
            return
        except OSError as error:
            if error.errno != errno.ENOSPC or attempt == 119:
                raise
            time.sleep(3)


if __name__ == "__main__":
    main()
