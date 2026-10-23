/**
 * litviz/1 — shared, client-safe shapes and pure helpers for the litigation visualizations: MDL lifecycle lanes, the
 * product signal timeline, the citation map and the court hierarchy explorer.
 *
 * Every value drawn comes from a row of the long series table (`SeriesRow`, the shape of `public.product_signals_v1`
 * and of `litviz.mdl_series` in database/contracts/litviz-v1.sql) or from a published record. A period the source does
 * not record is absent (drawn as a gap, listed as "Not recorded"), never 0. Nothing here fetches data.
 */

/** One value of one series in one month. `month` is "YYYY-MM"; for fiscal-year series it is the FY's last month
 * (September), for calendar-year series January. The shape of public.product_signals_v1 (worker SAFETY). */
export type SeriesRow = {
  series: string;
  month: string;
  value: number | null;
  unit: string;
  source_dataset: string;
  source_url: string | null;
  basis: string;
};

export type SeriesKind = "stock" | "flow";
export type SeriesGrain = "month" | "fiscal_year" | "calendar_year";
export type SeriesGroup = "lifecycle" | "activity" | "product" | "national";

export type SeriesMeta = {
  id: string;
  /** What is counted, in a sentence fragment ("Actions pending"). */
  label: string;
  /** Where it comes from, for the track label ("JPML monthly report"). */
  source: string;
  unit: string;
  kind: SeriesKind;
  grain: SeriesGrain;
  group: SeriesGroup;
};

export const SERIES = {
  jpml_pending: {
    label: "Actions pending",
    source: "JPML monthly pending-MDL report",
    unit: "actions",
    kind: "stock",
    grain: "month",
    group: "lifecycle",
  },
  jpml_fy_pending: {
    label: "Actions pending at fiscal-year end",
    source: "JPML fiscal-year statistical analysis",
    unit: "actions",
    kind: "stock",
    grain: "fiscal_year",
    group: "lifecycle",
  },
  jpml_fy_closed: {
    label: "Actions closed in the fiscal year",
    source: "JPML fiscal-year statistical analysis",
    unit: "actions",
    kind: "flow",
    grain: "fiscal_year",
    group: "lifecycle",
  },
  jpml_fy_remanded: {
    label: "Actions remanded in the fiscal year",
    source: "JPML fiscal-year statistical analysis",
    unit: "actions",
    kind: "flow",
    grain: "fiscal_year",
    group: "lifecycle",
  },
  fjc_idb_cases: {
    label: "Civil cases carrying the MDL number, by fiscal year filed",
    source: "FJC Integrated Database (historical association, not membership)",
    unit: "civil cases",
    kind: "flow",
    grain: "fiscal_year",
    group: "lifecycle",
  },
  docket_entries: {
    label: "Master-docket entries collected",
    source: "Docket entries held in the corpus",
    unit: "entries",
    kind: "flow",
    grain: "month",
    group: "activity",
  },
  filings: {
    label: "Court filings collected",
    source: "Court filings layer (documents)",
    unit: "filings",
    kind: "flow",
    grain: "month",
    group: "activity",
  },
  filings_year: {
    label: "Court filings collected",
    source: "Court filings layer (documents), by calendar year",
    unit: "filings",
    kind: "flow",
    grain: "calendar_year",
    group: "activity",
  },
  faers_reports: {
    label: "FAERS reports naming the product",
    source: "FDA Adverse Event Reporting System via openFDA",
    unit: "reports",
    kind: "flow",
    grain: "calendar_year",
    group: "product",
  },
  maude_reports: {
    label: "MAUDE device reports for the product",
    source: "FDA MAUDE via openFDA",
    unit: "reports",
    kind: "flow",
    grain: "calendar_year",
    group: "product",
  },
  jpml_motions_granted: {
    label: "Centralization motions granted",
    source: "JPML calendar-year statistics",
    unit: "motions",
    kind: "flow",
    grain: "calendar_year",
    group: "national",
  },
} as const satisfies Record<string, Omit<SeriesMeta, "id">>;

export type KnownSeries = keyof typeof SERIES;

const humanize = (id: string) => {
  const s = id.replace(/[_:]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : id;
};

/** Metadata of a series id; an id this file does not know (a SAFETY series) is described from its first row. */
export function seriesMeta(
  id: string,
  row?: Pick<SeriesRow, "unit" | "basis" | "source_dataset">,
): SeriesMeta {
  const known = (SERIES as Record<string, Omit<SeriesMeta, "id">>)[id];
  if (known) return { id, ...known };
  const basis = row?.basis ?? "";
  return {
    id,
    label: humanize(id),
    source: row?.source_dataset ?? "Not recorded",
    unit: row?.unit ?? "",
    kind: "flow",
    grain: /fiscal[_ ]year/.test(basis)
      ? "fiscal_year"
      : /calendar[_ ]year|annual/.test(basis)
        ? "calendar_year"
        : "month",
    group: "product",
  };
}

/** A basis that marks the period as still in progress or only partly covered. */
export const isPartialBasis = (basis: string) => /:partial/.test(basis);
/** A fiscal-year point whose MDL attribution the JPML extraction could not verify: listed, never drawn. */
export const isUnverifiedBasis = (basis: string) => /attribution_unverified/.test(basis);

// ------------------------------------------------------------------------------------------------ time

const MONTH = /^([12][0-9]{3})-(0[1-9]|1[0-2])$/;
const DAY = /^([12][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** "YYYY-MM" → months since year 0 (year × 12 + month − 1); null when not a month key. */
export function monthIndex(key: string | null | undefined): number | null {
  const m = MONTH.exec(key ?? "");
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

export function monthKey(index: number): string {
  const i = Math.floor(index);
  const y = Math.floor(i / 12);
  return `${y}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → fractional month index (the day placed within its month); null when not a real date. */
export function dateIndex(iso: string | null | undefined): number | null {
  const m = DAY.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > days) return null;
  return y * 12 + mo - 1 + (d - 1) / days;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2021" for a month index. */
export function monthLabel(index: number): string {
  const i = Math.floor(index);
  return `${MONTHS[((i % 12) + 12) % 12]} ${Math.floor(i / 12)}`;
}

/** "March 4, 2021" for a "YYYY-MM-DD" date; the input unchanged when it is not one. */
export function dayLabel(iso: string | null | undefined): string {
  const m = DAY.exec(iso ?? "");
  if (!m) return iso ?? "Not recorded";
  const full = [
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
  return `${full[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The months a row's value covers: [t0, t1) in month-index units. */
export function rowSpan(
  row: Pick<SeriesRow, "month">,
  grain: SeriesGrain,
): [number, number] | null {
  const i = monthIndex(row.month);
  if (i === null) return null;
  if (grain === "fiscal_year") return [i - 11, i + 1];
  if (grain === "calendar_year") return [i, i + 12];
  return [i, i + 1];
}

/** How a row's period is written: "Mar 2021", "FY2021 (Oct 2020 – Sep 2021)", "2021". */
export function periodLabel(row: Pick<SeriesRow, "month">, grain: SeriesGrain): string {
  const i = monthIndex(row.month);
  if (i === null) return row.month;
  if (grain === "fiscal_year") return `FY${Math.floor(i / 12)}`;
  if (grain === "calendar_year") return String(Math.floor(i / 12));
  return monthLabel(i);
}

// ------------------------------------------------------------------------------------------------ rows

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Parse untrusted rows (an RPC result) into SeriesRows; rows that do not fit the shape are dropped. */
export function parseSeriesRows(raw: unknown): SeriesRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SeriesRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const series = str(o["series"]);
    const month = str(o["month"]);
    if (!series || !/^[A-Za-z0-9_:.-]{1,80}$/.test(series) || !month || monthIndex(month) === null)
      continue;
    const value =
      typeof o["value"] === "string" && /^-?\d+(\.\d+)?$/.test(o["value"])
        ? Number(o["value"])
        : num(o["value"]);
    const url = str(o["source_url"]);
    out.push({
      series,
      month,
      value,
      unit: str(o["unit"]) ?? "",
      source_dataset: str(o["source_dataset"]) ?? "Not recorded",
      source_url: url && (/^https?:\/\//.test(url) || url.startsWith("/")) ? url : null,
      basis: str(o["basis"]) ?? "",
    });
  }
  return out;
}

/** Rows grouped by series id, each sorted by month. */
export function bySeries(rows: readonly SeriesRow[]): Map<string, SeriesRow[]> {
  const m = new Map<string, SeriesRow[]>();
  for (const r of rows) m.set(r.series, [...(m.get(r.series) ?? []), r]);
  for (const list of m.values()) list.sort((a, b) => a.month.localeCompare(b.month));
  return m;
}

/** Calendar-year roll-up of a monthly flow: sum per year, partial when any month is partial. */
export function yearlyFlow(
  rows: readonly SeriesRow[],
): { year: number; value: number; partial: boolean }[] {
  const m = new Map<number, { value: number; partial: boolean }>();
  for (const r of rows) {
    const i = monthIndex(r.month);
    if (i === null || r.value === null) continue;
    const y = Math.floor(i / 12);
    const cur = m.get(y) ?? { value: 0, partial: false };
    cur.value += r.value;
    cur.partial ||= isPartialBasis(r.basis);
    m.set(y, cur);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v }));
}

// ------------------------------------------------------------------------------------------------ attributes

/** The published fields an MDL lane is labelled with, as read from each source record (see litviz.source_rows). */
export type MdlSource = {
  /** `mdls`: the MDL record as of the latest JPML pending report. */
  m?: Record<string, unknown> | null;
  /** `jpml_pending_history_mdls`: monthly-report history. */
  h?: Record<string, unknown> | null;
  /** `mdl_analytics`. */
  a?: Record<string, unknown> | null;
  /** `jpml_statistics_extra` (fiscal-year history). */
  x?: Record<string, unknown> | null;
  /** `mdl_terminated_history` (JPML terminated-litigation tables). */
  t?: Record<string, unknown> | null;
  /** FDA product series records that name this MDL. */
  products?: unknown;
};

export type ProductRef = {
  dataset: string;
  id: string;
  product: string;
  sourceUrl: string | null;
  dataThrough: string | null;
};

export type MdlStatus =
  "pending" | "terminated" | "no_longer_listed" | "listed_after_closing_date" | "historical";

export const STATUS_LABEL: Record<MdlStatus, string> = {
  pending: "Pending",
  terminated: "Terminated",
  no_longer_listed: "No longer listed",
  listed_after_closing_date: "Listed after its closing date",
  historical: "Fiscal-year statistics only",
};

export type MdlAttributes = {
  mdl: string;
  title: string;
  status: MdlStatus;
  type: string | null;
  massTort: boolean | null;
  court: { id: string | null; label: string | null };
  judge: { name: string | null; href: string | null };
  dates: {
    motionFiled: string | null;
    centralized: string | null;
    closed: string | null;
    closedYear: number | null;
    closedSourceUrl: string | null;
  };
  products: ProductRef[];
};

const DAY_OR_NULL = (v: unknown) => {
  const s = str(v);
  return s && DAY.test(s) ? s : null;
};
const COURT_ID = /^[a-z0-9]{2,20}$/;
const PROFILE_ID = /^[0-9a-f]{32}$/;

function parseProducts(v: unknown): ProductRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .flatMap((p): ProductRef[] => {
      if (!p || typeof p !== "object") return [];
      const o = p as Record<string, unknown>;
      const dataset = str(o["dataset"]);
      const id = str(o["id"]);
      const product = str(o["product"]);
      if (!dataset || !id || !product) return [];
      const url = str(o["source_url"]);
      return [
        {
          dataset,
          id,
          product,
          sourceUrl: url && /^https?:\/\//.test(url) ? url : null,
          dataThrough: DAY_OR_NULL(o["data_through"]),
        },
      ];
    })
    .sort((a, b) => a.dataset.localeCompare(b.dataset) || a.id.localeCompare(b.id));
}

const STATUSES = new Set<MdlStatus>([
  "pending",
  "terminated",
  "no_longer_listed",
  "listed_after_closing_date",
]);

/**
 * One MDL's label fields, from its records in order of authority: the current `mdls` record (latest JPML report), then
 * the monthly-report history, then the analytics and fiscal-year tables. A judge links to a profile only when the MDL
 * record says its name matched that profile exactly.
 */
export function mdlAttributes(mdl: string, src: MdlSource): MdlAttributes {
  const m = src.m ?? null;
  const h = src.h ?? null;
  const a = src.a ?? null;
  const x = src.x ?? null;
  const t = src.t ?? null;
  const reported = !!(m || h || a);
  const rawStatus = str(m?.["status"]) ?? str(h?.["exit_status"]);
  const status: MdlStatus = !reported
    ? "historical"
    : rawStatus && STATUSES.has(rawStatus as MdlStatus)
      ? (rawStatus as MdlStatus)
      : m
        ? "pending"
        : "no_longer_listed";
  const courtId = str(m?.["cl_court_id"]);
  const profile = str(m?.["judge_profile_id"]);
  const exact = str(m?.["judge_match_kind"]) === "exact";
  const termYear = num(t?.["termination_year"]);
  return {
    mdl,
    title:
      str(m?.["title"]) ??
      str(h?.["title"]) ??
      str(a?.["title"]) ??
      str(x?.["caption"]) ??
      `MDL No. ${mdl}`,
    status,
    type: str(m?.["litigation_type"]) ?? str(h?.["type"]) ?? str(a?.["type"]),
    massTort: typeof a?.["mass_tort"] === "boolean" ? (a["mass_tort"] as boolean) : null,
    court: {
      id: courtId && COURT_ID.test(courtId) ? courtId : null,
      label:
        str(m?.["court_name"]) ??
        (str(h?.["district"]) ? `${str(h?.["district"])} (as printed by the JPML)` : null) ??
        str(x?.["district"]) ??
        str(t?.["district"]),
    },
    judge: {
      name: str(m?.["judge_name_as_printed"]) ?? str(h?.["judge"]) ?? str(x?.["judge"]),
      href: profile && exact && PROFILE_ID.test(profile) ? `/judges/${profile}` : null,
    },
    dates: {
      motionFiled: DAY_OR_NULL(h?.["date_filed"]),
      centralized: DAY_OR_NULL(m?.["date_transferred"]) ?? DAY_OR_NULL(h?.["date_transferred"]),
      closed: DAY_OR_NULL(m?.["date_closed"]) ?? DAY_OR_NULL(h?.["date_closed"]),
      closedYear:
        termYear !== null && Number.isInteger(termYear) && termYear > 1960 ? termYear : null,
      closedSourceUrl: (() => {
        const u = str(h?.["closed_url"]);
        return u && /^https?:\/\//.test(u) ? u : null;
      })(),
    },
    products: parseProducts(src.products),
  };
}

// ------------------------------------------------------------------------------------------------ links

export const mdlHref = (mdl: string) => `/matters/${mdl}`;
export const courtHref = (id: string | null) => (id ? `/courts/${id}` : null);
