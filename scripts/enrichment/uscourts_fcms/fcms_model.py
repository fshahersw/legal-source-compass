"""Pure helpers for the FCMS builder: load parsed editions into cells, derived figures, rankings, rollups, histories.

A cell is one court (or the national page) in one edition: {kind, court_id, name, usps, pages, periods, values {measure: {period_end: number|None}},
flags {measure: {period_end: 'dash'|'ambiguous'|'inconsistent'|'bad'}}, standing {measure: {'us': n, 'circuit': n}}, raw {measure: printed row}}.
Every number is a printed value of the edition's PDF; nothing is imputed. Derived numbers are named as such by the callers.
"""
import statistics
from collections import defaultdict

import courts
import jsonio

NOT_RECORDED = "Not recorded"
EXPLICIT_DEFENDANTS_NOTE = "defendants rather than cases"


# ------------------------------------------------------------------ periods and arithmetic
def prior_year_key(key, years=1):
    """'2026-06-30' -> '2025-06-30' (the same period end, `years` earlier)."""
    return f"{int(key[:4]) - years:04d}{key[4:]}"


def is_fiscal_year_end(key):
    return key.endswith("-09-30")


MONTH_NAMES = {"03-31": "March 31", "06-30": "June 30", "09-30": "September 30", "12-31": "December 31"}


def period_text(key):
    return f"{MONTH_NAMES.get(key[5:], key[5:])}, {key[:4]}"


def edition_title(key):
    return {"03-31": "March", "06-30": "June", "09-30": "September", "12-31": "December"}[key[5:]] + f" {key[:4]}"


def pct_change(cur, prev, digits=1):
    """(cur - prev) / |prev| x 100; None when either value is unknown or prev is zero."""
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / abs(prev) * 100, digits)


def abs_change(cur, prev, digits=1):
    if cur is None or prev is None:
        return None
    return round(cur - prev, digits)


def competition_ranks(values, descending=True):
    """{id: rank} with rank 1 = highest value (descending) or lowest (ascending); ties share the lowest rank number
    (1, 2, 2, 4). Unknown (None) values are not ranked. Returns (ranks, n_ranked)."""
    items = sorted(((k, v) for k, v in values.items() if v is not None), key=lambda kv: ((-kv[1] if descending else kv[1]), kv[0]))
    ranks, prev, rank = {}, object(), 0
    for position, (k, v) in enumerate(items, 1):
        if v != prev:
            rank, prev = position, v
        ranks[k] = rank
    return ranks, len(items)


def extremes(values, n=10):
    """(highest, lowest): lists of (id, value) of the n largest and n smallest known values; ties broken by id."""
    items = [(k, v) for k, v in values.items() if v is not None]
    high = sorted(items, key=lambda kv: (-kv[1], kv[0]))[:n]
    low = sorted(items, key=lambda kv: (kv[1], kv[0]))[:n]
    return high, low


def distribution(values, digits=1):
    """n, min, p25, median, p75, max of the known values (inclusive quartiles); None fields when fewer than two values."""
    nums = sorted(v for v in values if v is not None)
    if not nums:
        return {"n": 0, "min": None, "p25": None, "median": None, "p75": None, "max": None}
    if len(nums) == 1:
        q = [nums[0]] * 3
    else:
        q = statistics.quantiles(nums, n=4, method="inclusive")
    r = lambda x: round(x, digits)  # noqa: E731
    return {"n": len(nums), "min": r(nums[0]), "p25": r(q[0]), "median": r(q[1]), "p75": r(q[2]), "max": r(nums[-1])}


# ------------------------------------------------------------------ loading
def _cell_from_page(kind, page):
    return {"kind": kind, "court_id": page["court_id"], "name": page["name"], "usps": page.get("usps"), "match": page.get("match"),
            "pages": [page["page"]], "periods": list(page["years"]), "labels": list(page.get("labels") or []),
            "values": {m: dict(v) for m, v in page["values"].items()},
            "flags": {m: dict(v) for m, v in page.get("flags", {}).items()},
            "standing": {m: dict(v) for m, v in page.get("standing", {}).items()},
            "raw": {m: dict(v, page=page["page"]) for m, v in page.get("raw", {}).items()},
            "col_x": page.get("col_x"), "unmatched": list(page.get("unmatched", [])), "qa": []}


def merge_circuit_pages(pages):
    """Appeals profiles print the caseload (left) and per-panel measures (right) on one page (2025+) or on facing pages.
    Pages of one court are merged; the period columns must agree, a measure printed twice is an error."""
    out = {}
    for page in pages:
        cid = page["court_id"]
        cell = _cell_from_page("circuit", page)
        if cid not in out:
            out[cid] = cell
            continue
        have = out[cid]
        if have["periods"] != cell["periods"]:
            raise ValueError(f"{cid}: facing pages disagree on period columns")
        for m in cell["values"]:
            if m in have["values"]:
                raise ValueError(f"{cid}: measure {m} printed on two pages")
        have["pages"] = sorted(set(have["pages"] + cell["pages"]))
        for field in ("values", "flags", "standing", "raw"):
            have[field].update(cell[field])
        have["unmatched"] += cell["unmatched"]
    return out


def load_editions(parsed_dir):
    """All born-digital parsed editions keyed by period end. OCR editions and image-only files are returned separately.

    Returns (editions, skipped) where editions[period_end] = {period_end, edition, page_url, files {kind: {...}}, notes {kind: [...]},
    cells {'district': {court_id: cell}, 'circuit': {court_id: cell}}} and skipped lists {edition, kind, status, reason}."""
    index = jsonio.load(parsed_dir / "_index.json")
    editions, skipped = {}, []
    for key, meta in sorted(index.items()):
        slug, kind = key.rsplit("__", 1)
        if meta["status"] != "parsed":
            skipped.append({"edition": slug, "kind": kind, "status": meta["status"], "file": meta.get("file"), "url": meta.get("url"), "sha256": meta.get("sha256")})
            continue
        parsed = jsonio.load(parsed_dir / f"{key}.json.gz")
        if parsed["ocr_text_layer"]:
            skipped.append({"edition": slug, "kind": kind, "status": "ocr_text_layer", "period_end": parsed["period_end"], "file": parsed["file"], "url": parsed["url"], "sha256": parsed["sha256"],
                            "pages_read": len(parsed["pages"]), "pages_excluded": len(parsed["excluded"])})
            continue
        ed = editions.setdefault(parsed["period_end"], {"period_end": parsed["period_end"], "edition": slug, "page_url": parsed["page_url"], "files": {}, "notes": {}, "cells": {}, "excluded": {}})
        pages = [p for p in parsed["pages"] if p.get("court_id")]
        if kind == "district":
            cells = {}
            for p in pages:
                if p["court_id"] in cells:
                    raise ValueError(f"{slug}: court {p['court_id']} printed twice")
                cells[p["court_id"]] = _cell_from_page("district", p)
        else:
            cells = merge_circuit_pages(pages)
        ed["cells"][kind] = cells
        ed["files"][kind] = {"url": parsed["url"], "path": parsed["file"], "sha256": parsed["sha256"]}
        ed["notes"][kind] = parsed.get("page1_notes", [])
        ed["excluded"][kind] = parsed["excluded"] + [{"page": p["page"], "name": p["name"], "reason": "court name not matched to court_spine"} for p in parsed["pages"] if not p.get("court_id")]
    return editions, skipped


def current_key(edition):
    """The column that is the edition's own period (its period end)."""
    return edition["period_end"]


# ------------------------------------------------------------------ edition basis (criminal counts: defendants vs cases)
def national_series(edition, measure="filings"):
    cell = edition["cells"].get("district", {}).get("national")
    return dict(cell["values"].get(measure, {})) if cell else {}


def determine_basis(editions):
    """criminal_count_basis per edition: 'defendants' or 'cases' with the evidence used.

    1. explicit: the national page carries the publisher's NOTE that criminal data count defendants rather than cases;
    2. tested: otherwise the edition's national filings for its own period are compared with the same period printed by an explicit edition: equal -> defendants, different -> cases;
    3. inherited: periods no explicit edition prints take the basis of the nearest tested edition (same layout generation)."""
    keys = sorted(editions)
    explicit = {k for k in keys if any(EXPLICIT_DEFENDANTS_NOTE in n.lower() for n in editions[k]["notes"].get("district", []))}
    reference = {}
    for k in sorted(explicit):
        for period, value in national_series(editions[k]).items():
            if value is not None:
                reference.setdefault(period, (value, k))
    result = {}
    for k in keys:
        if k in explicit:
            result[k] = {"basis": "defendants", "evidence": "national page carries the publisher's note that criminal data count defendants rather than cases"}
            continue
        cur = national_series(editions[k]).get(k)
        ref = reference.get(k)
        if cur is not None and ref is not None:
            same = cur == ref[0]
            result[k] = {"basis": "defendants" if same else "cases",
                         "evidence": (f"national filings for this period ({cur:,}) {'equal' if same else 'differ from'} the {ref[0]:,} printed for the same period in the {ref[1]} edition, which carries the defendants note")}
    tested = sorted(result)
    for k in keys:
        if k in result:
            continue
        near = min(tested, key=lambda t: (abs(int(t[:4]) * 12 + int(t[5:7]) - int(k[:4]) * 12 - int(k[5:7])), t)) if tested else None
        if near is None:
            result[k] = {"basis": None, "evidence": "no edition could be tested"}
        else:
            result[k] = {"basis": result[near]["basis"], "evidence": f"inherited from the {near} edition (no edition with the defendants note prints this period)"}
    return result


# ------------------------------------------------------------------ quality checks (flags, never corrections)
def qa_flags(kind, cell):
    """Identity checks on one cell. Returns [{check, period, measure, detail}] for failures; values are never changed here.

    district: per-judgeship figures within 4% (or 1) of the total divided by the number of judgeships (the publisher's per-judgeship
    figures may use time-weighted judgeships, so a small difference is normal). circuit: filing and merits-termination components
    add to their totals; judgeships divided by 3 equals the printed number of panels (to 0.2)."""
    out = []
    values = cell["values"]

    def v(m, p):
        return values.get(m, {}).get(p)

    for p in cell["periods"]:
        if kind == "district":
            j = v("judgeships", p)
            if j:
                for total, per in (("filings", "pj_filings_total"), ("terminations", "pj_terminations"), ("pending", "pj_pending")):
                    a, b = v(total, p), v(per, p)
                    if a is not None and b is not None and abs(a / j - b) > max(1.01, 0.04 * b):
                        out.append({"check": "per_judgeship", "period": p, "measure": per, "detail": f"{a:,} / {j} = {a / j:.1f} but {b} printed"})
        else:
            parts = [v(m, p) for m in ("filings_prisoner", "filings_other", "filings_criminal", "filings_administrative")]
            if v("filings", p) is not None and None not in parts and sum(parts) != v("filings", p):
                out.append({"check": "filings_components", "period": p, "measure": "filings", "detail": f"components sum to {sum(parts):,}, total printed {v('filings', p):,}"})
            parts = [v(m, p) for m in ("merits_prisoner", "merits_other", "merits_criminal", "merits_administrative")]
            if v("merits_terminations", p) is not None and None not in parts and sum(parts) != v("merits_terminations", p):
                out.append({"check": "merits_components", "period": p, "measure": "merits_terminations", "detail": f"components sum to {sum(parts):,}, total printed {v('merits_terminations', p):,}"})
            j, pn = v("judgeships", p), v("panels", p)
            if j is not None and pn is not None and abs(j / 3 - pn) > 0.2:
                out.append({"check": "judgeships_panels", "period": p, "measure": "judgeships", "detail": f"{j} judgeships / 3 = {j / 3:.1f} but {pn} panels printed"})
    return out


def apply_inconsistent_judgeships(cell):
    """A judgeship count that contradicts the printed number of panels (the June 2009 text layer prints '67' where the panels row shows
    167/3 = 55.7) is not shown: the figure is set to None with flag 'inconsistent'; the printed token stays in the raw row."""
    for flag in qa_flags("circuit", cell):
        if flag["check"] == "judgeships_panels":
            cell["values"]["judgeships"][flag["period"]] = None
            cell["flags"].setdefault("judgeships", {})[flag["period"]] = "inconsistent"
    return cell


# ------------------------------------------------------------------ derived figures inside one cell
def within_edition_changes(cell, measure, current):
    """Year-over-year and five-year change for the current period from the columns of the same edition.

    The prior year is the column whose period end is exactly one year before the current one (mixed-period editions such as
    December 2010 print September and December columns together, so the column to its left is not always the prior year)."""
    s = cell["values"].get(measure, {})
    cur = s.get(current)
    out = {"current": cur}
    for label, years in (("yoy", 1), ("five_year", 5)):
        base_key = prior_year_key(current, years)
        has = base_key in s
        base = s.get(base_key)
        out[label] = {"base_period": base_key if has else None, "base": base, "abs": abs_change(cur, base, 2), "pct": pct_change(cur, base)}
    return out


# ------------------------------------------------------------------ histories across editions
def first_print_series(editions, kind, court_id, measure):
    """{period_end: (value, edition period_end)} using the earliest edition that prints each period (first print)."""
    series = {}
    for ek in sorted(editions):
        cell = editions[ek]["cells"].get(kind, {}).get(court_id)
        if not cell:
            continue
        for period, value in cell["values"].get(measure, {}).items():
            if period not in series and not (value is None and cell["flags"].get(measure, {}).get(period) is None):
                series[period] = (value, ek)
    return series


def revision_cells(editions, kind, basis):
    """Compare every (court, measure, period) printed by two or more editions of the same criminal-count basis.

    Returns {measure: {'compared': n, 'changed': n}} and a list of the largest relative changes (national rows excluded)."""
    seen = defaultdict(dict)  # (court, measure, period) -> {edition: value}
    for ek, ed in editions.items():
        if kind == "district" and basis[ek]["basis"] is None:
            continue
        for court_id, cell in ed["cells"].get(kind, {}).items():
            for measure, vals in cell["values"].items():
                if measure.startswith("pct_change"):
                    continue
                for period, value in vals.items():
                    seen[(court_id, measure, period)][ek] = value
    stats = defaultdict(lambda: {"compared": 0, "changed": 0})
    for (court_id, measure, period), per_edition in seen.items():
        groups = defaultdict(list)
        for ek, value in per_edition.items():
            groups[basis[ek]["basis"] if kind == "district" else "all"].append((ek, value))
        for group in groups.values():
            known = [(ek, v) for ek, v in group if v is not None]
            if len(group) < 2:
                continue
            stats[measure]["compared"] += 1
            if len({v for _, v in known}) > 1 or (known and len(known) != len(group)):
                stats[measure]["changed"] += 1
    return dict(stats)


# ------------------------------------------------------------------ rollups
def circuit_rollup(district_cells, circuit_of, circuit_id, periods, measures):
    """Sums over the districts of one regional circuit for each period column.

    A sum is reported only when every district of the circuit has a known value for that measure and period (never a partial sum):
    returns {measure: {period: {'sum': n|None, 'districts': k, 'known': m}}}."""
    members = sorted(c for c, circ in circuit_of.items() if circ == circuit_id)
    out = {}
    for measure in measures:
        per_period = {}
        for p in periods:
            vals = [district_cells[c]["values"].get(measure, {}).get(p) if c in district_cells else None for c in members]
            known = [x for x in vals if x is not None]
            per_period[p] = {"sum": (round(sum(known), 1) if len(known) == len(members) and members else None), "districts": len(members), "known": len(known)}
        out[measure] = per_period
    return out


def circuit_membership():
    """district court id -> regional circuit id (28 U.S.C. 41, 81-131), from courts.CIRCUIT_OF."""
    return dict(courts.CIRCUIT_OF)
