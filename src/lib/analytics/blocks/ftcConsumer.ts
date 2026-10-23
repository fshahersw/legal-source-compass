/**
 * Pure builders for the FTC consumer-protection section of the Analytics overview: Do Not Call reported calls by month,
 * the robocall share of those calls, and HSR early terminations by fiscal year. Inputs are rows already validated by
 * `@/lib/external/ftcData`; the reader does the I/O.
 */
import {
  dayRange,
  monthName,
  type DncMonth,
  type HsrFiscalYear,
  type HsrSeries,
  type OfficialMonth,
} from "@/lib/external/ftcData";
import {
  assembleBlock,
  densifyMonths,
  formatCount,
  longDate,
  type TrendBlockData,
  type TrendPoint,
} from "../trend";

export const DNC_DATA_URL =
  "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data";
export const DNC_DASHBOARD_URL =
  "https://public.tableau.com/app/profile/federal.trade.commission/viz/DoNotCallComplaints/MonthlyComparison";

type MonthValue = {
  calls: number;
  robocalls: number | null;
  notRobocalls: number | null;
  partial: boolean;
  origin: "records" | "count" | "dashboard";
};

/** One value per month: the build's own counts first, then the FTC dashboard's figure for a month the build did not count. */
export function mergeMonths(
  months: readonly DncMonth[],
  official: readonly OfficialMonth[],
): Map<string, MonthValue> {
  const out = new Map<string, MonthValue>();
  for (const m of months) {
    if (m.calls === null) continue;
    out.set(m.month, {
      calls: m.calls,
      robocalls: m.robocalls,
      notRobocalls: m.notRobocalls,
      partial: !m.complete,
      origin: m.method,
    });
  }
  for (const o of official)
    if (!out.has(o.month))
      out.set(o.month, {
        calls: o.total,
        robocalls: o.robocall,
        notRobocalls: o.live,
        partial: false,
        origin: "dashboard",
      });
  return out;
}

function monthRange(values: Map<string, MonthValue>): { first: string; last: string } | null {
  const keys = [...values.keys()].sort();
  return keys.length ? { first: keys[0]!, last: keys[keys.length - 1]! } : null;
}

function originNotes(
  months: readonly DncMonth[],
  values: Map<string, MonthValue>,
  official: readonly OfficialMonth[],
): string[] {
  const notes: string[] = [];
  const keysOf = (origin: MonthValue["origin"]) =>
    [...values.entries()]
      .filter(([, v]) => v.origin === origin)
      .map(([k]) => k)
      .sort();
  const records = months.filter((m) => m.method === "records");
  const recordsKeys = keysOf("records");
  if (recordsKeys.length) {
    const first = records.find((m) => m.firstDay)?.firstDay;
    const last = [...records].reverse().find((m) => m.lastDay)?.lastDay;
    notes.push(
      `${recordsKeys.map(monthName).join(" and ")}: every record was read and counted${first && last ? ` (complaints created ${dayRange(first, last)}, from the FTC's daily files)` : ""}.`,
    );
  }
  const counted = keysOf("count");
  if (counted.length)
    notes.push(
      `${counted.length} month${counted.length === 1 ? "" : "s"} (${monthName(counted[0]!)} to ${monthName(counted[counted.length - 1]!)}) were counted by asking the FTC's API how many records it lists for the month's creation dates; subjects and states were not read for them.`,
    );
  const dashboard = keysOf("dashboard");
  if (dashboard.length)
    notes.push(
      `${dashboard.length} month${dashboard.length === 1 ? "" : "s"} (${dashboard.map(monthName).join(", ")}) are the figures on the FTC's Do Not Call Complaints dashboard (April to June comparison), which the build did not count itself.`,
    );
  if (dashboard.length && (recordsKeys.length || counted.length)) {
    const checked = official.find((o) => dashboard.includes(o.month) && o.apiTotal !== null);
    notes.push(
      `Dashboard months and months counted from the daily files are different counts, so compare months within one source, not across the two.${
        checked
          ? ` For ${monthName(checked.month)} the FTC API lists ${formatCount(checked.apiTotal!)} records while the dashboard shows ${formatCount(checked.total)}; no reason is given in the FTC material read for this build.`
          : ""
      }`,
    );
  }
  return notes;
}

const SHARED_NOTES = [
  "Counts complaints by the date they were created. A complaint is a consumer's report of an unwanted call; the FTC states that none of the information in the reports is verified.",
  "Robocall means the consumer answered that the call was a recorded message. About one report in sixteen carries no answer; those are left out of the share.",
];

export function buildDncMonthly(input: {
  months: readonly DncMonth[];
  official: readonly OfficialMonth[];
  asOf: string | null;
}): TrendBlockData | null {
  const values = mergeMonths(input.months, input.official);
  const range = monthRange(values);
  if (!range) return null;
  const point = (pick: (v: MonthValue) => number | null) =>
    densifyMonths(
      new Map([...values].map(([k, v]) => [k, pick(v)] as const)),
      range.first,
      range.last,
    ).map((p): TrendPoint => (values.get(p.x)?.partial ? { ...p, partial: true } : p));
  const partial = [...values.entries()]
    .filter(([, v]) => v.partial)
    .map(([k]) => k)
    .sort();
  return assembleBlock({
    id: "ftc-dnc-monthly",
    xKind: "month",
    chart: "line",
    unit: "reported calls",
    series: [
      { id: "all", label: "All reported calls", points: point((v) => v.calls) },
      {
        id: "robocalls",
        label: "of which reported as a recording or robocall",
        points: point((v) => v.robocalls),
      },
    ],
    source: { label: "FTC Do Not Call reported calls data", url: DNC_DATA_URL },
    asOf: input.asOf,
    notes: [
      ...SHARED_NOTES,
      ...originNotes(input.months, values, input.official),
      ...(partial.length
        ? [
            `${partial.map((k) => `${monthName(k)}*`).join(" and ")} cover${partial.length === 1 ? "s" : ""} only the days stated above, drawn dashed, and ${partial.length === 1 ? "is" : "are"} never the latest value.`,
          ]
        : []),
      "Months with no point were not counted; they are gaps, not zero.",
    ],
  });
}

export function buildDncRobocallShare(input: {
  months: readonly DncMonth[];
  official: readonly OfficialMonth[];
  asOf: string | null;
}): TrendBlockData | null {
  const values = mergeMonths(input.months, input.official);
  const range = monthRange(values);
  if (!range) return null;
  const shareOf = (v: MonthValue): number | null =>
    v.robocalls !== null && v.notRobocalls !== null && v.robocalls + v.notRobocalls > 0
      ? Math.round((v.robocalls / (v.robocalls + v.notRobocalls)) * 1000) / 10
      : null;
  const points = densifyMonths(
    new Map([...values].map(([k, v]) => [k, shareOf(v)] as const)),
    range.first,
    range.last,
  ).map((p): TrendPoint => (values.get(p.x)?.partial ? { ...p, partial: true } : p));
  if (!points.some((p) => p.value !== null)) return null;
  return assembleBlock({
    id: "ftc-dnc-robocall-share",
    xKind: "month",
    chart: "line",
    format: "pct",
    unit: "of reported calls with an answer",
    series: [{ id: "share", label: "Reported as a recording or robocall", points }],
    source: { label: "FTC Do Not Call reported calls data", url: DNC_DATA_URL },
    asOf: input.asOf,
    notes: [
      "Share = calls reported as a recorded message or robocall / calls reported as either a recording or not × 100. Calls with no answer are in neither count.",
      "A share is a rate of reports, not of calls made: it says nothing about how many robocalls were placed.",
      ...originNotes(input.months, values, input.official),
      "Months with no point were not counted; they are gaps, not zero.",
    ],
  });
}

/** Federal fiscal year (October to September) of an ISO date, labelled by the year it ends; null for anything else. */
export function fiscalYearOf(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-\d{2}$/.exec(iso) : null;
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) + (month >= 10 ? 1 : 0);
}

/** The fiscal year of the API's earliest notice when that notice falls after the fiscal year began (October 1), else null. */
export function firstFiscalYearIsPartial(firstDate: string | null): number | null {
  const fy = fiscalYearOf(firstDate);
  if (fy === null || !firstDate) return null;
  return firstDate > `${fy - 1}-10-01` ? fy : null;
}

/**
 * Early terminations by fiscal year from two files: the API's notices and the FTC's fiscal-year table. The API series starts on
 * its first notice (earlier years are gaps), and the fiscal years it begins or ends inside are partial.
 */
export function buildHsrEarlyTerminations(input: {
  series: HsrSeries;
  filings: readonly HsrFiscalYear[];
}): TrendBlockData | null {
  const api = new Map(input.series.fiscal.map((f) => [f.year, f.count] as const));
  const lastFy = fiscalYearOf(input.series.lastDate);
  const openFiscalYear =
    lastFy !== null && input.series.lastDate !== null && input.series.lastDate < `${lastFy}-09-30`
      ? lastFy
      : null;
  const firstPartialFiscalYear = firstFiscalYearIsPartial(input.series.firstDate);
  const ftc = new Map(input.filings.map((f) => [f.fy, f.etGranted] as const));
  const years = [...api.keys(), ...ftc.keys()];
  if (!years.length) return null;
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const range: number[] = [];
  for (let y = lo; y <= hi; y += 1) range.push(y);
  const apiPoints: TrendPoint[] = range.map((y) => {
    const firstApi = Math.min(...api.keys());
    const inside = y >= firstApi;
    const partial = y === openFiscalYear || y === firstPartialFiscalYear;
    return {
      x: String(y),
      value: inside ? (api.get(y) ?? 0) : null,
      ...(partial && inside ? { partial: true } : {}),
    };
  });
  const ftcPoints: TrendPoint[] = range.map((y) => ({ x: String(y), value: ftc.get(y) ?? null }));
  const lastDate = input.series.lastDate;
  return assembleBlock({
    id: "ftc-hsr-early-terminations",
    xKind: "fy",
    chart: "line",
    unit: "early terminations",
    series: [
      { id: "notices", label: "Notices in the FTC API, by date granted", points: apiPoints },
      {
        id: "table",
        label: "Transactions granted, in the FTC's fiscal-year table",
        points: ftcPoints,
      },
    ],
    source: {
      label: "FTC HSR early termination notices API and HSR data sets",
      url: "https://www.ftc.gov/legal-library/browse/early-termination-notices",
    },
    asOf: lastDate,
    notes: [
      "A notice is the FTC's public record that early termination of the Hart-Scott-Rodino waiting period was granted for one transaction. It does not say the deal closed.",
      "The two lines count different things from different files: the API's notices (by the date granted) and the transactions the FTC's fiscal-year table says were granted early termination. They are close but not identical.",
      "The FTC announced on February 4, 2021 that it would not grant early terminations while it reviewed its process, and said on October 10, 2024 that it would lift the suspension once its new premerger form is in full effect. Years between are near zero by rule, not because data are missing.",
      "Fiscal years run October to September and are labelled by the year they end. The API holds no notices before its first one; years before it are gaps in that line, not zero. A year still running, or begun mid-year in the API, is marked * and is never the latest value.",
      ...(lastDate ? [`The API's last notice is dated ${longDate(lastDate)}.`] : []),
      `${formatCount(input.series.notices)} notices are published in all.`,
    ],
    markers: [{ x: "2021", label: "Suspended Feb 2021" }],
  });
}
