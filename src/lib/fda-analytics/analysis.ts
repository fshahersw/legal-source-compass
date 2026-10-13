import type {
  FdaAnalyticsDataset,
  FdaAnalyticsFacet,
  FdaDateRange,
  FdaGranularity,
  FdaPeriodComparison,
  FdaPeriodPoint,
} from "./types";

const DAY = 86_400_000;
export function isFdaDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const stamp = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
export function shiftFdaDate(date: string, days: number): string {
  if (!isFdaDate(date) || !Number.isInteger(days))
    throw new Error("Invalid calendar date or day offset");
  return iso(stamp(date) + days * DAY);
}
function dates(range: FdaDateRange): string[] {
  if (
    !isFdaDate(range.from) ||
    !isFdaDate(range.to) ||
    range.from > range.to ||
    (stamp(range.to) - stamp(range.from)) / DAY > 731
  )
    throw new Error("A valid date range of at most 732 days is required");
  const days = [];
  for (let time = stamp(range.from); time <= stamp(range.to); time += DAY) days.push(iso(time));
  return days;
}
function dailyValues(dataset: FdaAnalyticsDataset, range: FdaDateRange) {
  const series = dataset.series;
  const points = new Map(series?.points.map((point) => [point.date, point.count]) ?? []);
  return dates(range).map((date) => {
    const eligible =
      !!series &&
      dataset.status !== "failed" &&
      dataset.status !== "unavailable" &&
      date >= series.range.from &&
      date <= series.range.to;
    const withinCutoff = !!series?.completeThrough && date <= series.completeThrough;
    const value = eligible
      ? (points.get(date) ?? (series.complete && withinCutoff ? 0 : null))
      : null;
    return {
      date,
      value,
      complete:
        value !== null &&
        !!series?.complete &&
        !!series.completeThrough &&
        date <= series.completeThrough,
    };
  });
}

/** Presets follow this dataset's captured source-date coverage, never API release time. */
export function sourceAlignedRange(
  dataset: FdaAnalyticsDataset,
  days: number,
): FdaDateRange | null {
  const series = dataset.series;
  if (!series?.completeThrough || !Number.isInteger(days) || days < 1 || days > 732) return null;
  const from = shiftFdaDate(series.completeThrough, 1 - days);
  if (from < series.range.from || series.completeThrough > series.range.to) return null;
  return { from, to: series.completeThrough };
}
function calendarBucket(date: string, interval: FdaGranularity): FdaDateRange {
  const time = stamp(date);
  if (interval === "day") return { from: date, to: date };
  if (interval === "week") {
    const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * DAY;
    return { from: iso(monday), to: iso(monday + 6 * DAY) };
  }
  const day = new Date(time);
  return {
    from: iso(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)),
    to: iso(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)),
  };
}

/** Calendar buckets never replace unknown days with zero or mix dataset count units. */
export function aggregateSeries(
  dataset: FdaAnalyticsDataset,
  range: FdaDateRange,
  interval: FdaGranularity,
): FdaPeriodPoint[] {
  const groups = new Map<string, { bounds: FdaDateRange; days: ReturnType<typeof dailyValues> }>();
  for (const day of dailyValues(dataset, range)) {
    const bounds = calendarBucket(day.date, interval);
    const group = groups.get(bounds.from) ?? { bounds, days: [] };
    group.days.push(day);
    groups.set(bounds.from, group);
  }
  return [...groups.values()].map(({ bounds, days }) => {
    const knownDays = days.filter((day) => day.value !== null).length;
    const start = days[0]!.date,
      end = days.at(-1)!.date;
    return {
      start,
      end,
      label: interval === "month" ? bounds.from.slice(0, 7) : bounds.from,
      value: knownDays === days.length ? days.reduce((sum, day) => sum + day.value!, 0) : null,
      knownDays,
      totalDays: days.length,
      partial: start !== bounds.from || end !== bounds.to || days.some((day) => !day.complete),
    };
  });
}

/** Equal-duration adjacent windows. Open reporting days and missing coverage suppress deltas. */
export function comparePeriods(
  dataset: FdaAnalyticsDataset,
  range: FdaDateRange,
): FdaPeriodComparison {
  const length = dates(range).length;
  const previousRange = {
    from: shiftFdaDate(range.from, -length),
    to: shiftFdaDate(range.from, -1),
  };
  const period = (selected: FdaDateRange) => {
    const days = dailyValues(dataset, selected);
    return {
      range: selected,
      value: days.every((day) => day.value !== null)
        ? days.reduce((sum, day) => sum + day.value!, 0)
        : null,
      complete: days.every((day) => day.complete),
    };
  };
  const current = period(range),
    previous = period(previousRange);
  const comparable =
    current.complete && previous.complete && current.value !== null && previous.value !== null;
  return {
    current,
    previous,
    comparable,
    absoluteChange: comparable ? current.value! - previous.value! : null,
    percentChange:
      comparable && previous.value! > 0
        ? ((current.value! - previous.value!) / previous.value!) * 100
        : null,
    reason: !comparable
      ? "Comparison withheld: both equal-duration windows must fall within the reconciled API enumeration and captured source-date cutoff; incomplete or lagging coverage is not compared with a prior period."
      : previous.value === 0
        ? "Absolute change is available; percentage change is undefined because the prior count is zero."
        : "Equal-duration windows from the same dataset, count unit and date field. Reporting may be revised in later source snapshots.",
  };
}

export function facetBreakdown(
  facet: FdaAnalyticsFacet,
  range?: FdaDateRange,
): {
  available: boolean;
  buckets: (FdaAnalyticsFacet["buckets"][number] & { percent: number | null })[];
  canSumTo100: boolean;
  reason: string;
} {
  const available =
    !range ||
    (facet.scope.kind === "window" &&
      facet.scope.from === range.from &&
      facet.scope.to === range.to);
  if (!available)
    return {
      available: false,
      buckets: [],
      canSumTo100: false,
      reason:
        "This category capture does not match the selected date range. Counts are not rescaled or inferred.",
    };
  const denominator = facet.denominator;
  const total = facet.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const canSumTo100 =
    !facet.multiValued &&
    facet.exhaustive &&
    !facet.truncated &&
    denominator !== null &&
    denominator > 0 &&
    total === denominator;
  return {
    available: true,
    buckets: facet.buckets.map((bucket) => ({
      ...bucket,
      percent: denominator !== null && denominator > 0 ? (bucket.count / denominator) * 100 : null,
    })),
    canSumTo100,
    reason: canSumTo100
      ? `Complete exclusive categories; denominator: ${facet.denominatorLabel}.`
      : `${facet.multiValued ? "Categories may overlap. " : ""}${facet.truncated || !facet.exhaustive ? "Displayed categories may be incomplete. " : ""}Percentages use ${facet.denominatorLabel}; they are not normalized to the displayed categories.`,
  };
}
