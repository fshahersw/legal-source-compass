/**
 * CPSC NEISS weighted national estimates (neiss_national_years, neiss_product_estimates, neiss_injury_dimensions,
 * neiss_narrative_themes), built by scripts/enrichment/neiss from the public-use annual files.
 *
 * Every figure is a WEIGHTED national estimate of emergency-department-treated injuries associated with a product,
 * with a coefficient of variation and a 95% interval. Unweighted sample case counts are never national estimates.
 * CPSC's unstable rule (estimate below 1,200, fewer than 20 sample cases, or CV above 33%) withholds an estimate: only
 * the unweighted sample count is kept. In 2024 CPSC re-stratified the sample, so comparisons across 2023 and 2024 mix
 * two designs. No case-level row exists in these datasets. Malformed rows are dropped here, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const nonNeg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
const codeStr = (v: unknown) =>
  typeof v === "string" && v.trim()
    ? v
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;

// ------------------------------------------------------------------------------------------ types

/** A weighted estimate, withheld by CPSC's unstable rule, or absent (no sample case at all). */
export type NeissFigure =
  | { state: "estimate"; estimate: number; cvPct: number; ci95: [number, number]; cases: number }
  | { state: "withheld"; cases: number; reasons: string[] }
  | { state: "none" };

export type NeissYear = {
  year: number;
  estimate: number;
  cvPct: number;
  ci95: [number, number];
  /** Unweighted sample cases: a count of records in the sample, never a national estimate. */
  cases: number;
  hospitals: number | null;
  admittedPct: { pct: number; ciLow: number; ciHigh: number } | null;
  /** Change on the previous year; `exceedsSamplingError` is CPSC-style 1.96 x SE test (conservative). */
  change: { differenceFromPrevious: number; pct: number; exceedsSamplingError: boolean } | null;
};

export type NeissDesignBreak = {
  /** First year of the new sample design (2024). */
  year: number;
  hospitalsBefore: number | null;
  hospitalsAfter: number | null;
  inBothYears: number | null;
  changedStratum: number | null;
  strataBefore: Record<string, number>;
  strataAfter: Record<string, number>;
  text: string | null;
};

export type NeissTopProduct = {
  code: string;
  label: string;
  estimate: number;
  cvPct: number;
  ci95: [number, number] | null;
  cases: number | null;
  sharePct: number | null;
};

export type NeissNational = {
  years: NeissYear[];
  latestYear: number;
  designBreak: NeissDesignBreak | null;
  topProducts: NeissTopProduct[];
  reliability: { reliable: number; withheld: number; noCases: number; total: number } | null;
  credit: string | null;
  caveats: string | null;
  reliabilityRule: string | null;
  sourceUrls: string[];
};

export type NeissProductStatus = "current" | "retired" | "unknown";

export type NeissProduct = {
  code: string;
  label: string;
  status: NeissProductStatus;
  latest: NeissFigure | null;
  pooled: NeissFigure | null;
  /** 2025 against 2024; present only when both years are reliable estimates. */
  change: { differenceFromPrevious: number; pct: number; exceedsSamplingError: boolean } | null;
  /** Reliable annual estimates aligned to `NeissProducts.years`; null where withheld or absent. */
  spark: (number | null)[];
  firstYear: number | null;
  lastYear: number | null;
};

export type NeissProducts = {
  latestYear: number;
  years: number[];
  designBreakYear: number | null;
  rows: NeissProduct[];
  credit: string | null;
};

export type NeissTheme = {
  id: string;
  label: string;
  description: string | null;
  latest: NeissFigure | null;
  latestYear: number | null;
  pooled: NeissFigure | null;
  /** First year whose narratives are comparable with later ones (narratives were short before 2019). */
  comparableFrom: number | null;
  years: number[];
  spark: (number | null)[];
  relatedCodes: { code: string; label: string | null }[];
};

export type NeissThemes = {
  themes: NeissTheme[];
  classification: string | null;
  credit: string | null;
};

export type NeissDimension =
  "sex" | "age_group" | "body_part" | "diagnosis" | "disposition" | "location" | "month";

export const NEISS_DIMENSIONS: { id: NeissDimension; label: string }[] = [
  { id: "body_part", label: "Body part" },
  { id: "diagnosis", label: "Diagnosis" },
  { id: "disposition", label: "Disposition" },
  { id: "location", label: "Location" },
  { id: "age_group", label: "Age group" },
  { id: "sex", label: "Sex" },
  { id: "month", label: "Month" },
];

export type NeissInjuryRow = {
  id: string;
  dimension: NeissDimension;
  code: string;
  label: string;
  latest: NeissFigure | null;
  latestYear: number | null;
  pooled: NeissFigure | null;
  /** Share of all pooled 2021-2025 injuries, percent units. */
  pooledSharePct: number | null;
  /** Share admitted to hospital (pooled); "na" for the disposition dimension, null when withheld or absent. */
  admittedPct: { pct: number; ciLow: number; ciHigh: number } | "na" | null;
  topProducts: NeissTopProduct[];
};

export type NeissInjuries = {
  rows: NeissInjuryRow[];
  latestYear: number | null;
  credit: string | null;
};

// ---------------------------------------------------------------------------------------- parsers

function pair(raw: unknown): [number, number] | null {
  const a = arr(raw);
  const lo = num(a[0]);
  const hi = num(a[1]);
  return lo != null && hi != null && lo <= hi ? [lo, hi] : null;
}

/**
 * One stored estimate object ({estimate, cv, ci95, cases, reliable, reasons}). It is shown as an estimate only when the
 * dataset marked it reliable and carries every number; otherwise only the unweighted sample count survives.
 */
export function parseFigure(raw: unknown): NeissFigure | null {
  const f = obj(raw);
  if (!f) return null;
  const estimate = num(f["estimate"]);
  const cv = num(f["cv"]);
  const ci = pair(f["ci95"]);
  const cases = nonNeg(f["cases"]);
  if (f["reliable"] === true) {
    // A record marked reliable must carry every number; a malformed one is dropped, never shown as withheld.
    return estimate != null && estimate >= 0 && cv != null && cv >= 0 && ci && cases != null
      ? { state: "estimate", estimate, cvPct: cv * 100, ci95: ci, cases }
      : null;
  }
  if (f["reliable"] !== false || cases == null) return null;
  if (cases === 0) return { state: "none" };
  return {
    state: "withheld",
    cases,
    reasons: arr(f["reasons"]).flatMap((r) => {
      const s = strOrNull(r);
      return s ? [s] : [];
    }),
  };
}

function parseShare(raw: unknown): { pct: number; ciLow: number; ciHigh: number } | null {
  const s = obj(raw);
  const share = num(s?.["share"]);
  const ci = pair(s?.["ci95"]);
  return s?.["reliable"] === true && share != null && ci
    ? { pct: share * 100, ciLow: ci[0] * 100, ciHigh: ci[1] * 100 }
    : null;
}

function parseChange(raw: unknown): NeissYear["change"] {
  const c = obj(raw);
  const difference = num(c?.["difference"]);
  const percent = num(c?.["percent"]);
  if (!c || difference == null || percent == null) return null;
  return {
    differenceFromPrevious: difference,
    pct: percent * 100,
    exceedsSamplingError: c["exceeds_sampling_error"] === true,
  };
}

function parseStrata(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw) ?? {})) {
    const n = nonNeg(v);
    if (n != null) out[k] = n;
  }
  return out;
}

export function parseDesignBreak(raw: unknown, text: unknown): NeissDesignBreak | null {
  const d = obj(raw);
  if (!d) return null;
  // The break year is the later of the two `hospitals_<year>` keys the dataset records (2023 and 2024).
  const years = Object.keys(d)
    .map((k) => /^hospitals_(\d{4})$/.exec(k)?.[1])
    .flatMap((y) => (y ? [Number(y)] : []))
    .sort((a, b) => a - b);
  const year = years.at(-1);
  const before = years.at(-2);
  if (year == null || before == null) return null;
  return {
    year,
    hospitalsBefore: nonNeg(d[`hospitals_${before}`]),
    hospitalsAfter: nonNeg(d[`hospitals_${year}`]),
    inBothYears: nonNeg(d["in_both_years"]),
    changedStratum: nonNeg(d["changed_stratum"]),
    strataBefore: parseStrata(d[`strata_${before}`]),
    strataAfter: parseStrata(d[`strata_${year}`]),
    text: strOrNull(text),
  };
}

export function parseTopProducts(raw: unknown): NeissTopProduct[] {
  return arr(raw).flatMap((p) => {
    const r = obj(p);
    const code = codeStr(r?.["code"]);
    const label = strOrNull(r?.["label"]);
    const estimate = num(r?.["estimate"]);
    const cv = num(r?.["cv"]);
    // A product in a "top" list is shown only with a reliable estimate; anything else is dropped, not guessed.
    if (!r || !code || !label || r["reliable"] !== true || estimate == null || cv == null)
      return [];
    const share = num(r["share"]);
    return [
      {
        code,
        label,
        estimate,
        cvPct: cv * 100,
        ci95: pair(r["ci95"]),
        cases: nonNeg(r["cases"]),
        sharePct: share != null ? share * 100 : null,
      },
    ];
  });
}

export function parseNeissYears(raw: unknown): NeissYear[] {
  const out: NeissYear[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const year = num(r?.["year"]);
    const estimate = num(r?.["estimate"]);
    const cv = num(r?.["cv"]);
    const ci = pair(r?.["ci95"]);
    const cases = nonNeg(r?.["cases"]);
    if (
      !r ||
      year == null ||
      !Number.isInteger(year) ||
      estimate == null ||
      cv == null ||
      !ci ||
      cases == null
    )
      continue;
    out.push({
      year,
      estimate,
      cvPct: cv * 100,
      ci95: ci,
      cases,
      hospitals: nonNeg(r["hospitals"]),
      admittedPct: parseShare(r["admitted_share"]),
      change: parseChange(r["change_from_previous_year"]),
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

export type NeissMeta = {
  designBreakText: string | null;
  credit: string | null;
  caveats: string | null;
  reliabilityRule: string | null;
  classification: string | null;
  sourceUrls: string[];
};

export function parseNeissMeta(raw: unknown): NeissMeta {
  const m = obj(raw);
  return {
    designBreakText: strOrNull(m?.["design_break"]),
    credit: strOrNull(m?.["credit"]),
    caveats: strOrNull(m?.["caveats"]),
    reliabilityRule: strOrNull(m?.["reliability_rule"]),
    classification: strOrNull(m?.["classification"]),
    sourceUrls: arr(m?.["source_urls"]).flatMap((u) => {
      const s = strOrNull(u);
      return s && /^https?:\/\//.test(s) ? [s] : [];
    }),
  };
}

export function parseNeissNational(input: {
  series: unknown;
  designBreak: unknown;
  meta: unknown;
  topProducts: unknown;
  reliability: { reliable: number | null; withheld: number | null; noCases: number | null } | null;
  total: number | null;
}): NeissNational | null {
  const years = parseNeissYears(input.series);
  if (!years.length) return null;
  const meta = parseNeissMeta(input.meta);
  const rel = input.reliability;
  return {
    years,
    latestYear: years[years.length - 1]!.year,
    designBreak: parseDesignBreak(input.designBreak, meta.designBreakText),
    topProducts: parseTopProducts(input.topProducts),
    reliability:
      rel &&
      rel.reliable != null &&
      rel.withheld != null &&
      rel.noCases != null &&
      input.total != null
        ? {
            reliable: rel.reliable,
            withheld: rel.withheld,
            noCases: rel.noCases,
            total: input.total,
          }
        : null,
    credit: meta.credit,
    caveats: meta.caveats,
    reliabilityRule: meta.reliabilityRule,
    sourceUrls: meta.sourceUrls,
  };
}

function statusOf(raw: unknown, inUse: unknown, cmp: unknown): NeissProductStatus {
  const s = strOrNull(raw);
  if (s === "current" || s === "retired" || s === "unknown") return s;
  if (inUse === true) return "current";
  if (inUse === false || obj(cmp)?.["deleted"] === true) return "retired";
  return "unknown";
}

export function parseNeissProducts(input: {
  rows: {
    id?: unknown;
    cells?: unknown;
    label?: unknown;
    inUse?: unknown;
    cmp?: unknown;
    status?: unknown;
    latest?: unknown;
    pooled?: unknown;
    lvp?: unknown;
  }[];
  annual: { id?: unknown; annual?: unknown }[];
  designBreakYear: number | null;
  credit: unknown;
}): NeissProducts | null {
  const annualById = new Map<string, { year: number; fig: NeissFigure | null }[]>();
  const yearSet = new Set<number>();
  for (const a of input.annual) {
    const id = strOrNull(a.id);
    if (!id) continue;
    const points = arr(a.annual).flatMap((e) => {
      const year = num(obj(e)?.["year"]);
      if (year == null || !Number.isInteger(year)) return [];
      yearSet.add(year);
      return [{ year, fig: parseFigure(e) }];
    });
    annualById.set(id, points);
  }
  const years = [...yearSet].sort((x, y) => x - y);
  let latestYear = 0;
  const rows: NeissProduct[] = [];
  for (const r of input.rows) {
    const code = codeStr(r.id);
    const c = obj(r.cells);
    const label = strOrNull(r.label) ?? strOrNull(c?.["product"]);
    if (!code || !c || !label) continue;
    const ly = num(c["latest_year"]);
    if (ly != null) latestYear = Math.max(latestYear, ly);
    const latest = parseFigure(r.latest);
    const points = annualById.get(code) ?? [];
    const byYear = new Map(points.map((p) => [p.year, p.fig]));
    const lvp = parseChange(r.lvp);
    // A change is flagged only between two RELIABLE estimates; an unreliable year yields no comparison at all.
    const prev = ly != null ? byYear.get(ly - 1) : undefined;
    const bothReliable = latest?.state === "estimate" && prev?.state === "estimate";
    rows.push({
      code,
      label,
      status: statusOf(r.status, r.inUse, r.cmp),
      latest,
      pooled: parseFigure(r.pooled),
      change: lvp && bothReliable ? lvp : null,
      spark: years.map((y) => {
        const fig = byYear.get(y);
        return fig?.state === "estimate" ? fig.estimate : null;
      }),
      firstYear: nonNeg(c["first_year"]),
      lastYear: nonNeg(c["last_year"]),
    });
  }
  if (!rows.length || !latestYear) return null;
  return {
    latestYear,
    years,
    designBreakYear: input.designBreakYear,
    rows,
    credit: strOrNull(input.credit),
  };
}

export function parseNeissThemes(input: {
  rows: {
    id?: unknown;
    cells?: unknown;
    label?: unknown;
    description?: unknown;
    annual?: unknown;
    pooled?: unknown;
    comparable?: unknown;
    related?: unknown;
  }[];
  meta: unknown;
}): NeissThemes | null {
  const meta = parseNeissMeta(input.meta);
  const themes = input.rows.flatMap((r) => {
    const id = strOrNull(r.id);
    const c = obj(r.cells);
    const label = strOrNull(r.label) ?? strOrNull(c?.["theme"]);
    if (!id || !label) return [];
    const entries = arr(r.annual).flatMap((e) => {
      const year = num(obj(e)?.["year"]);
      return year != null && Number.isInteger(year) ? [{ year, fig: parseFigure(e) }] : [];
    });
    entries.sort((a, b) => a.year - b.year);
    const last = entries.at(-1);
    return [
      {
        id,
        label,
        description: strOrNull(r.description),
        latest: last?.fig ?? null,
        latestYear: last?.year ?? null,
        pooled: parseFigure(r.pooled),
        comparableFrom: num(r.comparable),
        years: entries.map((e) => e.year),
        spark: entries.map((e) => (e.fig?.state === "estimate" ? e.fig.estimate : null)),
        relatedCodes: arr(r.related).flatMap((x) => {
          const o = obj(x);
          const code = codeStr(o?.["code"]);
          return code ? [{ code, label: strOrNull(o?.["label"]) }] : [];
        }),
      },
    ];
  });
  if (!themes.length) return null;
  return { themes, classification: meta.classification, credit: meta.credit };
}

const DIMENSIONS = new Set<string>(NEISS_DIMENSIONS.map((d) => d.id));

export function parseNeissInjuries(input: {
  rows: {
    id?: unknown;
    dimension?: unknown;
    code?: unknown;
    label?: unknown;
    annual?: unknown;
    pooled?: unknown;
    top?: unknown;
  }[];
  meta: unknown;
}): NeissInjuries | null {
  const parsed = input.rows.flatMap((r) => {
    const id = strOrNull(r.id);
    const dimension = strOrNull(r.dimension);
    const code = codeStr(r.code);
    const label = strOrNull(r.label);
    if (!id || !dimension || !DIMENSIONS.has(dimension) || !code || !label) return [];
    const entries = arr(r.annual).flatMap((e) => {
      const year = num(obj(e)?.["year"]);
      return year != null && Number.isInteger(year) ? [{ year, fig: parseFigure(e) }] : [];
    });
    return [{ r, id, dimension, code, label, entries }];
  });
  // The latest year is the newest year ANY value has a record for; a value whose series stops earlier (a retired
  // code) has no sample case in the latest year and must not borrow its last older year.
  const latestYear = parsed.reduce<number | null>(
    (max, p) => p.entries.reduce((m, e) => (m == null || e.year > m ? e.year : m), max),
    null,
  );
  const rows = parsed.flatMap(({ r, id, dimension, code, label, entries }): NeissInjuryRow[] => {
    const atLatest = entries.find((e) => e.year === latestYear);
    const pooled = obj(r.pooled);
    const share = num(pooled?.["share_of_all"]);
    const hasAdmitted = pooled != null && "admitted_to_hospital" in pooled;
    return [
      {
        id,
        dimension: dimension as NeissDimension,
        code,
        label,
        latest: atLatest ? atLatest.fig : latestYear != null ? { state: "none" } : null,
        latestYear,
        pooled: parseFigure(pooled?.["total"]),
        pooledSharePct: share != null ? share * 100 : null,
        admittedPct:
          dimension === "disposition"
            ? "na"
            : hasAdmitted
              ? parseShare(pooled?.["admitted_to_hospital"])
              : null,
        topProducts: parseTopProducts(r.top).slice(0, 5),
      },
    ];
  });
  if (!rows.length) return null;
  return { rows, latestYear, credit: parseNeissMeta(input.meta).credit };
}

// ----------------------------------------------------------------------------------- server fns

const TTL = 10 * 60 * 1000;
const PRODUCTS = "neiss_product_estimates";
const META_SELECT =
  "design_break:metadata->summary->design_break,credit:metadata->summary->credit,caveats:metadata->summary->caveats,reliability_rule:metadata->summary->reliability_rule,source_urls:metadata->summary->source_urls";

let nationalCache: { at: number; value: NeissNational } | null = null;
let productsCache: { at: number; value: NeissProducts } | null = null;
let themesCache: { at: number; value: NeissThemes } | null = null;
let injuriesCache: { at: number; value: NeissInjuries } | null = null;

async function countProducts(filter: string): Promise<number | null> {
  const res = await restGet<unknown[]>(
    `corpus_records?select=id&dataset=eq.${PRODUCTS}&${filter}`,
    { count: true, range: [0, 0] },
  );
  return res.total;
}

export const getNeissNational = createServerFn({ method: "GET" }).handler(
  async (): Promise<NeissNational | null> => {
    if (nationalCache && Date.now() - nationalCache.at < TTL) return nationalCache.value;
    const [series, meta, reliable, withheld, noCases, total] = await Promise.all([
      restGet<{ series: unknown; design_break: unknown }[]>(
        "corpus_records?select=series:item->series,design_break:item->design_break&dataset=eq.neiss_national_years&id=eq.series&limit=1",
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_datasets?select=${META_SELECT}&id=eq.neiss_national_years&limit=1`,
      ),
      countProducts("filters->latest->>0=eq.stable_latest"),
      countProducts("filters->latest->>0=eq.unstable_latest"),
      countProducts("filters->latest->>0=eq.not_observed_latest"),
      countProducts("id=not.is.null"),
    ]);
    const years = parseNeissYears(series.rows[0]?.series);
    const latestYear = years.at(-1)?.year;
    // The latest year's record carries its top products; it is read only once the series names that year.
    const top =
      latestYear != null
        ? await restGet<{ top: unknown }[]>(
            `corpus_records?select=top:item->year->top_products&dataset=eq.neiss_national_years&id=eq.${latestYear}&limit=1`,
          )
        : { rows: [] as { top: unknown }[] };
    const value = parseNeissNational({
      series: series.rows[0]?.series,
      designBreak: series.rows[0]?.design_break,
      meta: meta.rows[0],
      topProducts: top.rows[0]?.top,
      reliability: { reliable, withheld, noCases },
      total,
    });
    if (value) nationalCache = { at: Date.now(), value };
    return value;
  },
);

export const getNeissProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<NeissProducts | null> => {
    if (productsCache && Date.now() - productsCache.at < TTL) return productsCache.value;
    const [rows, annual, meta, national] = await Promise.all([
      restGet<Parameters<typeof parseNeissProducts>[0]["rows"]>(
        `corpus_records?select=id,cells:item->cells,label:item->product->label,inUse:item->product->in_use,cmp:item->product->comparability_table,status:filters->code_status->0,latest:item->product->latest_year,pooled:item->product->pooled->total,lvp:item->product->latest_vs_previous&dataset=eq.${PRODUCTS}&order=ordinal.asc&limit=2000`,
      ),
      // Annual series only for products with a reliable latest estimate: those are the rows that draw a trend.
      restGet<Parameters<typeof parseNeissProducts>[0]["annual"]>(
        `corpus_records?select=id,annual:item->product->annual&dataset=eq.${PRODUCTS}&filters->latest->>0=eq.stable_latest&order=ordinal.asc&limit=2000`,
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_datasets?select=${META_SELECT}&id=eq.${PRODUCTS}&limit=1`,
      ),
      restGet<{ design_break: unknown }[]>(
        "corpus_records?select=design_break:item->design_break&dataset=eq.neiss_national_years&id=eq.series&limit=1",
      ),
    ]);
    const value = parseNeissProducts({
      rows: rows.rows,
      annual: annual.rows,
      designBreakYear: parseDesignBreak(national.rows[0]?.design_break, null)?.year ?? null,
      credit: parseNeissMeta(meta.rows[0]).credit,
    });
    if (value) productsCache = { at: Date.now(), value };
    return value;
  },
);

export const getNeissThemes = createServerFn({ method: "GET" }).handler(
  async (): Promise<NeissThemes | null> => {
    if (themesCache && Date.now() - themesCache.at < TTL) return themesCache.value;
    const [rows, meta] = await Promise.all([
      restGet<Parameters<typeof parseNeissThemes>[0]["rows"]>(
        "corpus_records?select=id,cells:item->cells,label:item->theme->label,description:item->theme->description,annual:item->theme->annual,pooled:item->theme->pooled->total,comparable:item->theme->comparable_from_year,related:item->theme->related_product_codes&dataset=eq.neiss_narrative_themes&order=ordinal.asc&limit=100",
      ),
      restGet<Record<string, unknown>[]>(
        "corpus_datasets?select=classification:metadata->summary->classification,credit:metadata->summary->credit&id=eq.neiss_narrative_themes&limit=1",
      ),
    ]);
    const value = parseNeissThemes({ rows: rows.rows, meta: meta.rows[0] });
    if (value) themesCache = { at: Date.now(), value };
    return value;
  },
);

export const getNeissInjuries = createServerFn({ method: "GET" }).handler(
  async (): Promise<NeissInjuries | null> => {
    if (injuriesCache && Date.now() - injuriesCache.at < TTL) return injuriesCache.value;
    const [rows, meta] = await Promise.all([
      restGet<Parameters<typeof parseNeissInjuries>[0]["rows"]>(
        "corpus_records?select=id,dimension:item->dimension->dimension,code:item->dimension->code,label:item->dimension->label,annual:item->dimension->annual,pooled:item->dimension->pooled,top:item->dimension->top_products&dataset=eq.neiss_injury_dimensions&order=ordinal.asc&limit=500",
      ),
      restGet<Record<string, unknown>[]>(
        "corpus_datasets?select=credit:metadata->summary->credit&id=eq.neiss_injury_dimensions&limit=1",
      ),
    ]);
    const value = parseNeissInjuries({ rows: rows.rows, meta: meta.rows[0] });
    if (value) injuriesCache = { at: Date.now(), value };
    return value;
  },
);
