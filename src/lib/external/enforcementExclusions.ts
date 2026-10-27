/**
 * Pure model for the Exclusions tab trends: HHS-OIG LEIE exclusions by year and authority, SAM.gov exclusions by year
 * and classification (from the exclusions_trends_v1 RPC), and the NPDB national medical-malpractice payment series.
 * No I/O. Missing values stay null ("Not recorded"); the current year and NPDB's first year (1990) are partial.
 */

/** LEIE exclusion authorities shown as their own band; every other code is "Other authorities". */
export const LEIE_GROUPS = [
  { id: "1128a1", label: "Program-related crime conviction (1128(a)(1))" },
  { id: "1128a2", label: "Patient abuse or neglect (1128(a)(2))" },
  { id: "1128a3", label: "Health-care fraud felony (1128(a)(3))" },
  { id: "1128a4", label: "Controlled-substance felony (1128(a)(4))" },
  { id: "1128b4", label: "Licence revoked or suspended (1128(b)(4))" },
  { id: "other", label: "Other authorities" },
] as const;
export type LeieGroup = (typeof LEIE_GROUPS)[number]["id"];

export const SAM_GROUPS = [
  { id: "Firm", label: "Firms" },
  { id: "Individual", label: "Individuals" },
  { id: "Special Entity Designation", label: "Special entity designations" },
  { id: "Vessel", label: "Vessels" },
  { id: "other", label: "Not recorded" },
] as const;
export type SamGroup = (typeof SAM_GROUPS)[number]["id"];

export type YearRow<K extends string> = { year: string; partial: boolean; total: number } & Record<
  K,
  number
>;

export type ExclusionTrends = {
  asOf: string;
  leie: YearRow<LeieGroup>[];
  leieTotal: number | null;
  leieUndated: number | null;
  leieFuture: number | null;
  sam: YearRow<SamGroup>[];
  samTotal: number | null;
  samUndated: number | null;
  samFuture: number | null;
};

type Cell = { year: string; group: string; n: number };
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function cells(v: unknown): Cell[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    const year = typeof o?.["year"] === "string" ? o["year"] : null;
    const group = typeof o?.["group"] === "string" ? o["group"] : null;
    const n = int(o?.["n"]);
    return year && /^(19|20)\d{2}$/.test(year) && group && n !== null ? [{ year, group, n }] : [];
  });
}

/** Years from the first to the last recorded (zero-filled between them: a list year with no entry is 0). */
function byYear<K extends string>(
  list: Cell[],
  keys: readonly K[],
  groupOf: (g: string) => K,
  asOf: string,
): YearRow<K>[] {
  if (!list.length) return [];
  const years = list.map((c) => Number(c.year));
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const rows: YearRow<K>[] = [];
  for (let y = lo; y <= hi; y++) {
    const row = { year: String(y), partial: String(y) >= asOf.slice(0, 4), total: 0 } as YearRow<K>;
    for (const k of keys) (row as Record<string, number>)[k] = 0;
    rows.push(row);
  }
  for (const c of list) {
    const row = rows[Number(c.year) - lo]!;
    const k = groupOf(c.group);
    (row as Record<string, number>)[k] = (row[k] as number) + c.n;
    row.total += c.n;
  }
  return rows;
}

const LEIE_KEYS = LEIE_GROUPS.map((g) => g.id);
const SAM_KEYS = SAM_GROUPS.map((g) => g.id);

export function parseExclusionTrends(raw: unknown): ExclusionTrends | null {
  const o = obj(raw);
  const asOf =
    typeof o?.["as_of"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o["as_of"]) ? o["as_of"] : null;
  if (!o || !asOf) return null;
  return {
    asOf,
    leie: byYear(
      cells(o["leie"]),
      LEIE_KEYS,
      (g) => ((LEIE_KEYS as readonly string[]).includes(g) ? (g as LeieGroup) : "other"),
      asOf,
    ),
    leieTotal: int(o["leie_total"]),
    leieUndated: int(o["leie_undated"]),
    leieFuture: int(o["leie_future"]),
    sam: byYear(
      cells(o["sam"]),
      SAM_KEYS,
      (g) => ((SAM_KEYS as readonly string[]).includes(g) ? (g as SamGroup) : "other"),
      asOf,
    ),
    samTotal: int(o["sam_total"]),
    samUndated: int(o["sam_undated"]),
    samFuture: int(o["sam_future"]),
  };
}

// ------------------------------------------------------------------------------------------------ NPDB

export type NpdbYear = {
  year: string;
  partial: boolean;
  reports: number | null;
  totalPaid: number | null;
  median: number | null;
  median2025: number | null;
  delayYears: number | null;
  judgmentShare: number | null;
};
export type NpdbGroup = {
  id: string;
  label: string;
  reports: number | null;
  median: number | null;
  deathShare: number | null;
};
export type NpdbNational = {
  years: NpdbYear[];
  allegations: NpdbGroup[];
  sourceUrl: string | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The npdb_malpractice_national rows: `npdb-mmpr-us:<year>` per year and `npdb-mmpr-us:allegation:<code>` per
 * allegation group (all years). The first year of the series (1990, the NPDB's opening year: 2,856 reports against
 * 17,961 in 1991) and the current year are partial.
 */
export function parseNpdbNational(
  rows: readonly { id?: unknown; c?: unknown; source_url?: unknown }[],
  asOf: string,
): NpdbNational {
  const years: NpdbYear[] = [];
  const allegations: NpdbGroup[] = [];
  let sourceUrl: string | null = null;
  for (const r of rows) {
    const id = typeof r.id === "string" ? r.id : "";
    const c = obj(r.c);
    if (!c) continue;
    if (!sourceUrl && typeof r.source_url === "string" && r.source_url.startsWith("https://"))
      sourceUrl = r.source_url;
    const y = /^npdb-mmpr-us:(\d{4})$/.exec(id);
    if (y) {
      years.push({
        year: y[1]!,
        partial: false,
        reports: int(c["reports"]),
        totalPaid: num(c["total_paid"]),
        median: num(c["median_payment"]),
        median2025: num(c["median_payment_2025usd"]),
        delayYears: num(c["delay_median_years"]),
        judgmentShare: num(c["judgment_share"]),
      });
      continue;
    }
    const a = /^npdb-mmpr-us:allegation:([A-Za-z0-9]+)$/.exec(id);
    if (a && typeof c["label"] === "string")
      allegations.push({
        id: a[1]!,
        label: c["label"],
        reports: int(c["reports"]),
        median: num(c["median_payment"]),
        deathShare: num(c["death_share"]),
      });
  }
  years.sort((p, q) => p.year.localeCompare(q.year));
  const first = years[0]?.year;
  for (const y of years) y.partial = y.year === first || y.year >= asOf.slice(0, 4);
  allegations.sort((p, q) => (q.reports ?? -1) - (p.reports ?? -1));
  return { years, allegations, sourceUrl };
}
