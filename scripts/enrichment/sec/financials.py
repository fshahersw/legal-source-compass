"""Turn SEC XBRL companyfacts into annual and quarterly series (pure functions, unit-tested).

Rules:
  * Only facts reported in the registrant's own 10-K/10-Q/20-F/40-F (and amendments) are used.
  * Annual = duration of 340-380 days (or an instant) from an annual form; quarterly = duration of
    80-100 days (or an instant) from any of those forms.
  * One value per period: facts are deduplicated by (start, end) — or end for balances — keeping the
    most recently filed value, so restatements replace earlier numbers.
  * Fiscal year label = calendar year of the period end, except periods ending in the first 7 days
    of January belong to the prior year (52/53-week years such as Johnson & Johnson's).
  * Each point keeps concept, unit, accession, form, filed date and SEC frame so it can be re-checked.
  * No currency conversion: series stay in the reported unit.
"""
from datetime import date

ANNUAL_FORMS = {"10-K", "10-K405", "10-KT", "20-F", "40-F"}
ALL_FORMS = ANNUAL_FORMS | {"10-Q"}

# metric -> (statement kind, [(taxonomy, concept), ...] in precedence order, selection mode)
# "period" picks per period the first concept with a value; "series" picks one concept for the whole
# company so a series never silently changes definition: the concept with the most recent observation,
# then the most observations, then precedence order.
METRICS = {
    "revenue": ("duration", [("us-gaap", "Revenues"), ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
                             ("us-gaap", "SalesRevenueNet"), ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
                             ("us-gaap", "SalesRevenueGoodsNet"),
                             ("ifrs-full", "Revenue"), ("ifrs-full", "RevenueFromContractsWithCustomers"),
                             ("ifrs-full", "RevenueFromSaleOfGoods")], "period"),
    "net_income": ("duration", [("us-gaap", "NetIncomeLoss"), ("us-gaap", "NetIncomeLossAvailableToCommonStockholdersBasic"),
                                ("us-gaap", "ProfitLoss"), ("ifrs-full", "ProfitLossAttributableToOwnersOfParent")], "period"),
    "assets": ("instant", [("us-gaap", "Assets"), ("ifrs-full", "Assets")], "period"),
    "cash": ("instant", [("us-gaap", "CashAndCashEquivalentsAtCarryingValue"), ("ifrs-full", "CashAndCashEquivalents")], "period"),
    "rnd": ("duration", [("us-gaap", "ResearchAndDevelopmentExpense"), ("ifrs-full", "ResearchAndDevelopmentExpense")], "period"),
    "litigation_accrual": ("instant", [("us-gaap", "LossContingencyAccrualAtCarryingValue"), ("us-gaap", "LitigationReserve"),
                                       ("us-gaap", "LossContingencyAccrualProductLiabilityNet"), ("us-gaap", "LossContingencyAccrualProductLiabilityGross")], "series"),
    "possible_loss": ("instant", [("us-gaap", "LossContingencyEstimateOfPossibleLoss")], "series"),
    "litigation_expense": ("duration", [("us-gaap", "LitigationSettlementExpense"), ("us-gaap", "LossContingencyLossInPeriod"),
                                        ("us-gaap", "LossContingencyAccrualProvision"), ("us-gaap", "ProductLiabilityAccrualPeriodExpense")], "series"),
    "legal_payments": ("duration", [("us-gaap", "PaymentsForLegalSettlements"), ("us-gaap", "LossContingencyAccrualCarryingValuePayments")], "series"),
}
# Every concept named in the brief plus the litigation extensions above is also kept raw, as
# (taxonomy, concept) pairs: a concept is tracked only in the taxonomy it is listed under.
RAW_CONCEPTS = sorted({c for _, cs, _ in METRICS.values() for c in cs})
STANDARD_TAXONOMIES = ("us-gaap", "ifrs-full")
MIN_YEAR = 2012  # series keep fiscal years from this one on


def tracked_pairs(facts: dict) -> list[tuple[str, str]]:
    """Tracked (taxonomy, concept) pairs the companyfacts file reports for any period, sorted. Company
    extensions, dei/srt/ffd facts and a concept under a taxonomy it is not tracked in never count."""
    tracked = set(RAW_CONCEPTS)
    return sorted((taxonomy, concept) for taxonomy in STANDARD_TAXONOMIES for concept in (facts.get(taxonomy) or {})
                  if (taxonomy, concept) in tracked)


def taxonomy_label(facts: dict) -> str | None:
    """The standard taxonomy the company's figures come from: 'us-gaap' or 'ifrs-full' when every tracked
    concept is reported under that one, 'mixed' when tracked concepts come from both. Series points are
    always drawn from tracked concepts, so they never add a taxonomy. Without any tracked concept, the
    standard taxonomies the file holds at all decide; None when it holds neither (e.g. only filing-fee facts)."""
    used = [t for t in STANDARD_TAXONOMIES if any(pt == t for pt, _ in tracked_pairs(facts))]
    if not used:
        used = [t for t in STANDARD_TAXONOMIES if facts.get(t)]
    if len(used) > 1:
        return "mixed"
    return used[0] if used else None


def concepts_present(facts: dict) -> list[str]:
    """The tracked concepts the companyfacts file reports for any period (not only the periods the series
    keep), sorted, one entry per (taxonomy, concept) pair. Names are bare when every pair comes from one
    taxonomy; when both taxonomies supply tracked concepts each name carries its taxonomy ('ifrs-full:Assets')."""
    pairs = tracked_pairs(facts)
    if len({taxonomy for taxonomy, _ in pairs}) > 1:
        return sorted(f"{taxonomy}:{concept}" for taxonomy, concept in pairs)
    return sorted(concept for _, concept in pairs)


def days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def fiscal_year(end: str) -> int:
    d = date.fromisoformat(end)
    return d.year - 1 if d.month == 1 and d.day <= 7 else d.year


def pick_unit(units: dict) -> str | None:
    """USD when present, otherwise the currency unit with the most facts (never a per-share unit)."""
    if not units:
        return None
    if "USD" in units:
        return "USD"
    money = {u: v for u, v in units.items() if "/" not in u and u.isalpha() and len(u) == 3}
    pool = money or units
    return max(pool, key=lambda u: len(pool[u]))


def period_ends(facts: dict, grain: str) -> set[str]:
    """Period-end dates of the company's own annual (340-380 day) or quarterly (80-100 day) income
    statement facts. Balance-sheet instants are only kept on these dates, so a subsequent-event
    balance quoted inside a 10-K is never mistaken for a fiscal-year-end balance."""
    ends = set()
    for taxonomy, concept in (("us-gaap", "NetIncomeLoss"), ("us-gaap", "ProfitLoss"), ("us-gaap", "Revenues"),
                              ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"), ("us-gaap", "SalesRevenueNet"),
                              ("ifrs-full", "ProfitLoss"), ("ifrs-full", "Revenue"), ("ifrs-full", "ProfitLossAttributableToOwnersOfParent")):
        node = (facts.get(taxonomy) or {}).get(concept)
        if not node:
            continue
        for unit_facts in node.get("units", {}).values():
            for f in unit_facts:
                form = (f.get("form") or "").replace("/A", "")
                if not f.get("start") or not f.get("end") or form not in ALL_FORMS:
                    continue
                span = days(f["start"], f["end"])
                if grain == "annual" and 340 <= span <= 380 and form in ANNUAL_FORMS:
                    ends.add(f["end"])
                if grain == "quarterly" and (80 <= span <= 100 or 340 <= span <= 380):
                    ends.add(f["end"])
    return ends


def series_for(facts: dict, taxonomy: str, concept: str, kind: str, grain: str, valid_ends: set[str] | None = None):
    """Deduplicated points for one concept: [{start, end, fy, value, unit, concept, accn, form, filed, frame}]."""
    node = (facts.get(taxonomy) or {}).get(concept)
    if not node:
        return []
    unit = pick_unit(node.get("units") or {})
    if not unit:
        return []
    best: dict[tuple, dict] = {}
    for f in node["units"][unit]:
        form = (f.get("form") or "").replace("/A", "")
        if form not in ALL_FORMS or not isinstance(f.get("val"), (int, float)):
            continue
        end, start = f.get("end"), f.get("start")
        if not end:
            continue
        if kind == "duration":
            if not start:
                continue
            span = days(start, end)
            if grain == "annual" and not (340 <= span <= 380 and form in ANNUAL_FORMS):
                continue
            if grain == "quarterly" and not (80 <= span <= 100):
                continue
            key = (start, end)
        else:
            if start:
                continue
            if grain == "annual" and form not in ANNUAL_FORMS:
                continue
            if valid_ends is not None and end not in valid_ends:
                continue
            key = (end,)
        prev = best.get(key)
        if prev is None or (f.get("filed") or "") > prev["filed"]:
            best[key] = {"start": start, "end": end, "value": f["val"], "unit": unit, "concept": concept, "taxonomy": taxonomy,
                         "accn": f.get("accn"), "form": f.get("form"), "filed": f.get("filed") or "", "frame": f.get("frame")}
    points = sorted(best.values(), key=lambda p: (p["end"], p["start"] or ""))
    # Two durations ending on the same date (e.g. a short transition period) keep the longest.
    by_end: dict[str, dict] = {}
    for p in points:
        cur = by_end.get(p["end"])
        if cur is None or (p["start"] and cur["start"] and p["start"] < cur["start"]):
            by_end[p["end"]] = p
    out = []
    for p in sorted(by_end.values(), key=lambda p: p["end"]):
        p["fy"] = fiscal_year(p["end"])
        out.append(p)
    return out


def annual_by_year(points):
    """Keep one point per fiscal-year label (the latest period end within that label)."""
    out: dict[int, dict] = {}
    for p in points:
        if p["fy"] not in out or p["end"] > out[p["fy"]]["end"]:
            out[p["fy"]] = p
    return [out[y] for y in sorted(out)]


def metric_series(facts: dict, metric: str, grain: str, min_year: int = MIN_YEAR):
    kind, concepts, mode = METRICS[metric]
    ends = period_ends(facts, grain) if kind == "instant" else None
    per_concept = {(t, c): series_for(facts, t, c, kind, grain, ends) for t, c in concepts}
    if grain == "annual":
        per_concept = {k: annual_by_year(v) for k, v in per_concept.items()}
    if mode == "series":
        ranked = [k for k in per_concept if per_concept[k]]
        if not ranked:
            return []
        chosen = max(ranked, key=lambda k: (per_concept[k][-1]["end"][:4] if per_concept[k] else "", len(per_concept[k]), -concepts.index(k)))
        points = per_concept[chosen]
    else:
        merged: dict[str, dict] = {}
        for k in concepts:
            for p in per_concept[k]:
                slot = str(p["fy"]) if grain == "annual" else p["end"]
                if slot not in merged:
                    merged[slot] = p
        points = sorted(merged.values(), key=lambda p: p["end"])
    return [p for p in points if p["fy"] >= min_year]


def yoy(points, key="value"):
    """Year-over-year change for consecutive fiscal years (None when the prior year is missing or zero)."""
    by = {p["fy"]: p[key] for p in points}
    out = []
    for p in points:
        prev = by.get(p["fy"] - 1)
        pct = None if prev in (None, 0) else (p[key] - prev) / abs(prev)
        out.append({"fy": p["fy"], "value": p[key], "prior": prev, "change_pct": None if pct is None else round(100 * pct, 1)})
    return out


def ratio_same_year(numer, denom):
    """Numerator / denominator for fiscal years present in both and in the same unit; percent, 2 dp."""
    d = {p["fy"]: p for p in denom}
    out = []
    for p in numer:
        q = d.get(p["fy"])
        if q and q["unit"] == p["unit"] and q["value"]:
            out.append({"fy": p["fy"], "pct": round(100 * p["value"] / q["value"], 2)})
    return out
