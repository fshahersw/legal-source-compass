/**
 * State clusters for the Signals page: seeded k-means on z-scored, stated features from the published state metrics.
 * Pure and tested (clusters.test.ts). Clusters describe similarity of the chosen figures only; they carry no meaning
 * beyond that and are not a ranking.
 */
import type { StateMetricsBundle } from "@/lib/external/stateMetrics.functions";
import { kmeans, mean, standardize, type KMeansResult } from "@/components/charts/stats";
import { STATE_METRIC_PREFIX, stateMetricFacts } from "./bridge/stateMetrics";

export const DEFAULT_FEATURES = [
  "sm.per_capita_income",
  "sm.unemployment_rate",
  "sm.overdose_rate",
  "sm.fars_rate",
  "sm.nhtsa_complaint_rate",
  "sm.fda_recall_rate",
] as const;

export const CLUSTER_SEED = 20261023;

export type ClusterInput = {
  /** One year all features share, the latest one where every feature is complete for at least 40 states. */
  year: string | null;
  features: string[];
  states: { usps: string; values: number[] }[];
  excluded: { usps: string; missing: string[] }[];
};

/** The latest common complete year of the features, and every state's values in it (states missing any are excluded). */
export function clusterInput(
  bundle: StateMetricsBundle,
  features: readonly string[],
): ClusterInput {
  const defs = features
    .map((id) => bundle.metrics.find((m) => `${STATE_METRIC_PREFIX}${m.key}` === id))
    .filter((d): d is NonNullable<typeof d> => !!d && !!d.years);
  const ids = defs.map((d) => `${STATE_METRIC_PREFIX}${d.key}`);
  if (!defs.length) return { year: null, features: [], states: [], excluded: [] };
  const lo = Math.max(...defs.map((d) => d.years![0]));
  const hi = Math.min(...defs.map((d) => d.years![1]));
  let year: string | null = null;
  for (let y = hi; y >= lo && !year; y--) {
    const k = String(y);
    if (defs.some((d) => k in d.partialYears)) continue;
    const ok = defs.every(
      (d) => bundle.states.filter((s) => typeof s.series[d.key]?.[k] === "number").length >= 40,
    );
    if (ok) year = k;
  }
  if (!year) return { year: null, features: ids, states: [], excluded: [] };
  const byFeature = ids.map(
    (id) =>
      new Map(
        stateMetricFacts(bundle, id, "state", { period: year! }).map(
          (f) => [f.entityId, f.value] as const,
        ),
      ),
  );
  const states: ClusterInput["states"] = [];
  const excluded: ClusterInput["excluded"] = [];
  for (const s of bundle.states) {
    const values = byFeature.map((m) => m.get(s.usps) ?? null);
    const missing = ids.filter((_, i) => values[i] === null);
    if (missing.length) excluded.push({ usps: s.usps, missing });
    else states.push({ usps: s.usps, values: values as number[] });
  }
  return { year, features: ids, states, excluded };
}

export type ClusterResult = {
  fit: KMeansResult;
  /** Mean z-score of each feature in each cluster (rows: clusters). */
  profileZ: number[][];
  /** Mean raw value of each feature in each cluster. */
  profileRaw: number[][];
  members: string[][];
};

export function clusterStates(input: ClusterInput, k: number): ClusterResult | null {
  if (input.states.length < k * 2 || !input.features.length) return null;
  const { z } = standardize(input.states.map((s) => s.values));
  const fit = kmeans(z, k, { seed: CLUSTER_SEED, starts: 25 });
  if (!fit) return null;
  const members = Array.from({ length: fit.k }, (_, c) =>
    input.states.filter((_, i) => fit.assignments[i] === c).map((s) => s.usps),
  );
  const profileZ = Array.from({ length: fit.k }, (_, c) =>
    input.features.map(
      (_, f) => mean(z.filter((_, i) => fit.assignments[i] === c).map((r) => r[f]!)) ?? 0,
    ),
  );
  const profileRaw = Array.from({ length: fit.k }, (_, c) =>
    input.features.map(
      (_, f) =>
        mean(input.states.filter((_, i) => fit.assignments[i] === c).map((s) => s.values[f]!)) ?? 0,
    ),
  );
  return { fit, profileZ, profileRaw, members };
}
