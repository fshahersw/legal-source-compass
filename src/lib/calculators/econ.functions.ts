/**
 * Server functions behind the litigation calculators and the federal-awards company tab. Read-only reads of the
 * api-econ corpus datasets (econReads.server.ts); every input is validated; a dataset that is not published yet is
 * reported as unavailable, never filled with anything else.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SPEC_BY_ID } from "@/lib/ingest/sources/fredSpec";
import { fromTuple } from "@/lib/ingest/sources/fred";
import { econDatasets, econRows, usingStagedBuilds } from "./econReads.server";
import type { LifeGroup, LifeSex, LifeTable } from "./lifeExpectancy";
import type { SeriesObservations } from "./types";

export type FredRead = {
  series: SeriesObservations | null;
  /** Requested years without a stored row (no observations stored for that year). */
  missingYears: number[];
  staged: boolean;
  error: string | null;
};

const seriesId = z
  .string()
  .regex(/^[A-Z0-9]{2,30}$/)
  .refine((s) => SPEC_BY_ID.has(s), "unknown series");

async function readFred(id: string, years: number[]): Promise<FredRead> {
  const staged = usingStagedBuilds();
  try {
    const [head] = await econRows("econ_fred_series", { ids: [`fred:${id}`] });
    if (!head) return { series: null, missingYears: years, staged, error: null };
    const f = (head.item["fred"] ?? {}) as Record<string, unknown>;
    const rows = await econRows("econ_fred_observations", {
      ids: years.map((y) => `fred:${id}:${y}`),
    });
    const have = new Set(rows.map((r) => Number(r.id.split(":")[2])));
    const obs = rows
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .flatMap((r) =>
        ((r.item["fred"] as { obs?: unknown[] } | undefined)?.obs ?? []).map((t) =>
          fromTuple(t as never),
        ),
      )
      .filter((o): o is NonNullable<typeof o> => o !== null);
    return {
      series: {
        seriesId: id,
        label: String(f["label"] ?? SPEC_BY_ID.get(id)!.label),
        units: String(f["units_short"] ?? ""),
        frequency: String(f["frequency_short"] ?? ""),
        url: `https://fred.stlouisfed.org/series/${id}`,
        obs,
      },
      missingYears: years.filter((y) => !have.has(y)),
      staged,
      error: null,
    };
  } catch (error) {
    console.error("fred read failed", error instanceof Error ? error.message : error);
    return {
      series: null,
      missingYears: years,
      staged,
      error: "The economic series could not be read right now.",
    };
  }
}

/** Observations of one FRED series for the given calendar years (at most 12 years per call). */
export const getFredObservations = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        series: seriesId,
        years: z.array(z.number().int().min(1913).max(2100)).min(1).max(12),
      })
      .parse(d),
  )
  .handler(({ data }) => readFred(data.series, [...new Set(data.years)].sort()));

export type FredLatest = {
  available: boolean;
  staged: boolean;
  seriesId: string;
  label: string | null;
  units: string | null;
  latest: { date: string; value: string | null; vintage: string } | null;
  years: string[];
  lastUpdated: string | null;
  error: string | null;
};

/** A series' latest stored observation and the years it holds (defaults for the calculator forms). */
export const getFredLatest = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ series: seriesId }).parse(d))
  .handler(async ({ data }): Promise<FredLatest> => {
    const staged = usingStagedBuilds();
    try {
      const [head] = await econRows("econ_fred_series", { ids: [`fred:${data.series}`] });
      const f = (head?.item["fred"] ?? null) as Record<string, unknown> | null;
      const latest = f ? fromTuple((f["latest"] ?? null) as never) : null;
      return {
        available: !!head,
        staged,
        seriesId: data.series,
        label: f ? String(f["label"] ?? "") : null,
        units: f ? String(f["units_short"] ?? "") : null,
        latest: latest ? { date: latest.date, value: latest.value, vintage: latest.vintage } : null,
        years: Array.isArray(f?.["years"]) ? (f!["years"] as string[]) : [],
        lastUpdated: f ? String(f["last_updated"] ?? "") || null : null,
        error: null,
      };
    } catch {
      return {
        available: false,
        staged,
        seriesId: data.series,
        label: null,
        units: null,
        latest: null,
        years: [],
        lastUpdated: null,
        error: "The series could not be read right now.",
      };
    }
  });

export type LifeIndexEntry = {
  id: string;
  year: number;
  group: LifeGroup;
  sex: LifeSex;
  table: number;
  report: string;
};

export const getLifeTableIndex = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ entries: LifeIndexEntry[]; staged: boolean; error: string | null }> => {
    const staged = usingStagedBuilds();
    try {
      const rows = await econRows("econ_nchs_life_tables", { fields: "cells", limit: 500 });
      const entries = rows.map((r) => {
        const [, y, n] = r.id.split(":");
        const c = (r.item["cells"] ?? {}) as Record<string, string>;
        return {
          id: r.id,
          year: Number(y),
          table: Number(n),
          group: groupKey(c["group"]),
          sex: sexKey(c["sex"]),
          report: c["report"] ?? "",
        };
      });
      return {
        entries: entries.filter((e) => e.group && e.sex) as LifeIndexEntry[],
        staged,
        error: null,
      };
    } catch {
      return { entries: [], staged, error: "The life tables could not be read right now." };
    }
  },
);

const GROUP_BY_LABEL: Record<string, LifeGroup> = {
  "Total population": "total",
  Hispanic: "hispanic",
  "Non-Hispanic White": "nh_white",
  "Non-Hispanic Black": "nh_black",
  "Non-Hispanic Asian": "nh_asian",
  "Non-Hispanic American Indian and Alaska Native": "nh_aian",
};
const groupKey = (label: string | undefined) => (label ? GROUP_BY_LABEL[label] : undefined);
const sexKey = (label: string | undefined): LifeSex | undefined =>
  label === "Both sexes"
    ? "total"
    : label === "Male"
      ? "male"
      : label === "Female"
        ? "female"
        : undefined;

export const getLifeTable = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^nchs-lt:\d{4}:\d{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<{ table: LifeTable | null; error: string | null }> => {
    try {
      const [r] = await econRows("econ_nchs_life_tables", { ids: [data.id] });
      const lt = r?.item["lifetable"] as Record<string, unknown> | undefined;
      if (!lt) return { table: null, error: null };
      return {
        table: {
          year: Number(lt["year"]),
          report: String(lt["report"]),
          reportUrl: String(lt["report_url"]),
          table: Number(lt["table"]),
          title: String(lt["title"]),
          group: lt["group"] as LifeGroup,
          sex: lt["sex"] as LifeSex,
          rows: lt["rows"] as string[][],
          sourceUrl: String(lt["source_url"]),
        },
        error: null,
      };
    } catch {
      return { table: null, error: "The life table could not be read right now." };
    }
  });

export type StateRate = {
  id: string;
  state: string;
  kind: "prejudgment" | "postjudgment";
  appliesTo: string;
  provision: string;
  rateType: string;
  ratePercent: string | null;
  publisher: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  accruesFrom: string | null;
  quote: string;
  note: string | null;
  sourceUrl: string;
  retrievedAt: string;
};

export const getStateRates = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ rates: StateRate[]; available: boolean; error: string | null }> => {
    try {
      const rows = await econRows("econ_state_judgment_rates", { limit: 500 });
      const rates = rows.map((r) => {
        const x = (r.item["rate"] ?? {}) as Record<string, string | null>;
        return {
          id: r.id,
          state: String(x["state"]),
          kind: x["kind"] as StateRate["kind"],
          appliesTo: String(x["applies_to"] ?? ""),
          provision: String(x["provision"] ?? ""),
          rateType: String(x["rate_type"] ?? ""),
          ratePercent: x["rate_percent"] ?? null,
          publisher: x["publisher"] ?? null,
          effectiveFrom: x["effective_from"] ?? null,
          effectiveTo: x["effective_to"] ?? null,
          accruesFrom: x["accrues_from"] ?? null,
          quote: String(x["quote"] ?? ""),
          note: x["note"] ?? null,
          sourceUrl: String(x["source_url"] ?? r.source_url ?? ""),
          retrievedAt: String(x["retrieved_at"] ?? ""),
        };
      });
      return { rates, available: rows.length > 0, error: null };
    } catch {
      return { rates: [], available: false, error: "The state rates could not be read right now." };
    }
  },
);

export type CompanyAwards = {
  available: boolean;
  rows: {
    id: string;
    name: string;
    uei: string;
    total: number | null;
    fiscalYears: { fiscal_year: string; total: number }[];
    topAwards: Record<
      string,
      {
        award_id: string;
        amount: number | null;
        agency: string | null;
        start: string | null;
        end: string | null;
        description: string | null;
        url: string;
      }[]
    >;
    url: string;
  }[];
  error: string | null;
};

/** Federal awards linked to an SEC company by an official identifier crosswalk (exact CIK; never by name). */
export const getCompanyFederalAwards = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ cik: z.string().regex(/^\d{10}$/) }).parse(d))
  .handler(async ({ data }): Promise<CompanyAwards> => {
    try {
      const status = await econDatasets();
      if (!status["company_federal_awards"]) return { available: false, rows: [], error: null };
      const rows = await econRows("company_federal_awards", {
        itemContains: { awards: { sec: [{ cik: data.cik }] } },
        limit: 50,
      });
      return {
        available: true,
        rows: rows.map((r) => {
          const a = (r.item["awards"] ?? {}) as Record<string, unknown>;
          return {
            id: r.id,
            name: String(a["name"] ?? r.title),
            uei: String(a["uei"] ?? ""),
            total:
              typeof a["total_obligations"] === "number"
                ? (a["total_obligations"] as number)
                : null,
            fiscalYears: (a["fiscal_years"] as { fiscal_year: string; total: number }[]) ?? [],
            topAwards: (a["top_awards"] as CompanyAwards["rows"][number]["topAwards"]) ?? {},
            url: r.source_url ?? "",
          };
        }),
        error: null,
      };
    } catch {
      return { available: false, rows: [], error: "Federal awards could not be read right now." };
    }
  });

export const getEconStatus = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return {
      datasets: await econDatasets(),
      staged: usingStagedBuilds(),
      error: null as string | null,
    };
  } catch {
    return {
      datasets: {} as Awaited<ReturnType<typeof econDatasets>>,
      staged: usingStagedBuilds(),
      error: "Dataset status could not be read.",
    };
  }
});
