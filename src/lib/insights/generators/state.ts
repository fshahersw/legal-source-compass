/**
 * State analytics insights. Three pure generators, one per published source:
 *   - generateStateMetricInsights: state_metrics_national + state_metrics_profiles (Census, BEA, BLS, CDC, NHTSA, openFDA files)
 *   - generateCfpbStateInsights:   cfpb_complaints_states rankings (from the parsed CFPB consumer-complaint view)
 *   - generateEpaStateInsights:    regulatory_epa_state_profiles / epa_echo_case_series (EPA ECHO case data by facility state)
 * A metric, year or state that is missing or too thinly covered drops its candidate; nothing is estimated.
 */
import type { MetricDef } from "@/lib/external/stateMetrics.functions";
import type { ConsumerComplaints } from "@/lib/external/consumerComplaints.functions";
import { finishPool, makeInsight } from "../build";
import {
  fmtDec,
  fmtInt,
  fmtPct,
  fmtSignedPct,
  fmtTimes,
  fmtWords,
  isNum,
  latestCompleteFiscalYear,
  median,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "state";
const PAGE = "/places/analytics";
const place = (usps: string) => `/places/${usps}`;

export type StateSeriesRow = {
  usps: string;
  name: string;
  /** metric key -> { "YYYY": value } */
  series: Record<string, Record<string, number>>;
};
export type StateMetricsInput = {
  metrics: MetricDef[];
  states: StateSeriesRow[];
};

/** The 50 states and DC are the only rows ranked; a metric needs this many to be compared at all. */
const MIN_JURISDICTIONS = 45;

type Spec = {
  key: string;
  slug: string;
  /** Plain-language name of the quantity, lower case: "drug overdose death rate". */
  noun: string;
  /** Full display of one value, unit included: "51.0 per 100,000". */
  show: (v: number) => string;
  /** Whether the percent-change comparison is meaningful (false for rates already in percent). */
  pctMove: boolean;
  score: number;
  /** Optional extra caveat; the metric's own provisional/partial flags are always added. */
  caveat?: string;
};

const per100k = (v: number) => `${fmtDec(v, 1)} per 100,000`;

/** Series the generator reads from each state profile; the reader selects only these. */
export const STATE_SERIES_KEYS = [
  "overdose_rate",
  "fars_rate",
  "unemployment_rate",
  "per_capita_income",
  "nhtsa_complaint_rate",
  "population",
] as const;

const RANGE_SPECS: Spec[] = [
  {
    key: "overdose_rate",
    slug: "overdose-rate",
    noun: "drug overdose death rate",
    show: per100k,
    pctMove: true,
    score: 78,
  },
  {
    key: "fars_rate",
    slug: "traffic-death-rate",
    noun: "traffic fatality rate",
    show: per100k,
    pctMove: true,
    score: 66,
  },
  {
    key: "unemployment_rate",
    slug: "unemployment-rate",
    noun: "unemployment rate",
    show: (v) => fmtPct(v, 1),
    pctMove: false,
    score: 58,
  },
  {
    key: "per_capita_income",
    slug: "income-gap",
    noun: "per capita personal income",
    show: (v) => `$${fmtInt(v)}`,
    pctMove: true,
    score: 56,
  },
  {
    key: "nhtsa_complaint_rate",
    slug: "vehicle-complaint-rate",
    noun: "rate of NHTSA vehicle-safety complaints",
    show: per100k,
    pctMove: true,
    score: 60,
    caveat:
      "Complaints are reports submitted to NHTSA by vehicle owners; a count is not a finding that a vehicle is defective.",
  },
];

const MOVER_SPECS: Spec[] = [
  {
    key: "population",
    slug: "population-growth",
    noun: "resident population",
    show: (v) => fmtWords(v),
    pctMove: true,
    score: 62,
  },
  {
    key: "overdose_rate",
    slug: "overdose-change",
    noun: "drug overdose death rate",
    show: per100k,
    pctMove: true,
    score: 64,
  },
  {
    key: "fars_rate",
    slug: "traffic-death-change",
    noun: "traffic fatality rate",
    show: per100k,
    pctMove: true,
    score: 54,
  },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Ranked = { usps: string; name: string; value: number };

function valuesAt(input: StateMetricsInput, key: string, year: number): Ranked[] {
  const out: Ranked[] = [];
  for (const s of input.states) {
    const v = s.series[key]?.[String(year)];
    if (isNum(v)) out.push({ usps: s.usps, name: s.name, value: v });
  }
  return out;
}

function metricSources(metric: MetricDef): InsightSourceLink[] {
  const links = metric.sources.slice(0, 2).map((s) => ({
    label: s.publisher ? `${s.publisher}: ${s.name}` : s.name,
    href: s.page ?? s.url,
  }));
  return links.length ? links : [{ label: "State analytics", href: PAGE }];
}

function metricCaveat(metric: MetricDef, year: number, extra?: string): string | undefined {
  const parts: string[] = [];
  if (typeof metric.provisional === "string" && metric.provisional)
    parts.push(`Source: ${metric.provisional}; later revisions are possible.`);
  else if (metric.provisional && typeof metric.provisional === "object") {
    const note = metric.provisional[String(year)];
    if (note) parts.push(`${year}: ${note}; later revisions are possible.`);
  }
  const partial = metric.partialYears[String(year)];
  if (partial) parts.push(`${year} is a partial year (${partial}).`);
  if (extra) parts.push(extra);
  return parts.length ? parts.join(" ") : undefined;
}

function usable(input: StateMetricsInput, spec: Spec) {
  const metric = input.metrics.find((m) => m.key === spec.key);
  const year = metric?.latestYear;
  if (!metric || !isNum(year)) return null;
  const values = valuesAt(input, spec.key, year);
  if (values.length < MIN_JURISDICTIONS) return null;
  return { metric, year, values };
}

function rangeInsight(input: StateMetricsInput, spec: Spec): Insight | null {
  const u = usable(input, spec);
  if (!u) return null;
  const { metric, year, values } = u;
  const desc = sortDesc(values, (v) => v.value);
  const hi = desc[0];
  const lo = desc[desc.length - 1];
  if (!hi || !lo || hi.usps === lo.usps) return null;
  const mid = median(values.map((v) => v.value));
  const nat = metric.national[String(year)];
  const natThen = metric.national[String(year - 5)];
  const natPct = spec.pctMove && isNum(nat) ? pctChange(nat, natThen) : null;
  const ratio = lo.value > 0 ? hi.value / lo.value : null;
  return makeInsight({
    section: SECTION,
    slug: spec.slug,
    kind: "outlier",
    headline: `${cap(spec.noun)} in ${year} ran from ${spec.show(lo.value)} in ${lo.name} to ${spec.show(hi.value)} in ${hi.name}`,
    summary: [
      `In ${year}, the recorded ${spec.noun} was highest in ${hi.name} (${spec.show(hi.value)}) and lowest in ${lo.name} (${spec.show(lo.value)}).`,
      isNum(nat)
        ? `The national figure was ${spec.show(nat)}, and the middle state (the median) was ${mid == null ? "not recorded" : spec.show(mid)}.`
        : mid != null
          ? `The middle state (the median) was ${spec.show(mid)}.`
          : null,
      ratio != null && ratio >= 1.05
        ? `The highest state was ${fmtTimes(ratio)} the lowest.`
        : null,
      natPct != null && isNum(natThen)
        ? `Nationally the figure is ${moved(natPct)} from ${year - 5} (${spec.show(natThen)}).`
        : null,
    ],
    points: [
      { label: `Highest: ${hi.name}`, value: spec.show(hi.value), href: place(hi.usps) },
      { label: `Lowest: ${lo.name}`, value: spec.show(lo.value), href: place(lo.usps) },
      isNum(nat) ? { label: "National", value: spec.show(nat) } : null,
      mid != null ? { label: "Median state", value: spec.show(mid) } : null,
      ratio != null && ratio >= 1.05 ? { label: "Highest ÷ lowest", value: fmtTimes(ratio) } : null,
    ],
    caveat: metricCaveat(metric, year, spec.caveat),
    sources: metricSources(metric),
    dataThrough: String(year),
    score: spec.score,
  });
}

function moverInsight(input: StateMetricsInput, spec: Spec): Insight | null {
  const u = usable(input, spec);
  if (!u) return null;
  const { metric, year } = u;
  const base = year - 5;
  const changes: (Ranked & { from: number; pct: number })[] = [];
  for (const s of input.states) {
    const to = s.series[spec.key]?.[String(year)];
    const from = s.series[spec.key]?.[String(base)];
    const pct = pctChange(to, from);
    if (isNum(to) && isNum(from) && pct != null)
      changes.push({ usps: s.usps, name: s.name, value: to, from, pct });
  }
  if (changes.length < MIN_JURISDICTIONS) return null;
  const up = sortDesc(changes, (c) => c.pct);
  const down = sortAsc(changes, (c) => c.pct);
  const top = up[0];
  const second = up[1];
  const bottom = down[0];
  if (!top || !second || !bottom || top.usps === bottom.usps) return null;
  const rising = changes.filter((c) => c.pct > 0).length;
  const falling = changes.filter((c) => c.pct < 0).length;
  const nat = metric.national[String(year)];
  const natThen = metric.national[String(base)];
  const natPct = pctChange(nat, natThen);
  const fallWord = bottom.pct < 0 ? "largest decrease" : "smallest increase";
  return makeInsight({
    section: SECTION,
    slug: spec.slug,
    kind: "mover",
    headline: `${cap(spec.noun)}, ${base} to ${year}: ${top.name} changed most (${fmtSignedPct(top.pct)}); ${bottom.name} ${bottom.pct < 0 ? "fell most" : "rose least"} (${fmtSignedPct(bottom.pct)})`,
    summary: [
      `From ${base} to ${year}, ${top.name} had the largest increase in ${spec.noun} (${fmtSignedPct(top.pct)}, from ${spec.show(top.from)} to ${spec.show(top.value)}).`,
      `${bottom.name} had the ${fallWord} (${fmtSignedPct(bottom.pct)}, from ${spec.show(bottom.from)} to ${spec.show(bottom.value)}).`,
      `Across the ${changes.length} states and D.C. compared, ${rising} rose and ${falling} fell.`,
      natPct != null && isNum(nat) && isNum(natThen)
        ? `The national figure is ${moved(natPct)} over the same period (${spec.show(natThen)} to ${spec.show(nat)}).`
        : null,
    ],
    points: [
      {
        label: `Largest increase: ${top.name}`,
        value: fmtSignedPct(top.pct),
        note: `${spec.show(top.from)} to ${spec.show(top.value)}`,
        href: place(top.usps),
      },
      {
        label: `Next: ${second.name}`,
        value: fmtSignedPct(second.pct),
        href: place(second.usps),
      },
      {
        label: `${cap(fallWord)}: ${bottom.name}`,
        value: fmtSignedPct(bottom.pct),
        note: `${spec.show(bottom.from)} to ${spec.show(bottom.value)}`,
        href: place(bottom.usps),
      },
      { label: "States rising / falling", value: `${rising} / ${falling}` },
      natPct != null ? { label: "National change", value: fmtSignedPct(natPct) } : null,
    ],
    caveat: metricCaveat(metric, year, spec.caveat),
    sources: metricSources(metric),
    dataThrough: `${base} to ${year}`,
    score: spec.score,
  });
}

const populationSpec: Spec = {
  key: "population",
  slug: "population-concentration",
  noun: "resident population",
  show: (v) => fmtWords(v),
  pctMove: true,
  score: 50,
};

function populationConcentration(input: StateMetricsInput): Insight | null {
  const u = usable(input, populationSpec);
  if (!u) return null;
  const { metric, year, values } = u;
  const total = sum(values.map((v) => v.value));
  const desc = sortDesc(values, (v) => v.value);
  const top5 = desc.slice(0, 5);
  const top5Share = sharePct(sum(top5.map((v) => v.value)), total);
  const first = desc[0];
  const last = desc[desc.length - 1];
  const firstShare = sharePct(first?.value, total);
  if (!first || !last || top5Share == null || firstShare == null || top5.length < 5) return null;
  return makeInsight({
    section: SECTION,
    slug: "population-concentration",
    kind: "concentration",
    headline: `Five states hold ${fmtPct(top5Share, 0)} of U.S. residents (${year}): ${top5.map((v) => v.name).join(", ")}`,
    summary: [
      `On July 1, ${year}, the five most populous states (${top5.map((v) => v.name).join(", ")}) had ${fmtWords(sum(top5.map((v) => v.value)))} residents, ${fmtPct(top5Share)} of the ${fmtWords(total)} living in the 50 states and D.C.`,
      `${first.name} alone had ${fmtWords(first.value)} (${fmtPct(firstShare)}), while the smallest, ${last.name}, had ${fmtWords(last.value)}.`,
      `Population is the denominator behind every per-resident rate on this page, so a small state can top a per-capita ranking on few events.`,
    ],
    points: [
      {
        label: `Largest: ${first.name}`,
        value: fmtWords(first.value),
        note: fmtPct(firstShare),
        href: place(first.usps),
      },
      {
        label: "Top five combined",
        value: fmtWords(sum(top5.map((v) => v.value))),
        note: fmtPct(top5Share),
      },
      { label: `Smallest: ${last.name}`, value: fmtWords(last.value), href: place(last.usps) },
      { label: "States and D.C.", value: fmtWords(total) },
    ],
    caveat: metricCaveat(metric, year),
    sources: metricSources(metric),
    dataThrough: `July 1, ${year}`,
    score: 50,
  });
}

export function generateStateMetricInsights(input: StateMetricsInput): Insight[] {
  return finishPool(
    [
      ...RANGE_SPECS.map((s) => rangeInsight(input, s)),
      ...MOVER_SPECS.map((s) => moverInsight(input, s)),
      populationConcentration(input),
    ],
    20,
  );
}

// ---------------------------------------------------------------- CFPB by state

const CFPB_SOURCES: InsightSourceLink[] = [
  {
    label: "CFPB Consumer Complaint Database",
    href: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
  },
  {
    label: "Census Bureau state population estimates",
    href: "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
  },
];

export function generateCfpbStateInsights(data: ConsumerComplaints): Insight[] {
  const rate = data.perCapitaRanking;
  const rise = data.riseRanking;
  const medianRate = median(data.states.map((s) => s.per100k2025));
  const [a, b, c] = rate;
  const risen = rise[0];
  if (!a || !b || !c || medianRate == null || medianRate <= 0) return [];
  const lastYear = [...data.years].reverse().find((y) => y.complete);
  const creditNote =
    lastYear && isNum(lastYear.creditReportingSharePct)
      ? `Credit-reporting complaints were ${fmtPct(lastYear.creditReportingSharePct)} of all complaints nationally in ${lastYear.year}, so state rankings largely track them.`
      : undefined;
  const out = makeInsight({
    section: SECTION,
    slug: "cfpb-complaint-rates",
    kind: "leader",
    headline: `CFPB complaints in 2025 were most frequent, per resident, in ${a.name}, ${b.name} and ${c.name}`,
    summary: [
      `In 2025, ${a.name} had the most CFPB consumer complaints per 100,000 residents (${fmtInt(a.value)}), followed by ${b.name} (${fmtInt(b.value)}) and ${c.name} (${fmtInt(c.value)}).`,
      `The middle state (the median) had ${fmtInt(medianRate)} per 100,000, so ${a.name}'s rate was ${fmtTimes(a.value / medianRate)} the median.`,
      risen
        ? `The per-resident rate rose fastest between 2022 and 2025 in ${risen.name} (${fmtSignedPct(risen.value, 0)}).`
        : null,
      `These are complaints that consumers submitted, grouped by the consumer's mailing-address state; they are not findings against any company.`,
    ],
    points: [
      { label: `Highest: ${a.name}`, value: `${fmtInt(a.value)} per 100,000`, href: place(a.code) },
      { label: `Second: ${b.name}`, value: `${fmtInt(b.value)} per 100,000`, href: place(b.code) },
      { label: `Third: ${c.name}`, value: `${fmtInt(c.value)} per 100,000`, href: place(c.code) },
      { label: "Median state", value: `${fmtInt(medianRate)} per 100,000` },
      risen
        ? {
            label: `Fastest rise since 2022: ${risen.name}`,
            value: fmtSignedPct(risen.value, 0),
            href: place(risen.code),
          }
        : null,
    ],
    caveat: creditNote,
    sources: CFPB_SOURCES,
    dataThrough: "2025",
    score: 64,
  });
  return out ? [out] : [];
}

// ---------------------------------------------------------------- EPA by state

export type EpaStateInput = {
  /** ECHO download date, `YYYY-MM-DD`; decides which fiscal year is complete. */
  fileDate: string | null;
  states: {
    code: string;
    name: string;
    population: number | null;
    populationYear: number | null;
    years: { fy: number; cases: number }[];
  }[];
};

export function generateEpaStateInsights(input: EpaStateInput): Insight[] {
  const last = latestCompleteFiscalYear(input.fileDate);
  if (last == null) return [];
  const from = last - 4;
  const rows = input.states.flatMap((s) => {
    const pop = s.population;
    if (!isNum(pop) || pop <= 0) return [];
    const inWindow = s.years.filter((y) => y.fy >= from && y.fy <= last);
    if (!inWindow.length) return [];
    const cases = sum(inWindow.map((y) => y.cases));
    return [{ code: s.code, name: s.name, cases, rate: (100_000 * cases) / pop }];
  });
  if (rows.length < MIN_JURISDICTIONS) return [];
  const desc = sortDesc(rows, (r) => r.rate);
  const [a, b, c] = desc;
  const lowest = desc[desc.length - 1];
  const mid = median(rows.map((r) => r.rate));
  if (!a || !b || !c || !lowest || mid == null || mid <= 0) return [];
  const out = makeInsight({
    section: SECTION,
    slug: "epa-cases-per-resident",
    kind: "leader",
    headline: `EPA civil enforcement cases, FY${from}-FY${last}: most per resident in ${a.name}, ${b.name} and ${c.name}`,
    summary: [
      `Over fiscal years ${from} to ${last}, ${a.name} had the most EPA enforcement cases opened per 100,000 residents (${fmtDec(a.rate, 1)}; ${fmtInt(a.cases)} cases), followed by ${b.name} (${fmtDec(b.rate, 1)}) and ${c.name} (${fmtDec(c.rate, 1)}).`,
      `The middle state had ${fmtDec(mid, 1)} per 100,000, and ${lowest.name} had the fewest (${fmtDec(lowest.rate, 1)}).`,
      `A case is counted in every state where one of its recorded facilities is located, so the state figures overlap and should not be added together.`,
    ],
    points: [
      {
        label: `Highest: ${a.name}`,
        value: `${fmtDec(a.rate, 1)} per 100,000`,
        note: `${fmtInt(a.cases)} cases`,
        href: place(a.code),
      },
      {
        label: `Second: ${b.name}`,
        value: `${fmtDec(b.rate, 1)} per 100,000`,
        href: place(b.code),
      },
      { label: `Third: ${c.name}`, value: `${fmtDec(c.rate, 1)} per 100,000`, href: place(c.code) },
      { label: "Median state", value: `${fmtDec(mid, 1)} per 100,000` },
      {
        label: `Lowest: ${lowest.name}`,
        value: `${fmtDec(lowest.rate, 1)} per 100,000`,
        href: place(lowest.code),
      },
    ],
    caveat:
      "Cases are counted by the fiscal year they were opened and by facility location; most are administrative actions. Rates use Census July 1 population for the latest year in the file.",
    sources: [
      {
        label: "EPA ECHO case downloads",
        href: "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary",
      },
    ],
    dataThrough: `FY${last}`,
    score: 52,
  });
  return out ? [out] : [];
}
