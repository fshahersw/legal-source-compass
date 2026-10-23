/**
 * Read-only access to the api-econ corpus datasets for the calculators (server only). Rows come from the corpus through
 * PostgREST (restGet, read-only key from the server environment). Rows are served only once published; there is no
 * staged-file preview in the deployed worker (it has no file system to read build files from).
 */
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

/** The api-econ datasets the calculators read (dataset id → staged build file, kept for the builders' manifests). */
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

/** Whether rows come from staged build files (shown in the UI so a preview is never mistaken for published data). */
export const usingStagedBuilds = () => false;

export async function econRows(dataset: string, q: EconQuery): Promise<EconRow[]> {
  if (!/^[a-z0-9_]{1,80}$/.test(dataset)) throw new Error("bad dataset id");
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
