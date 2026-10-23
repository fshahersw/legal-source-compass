/**
 * Read-only access to the api-econ corpus datasets for the calculators (server only). Rows come from the corpus through
 * PostgREST (restGet, read-only key from the server environment). Before a dataset is published, a developer can point
 * ECON_STAGED_BUILD_DIR at private/build/w1025_api-econ to preview the staged build files; that switch is ignored in
 * production builds and never reaches the browser.
 */
import fs from "node:fs";
import path from "node:path";
import { restGet } from "@/lib/external/rest.server";

export type EconRow = {
  id: string;
  title: string;
  source_url: string | null;
  item: Record<string, unknown>;
};
export type EconQuery = {
  ids?: string[];
  filters?: Record<string, string>;
  /** JSON containment on item (e.g. { awards: { sec: [{ cik }] } }). */
  itemContains?: Record<string, unknown>;
  limit?: number;
  /** "cells": only item.cells (listing reads), else the whole item. */
  fields?: "item" | "cells";
};

function contains(have: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  if (want && typeof want === "object")
    return (
      !!have &&
      typeof have === "object" &&
      Object.entries(want).every(([k, v]) => contains((have as Record<string, unknown>)[k], v))
    );
  return have === want;
}

const STAGED_FILES: Record<string, string> = {
  econ_fred_series: "fred/econ_fred_series.json",
  econ_fred_observations: "fred/econ_fred_observations.json",
  econ_nchs_life_tables: "nchs/econ_nchs_life_tables.json",
  econ_ssa_awi: "ssa_awi/econ_ssa_awi.json",
  econ_bls_cpi_areas: "bls/econ_bls_cpi_areas.json",
  econ_bls_oews: "bls/econ_bls_oews.json",
  econ_state_judgment_rates: "state_rates/econ_state_judgment_rates.json",
  company_federal_awards: "usaspending/company_federal_awards.json",
  census_acs_cvap_counties: "census_cvap/census_acs_cvap_counties.json",
};

function stagedDir(): string | null {
  const dir = process.env["ECON_STAGED_BUILD_DIR"];
  if (!dir || process.env["NODE_ENV"] === "production") return null;
  return dir;
}

const stagedCache = new Map<string, EconRow[]>();

function stagedRows(dataset: string): EconRow[] | null {
  const dir = stagedDir();
  const file = STAGED_FILES[dataset];
  if (!dir || !file) return null;
  const hit = stagedCache.get(dataset);
  if (hit) return hit;
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  const build = JSON.parse(fs.readFileSync(full, "utf8")) as {
    rows: (EconRow & { filters: Record<string, string[]> })[];
  };
  const rows = build.rows.map((r) => ({
    id: r.id,
    title: r.title,
    source_url: r.source_url,
    item: { ...r.item, _filters: r.filters },
  }));
  stagedCache.set(dataset, rows);
  return rows;
}

/** Whether rows come from staged build files (shown in the UI so a preview is never mistaken for published data). */
export const usingStagedBuilds = () => stagedDir() !== null;

export async function econRows(dataset: string, q: EconQuery): Promise<EconRow[]> {
  if (!/^[a-z0-9_]{1,80}$/.test(dataset)) throw new Error("bad dataset id");
  const staged = stagedRows(dataset);
  if (staged) {
    return staged
      .filter((r) => !q.ids || q.ids.includes(r.id))
      .filter((r) => {
        if (!q.filters) return true;
        const f = (r.item["_filters"] ?? {}) as Record<string, string[]>;
        return Object.entries(q.filters).every(([k, v]) => (f[k] ?? []).includes(v));
      })
      .filter((r) => !q.itemContains || contains(r.item, q.itemContains))
      .slice(0, q.limit ?? 1000)
      .map((r) => (q.fields === "cells" ? { ...r, item: { cells: r.item["cells"] } } : r));
  }
  const parts = [
    q.fields === "cells"
      ? "select=id,title,source_url,cells:item->cells"
      : "select=id,title,source_url,item",
    `dataset=eq.${dataset}`,
  ];
  if (q.ids)
    parts.push(
      `id=in.(${q.ids
        .map((x) => `"${x.replace(/"/g, "")}"`)
        .map(encodeURIComponent)
        .join(",")})`,
    );
  if (q.filters)
    parts.push(
      `filters=cs.${encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(q.filters).map(([k, v]) => [k, [v]]))))}`,
    );
  if (q.itemContains) parts.push(`item=cs.${encodeURIComponent(JSON.stringify(q.itemContains))}`);
  parts.push("order=ordinal.asc", `limit=${q.limit ?? 1000}`);
  const { rows } = await restGet<(EconRow & { cells?: unknown })[]>(
    `corpus_records?${parts.join("&")}`,
  );
  return q.fields === "cells"
    ? rows.map((r) => ({
        id: r.id,
        title: r.title,
        source_url: r.source_url,
        item: { cells: r.cells },
      }))
    : rows;
}

/** Which of the api-econ datasets the catalog holds (ready flag and record count). */
export async function econDatasets(): Promise<
  Record<string, { ready: boolean; records: number | null } | null>
> {
  const ids = Object.keys(STAGED_FILES);
  if (stagedDir()) {
    return Object.fromEntries(
      ids.map((id) => {
        const rows = stagedRows(id);
        return [id, rows && rows.length ? { ready: true, records: rows.length } : null];
      }),
    );
  }
  const { rows } = await restGet<
    { id: string; ready: boolean | null; imported_records: number | null }[]
  >(`corpus_datasets?select=id,ready,imported_records&id=in.(${ids.join(",")})`);
  return Object.fromEntries(
    ids.map((id) => {
      const r = rows.find((x) => x.id === id);
      return [id, r ? { ready: r.ready === true, records: r.imported_records } : null];
    }),
  );
}
