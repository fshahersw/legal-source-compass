"""Income statement, balance sheet and cash flow statement from SEC XBRL companyfacts (pure functions, unit-tested).

Rules:
  * Only facts the registrant reported in its own 10-K/10-Q/20-F/40-F (and amendments) are used; one value per period,
    the most recently filed, so restatements replace earlier numbers. Every value keeps its concept and accession.
  * Fiscal years are the registrant's 340-380 day annual periods (fiscal_year labels as in financials.py).
  * Quarters: a 80-100 day value reported for exactly that quarter is used as filed. Otherwise the quarter is derived from
    year-to-date values of the same concept that start on the fiscal year's first day (e.g. Q4 = full year - nine months,
    Q2 = six months - first quarter), or, for a fourth quarter, the full year less the three earlier quarters of the same
    concept, and is marked derived. Nothing is derived across concepts, and per-share or share-count values never are.
    The quarters filed so far in the fiscal year after the last annual report are included.
  * Lines name concepts in precedence order; per period the first concept with a value is used (revenue concepts change
    over time, e.g. SalesRevenueNet to RevenueFromContractWithCustomerExcludingAssessedTax). A quarter uses the concept of
    its fiscal year's annual value, or one reporting the same annual amount, so a year's quarters and total agree in
    definition.
  * Computed lines (gross profit when not reported, free cash flow) and margins are marked computed and only use values of
    the same period and unit.
"""
from __future__ import annotations

from datetime import date, timedelta

from financials import ALL_FORMS, ANNUAL_FORMS, days, fiscal_year, pick_unit

R = [("us-gaap", "Revenues"), ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"), ("us-gaap", "SalesRevenueNet"),
     ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"), ("us-gaap", "SalesRevenueGoodsNet"),
     ("ifrs-full", "Revenue"), ("ifrs-full", "RevenueFromContractsWithCustomers"),
     # last resort: IFRS filers that tag only net sales of goods (Novartis, Sanofi) and no total revenue line
     ("ifrs-full", "RevenueFromSaleOfGoods")]

# key, label, statement, kind (duration|instant), unit kind (money|per_share|shares), concepts
LINES = [
    ("revenue", "Revenue", "income", "duration", "money", R),
    ("cost_of_revenue", "Cost of revenue", "income", "duration", "money",
     [("us-gaap", "CostOfRevenue"), ("us-gaap", "CostOfGoodsAndServicesSold"), ("us-gaap", "CostOfGoodsSold"),
      ("us-gaap", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"), ("ifrs-full", "CostOfSales")]),
    ("gross_profit", "Gross profit", "income", "duration", "money", [("us-gaap", "GrossProfit"), ("ifrs-full", "GrossProfit")]),
    ("rnd", "Research and development", "income", "duration", "money",
     [("us-gaap", "ResearchAndDevelopmentExpense"), ("us-gaap", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"),
      ("ifrs-full", "ResearchAndDevelopmentExpense")]),
    ("sga", "Selling, general and administrative", "income", "duration", "money",
     [("us-gaap", "SellingGeneralAndAdministrativeExpense"), ("ifrs-full", "SellingGeneralAndAdministrativeExpense")]),
    ("operating_income", "Operating income", "income", "duration", "money",
     [("us-gaap", "OperatingIncomeLoss"), ("ifrs-full", "ProfitLossFromOperatingActivities")]),
    ("interest_expense", "Interest expense", "income", "duration", "money",
     [("us-gaap", "InterestExpense"), ("us-gaap", "InterestExpenseNonoperating"), ("ifrs-full", "FinanceCosts")]),
    ("pretax_income", "Income before income taxes", "income", "duration", "money",
     [("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
      ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
      ("ifrs-full", "ProfitLossBeforeTax")]),
    ("income_tax", "Income tax expense", "income", "duration", "money",
     [("us-gaap", "IncomeTaxExpenseBenefit"), ("ifrs-full", "IncomeTaxExpenseContinuingOperations")]),
    ("net_income", "Net income", "income", "duration", "money",
     [("us-gaap", "NetIncomeLoss"), ("us-gaap", "NetIncomeLossAvailableToCommonStockholdersBasic"), ("us-gaap", "ProfitLoss"),
      ("ifrs-full", "ProfitLossAttributableToOwnersOfParent"), ("ifrs-full", "ProfitLoss")]),
    ("eps_basic", "EPS, basic", "income", "duration", "per_share",
     [("us-gaap", "EarningsPerShareBasic"), ("ifrs-full", "BasicEarningsLossPerShare")]),
    ("eps_diluted", "EPS, diluted", "income", "duration", "per_share",
     [("us-gaap", "EarningsPerShareDiluted"), ("us-gaap", "EarningsPerShareBasicAndDiluted"), ("ifrs-full", "DilutedEarningsLossPerShare")]),
    ("shares_diluted", "Diluted shares (weighted)", "income", "duration", "shares",
     [("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"), ("ifrs-full", "AdjustedWeightedAverageShares")]),
    ("cash", "Cash and cash equivalents", "balance", "instant", "money",
     [("us-gaap", "CashAndCashEquivalentsAtCarryingValue"), ("ifrs-full", "CashAndCashEquivalents")]),
    ("short_term_investments", "Short-term investments", "balance", "instant", "money",
     [("us-gaap", "ShortTermInvestments"), ("us-gaap", "MarketableSecuritiesCurrent"), ("ifrs-full", "CurrentInvestments")]),
    ("receivables", "Accounts receivable", "balance", "instant", "money",
     [("us-gaap", "AccountsReceivableNetCurrent"), ("ifrs-full", "TradeAndOtherCurrentReceivables")]),
    ("inventory", "Inventories", "balance", "instant", "money", [("us-gaap", "InventoryNet"), ("ifrs-full", "Inventories")]),
    ("current_assets", "Total current assets", "balance", "instant", "money", [("us-gaap", "AssetsCurrent"), ("ifrs-full", "CurrentAssets")]),
    ("ppe", "Property, plant and equipment, net", "balance", "instant", "money",
     [("us-gaap", "PropertyPlantAndEquipmentNet"), ("ifrs-full", "PropertyPlantAndEquipment")]),
    ("goodwill", "Goodwill", "balance", "instant", "money", [("us-gaap", "Goodwill"), ("ifrs-full", "Goodwill")]),
    ("intangibles", "Intangible assets, net", "balance", "instant", "money",
     [("us-gaap", "IntangibleAssetsNetExcludingGoodwill"), ("us-gaap", "FiniteLivedIntangibleAssetsNet"),
      ("ifrs-full", "IntangibleAssetsOtherThanGoodwill")]),
    ("total_assets", "Total assets", "balance", "instant", "money", [("us-gaap", "Assets"), ("ifrs-full", "Assets")]),
    ("current_liabilities", "Total current liabilities", "balance", "instant", "money",
     [("us-gaap", "LiabilitiesCurrent"), ("ifrs-full", "CurrentLiabilities")]),
    ("long_term_debt", "Long-term debt", "balance", "instant", "money",
     [("us-gaap", "LongTermDebtNoncurrent"), ("us-gaap", "LongTermDebt"), ("ifrs-full", "NoncurrentPortionOfNoncurrentBorrowings")]),
    ("total_liabilities", "Total liabilities", "balance", "instant", "money", [("us-gaap", "Liabilities"), ("ifrs-full", "Liabilities")]),
    ("equity", "Shareholders' equity", "balance", "instant", "money",
     [("us-gaap", "StockholdersEquity"), ("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
      ("ifrs-full", "EquityAttributableToOwnersOfParent"), ("ifrs-full", "Equity")]),
    ("liabilities_and_equity", "Total liabilities and equity", "balance", "instant", "money",
     [("us-gaap", "LiabilitiesAndStockholdersEquity"), ("ifrs-full", "EquityAndLiabilities")]),
    ("cfo", "Cash from operating activities", "cashflow", "duration", "money",
     [("us-gaap", "NetCashProvidedByUsedInOperatingActivities"), ("us-gaap", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
      ("ifrs-full", "CashFlowsFromUsedInOperatingActivities")]),
    ("capex", "Capital expenditures", "cashflow", "duration", "money",
     [("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"), ("us-gaap", "PaymentsToAcquireProductiveAssets"),
      ("ifrs-full", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities")]),
    ("cfi", "Cash from investing activities", "cashflow", "duration", "money",
     [("us-gaap", "NetCashProvidedByUsedInInvestingActivities"), ("us-gaap", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"),
      ("ifrs-full", "CashFlowsFromUsedInInvestingActivities")]),
    ("cff", "Cash from financing activities", "cashflow", "duration", "money",
     [("us-gaap", "NetCashProvidedByUsedInFinancingActivities"), ("us-gaap", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"),
      ("ifrs-full", "CashFlowsFromUsedInFinancingActivities")]),
    ("dna", "Depreciation and amortization", "cashflow", "duration", "money",
     [("us-gaap", "DepreciationDepletionAndAmortization"), ("us-gaap", "DepreciationAndAmortization"),
      ("us-gaap", "DepreciationAmortizationAndAccretionNet")]),
    ("sbc", "Share-based compensation", "cashflow", "duration", "money",
     [("us-gaap", "ShareBasedCompensation"), ("us-gaap", "AllocatedShareBasedCompensationExpense")]),
    ("dividends", "Dividends paid", "cashflow", "duration", "money",
     [("us-gaap", "PaymentsOfDividends"), ("us-gaap", "PaymentsOfDividendsCommonStock"),
      ("ifrs-full", "DividendsPaidClassifiedAsFinancingActivities")]),
    ("buybacks", "Share repurchases", "cashflow", "duration", "money", [("us-gaap", "PaymentsForRepurchaseOfCommonStock")]),
]
COMPUTED = {"gross_profit": ("revenue", "cost_of_revenue", "-"), "fcf": ("cfo", "capex", "-")}
MARGINS = {"gross_margin": "gross_profit", "operating_margin": "operating_income", "net_margin": "net_income", "fcf_margin": "fcf"}
LINE_INDEX = {line[0]: line for line in LINES}


def unit_for(units: dict, unit_kind: str) -> str | None:
    if not units:
        return None
    if unit_kind == "money":
        return pick_unit({u: v for u, v in units.items() if "/" not in u})
    if unit_kind == "per_share":
        per = [u for u in units if u.endswith("/shares")]
        return "USD/shares" if "USD/shares" in per else (per[0] if per else None)
    return "shares" if "shares" in units else None


def facts_for(facts: dict, taxonomy: str, concept: str, unit_kind: str) -> tuple[str | None, list[dict]]:
    """Own-form facts of one concept in its chosen unit, one per (start, end), latest filed."""
    node = (facts.get(taxonomy) or {}).get(concept)
    if not node:
        return None, []
    unit = unit_for(node.get("units") or {}, unit_kind)
    if not unit:
        return None, []
    best: dict[tuple, dict] = {}
    for f in node["units"][unit]:
        form = (f.get("form") or "").replace("/A", "")
        if form not in ALL_FORMS or not isinstance(f.get("val"), (int, float)) or not f.get("end"):
            continue
        key = (f.get("start"), f["end"])
        prev = best.get(key)
        if prev is None or (f.get("filed") or "") > prev["filed"]:
            best[key] = {"start": f.get("start"), "end": f["end"], "v": f["val"], "accn": f.get("accn"), "form": f.get("form"),
                         "filed": f.get("filed") or "", "concept": concept, "taxonomy": taxonomy, "unit": unit}
    return unit, list(best.values())


def fiscal_years(facts: dict) -> list[dict]:
    """The registrant's annual periods (start, end, fy) from 10-K/20-F/40-F income statement facts, one per fiscal-year label."""
    spans: dict[tuple, str] = {}
    for taxonomy, concept in R + [("us-gaap", "NetIncomeLoss"), ("us-gaap", "ProfitLoss"), ("ifrs-full", "ProfitLoss")]:
        node = (facts.get(taxonomy) or {}).get(concept)
        if not node:
            continue
        for unit_facts in (node.get("units") or {}).values():
            for f in unit_facts:
                form = (f.get("form") or "").replace("/A", "")
                if form in ANNUAL_FORMS and f.get("start") and f.get("end") and 340 <= days(f["start"], f["end"]) <= 380:
                    spans[(f["start"], f["end"])] = f["end"]
    by_fy: dict[int, dict] = {}
    for start, end in spans:
        fy = fiscal_year(end)
        cur = by_fy.get(fy)
        if cur is None or end > cur["end"] or (end == cur["end"] and start < cur["start"]):
            by_fy[fy] = {"fy": fy, "start": start, "end": end}
    return [by_fy[y] for y in sorted(by_fy)]


def _next_day(d: str) -> str:
    return (date.fromisoformat(d) + timedelta(days=1)).isoformat()


def quarter_periods(fy: dict, duration_facts: list[dict]) -> list[dict] | None:
    """The four quarters of a fiscal year, from the period ends of 3-month values inside it and of year-to-date values
    starting on its first day. None unless exactly three interior quarter ends are found and every quarter is 80-100 days."""
    ends = set()
    for f in duration_facts:
        if not f["start"] or f["end"] >= fy["end"] or f["end"] <= fy["start"]:
            continue
        span = days(f["start"], f["end"])
        if f["start"] == fy["start"] and (80 <= span <= 100 or 170 <= span <= 200 or 260 <= span <= 290):
            ends.add(f["end"])
        elif fy["start"] <= f["start"] and 80 <= span <= 100:
            ends.add(f["end"])
    interior = sorted(ends)
    if len(interior) != 3:
        return None
    out, start = [], fy["start"]
    for q, end in enumerate(interior + [fy["end"]], 1):
        if not 80 <= days(start, end) <= 100:
            return None
        out.append({"fy": fy["fy"], "q": q, "start": start, "end": end})
        start = _next_day(end)
    return out


def duration_value(facts_by_span: dict, start: str, end: str, fy_start: str, prev_end: str | None, allow_derive: bool = True):
    """A quarter's value: as filed for (start, end), else year-to-date(end) - year-to-date(prev_end), both from the
    fiscal year's first day; marked derived. Per-share and share-count values are never derived (they do not add up
    across periods). None when neither is available."""
    direct = facts_by_span.get((start, end))
    if direct:
        return {**direct, "derived": False}
    cum_end = facts_by_span.get((fy_start, end))
    if not cum_end:
        return None
    if prev_end is None:
        return {**cum_end, "derived": False}
    if not allow_derive:
        return None
    cum_prev = facts_by_span.get((fy_start, prev_end))
    if not cum_prev:
        return None
    return {**cum_end, "v": cum_end["v"] - cum_prev["v"], "derived": True, "derived_from": [cum_prev["accn"], cum_end["accn"]]}


def current_year_quarters(last_fy: dict, duration_facts: list[dict]) -> list[dict]:
    """Quarters reported so far in the fiscal year after the last annual report (10-Q only, so Q1-Q3 at most): contiguous
    from the day after that year ended, each 80-100 days, from the ends of 3-month and year-to-date values."""
    start = _next_day(last_fy["end"])
    ends = set()
    for f in duration_facts:
        if not f["start"] or f["end"] <= start or days(start, f["end"]) > 290:
            continue
        span = days(f["start"], f["end"])
        if f["start"] == start and (80 <= span <= 100 or 170 <= span <= 200 or 260 <= span <= 290):
            ends.add(f["end"])
        elif f["start"] >= start and 80 <= span <= 100:
            ends.add(f["end"])
    out, begin = [], start
    for q, end in enumerate(sorted(ends)[:3], 1):
        if not 80 <= days(begin, end) <= 100:
            break
        out.append({"fy": last_fy["fy"] + 1, "q": q, "start": begin, "end": end})
        begin = _next_day(end)
    return out


def _annual_cells(fs: list[dict], kind: str, fys: list[dict]) -> dict[int, dict]:
    """A concept's annual facts by fiscal year: the full-year duration from an annual form, or the year-end balance."""
    if kind == "duration":
        by_span = {(f["start"], f["end"]): f for f in fs if f["start"]}
        return {fy["fy"]: by_span[(fy["start"], fy["end"])] for fy in fys
                if (fy["start"], fy["end"]) in by_span and (by_span[(fy["start"], fy["end"])]["form"] or "").replace("/A", "") in ANNUAL_FORMS}
    by_end = {f["end"]: f for f in fs if not f["start"]}
    return {fy["fy"]: by_end[fy["end"]] for fy in fys if fy["end"] in by_end}


def line_series(facts: dict, line: tuple, fys: list[dict], quarters: list[dict]):
    """(annual, quarterly, unit) for one line: one cell per period, first concept in precedence with a value.

    A quarter only takes a concept that its fiscal year's annual cell uses, or one reporting the same annual amount, so
    a year's quarters and its total never mix definitions (quarters of the year in progress follow the latest annual
    concept). A fourth quarter missing both as filed and as a year-to-date difference is the annual value minus the
    three earlier quarters of the same concept, marked derived."""
    _key, _label, _stmt, kind, unit_kind, concepts = line
    annual: list[dict | None] = [None] * len(fys)
    quarterly: list[dict | None] = [None] * len(quarters)
    series = []
    for taxonomy, concept in concepts:
        unit, fs = facts_for(facts, taxonomy, concept, unit_kind)
        if fs:
            series.append((concept, unit, fs, _annual_cells(fs, kind, fys)))
    unit_seen = None
    for _concept, unit, _fs, by_fy in series:
        if unit_seen and unit != unit_seen:
            continue
        for i, fy in enumerate(fys):
            if annual[i] is None and fy["fy"] in by_fy:
                annual[i] = {**by_fy[fy["fy"]], "derived": False}
                unit_seen = unit
    year_cell = {fy["fy"]: cell for fy, cell in zip(fys, annual) if cell}
    latest = max(year_cell) if year_cell else None

    def allowed(concept: str, by_fy: dict, fy: int) -> bool:
        ref = fy if fy in year_cell else (latest if latest is not None and fy > latest else None)
        if ref is None:
            return True
        cell = year_cell[ref]
        same = by_fy.get(ref)
        return cell["concept"] == concept or (same is not None and abs(same["v"] - cell["v"]) <= 1e-3 * max(1.0, abs(cell["v"])))

    fy_starts = {fy["fy"]: fy["start"] for fy in fys}
    for q in quarters:
        if q["q"] == 1:
            fy_starts.setdefault(q["fy"], q["start"])
    for concept, unit, fs, by_fy in series:
        if unit_seen and unit != unit_seen:
            continue
        own: dict[int, dict] = {}
        if kind == "duration":
            by_span = {(f["start"], f["end"]): f for f in fs if f["start"]}
            for i, q in enumerate(quarters):
                if not allowed(concept, by_fy, q["fy"]) or q["fy"] not in fy_starts:
                    continue
                fy_start = fy_starts[q["fy"]]
                prev_end = quarters[i - 1]["end"] if q["q"] > 1 and i > 0 and quarters[i - 1]["fy"] == q["fy"] else None
                if q["q"] > 1 and prev_end is None:
                    continue
                cell = duration_value(by_span, q["start"], q["end"], fy_start, prev_end, allow_derive=unit_kind == "money")
                total = by_span.get((fy_start, q["end"]))
                if (cell is None and unit_kind == "money" and q["q"] == 4 and total and i >= 3
                        and all(j in own and quarters[j]["fy"] == q["fy"] for j in (i - 3, i - 2, i - 1))):
                    cell = {**total, "v": total["v"] - sum(own[j]["v"] for j in (i - 3, i - 2, i - 1)), "derived": True,
                            "derived_from": [own[j]["accn"] for j in (i - 3, i - 2, i - 1)] + [total["accn"]]}
                if cell:
                    own[i] = cell
                    if quarterly[i] is None:
                        quarterly[i] = cell
                        unit_seen = unit
        else:
            by_end = {f["end"]: f for f in fs if not f["start"]}
            for i, q in enumerate(quarters):
                if quarterly[i] is None and q["end"] in by_end and allowed(concept, by_fy, q["fy"]):
                    quarterly[i] = {**by_end[q["end"]], "derived": False}
                    unit_seen = unit
    return annual, quarterly, unit_seen


def compute(cells_a: list, cells_b: list, op: str) -> list:
    out = []
    for a, b in zip(cells_a, cells_b):
        if a and b and a["unit"] == b["unit"]:
            v = a["v"] - b["v"] if op == "-" else a["v"] + b["v"]
            out.append({"v": v, "unit": a["unit"], "computed": True, "concept": None, "accn": None, "derived": a.get("derived") or b.get("derived")})
        else:
            out.append(None)
    return out


def margins(lines: dict, grain: str) -> dict:
    rev = lines.get("revenue", {}).get(grain) or []
    out = {}
    for name, key in MARGINS.items():
        cells = lines.get(key, {}).get(grain) or []
        vals = []
        for r, c in zip(rev, cells):
            vals.append(round(100 * c["v"] / r["v"], 2) if r and c and r["v"] and r["unit"] == c["unit"] else None)
        out[name] = vals
    return out


def growth(cells: list, periods: list, grain: str) -> list:
    """Change against the prior fiscal year (annual) or the same quarter a year earlier (quarterly), percent, 1 dp."""
    index = {((p["fy"], p.get("q")) if grain == "quarterly" else (p["fy"], None)): i for i, p in enumerate(periods)}
    out = []
    for i, p in enumerate(periods):
        prev_i = index.get((p["fy"] - 1, p.get("q") if grain == "quarterly" else None))
        a, b = cells[i], (cells[prev_i] if prev_i is not None else None)
        out.append(round(100 * (a["v"] - b["v"]) / abs(b["v"]), 1) if a and b and b["v"] and a["unit"] == b["unit"] else None)
    return out


def line_concepts() -> set[str]:
    return {concept for line in LINES for _taxonomy, concept in line[5]}


def merge_facts(facts: dict, extra: list[dict], *, accn: str, form: str, filed: str) -> dict:
    """companyfacts with one more filing's consolidated facts (segments.consolidated_facts output) added, shaped as
    companyfacts facts so the same rules apply. The input is not modified."""
    out = {t: {c: {**node, "units": {u: list(fs) for u, fs in (node.get("units") or {}).items()}} for c, node in cs.items()}
           for t, cs in facts.items()}
    for f in extra:
        node = out.setdefault(f["taxonomy"], {}).setdefault(f["concept"], {"units": {}})
        fact = {"end": f["end"], "val": f["value"], "accn": accn, "form": form, "filed": filed}
        if f["start"]:
            fact["start"] = f["start"]
        node["units"].setdefault(f["unit"], []).append(fact)
    return out


def build_statements(facts: dict, *, years: int = 12, quarters_kept: int = 16) -> dict | None:
    fys_all = fiscal_years(facts)
    if not fys_all:
        return None
    fys = fys_all[-years:]
    # Quarter boundaries come from revenue and net income facts (the lines most often reported per quarter).
    pool = []
    for taxonomy, concept in R + [("us-gaap", "NetIncomeLoss"), ("ifrs-full", "ProfitLoss")]:
        pool += facts_for(facts, taxonomy, concept, "money")[1]
    qs: list[dict] = []
    for fy in fys_all[-(quarters_kept // 4 + 2):]:
        found = quarter_periods(fy, pool)
        if found:
            qs += found
    qs += current_year_quarters(fys_all[-1], pool)
    qs = qs[-quarters_kept:]
    lines: dict[str, dict] = {}
    for line in LINES:
        annual, quarterly, unit = line_series(facts, line, fys, qs)
        if any(annual) or any(quarterly):
            lines[line[0]] = {"annual": annual, "quarterly": quarterly, "unit": unit}
    for key, (a, b, op) in COMPUTED.items():
        if a in lines and b in lines:
            ann = compute(lines[a]["annual"], lines[b]["annual"], op)
            qtr = compute(lines[a]["quarterly"], lines[b]["quarterly"], op)
            if key in lines:  # reported line: fill only the gaps
                ann = [x or y for x, y in zip(lines[key]["annual"], ann)]
                qtr = [x or y for x, y in zip(lines[key]["quarterly"], qtr)]
            if any(ann) or any(qtr):
                lines[key] = {"annual": ann, "quarterly": qtr, "unit": lines[a]["unit"]}
    return {
        "annual_periods": fys,
        "quarterly_periods": qs,
        "lines": lines,
        "margins": {"annual": margins(lines, "annual"), "quarterly": margins(lines, "quarterly")},
        "growth": {g: {k: growth(lines[k][g], fys if g == "annual" else qs, g) for k in ("revenue", "net_income", "eps_diluted", "operating_income") if k in lines}
                   for g in ("annual", "quarterly")},
    }
