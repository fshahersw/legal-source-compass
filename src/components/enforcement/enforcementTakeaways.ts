/** Key takeaways for the /law/enforcement tabs, computed only from the published analytics rows. */
import {
  changePct,
  int,
  listAnd,
  pct,
  plural,
  shareOf,
  signedPct,
  times,
  usableTakeaways,
  usdCompact,
  type Takeaway,
} from "@/components/analysis/analysisFormat";

// ---------------------------------------------------------------- CFPB consumer complaints

export type ConsumerTakeawayInput = {
  /** The two latest complete calendar years; credit reporting is null when the year records no split. */
  lastYear: { year: number; complaints: number; creditReporting: number | null } | null;
  previous: { year: number; complaints: number; creditReporting: number | null } | null;
  /** The highest-ranked state for the per-capita metric, and the page's label for that metric. */
  topState: { name: string; value: number } | null;
  perCapitaLabel: string;
  /** The state with the largest rise in its per-capita rate, in percent. */
  riseState: { name: string; value: number; label: string } | null;
  /** Company counts are over all history, the same basis as `totalComplaints`. */
  topCompanies: { company: string; complaints: number }[];
  totalComplaints: number;
  since: string;
};

export function consumerTakeaways(i: ConsumerTakeawayInput): Takeaway[] {
  const l = i.lastYear;
  const p = i.previous;
  const split =
    l && p && l.creditReporting != null && p.creditReporting != null
      ? {
          other: Math.max(0, l.complaints - l.creditReporting),
          otherPrev: Math.max(0, p.complaints - p.creditReporting),
          credit: l.creditReporting,
          creditPrev: p.creditReporting,
        }
      : null;
  const otherChange = split ? changePct(split.other, split.otherPrev) : null;
  const creditChange = split ? changePct(split.credit, split.creditPrev) : null;
  const topTen =
    i.topCompanies.length >= 10
      ? shareOf(
          i.topCompanies.slice(0, 10).reduce((a, c) => a + c.complaints, 0),
          i.totalComplaints,
        )
      : null;
  const lead = i.topCompanies[0];
  return usableTakeaways([
    l && p && split && otherChange != null
      ? {
          id: "other-products",
          figure: signedPct(otherChange),
          text: `change in complaints about every product other than credit reporting, ${l.year} (${int(split.other)}) against ${int(split.otherPrev)} in ${p.year}${creditChange != null ? `; credit reporting ${signedPct(creditChange)} (${int(split.credit)} against ${int(split.creditPrev)})` : ""}.`,
          anchor: "cfpb-years",
          anchorLabel: "See the years",
        }
      : null,
    i.topState
      ? {
          id: "top-state",
          figure: i.topState.value.toLocaleString("en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
          text: `${i.topState.name} is the highest of the 50 states and DC (${i.perCapitaLabel}).`,
          anchor: "cfpb-states",
          anchorLabel: "See the map",
        }
      : null,
    i.riseState
      ? {
          id: "rise-state",
          figure: signedPct(i.riseState.value),
          text: `${i.riseState.name} has the largest ${i.riseState.label} of the 50 states and DC.`,
          anchor: "cfpb-states",
          anchorLabel: "See the map",
        }
      : null,
    topTen != null && lead
      ? {
          id: "company-concentration",
          figure: pct(topTen),
          text: `of all complaints since ${i.since} name one of the ten most-named companies; ${lead.company} leads with ${int(lead.complaints)}. Complaints are not findings.`,
          anchor: "cfpb-companies-panel",
          anchorLabel: "See companies",
        }
      : null,
  ]);
}

// ---------------------------------------------------------------- CPSC recalls

export type CpscTakeawayInput = {
  latest: number;
  latestRecalls: number | null;
  priorMean: number;
  rising: { label: string; latest: number; baseline: number }[];
  windowLabel: string;
  deathMentions: number;
  deathBackground: number;
  /** Share of the latest year's recalls with a recorded country that list China, as a fraction 0 to 1. */
  chinaShare: number | null;
  countryRecordedPct: number | null;
  topHazard: { label: string; total: number } | null;
};

export function cpscTakeaways(i: CpscTakeawayInput): Takeaway[] {
  const vs = i.latestRecalls != null ? times(i.latestRecalls, i.priorMean) : null;
  return usableTakeaways([
    i.latestRecalls != null
      ? {
          id: "latest-year",
          figure: int(i.latestRecalls),
          text: `recalls in ${i.latest} against a mean of ${int(i.priorMean)} over the three years before${vs ? ` (${vs})` : ""}.`,
          anchor: "cpsc-hazards",
          anchorLabel: "See hazards",
        }
      : null,
    {
      id: "rising",
      figure: int(i.rising.length),
      text: i.rising.length
        ? `${i.rising.length === 1 ? "hazard category is" : "hazard categories are"} rising in ${i.latest}: ${listAnd(i.rising.slice(0, 3).map((r) => `${r.label} (${int(r.latest)} vs ${r.baseline.toFixed(1)})`))}${i.rising.length > 3 ? ` and ${int(i.rising.length - 3)} more` : ""}.`
        : `hazard categories meet the rising rule in ${i.latest} (at least 1.5× the prior three-year mean and at least 10 recalls).`,
      anchor: "cpsc-flags",
      anchorLabel: "See flags",
    },
    i.topHazard
      ? {
          id: "top-hazard",
          figure: int(i.topHazard.total),
          text: `recalls in the largest hazard category, ${i.topHazard.label}, over ${i.windowLabel}; a recall can fall in several categories.`,
          anchor: "cpsc-hazards",
          anchorLabel: "See hazards",
        }
      : null,
    {
      id: "deaths",
      figure: int(i.deathMentions),
      text: `recalls mention a product-related death over ${i.windowLabel} (${int(i.deathBackground)} background mentions excluded); text mentions, not verified counts.`,
      anchor: "cpsc-deaths",
      anchorLabel: "See the mentions",
    },
    i.chinaShare != null
      ? {
          id: "china",
          figure: pct(100 * i.chinaShare),
          text: `of ${i.latest} recalls with a recorded manufacturing country list China${i.countryRecordedPct != null ? `; a country is recorded for ${pct(i.countryRecordedPct, Number.isInteger(i.countryRecordedPct) ? 0 : 1)} of recalls` : ""}.`,
          anchor: "cpsc-country",
          anchorLabel: "See countries",
        }
      : null,
  ]);
}

// ---------------------------------------------------------------- EPA civil enforcement

export type EpaTakeawayInput = {
  windowLabel: string;
  /** "United States" or the selected state's name. */
  scopeName: string;
  cases: number;
  judicial: number;
  administrative: number;
  fedPenalty: number;
  penaltySettlements: number;
  /** Highest federal penalties settled in the window among states; only meaningful for the national view. */
  topState: { name: string; fedPenalty: number } | null;
  latestFy: number;
  surges: { name: string; latest: number; baseline: number }[];
  outliers: { name: string; perMillion: number }[];
  topCase: { name: string; fedPenalty: number; sharePct: number | null } | null;
};

export function epaTakeaways(i: EpaTakeawayInput): Takeaway[] {
  const judicialShare = shareOf(i.judicial, i.cases);
  const adminShare = shareOf(i.administrative, i.cases);
  return usableTakeaways([
    {
      id: "penalties",
      figure: usdCompact(i.fedPenalty),
      text: `federal penalties settled in ${i.windowLabel} for ${i.scopeName}, across ${plural(i.penaltySettlements, "settlement")} with a penalty.`,
      anchor: "epa-trend",
      anchorLabel: "See the trend",
    },
    {
      id: "cases",
      figure: int(i.cases),
      text: `cases opened in ${i.windowLabel}${judicialShare != null && adminShare != null ? `; ${pct(judicialShare)} judicial and ${pct(adminShare)} administrative` : ""}.`,
      anchor: "epa-trend",
      anchorLabel: "See the trend",
    },
    i.topState
      ? {
          id: "top-state",
          figure: usdCompact(i.topState.fedPenalty),
          text: `settled in ${i.topState.name}, the largest of any state in ${i.windowLabel}; a multi-state case counts in each state, so state totals are not additive.`,
          anchor: "epa-states",
          anchorLabel: "See states",
        }
      : null,
    {
      id: "surge",
      figure: int(i.surges.length),
      text: i.surges.length
        ? `${i.surges.length === 1 ? "state meets" : "states meet"} the FY${i.latestFy} case-surge rule: ${listAnd(i.surges.slice(0, 3).map((s) => `${s.name} (${int(s.latest)} vs ${s.baseline.toFixed(1)})`))}${i.surges.length > 3 ? ` and ${int(i.surges.length - 3)} more` : ""}.`
        : `states meet the FY${i.latestFy} case-surge rule.`,
      anchor: "epa-flags",
      anchorLabel: "See flags",
    },
    i.topCase
      ? {
          id: "top-case",
          figure: usdCompact(i.topCase.fedPenalty),
          text: `${i.topCase.name} is the largest settled case recorded for ${i.scopeName}, all years${i.topCase.sharePct != null ? `, ${pct(i.topCase.sharePct, 0)} of all settled federal penalties` : ""}.`,
          anchor: "epa-flags",
          anchorLabel: "See the case",
        }
      : null,
    i.outliers.length
      ? {
          id: "per-capita",
          figure: int(i.outliers.length),
          text: `${i.outliers.length === 1 ? "state is a" : "states are"} per-capita outlier${i.outliers.length === 1 ? "" : "s"} for FY2025 cases: ${listAnd(i.outliers.slice(0, 3).map((o) => `${o.name} (${o.perMillion.toFixed(1)} per million)`))}.`,
          anchor: "epa-flags",
          anchorLabel: "See flags",
        }
      : null,
  ]);
}
