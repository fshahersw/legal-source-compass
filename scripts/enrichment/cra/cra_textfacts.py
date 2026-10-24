"""Facts stated in a report's prose (not in a chart): strict sentence patterns, each naming the value and its period in
the same sentence. A sentence that does not match exactly is ignored; nothing is inferred from context. The sentence
itself is kept only in the private verification file, never in a published row.

Rules:
- the period comes from the sentence ("in 2025", "the first half of 2026"); a pattern without a year in its match is
  used only when the sentence names exactly one year;
- a count printed as a word ("three") is mapped by a fixed table (one to twenty);
- a figure stated "through November 30, 2009" or "as of ..." for a year in progress is marked partial with that date.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import cra_specs as S

WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                                     "fifteen sixteen seventeen eighteen nineteen twenty".split())}
NUM = r"(\d[\d,]*|" + "|".join(sorted(WORDS, key=len, reverse=True)) + r")"
YEAR = r"((?:19|20)\d{2}(?: H[12])?)"
MONEY = r"\$(\d[\d,]*(?:\.\d+)?) (billion|million)"


def num(s: str) -> float | None:
    s = s.strip().lower()
    if s in WORDS:
        return float(WORDS[s])
    t = s.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


@dataclass
class TextPattern:
    family: str  # report family prefix it applies to ("nera_us", "cr_filings")
    series: str
    label: str
    unit: str
    rx: re.Pattern
    order: str  # group roles in order: v value, y year, s scale (million/billion), _ ignored; e.g. "vy", "vsy"
    half: str = ""  # "H1" when the pattern is about the first half
    series2: tuple | None = None  # (series, label, unit) of the second value, when one sentence states two measures
    more: tuple = ()  # (series, label, unit) for the third, fourth ... values


def P(family, series, label, unit, rx, order, half="", series2=None, more=()):
    return TextPattern(family, series, label, unit, re.compile(rx), order, half, series2, tuple(more))


RES = ("nera.resolved", "Cases resolved", "cases")
DIS = ("nera.dismissals", "Cases dismissed", "cases")
SET = ("nera.settlements_count", "Cases settled", "cases")


FIL = ("nera.filings", "Federal securities class action filings", "filings")
AVG = ("nera.settlement_average", "Average settlement value", "usd")
MED = ("nera.settlement_median", "Median settlement value", "usd")
AVG_IA = ("nera.settlement_average", "Average settlement value", "usd")
PATTERNS = [
    # ---- NERA: older editions (curated sentence shapes)
    P("nera_us", *FIL, rf"\bFederal courts received {NUM} filings in {YEAR}, down \d+(?:%| percent) from the all-time high of {NUM} in {YEAR} "
      rf"and \d+(?:%| percent) from {NUM} in {YEAR}", "vyvyvy"),
    P("nera_us", *FIL, rf"\bFor the year {YEAR} \(through [A-Z][a-z]+ \d{{1,2}}, \d{{4}}\), {NUM} securities class actions were filed, up from a "
      rf"12-year low of only {NUM} filings in {YEAR} and {NUM} in {YEAR}", "yvvyvy"),
    P("nera_us", *FIL, rf"\bThrough [A-Z][a-z]+ \d{{1,2}}, {YEAR}, {NUM} federal securities class actions were filed", "yv"),
    P("nera_us", *FIL, rf"\bdecline from the {NUM} filings observed in {YEAR}, which in turn was less than the {NUM} filings in {YEAR}", "vyvy"),
    P("nera_us", *FIL, rf"\bof the {NUM} filings in {YEAR}, \d+ were related to the credit crisis", "vy"),
    # ---- NERA: settlement values stated with their year
    P("nera_us", *AVG, rf"\bThe average settlement value declined by \d+% to {MONEY} in {YEAR}, and the median settlement value slightly declined by "
      rf"\d+% to {MONEY}", "vsyvs", series2=MED),
    P("nera_us", *AVG, rf"\bthe average settlement value declined by \d+% in {YEAR} to {MONEY}, the median settlement value increased by \d+% to {MONEY}",
      "yvsvs", series2=MED),
    P("nera_us", *AVG, rf"\bThe average settlement value increased by \d+% in {YEAR} to {MONEY}", "yvs"),
    P("nera_us", *AVG, rf"\bThe average settlement value was {MONEY} in the first half of {YEAR}", "vsy", "H1"),
    P("nera_us", *MED, rf"\bThe median settlement value was {MONEY} in the first half of {YEAR}", "vsy", "H1"),
    P("nera_us", *AVG, rf"\bFor cases settled in the first six months of {YEAR}, the average settlement value was {MONEY}", "yvs", "H1"),
    P("nera_us", "nera.settlement_average_ia_restated", "Average settlement value, inflation-adjusted as restated in a later report", "usd",
      rf"\bthe {YEAR} inflation-adjusted average settlement value of {MONEY}", "yvs"),
    P("nera_us", "nera.settlement_median_ia_restated", "Median settlement value, inflation-adjusted as restated in a later report", "usd",
      rf"\bthe {YEAR} inflation-?adjusted median settlement value of {MONEY}", "yvs"),
    P("nera_us", "nera.settlement_average_under_1bn", "Average settlement value, settlements under $1 billion", "usd",
      rf"\bLimiting to settlements under \$1 billion, the {YEAR} average settlement value was {MONEY}", "yvs"),
    P("nera_us", "nera.settlement_average_under_1bn", "Average settlement value, settlements under $1 billion", "usd",
      rf"\bExcluding settlements of \$1 billion or more, the average settlement value declined by approximately \d+% in {YEAR} to {MONEY}", "yvs"),
    P("nera_us", "nera.settlements_aggregate", "Aggregate settlements", "usd", rf"\bAggregate settlements for {YEAR} totaled {MONEY}", "yvs"),
    P("nera_us", "nera.settlement_average", "Average settlement value", "usd",
      rf"\bThe average settlement amount increased substantially for a second straight year, reaching {MONEY} in {YEAR}", "vsy"),
    # ---- NERA: filings
    P("nera_us", *FIL, rf"\bThere were {NUM} (?:new )?federal securities class actions?(?: suits| cases)? filed (?:in the US )?in {YEAR}\b", "vy"),
    P("nera_us", *FIL, rf"\bIn {YEAR}, there were {NUM} new federal securities class action (?:suits|cases) filed\b", "yv"),
    P("nera_us", *FIL, rf"\bIn {YEAR}, {NUM} securities class actions? (?:were|was) filed in federal courts?\b", "yv"),
    P("nera_us", *FIL, rf"\bAcross full-year {YEAR}, {NUM} new federal securities class action cases were filed\b", "yv"),
    P("nera_us", *FIL, rf"\bdecline from the {NUM} cases filed in {YEAR}\b", "vy"),
    P("nera_us", *FIL, rf"\b(?:During|In) the first half of {YEAR}, {NUM} new federal securities class action (?:suits|cases) were filed\b", "yv", "H1"),
    P("nera_us", *FIL, rf"\bThere were {NUM} new federal securities class actions?(?: suits| cases)? filed (?:during|in) the first half of {YEAR}\b",
      "vy", "H1"),
    # ---- NERA: resolutions and settlements
    P("nera_us", *RES, rf"\bThere were {NUM} cases resolved in {YEAR}, consisting of {NUM} settlements and {NUM} dismissals", "vyvv",
      series2=SET, more=[DIS]),
    P("nera_us", *RES, rf"\bThere were {NUM} cases resolved in {YEAR}, consisting of {NUM} dismissals and {NUM} settlements", "vyvv",
      series2=DIS, more=[SET]),
    P("nera_us", *RES, rf"\bThere were {NUM} cases resolved in {YEAR}\b", "vy"),
    P("nera_us", *RES, rf"\bOf the {NUM} cases resolved in {YEAR}, {NUM} were dismissed and {NUM} resolved through a settlement", "vyvv",
      series2=DIS, more=[SET]),
    P("nera_us", *FIL, rf"\breaching a high of {NUM} cases in {YEAR}", "vy"),
    P("nera_us", *FIL, rf"\bIn {YEAR}, there were {NUM} new cases filed\b", "yv"),
    P("nera_us", *MED, rf"\bThe median settlement value in {YEAR} was {MONEY}", "yvs"),
    P("nera_us", *MED, rf"\bFor {YEAR}, the median settlement value was {MONEY}", "yvs"),
    P("nera_us", *AVG, rf"\bThe average settlement value (?:increased|decreased|declined|rose|fell) by (?:over |about |approximately )?\d+% in "
      rf"{YEAR} to {MONEY}", "yvs"),
    P("nera_us", "nera.settlements_aggregate", "Aggregate settlements", "usd", rf"\bAggregate settlements totaled {MONEY} in {YEAR}\b", "vsy"),
    P("nera_us", "nera.settlement_average", "Average settlement value", "usd",
      rf"\bthe average settlement value (?:increased|declined|decreased|rose|fell)(?: by \d+%)? in {YEAR} to {MONEY}", "ysv"),
    P("nera_us", "nera.fees_aggregate", "Aggregate plaintiffs' attorneys' fees and expenses", "usd",
      rf"\bAggregate plaintiffs[’'] attorneys[’'] fees and expenses totaled {MONEY}, or \d+% of the {YEAR} aggregate settlement value", "vsy"),
    # ---- NERA: categories
    # ---- Cornerstone filings, 2005-2009 editions (headline counts stated in prose)
    P("cr_filings", "filings.traditional_filings", "Traditional filings (as defined in the 2005–2007 reports)", "filings",
      rf"\bthe {NUM} “traditional” securities class action suits filed in {YEAR} represented a \d+ percent (?:decrease|increase) from the {NUM} "
      rf"cases filed in {YEAR}", "vyvy"),
    P("cr_filings", "filings.traditional_filings", "Traditional filings (as defined in the 2005–2007 reports)", "filings",
      rf"\bThe number of traditional filings in {YEAR} is higher than in {YEAR}, with {NUM} filings in {YEAR} compared to {NUM} filings in {YEAR}",
      "__vyvy"),
    P("cr_filings", "filings.class_action_filings", "Class action filings", "filings",
      rf"\bThe Class Action Filings \(CAF\) Index(?:™|TM)? reports {NUM} filings in {YEAR}", "vy"),
    P("cr_filings", "filings.class_action_filings", "Class action filings", "filings",
      rf"\bThe Class Action Filings \(CAF\) Index(?:™|TM)? shows {NUM} filings in {YEAR}, a \d+ percent (?:decrease|increase) from the {NUM} "
      rf"filings in {YEAR}", "vyvy"),
    P("cr_filings", "filings.class_action_filings", "Class action filings", "filings",
      rf"\bThe number of filings in {YEAR} constitutes a \d+ percent increase over the {NUM} filings in {YEAR}", "_vy"),
    # ---- Cornerstone filings: trend categories
    P("cr_filings", "filings.trend.ai", "Core federal filings in the AI trend category", "filings",
      rf"\bThere were {NUM} AI-related filings in {YEAR}\b", "vy"),
    P("cr_filings", "filings.trend.ai", "Core federal filings in the AI trend category", "filings",
      rf"\bThere were {NUM} filings in the AI trend category in {YEAR}\b", "vy"),
    P("cr_filings", "filings.trend.covid", "Core federal filings in the COVID-19 trend category", "filings",
      rf"\bThe number of COVID-19-related filings (?:decreased|increased|fell|rose) from {NUM} in {YEAR} to {NUM} in {YEAR}\b", "vyvy"),
    P("cr_filings", "filings.trend.crypto", "Core federal filings in the cryptocurrency trend category", "filings",
      rf"\bThe number of cryptocurrency-related filings in {YEAR} (?:increased|decreased) slightly, from {NUM} in {YEAR} to {NUM} in {YEAR}\b", "_vyvy"),
    P("cr_filings", "filings.trend.spac", "Core federal filings in the SPAC trend category", "filings",
      rf"\bThe number of SPAC filings in {YEAR} \({NUM}\) was (?:slightly )?(?:lower|higher) compared to {YEAR} \({NUM}\)", "yvyv"),
]


def sentences(page: str) -> list[str]:
    t = re.sub(r"\s+", " ", page.replace("-\n", "-").replace("­", ""))
    return [s.strip() for s in re.split(r"(?<=[.;])\s+(?=[A-Z(•“\"])", t) if s.strip()]


def years_in(s: str) -> set[str]:
    return set(re.findall(r"\b(?:19|20)\d{2}\b", s))


def apply(rep: dict, plain_pages: list[str], printed: list[str | None]) -> tuple[list[S.Fact], list[dict]]:
    """Text facts of one report and their private evidence rows."""
    facts, evidence = [], []
    fam = rep["family"]
    seen: set[tuple] = set()
    for pi, page in enumerate(plain_pages, 1):
        for sent in sentences(page):
            for pat in PATTERNS:
                if pat.family != fam:
                    continue
                for m in pat.rx.finditer(sent):
                    groups = list(m.groups())
                    pairs: list[tuple[float, str, str]] = []  # (value, year, scale)
                    roles = pat.order
                    vals, yrs, scales = [], [], []
                    for role, g in zip(roles, groups):
                        if role == "v":
                            vals.append(g)
                        elif role == "y":
                            yrs.append(g)
                        elif role == "s":
                            scales.append(g)
                    if not yrs:
                        continue  # every pattern must name its own period
                    if len(yrs) == 1 and len(vals) > 1:
                        yrs = yrs * len(vals)
                    for i, v in enumerate(vals):
                        n = num(v)
                        if n is None:
                            continue
                        pairs.append((n, yrs[i], scales[i] if i < len(scales) else ""))
                    for idx, (n, y, sc) in enumerate(pairs):
                        if idx == 0:
                            ser, lab, unit = pat.series, pat.label, pat.unit
                        elif idx == 1 and pat.series2:
                            ser, lab, unit = pat.series2
                        elif idx >= 1 and len(pat.more) >= idx - (1 if pat.series2 else 0):
                            ser, lab, unit = pat.more[idx - 1 - (1 if pat.series2 else 0)]
                        else:
                            ser, lab, unit = pat.series, pat.label, pat.unit
                        if unit == "usd":
                            unit = {"billion": "usd_billions", "million": "usd_millions"}[sc]
                        period = y if " H" in y else f"{y} {pat.half}".strip()
                        key = (ser, period, n)
                        if key in seen:
                            continue
                        seen.add(key)
                        partial = bool(re.search(r"\b[Tt]hrough (?:January|February|March|April|May|June|July|August|September|October|November|"
                                                 r"December) \d{1,2}, " + y[:4], sent))
                        S.series(ser, lab, unit)
                        f = S.Fact(report_id=rep["id"], series=ser, series_label=lab, period=period,
                                   period_type="half" if " H" in period else "year", aggregate="", value=n,
                                   value_text=(f"${v}" if False else _printed(m, n, sc)), unit=unit,
                                   basis=(("inflation-adjusted, base year not stated" if "_ia_restated" in ser else "not stated")
                                          if unit.startswith("usd") else ""),
                                   dimension="", scope="", table="Report text", row_label=lab, column_label=period,
                                   pdf_page=pi, printed_page=(printed[pi - 1] if pi - 1 < len(printed) else "") or "",
                                   method="text", partial=partial,
                                   note="Stated for part of the year only (through the date given in the text)." if partial else "")
                        facts.append(f)
                        evidence.append({"report": rep["id"], "page": pi, "series": ser, "period": period, "value": n,
                                         "sentence": sent})
    return facts, evidence


def _printed(m: re.Match, n: float, scale: str) -> str:
    if scale:
        return f"${n:g} {scale}"
    return f"{int(n)}" if float(n).is_integer() else f"{n:g}"
