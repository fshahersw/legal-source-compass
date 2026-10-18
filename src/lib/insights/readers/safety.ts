/**
 * Product safety reads: FAERS (fda_faers_national_series, fda_faers_product_series), MAUDE (fda_device_event_series),
 * CAERS (fda_caers_series), CPSC (regulatory_cpsc_aggregates) and NHTSA complaint trends
 * (agency_safety_nhtsa_complaint_trends). Each returns null when its dataset has nothing usable.
 */
import { restGet } from "@/lib/external/rest.server";
import { parseCpsc, type CpscAnalytics } from "@/lib/external/enforcement.functions";
import type {
  CaersInput,
  FaersInput,
  MaudeInput,
  MaudeYear,
  NhtsaInput,
  ReportYear,
} from "../generators/safety";
import { memoAsync, READ_TTL_MS } from "./cache";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function parseYears(raw: unknown): ReportYear[] {
  return arr(raw).flatMap((p) => {
    const o = obj(p);
    const year = num(o?.["year"]);
    const reports = num(o?.["reports"]);
    return o && year != null && Number.isInteger(year) && reports != null
      ? [
          {
            year,
            reports,
            partial: o["partial"] === true,
            deaths: num(o["deaths"]),
            serious: num(o["serious"]),
            lawyer: num(o["lawyer"]),
          },
        ]
      : [];
  });
}

export function parseMaudeYears(raw: unknown): MaudeYear[] {
  return arr(raw).flatMap((p) => {
    const o = obj(p);
    const base = parseYears([p])[0];
    const death = num(o?.["death"]);
    const injury = num(o?.["injury"]);
    const malfunction = num(o?.["malfunction"]);
    return o && base && death != null && injury != null && malfunction != null
      ? [{ ...base, death, injury, malfunction }]
      : [];
  });
}

const peakOf = (v: unknown) => {
  const o = obj(v);
  const year = num(o?.["year"]);
  const reports = num(o?.["reports"]);
  return year != null && reports != null ? { year, reports } : null;
};

type ProductRow = { id: string; product: unknown; mdl: unknown; series: unknown; peak: unknown };

export const readFaers = memoAsync<FaersInput | null>(READ_TTL_MS, async () => {
  const [national, products] = await Promise.all([
    restGet<{ series: unknown; dt: unknown }[]>(
      "corpus_records?select=series:item->series,dt:item->>data_through&dataset=eq.fda_faers_national_series&id=eq.all_years&limit=1",
    ),
    restGet<ProductRow[]>(
      "corpus_records?select=id,product:item->>product,mdl:item->mdl,series:item->series,peak:item->peak&dataset=eq.fda_faers_product_series&order=ordinal.asc&limit=200",
    ),
  ]);
  const years = parseYears(national.rows[0]?.series);
  if (!years.length) return null;
  return {
    dataThrough: str(national.rows[0]?.dt),
    national: years,
    products: products.rows.flatMap((r) => {
      const product = str(r.product);
      const series = parseYears(r.series);
      return product && series.length
        ? [{ id: r.id, product, mdl: num(r.mdl), years: series, peak: peakOf(r.peak) }]
        : [];
    }),
  };
});

export const readMaude = memoAsync<MaudeInput | null>(READ_TTL_MS, async () => {
  const [national, devices] = await Promise.all([
    restGet<{ total: unknown; mix: unknown; series: unknown; dt: unknown }[]>(
      "corpus_records?select=total:item->total,mix:item->event_mix,series:item->series,dt:item->>data_through&dataset=eq.fda_device_event_series&id=eq.national&limit=1",
    ),
    restGet<ProductRow[]>(
      "corpus_records?select=id,product:item->>product,mdl:item->mdl,series:item->series,peak:item->peak&dataset=eq.fda_device_event_series&id=neq.national&order=ordinal.asc&limit=200",
    ),
  ]);
  const row = national.rows[0];
  const years = parseMaudeYears(row?.series);
  if (!row || !years.length) return null;
  return {
    dataThrough: str(row.dt),
    total: num(row.total),
    mix: arr(row.mix).flatMap((m) => {
      const o = obj(m);
      const label = str(o?.["label"]);
      const count = num(o?.["count"]);
      const share = num(o?.["share"]);
      return o && label && count != null && share != null ? [{ label, count, share }] : [];
    }),
    national: years,
    devices: devices.rows.flatMap((r) => {
      const product = str(r.product);
      const series = parseYears(r.series);
      return product && series.length
        ? [{ id: r.id, product, mdl: num(r.mdl), years: series, peak: peakOf(r.peak) }]
        : [];
    }),
  };
});

export const readCaers = memoAsync<CaersInput | null>(READ_TTL_MS, async () => {
  const rows = await restGet<
    {
      id: string;
      kind: unknown;
      point: unknown;
      total: unknown;
      name: unknown;
      reports: unknown;
      dt: unknown;
    }[]
  >(
    "corpus_records?select=id,kind:item->>kind,point:item->point,total:item->total,name:item->>name,reports:item->reports,dt:item->>data_through&dataset=eq.fda_caers_series&limit=1000",
  );
  const years = rows.rows.flatMap((r) => (r.kind === "caers_year" ? parseYears([r.point]) : []));
  if (!years.length) return null;
  const all = rows.rows.find((r) => r.id === "all_years");
  return {
    dataThrough: str(all?.dt) ?? str(rows.rows.find((r) => r.kind === "caers_year")?.dt),
    total: num(all?.total),
    years,
    industries: rows.rows.flatMap((r) => {
      const name = str(r.name);
      const reports = num(r.reports);
      return r.kind === "caers_industry" && name && reports != null ? [{ name, reports }] : [];
    }),
  };
});

export const readCpsc = memoAsync<CpscAnalytics | null>(READ_TTL_MS, async () => {
  const aggs = await restGet<{ a: unknown }[]>(
    "corpus_records?select=a:item->agg&dataset=eq.regulatory_cpsc_aggregates&id=not.like.cpsc-agg:firm:*&order=ordinal.asc&limit=1000",
  );
  return parseCpsc(
    aggs.rows.map((r) => r.a),
    [],
  );
});

export const readNhtsa = memoAsync<NhtsaInput | null>(READ_TTL_MS, async () => {
  const rows = await restGet<
    { make: unknown; component: unknown; total: unknown; years: unknown }[]
  >(
    "corpus_records?select=make:item->trend->>make,component:item->trend->>component,total:item->trend->total,years:item->trend->years&dataset=eq.agency_safety_nhtsa_complaint_trends&order=ordinal.asc&limit=1000",
  );
  const parsed = rows.rows.flatMap((r) => {
    const make = str(r.make);
    const component = str(r.component);
    const total = num(r.total);
    const yearsObj = obj(r.years);
    if (!make || !component || total == null || !yearsObj) return [];
    const years: Record<string, number> = {};
    for (const [y, v] of Object.entries(yearsObj))
      if (/^\d{4}$/.test(y) && num(v) != null) years[y] = v as number;
    return Object.keys(years).length ? [{ make, component, total, years }] : [];
  });
  if (!parsed.length) return null;
  // The file's final year is still filling in (the file name spans "2025-2026"), so the year before it is the last complete one.
  const latest = Math.max(...parsed.flatMap((r) => Object.keys(r.years).map(Number)));
  return { latestCompleteYear: latest - 1, rows: parsed };
});
