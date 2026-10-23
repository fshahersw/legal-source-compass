/**
 * Server functions for the government domain registries (gov_domains, gov_domains_summary; built by
 * scripts/enrichment/gov_domains from the CISA .gov registry and the GSA government URLs list). Read-only.
 *
 *   lookupGovernmentDomains   is this host (or http(s) address) a registered government domain? Exact entry or parent
 *                             domain, label by label; returns the publishers' facts and the snapshot date.
 *   getStateGovDomains        every registered domain whose publisher-given state is this state
 *   getGovDomainsSummary      counts by type and by state, with the snapshot
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canonicalState } from "@/lib/corpus/stateHub";
import type {
  GovLookupResult,
  GovRow,
  GovSnapshot,
  GovSummaryAll,
  GovSummaryState,
} from "./govDomainsModel";
import { lookupGovDomains, readGovSummary, readStateGovRows } from "./govDomains.server";

export const lookupGovernmentDomains = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ inputs: z.array(z.string().max(2048)).min(1).max(60) }).parse(d),
  )
  .handler(
    async ({ data }): Promise<{ results: GovLookupResult[]; snapshot: GovSnapshot | null }> =>
      lookupGovDomains(data.inputs),
  );

export type StateGovDomains = {
  usps: string;
  /** False when the registry datasets are not published (the section then says so instead of showing an empty list). */
  available: boolean;
  rows: GovRow[];
  total: number;
  truncated: boolean;
  snapshot: GovSnapshot | null;
  summary: GovSummaryState | null;
};

export const getStateGovDomains = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Za-z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateGovDomains> => {
    const usps = canonicalState(data.usps)?.usps ?? data.usps.toUpperCase();
    const summary = await readGovSummary();
    if (!summary.all)
      return {
        usps,
        available: false,
        rows: [],
        total: 0,
        truncated: false,
        snapshot: null,
        summary: null,
      };
    const state = summary.states.find((s) => s.usps === usps) ?? null;
    if (!state)
      return {
        usps,
        available: true,
        rows: [],
        total: 0,
        truncated: false,
        snapshot: summary.all.snapshot,
        summary: null,
      };
    const list = await readStateGovRows(usps);
    return { usps, available: true, ...list, snapshot: summary.all.snapshot, summary: state };
  });

export type GovDomainsSummary = { all: GovSummaryAll | null; states: GovSummaryState[] };

export const getGovDomainsSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<GovDomainsSummary> => readGovSummary(),
);
