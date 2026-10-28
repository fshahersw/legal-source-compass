/**
 * Computed reading aids for the FDA dashboard: period axes and series for the chart kit, rolling averages, peaks,
 * the latest period against its recent baseline, changes against the prior window, recall class mixes, ranked facet
 * categories with plain-language code meanings, and the "What stands out" findings. Every figure is taken from the
 * snapshot; nothing here estimates a count the snapshot does not hold.
 */
import { aggregateSeries, comparePeriods, facetBreakdown } from "@/lib/fda-analytics/analysis";
import type {
  FdaAnalyticsDataset,
  FdaAnalyticsFacet,
  FdaDateRange,
  FdaGranularity,
  FdaPeriodPoint,
} from "@/lib/fda-analytics/types";
import type { PeriodAxis, TrendDatum, TrendSeriesInput } from "@/components/charts/series";
import { findFacet } from "./analyticsView";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const count = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString("en-US")
    : "Not recorded";

export function share(part: number, whole: number | null | undefined) {
  if (!whole || !Number.isFinite(part) || whole <= 0) return null;
  return (part / whole) * 100;
}

export const percentText = (value: number | null, digits = 1) => {
  if (value === null || !Number.isFinite(value)) return "Not recorded";
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
};

/** Short count for tight spaces: 2.42M, 123K, 980. */
export function shortCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not recorded";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return Math.round(value).toLocaleString("en-US");
}

export const signedPercent = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? null
    : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

/** "Oct 14, 2026" for an ISO day. */
export function dayText(iso: string) {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month && d ? `${month} ${Number(d)}, ${y}` : iso;
}

/** Period key as written in a tooltip or table: a day, "Week of …" or a month. */
export function periodText(key: string, interval: FdaGranularity) {
  if (interval === "month" || key.length === 7) {
    const [y, m] = key.split("-");
    const month = LONG_MONTHS[Number(m) - 1];
    return month ? `${month} ${y}` : key;
  }
  return interval === "week" ? `Week of ${dayText(key)}` : dayText(key);
}

/** A period axis over the snapshot's calendar buckets, with ticks that never repeat a label. */
export function fdaPeriodAxis(keys: readonly string[], interval: FdaGranularity): PeriodAxis {
  const first = keys[0] ?? "";
  const last = keys.at(-1) ?? "";
  const spansYears = first.slice(0, 4) !== last.slice(0, 4);
  const months = new Set(keys.map((key) => key.slice(0, 7))).size;
  const monthStep = Math.max(1, Math.ceil(months / 8));
  const monthTick = (key: string) => {
    const m = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
    return spansYears ? `${m} ’${key.slice(2, 4)}` : m;
  };
  const longAxis = interval !== "month" && months > 3;
  return {
    keys,
    label: (key) => periodText(key, interval),
    tick: (key) => {
      if (interval === "month" || longAxis) return monthTick(key);
      const m = MONTHS[Number(key.slice(5, 7)) - 1] ?? "";
      return `${m} ${Number(key.slice(8, 10))}`;
    },
    ...(longAxis
      ? {
          // a month's tick sits on its first bucket, and only when that bucket starts in the month's first week, so a
          // window that opens late in a month never crowds its first label against the next one
          showTick: (key: string, index: number) => {
            const previous = keys[index - 1];
            if (previous && previous.slice(0, 7) === key.slice(0, 7)) return false;
            if (Number(key.slice(8, 10)) > 7) return false;
            const monthIndex = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
            return monthIndex % monthStep === 0;
          },
        }
      : {}),
  };
}

export type FdaTrend = {
  dataset: FdaAnalyticsDataset;
  range: FdaDateRange;
  points: FdaPeriodPoint[];
  data: TrendDatum[];
};

/** The dataset's calendar buckets in the chart kit's shape (key = bucket start; partial edge buckets marked). */
export function fdaTrend(
  dataset: FdaAnalyticsDataset,
  range: FdaDateRange,
  interval: FdaGranularity,
): FdaTrend {
  const points = dataset.series ? aggregateSeries(dataset, range, interval) : [];
  return {
    dataset,
    range,
    points,
    data: points.map((point) => ({
      key: point.label,
      value: point.value,
      ...(point.partial ? { partial: true } : {}),
    })),
  };
}

/** Rolling mean over `window` buckets; a bucket whose window holds a gap or a partial period has no average. */
export function rollingMean(data: readonly TrendDatum[], window: number): TrendDatum[] {
  return data.map((datum, index) => {
    if (index < window - 1) return { key: datum.key, value: null };
    const slice = data.slice(index - window + 1, index + 1);
    if (slice.some((item) => item.value === null || item.partial))
      return { key: datum.key, value: null };
    const sum = slice.reduce((total, item) => total + (item.value as number), 0);
    return { key: datum.key, value: Math.round((sum / window) * 10) / 10 };
  });
}

export const averageWindow = (interval: FdaGranularity) =>
  interval === "day" ? 7 : interval === "week" ? 4 : 0;

export function averageLabel(interval: FdaGranularity) {
  return interval === "day" ? "7-day average" : interval === "week" ? "4-week average" : "";
}

/** Highest complete bucket. */
export function peakOf(data: readonly TrendDatum[]) {
  let best: { key: string; value: number } | null = null;
  for (const datum of data)
    if (typeof datum.value === "number" && !datum.partial && (!best || datum.value > best.value))
      best = { key: datum.key, value: datum.value };
  return best;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Latest complete bucket against the median of the `window` complete buckets before it. */
export function latestVsBaseline(data: readonly TrendDatum[], window = 12) {
  const complete = data.filter(
    (datum): datum is TrendDatum & { value: number } =>
      typeof datum.value === "number" && !datum.partial,
  );
  const latest = complete.at(-1);
  const prior = complete.slice(-window - 1, -1).map((datum) => datum.value);
  if (!latest || prior.length < Math.min(window, 6)) return null;
  const baseline = median(prior);
  if (baseline === null) return null;
  return {
    key: latest.key,
    value: latest.value,
    baseline,
    ratio: baseline > 0 ? latest.value / baseline : null,
    periods: prior.length,
  };
}

export type FdaMover = {
  id: string;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  percent: number | null;
  absolute: number | null;
  range: FdaDateRange;
  previousRange: FdaDateRange;
  comparable: boolean;
};

/** Selected window against the equal window before it, for each dataset with a date series. */
export function fdaMovers(
  items: readonly { dataset: FdaAnalyticsDataset; label: string; range: FdaDateRange }[],
): FdaMover[] {
  return items
    .filter(({ dataset }) => !!dataset.series)
    .map(({ dataset, label, range }) => {
      const comparison = comparePeriods(dataset, range);
      return {
        id: dataset.id,
        label,
        unit: dataset.countUnit,
        current: comparison.current.value,
        previous: comparison.previous.value,
        percent: comparison.percentChange,
        absolute: comparison.absoluteChange,
        range,
        previousRange: comparison.previous.range,
        comparable: comparison.comparable,
      };
    });
}

/** FDA's recall classes, as FDA defines them. */
export const RECALL_CLASS_MEANING: Record<string, string> = {
  "Class I":
    "A reasonable probability that use of or exposure to the product will cause serious adverse health consequences or death.",
  "Class II":
    "Use of or exposure to the product may cause temporary or medically reversible adverse health consequences, or the probability of serious consequences is remote.",
  "Class III":
    "Use of or exposure to the product is not likely to cause adverse health consequences.",
  "Not Yet Classified": "FDA had not assigned a class when the report was captured.",
};

const CLASS_ORDER = ["Class I", "Class II", "Class III", "Not Yet Classified"];

export type FdaClassMix = {
  dataset: FdaAnalyticsDataset;
  range: FdaDateRange;
  total: number;
  parts: { key: string; label: string; count: number; share: number }[];
};

/** Recall classification counts in the exact captured window, ordered from most to least serious. */
export function classMix(dataset: FdaAnalyticsDataset, range: FdaDateRange): FdaClassMix | null {
  const facet = findFacet(dataset, /classification/, range);
  if (!facet) return null;
  const result = facetBreakdown(facet, range);
  if (!result.available || !facet.denominator) return null;
  const total = facet.denominator;
  const parts = [...result.buckets]
    .sort((a, b) => {
      const ia = CLASS_ORDER.indexOf(a.key),
        ib = CLASS_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      count: bucket.count,
      share: (bucket.count / total) * 100,
    }));
  return { dataset, range, total, parts };
}

/**
 * Plain meanings of coded categories, from the openFDA field references (510(k) and PMA decision codes, the FAERS
 * seriousness flag) and FDA's De Novo database. A code without a published meaning keeps its code.
 */
const CODE_MEANING: Record<string, Record<string, string>> = {
  decision_code: {
    SESE: "Substantially equivalent, cleared",
    SESD: "Substantially equivalent with drug",
    SESK: "Substantially equivalent, kit",
    SEKD: "Substantially equivalent, kit with drugs",
    SESP: "Substantially equivalent, postmarket surveillance required",
    SESU: "Substantially equivalent with limitations",
    SESR: "Potential recall",
    DENG: "De Novo request granted",
    APPR: "Approved",
    WTDR: "Withdrawn",
    DENY: "Denied",
    LE30: "30-day notice accepted (decided in 30 days or less)",
    OK30: "Not defined in the openFDA field reference",
    GT30: "No decision within 30 days",
    APRL: "Reclassified after approval",
    APWD: "Withdrawn after approval",
    APCV: "Converted after approval",
  },
  serious: {
    "1": "Serious (death, life-threatening, hospitalization, disability, birth defect or other serious outcome)",
    "2": "Not serious",
  },
};

function fieldKey(field: string) {
  return (
    field
      .replace(/\.exact$/, "")
      .split(".")
      .at(-1) ?? field
  );
}

/** Category label in plain words; a known code keeps its code in brackets so it can be checked at the source. */
export function categoryLabel(facet: Pick<FdaAnalyticsFacet, "field">, key: string, label: string) {
  const meaning = CODE_MEANING[fieldKey(facet.field)]?.[key];
  if (!meaning) return label;
  if (/^\d$/.test(key)) return meaning;
  return meaning.startsWith("Not defined")
    ? `${key} (${meaning.toLowerCase()})`
    : `${meaning} (${key})`;
}

export function hasCodedCategories(facet: Pick<FdaAnalyticsFacet, "field">) {
  return !!CODE_MEANING[fieldKey(facet.field)];
}

export type RankedCategory = { key: string; label: string; count: number; share: number | null };

/** Ranked categories of a facet in the exact window, with each one's share of the matching records. */
export function rankedCategories(facet: FdaAnalyticsFacet, range?: FdaDateRange) {
  const result = facetBreakdown(facet, range);
  if (!result.available) return { available: false as const, reason: result.reason };
  const items: RankedCategory[] = [...result.buckets]
    .sort((a, b) => b.count - a.count)
    .map((bucket) => ({
      key: bucket.key,
      label: categoryLabel(facet, bucket.key, bucket.label),
      count: bucket.count,
      share: share(bucket.count, facet.denominator),
    }));
  return { available: true as const, items, denominator: facet.denominator };
}

export type FdaFinding = { id: string; text: string; detail?: string | undefined };

const family = (dataset: FdaAnalyticsDataset) =>
  dataset.productFamily === "animal_veterinary"
    ? "Veterinary"
    : dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1);

const enforcement = (dataset: FdaAnalyticsDataset) =>
  /\/enforcement(?:\.json)?$/.test(dataset.endpoint);

/**
 * "What stands out": up to six short sentences computed from the selected window. Each states its own figures and
 * period; a finding whose inputs are not recorded is left out rather than guessed.
 */
export function fdaFindings({
  datasets,
  ranges,
  fallback,
  labels,
  interval,
}: {
  datasets: readonly FdaAnalyticsDataset[];
  ranges: Record<string, FdaDateRange>;
  fallback: FdaDateRange;
  labels: Record<string, string>;
  interval: FdaGranularity;
}): FdaFinding[] {
  const out: FdaFinding[] = [];
  const rangeOf = (dataset: FdaAnalyticsDataset) => ranges[dataset.id] ?? fallback;
  const nameOf = (dataset: FdaAnalyticsDataset) => labels[dataset.id] ?? dataset.label;
  const movers = fdaMovers(
    datasets.map((dataset) => ({ dataset, label: nameOf(dataset), range: rangeOf(dataset) })),
  ).filter((mover) => mover.comparable && mover.percent !== null && (mover.previous ?? 0) >= 20);
  const up = [...movers].sort((a, b) => b.percent! - a.percent!)[0];
  const down = [...movers].sort((a, b) => a.percent! - b.percent!)[0];
  const days = (r: FdaDateRange) =>
    Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  if (up && up.percent! >= 5)
    out.push({
      id: "rise",
      text: `${up.label} rose ${signedPercent(up.percent)?.replace("+", "")} to ${count(up.current)} in the ${days(up.range)} days through ${dayText(up.range.to)} (prior ${days(up.range)} days: ${count(up.previous)}).`,
    });
  if (down && down !== up && down.percent! <= -5)
    out.push({
      id: "fall",
      text: `${down.label} fell ${signedPercent(down.percent)?.replace("−", "")} to ${count(down.current)} in the ${days(down.range)} days through ${dayText(down.range.to)} (prior: ${count(down.previous)}).`,
    });

  const recallSets = datasets.filter(enforcement);
  const mixes = recallSets
    .map((dataset) => classMix(dataset, rangeOf(dataset)))
    .filter((mix): mix is FdaClassMix => !!mix && mix.total >= 20);
  const classOne = mixes
    .map((mix) => ({ mix, part: mix.parts.find((part) => part.key === "Class I") }))
    .filter((item) => item.part)
    .sort((a, b) => b.part!.share - a.part!.share)[0];
  if (classOne)
    out.push({
      id: "class1",
      text:
        mixes.length > 1
          ? `${family(classOne.mix.dataset)} recalls carry the highest Class I share: ${percentText(classOne.part!.share)} of ${count(classOne.mix.total)} reports (${count(classOne.part!.count)}) were the most serious class.`
          : `${percentText(classOne.part!.share)} of ${family(classOne.mix.dataset).toLowerCase()} recall reports (${count(classOne.part!.count)} of ${count(classOne.mix.total)}) were Class I, the most serious class.`,
    });

  if (interval !== "month")
    for (const dataset of recallSets) {
      const trend = fdaTrend(dataset, rangeOf(dataset), "week");
      const latest = latestVsBaseline(trend.data, 12);
      if (latest?.ratio && latest.ratio >= 1.75 && latest.value >= 10) {
        out.push({
          id: `spike-${dataset.id}`,
          text: `${family(dataset)} recalls: ${count(latest.value)} reports in the week of ${dayText(latest.key)}, ${latest.ratio.toFixed(1)}× the median of the ${latest.periods} weeks before.`,
        });
        break;
      }
    }

  const device = datasets.find((dataset) => /device\/event/.test(dataset.endpoint));
  if (device) {
    const facet = findFacet(device, /event_type/, rangeOf(device));
    const ranked = facet ? rankedCategories(facet, rangeOf(device)) : null;
    const death = ranked?.available ? ranked.items.find((item) => item.key === "Death") : undefined;
    if (death && ranked?.available)
      out.push({
        id: "device-death",
        text: `${count(death.count)} device reports recorded a death (${percentText(death.share, 2)} of ${count(ranked.denominator)}) between ${dayText(rangeOf(device).from)} and ${dayText(rangeOf(device).to)}.`,
      });
  }

  const drug = datasets.find((dataset) => /drug\/event/.test(dataset.endpoint));
  if (drug) {
    const facet = findFacet(drug, /medicinalproduct/, rangeOf(drug));
    const ranked = facet ? rankedCategories(facet, rangeOf(drug)) : null;
    const top = ranked?.available ? ranked.items[0] : undefined;
    if (top && ranked?.available)
      out.push({
        id: "drug-top",
        text: `${top.label} is the product named most often in drug adverse reports: ${count(top.count)} reports (${percentText(top.share)}), ${dayText(rangeOf(drug).from)} to ${dayText(rangeOf(drug).to)}.`,
      });
  }

  const clearance = datasets.find((dataset) => /device\/510k/.test(dataset.endpoint));
  if (clearance) {
    const facet = findFacet(clearance, /decision_code/, rangeOf(clearance));
    const ranked = facet ? rankedCategories(facet, rangeOf(clearance)) : null;
    if (ranked?.available && ranked.denominator) {
      const cleared = ranked.items
        .filter((item) => item.key.startsWith("SE"))
        .reduce((sum, item) => sum + item.count, 0);
      const deNovo = ranked.items.find((item) => item.key === "DENG")?.count ?? 0;
      out.push({
        id: "510k",
        text: `${count(cleared)} of ${count(ranked.denominator)} 510(k) decisions (${percentText(share(cleared, ranked.denominator))}) found the device substantially equivalent${deNovo ? `; ${count(deNovo)} De Novo requests were granted` : ""}.`,
      });
    }
  }
  return out.slice(0, 6);
}

/** Series lines for one dataset: raw buckets and, for daily and weekly views, the rolling average. */
export function trendLines(trend: FdaTrend, interval: FdaGranularity, label: string) {
  const window = averageWindow(interval);
  const lines: TrendSeriesInput[] = [{ id: "count", label, points: trend.data }];
  if (window && trend.data.length > window * 2)
    lines.push({
      id: "average",
      label: averageLabel(interval),
      points: rollingMean(trend.data, window),
    });
  return lines;
}
