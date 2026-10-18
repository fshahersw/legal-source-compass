import { FDA_COLORS } from "@/components/fda-analytics/chartView";

export const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : "Not recorded";
export const compact = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
export const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "Not recorded";
export const signed = (v: number | null | undefined) =>
  typeof v !== "number" ? "—" : v > 0 ? `+${v.toLocaleString("en-US")}` : v.toLocaleString("en-US");
export const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
export const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export const OUTCOME_ORDER = [
  "granted",
  "denied",
  "withdrawn",
  "moot",
  "transferred",
  "cto_vacated",
  "cto_stay_lifted",
  "unopposed_transfer_granted",
  "cro_vacated",
  "scheduled",
  "not_found",
] as const;
export const OUTCOME_LABEL: Record<string, string> = {
  granted: "Centralized",
  denied: "Denied",
  withdrawn: "Withdrawn",
  moot: "Moot",
  transferred: "Transferred",
  cto_vacated: "CTO vacated",
  cto_stay_lifted: "CTO stay lifted",
  unopposed_transfer_granted: "Unopposed transfer",
  cro_vacated: "CRO vacated",
  scheduled: "Scheduled",
  not_found: "Not found",
  other: "Other",
};
export const OUTCOME_COLOR: Record<string, string> = {
  granted: FDA_COLORS[1]!,
  denied: FDA_COLORS[2]!,
  withdrawn: FDA_COLORS[3]!,
  moot: FDA_COLORS[4]!,
  transferred: FDA_COLORS[0]!,
  cto_vacated: FDA_COLORS[5]!,
  cto_stay_lifted: FDA_COLORS[5]!,
  unopposed_transfer_granted: FDA_COLORS[0]!,
  cro_vacated: FDA_COLORS[5]!,
  scheduled: "var(--border)",
  not_found: "var(--muted-foreground)",
  other: "var(--muted-foreground)",
};
export const FLAG_LABEL: Record<string, string> = {
  fast_growth_no_bellwether_quote: "Fast growth, no bellwether quoted",
  no_court_page: "No court page located",
  page_lists_no_orders: "Court page unreadable (no orders extracted)",
  page_unreadable: "Court page unreadable (no orders extracted)",
  not_transferred_as_of_report: "Not transferred as of 10/1/2026",
};
const ACRONYMS =
  /\b(Ii|Iii|Iv|Mdl|Glp|Ras|Ivc|Iud|Cpap|Pap|Afff|Asd|Adhd|Dps6|Zf-Trw|Arc|Sc|Llc|Usa|Uk|Nv|Ml|Mtbe|Abg|Lfit|Ncaa|Pfas|Erisa|Tcpa|Fcra|Ftx|Crt|Ldl)\b/g;
/** Litigation title without "IN RE:". Titles the JPML already prints in mixed case are kept exactly as printed;
 * ALL-CAPS titles (hearing schedules) are converted to title case with acronyms and model codes preserved. */
export const title = (s: string) => {
  const bare = s.replace(/^IN RE:?\s*/i, "");
  if (/[a-z]/.test(bare)) return bare;
  return bare
    .toLowerCase()
    .replace(/(^|[\s(/"“-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(And|Of|The|For|In|On|To|Or|A|An)\b/g, (w) => w.toLowerCase())
    .replace(ACRONYMS, (w) => w.toUpperCase())
    .replace(/\b(\d+[a-z])\b/g, (w) => w.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
};
