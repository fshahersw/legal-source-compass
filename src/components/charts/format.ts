/**
 * Number and period formatting shared by every chart. Pure and client-safe.
 *
 * Values follow the insights contract (src/lib/insights/contract.ts): `percent` is 0–100, `rate_per_100k` is per
 * 100,000 residents, `currency_usd` is whole US dollars (not adjusted for inflation unless the metric says so). A
 * missing value is always "Not recorded", never 0.
 */
import type { MetricFormat, PeriodType } from "@/lib/insights/contract";

export const NOT_RECORDED = "Not recorded";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** How a chart writes one value in full (tooltip, table) and on an axis tick. */
export type ValueFormatter = {
  full: (v: number | null | undefined) => string;
  tick: (v: number) => string;
  /** Signed difference in the metric's own unit ("+1,204", "+2.1 percentage points"). */
  delta: (d: number) => string;
};

function fixed(v: number, digits: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatUsd(v: number | null | undefined): string {
  if (!finite(v)) return NOT_RECORDED;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}$${fixed(abs / 1e12, 2)} trillion`;
  if (abs >= 1e9) return `${sign}$${fixed(abs / 1e9, 2)} billion`;
  if (abs >= 1e6) return `${sign}$${fixed(abs / 1e6, 1)} million`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Compact tick: 0, 950, 1.2k, 12k, 1.4M, 2.1B. */
export function compactNumber(v: number, prefix = ""): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const pick = (n: number, unit: string) => {
    const s = n >= 10 ? n.toFixed(0) : n.toFixed(1);
    return `${sign}${prefix}${s.replace(/\.0$/, "")}${unit}`;
  };
  if (abs >= 1e12) return pick(abs / 1e12, "T");
  if (abs >= 1e9) return pick(abs / 1e9, "B");
  if (abs >= 1e6) return pick(abs / 1e6, "M");
  if (abs >= 1e3) return pick(abs / 1e3, "k");
  const small = abs < 10 && abs % 1 !== 0 ? abs.toFixed(1) : abs.toFixed(0);
  return `${sign}${prefix}${small}`;
}

function signed(d: number, body: string): string {
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${body}`;
}

/** Formatter for a contract metric format. */
export function metricFormatter(format: MetricFormat): ValueFormatter {
  switch (format) {
    case "count":
      return {
        full: (v) => (finite(v) ? Math.round(v).toLocaleString("en-US") : NOT_RECORDED),
        tick: (v) => compactNumber(v),
        delta: (d) => signed(d, Math.round(Math.abs(d)).toLocaleString("en-US")),
      };
    case "rate_per_100k":
      return {
        full: (v) => (finite(v) ? fixed(v, 1) : NOT_RECORDED),
        tick: (v) => compactNumber(v),
        delta: (d) => signed(d, fixed(Math.abs(d), 1)),
      };
    case "percent":
      return {
        full: (v) => (finite(v) ? `${fixed(v, 1)}%` : NOT_RECORDED),
        tick: (v) => `${Number.isInteger(v) ? v : fixed(v, 1)}%`,
        delta: (d) => signed(d, `${fixed(Math.abs(d), 1)} percentage points`),
      };
    case "currency_usd":
      return {
        full: formatUsd,
        tick: (v) => compactNumber(v, "$"),
        delta: (d) => signed(d, formatUsd(Math.abs(d))),
      };
    case "months":
      return {
        full: (v) => (finite(v) ? fixed(v, 1) : NOT_RECORDED),
        tick: (v) => compactNumber(v),
        delta: (d) => signed(d, `${fixed(Math.abs(d), 1)} months`),
      };
    case "days":
      return {
        full: (v) => (finite(v) ? Math.round(v).toLocaleString("en-US") : NOT_RECORDED),
        tick: (v) => compactNumber(v),
        delta: (d) => signed(d, `${Math.round(Math.abs(d)).toLocaleString("en-US")} days`),
      };
    case "ratio":
      return {
        full: (v) => (finite(v) ? fixed(v, 2) : NOT_RECORDED),
        tick: (v) => (Math.abs(v) >= 100 ? compactNumber(v) : fixed(v, Math.abs(v) < 10 ? 1 : 0)),
        delta: (d) => signed(d, fixed(Math.abs(d), 2)),
      };
  }
}

/** True when the format already says its unit ("12.0%", "$4.1 million"), so the unit text is not repeated. */
export function formatCarriesUnit(format: MetricFormat): boolean {
  return format === "percent" || format === "currency_usd";
}

/** "1,204 cases", "12.0%", "$4.1 million", "Not recorded". */
export function valueWithUnit(
  v: number | null | undefined,
  format: MetricFormat,
  unit: string,
): string {
  const text = metricFormatter(format).full(v);
  if (!finite(v) || formatCarriesUnit(format) || !unit) return text;
  return `${text} ${unit}`;
}

/** Relative change in percent, or null when the base is zero or either side is missing. */
export function percentChange(from: number | null, to: number | null): number | null {
  if (!finite(from) || !finite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function formatPercentChange(p: number | null): string {
  if (p === null) return "";
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${fixed(Math.abs(p), 1)}%`;
}

const MONTHS = [
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

function isoParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
    return null;
  return [y, mo, d];
}

/** "October 1, 2026" for a valid ISO date; the input itself otherwise. */
export function longDate(iso: string): string {
  const p = isoParts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : iso;
}

/** Full label of a period key as the contract writes it. */
export function periodLabel(period: string, type: PeriodType): string {
  switch (type) {
    case "year":
      return period;
    case "fiscal_year":
      return /^FY\d{4}$/.test(period) ? period : /^\d{4}$/.test(period) ? `FY${period}` : period;
    case "quarter": {
      const m = /^(\d{4})-Q([1-4])$/.exec(period);
      return m ? `Q${m[2]} ${m[1]}` : period;
    }
    case "month": {
      const m = /^(\d{4})-(\d{2})$/.exec(period);
      const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
      return m && name ? `${name} ${m[1]}` : period;
    }
    case "twelve_months_ending":
      return isoParts(period) ? `12 months ending ${longDate(period)}` : period;
    case "snapshot":
      return isoParts(period) ? `As of ${longDate(period)}` : period;
  }
}

/** Short axis label of a period key. */
export function periodTick(period: string, type: PeriodType): string {
  switch (type) {
    case "year":
      return period;
    case "fiscal_year": {
      const m = /(\d{4})$/.exec(period);
      return m ? `FY${m[1]!.slice(2)}` : period;
    }
    case "quarter": {
      const m = /^(\d{4})-Q([1-4])$/.exec(period);
      return m ? `Q${m[2]} ’${m[1]!.slice(2)}` : period;
    }
    case "month": {
      const m = /^(\d{4})-(\d{2})$/.exec(period);
      const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
      return m && name ? `${name.slice(0, 3)} ${m[1]}` : period;
    }
    case "twelve_months_ending":
    case "snapshot": {
      const p = isoParts(period);
      return p ? `${MONTHS[p[1] - 1]!.slice(0, 3)} ${p[0]}` : period;
    }
  }
}

/** Ordering of period keys of one type (text order is chronological for every contract period format). */
export function comparePeriods(a: string, b: string): number {
  const fy = /^FY(\d+)$/;
  const ma = fy.exec(a);
  const mb = fy.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every period between `first` and `last` (inclusive) for the types with a fixed cadence (year, fiscal year, quarter,
 * month), so a period the source does not give is an explicit gap. Other types (12 months ending, snapshot) have no
 * fixed cadence; their keys are returned as given.
 */
export function densePeriods(keys: readonly string[], type: PeriodType): string[] {
  const sorted = [...new Set(keys)].sort(comparePeriods);
  if (sorted.length < 2) return sorted;
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const out: string[] = [];
  if (type === "year" || type === "fiscal_year") {
    const prefix = type === "fiscal_year" && first.startsWith("FY") ? "FY" : "";
    const a = Number(first.replace(/^FY/, ""));
    const b = Number(last.replace(/^FY/, ""));
    if (!Number.isInteger(a) || !Number.isInteger(b) || b - a > 400) return sorted;
    for (let y = a; y <= b; y += 1) out.push(`${prefix}${y}`);
    return out;
  }
  if (type === "quarter") {
    const pa = /^(\d{4})-Q([1-4])$/.exec(first);
    const pb = /^(\d{4})-Q([1-4])$/.exec(last);
    if (!pa || !pb) return sorted;
    for (
      let i = Number(pa[1]) * 4 + Number(pa[2]) - 1;
      i <= Number(pb[1]) * 4 + Number(pb[2]) - 1;
      i++
    )
      out.push(`${Math.floor(i / 4)}-Q${(i % 4) + 1}`);
    return out;
  }
  if (type === "month") {
    const pa = /^(\d{4})-(\d{2})$/.exec(first);
    const pb = /^(\d{4})-(\d{2})$/.exec(last);
    if (!pa || !pb) return sorted;
    for (
      let i = Number(pa[1]) * 12 + Number(pa[2]) - 1;
      i <= Number(pb[1]) * 12 + Number(pb[2]) - 1;
      i++
    )
      out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
    return out;
  }
  return sorted;
}
