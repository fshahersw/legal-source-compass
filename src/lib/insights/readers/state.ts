/** State analytics reads: state_metrics_national (metric definitions) + state_metrics_profiles (per-state series). */
import { restGet } from "@/lib/external/rest.server";
import { parseMetric, parseSeries, type MetricDef } from "@/lib/external/stateMetrics.functions";
import { STATE_SERIES_KEYS, type StateMetricsInput } from "../generators/state";
import { memoAsync, READ_TTL_MS } from "./cache";

export const readStateMetrics = memoAsync<StateMetricsInput | null>(READ_TTL_MS, async () => {
  const series = STATE_SERIES_KEYS.map((k) => `s_${k}:item->profile->series->${k}`).join(",");
  const [metrics, profiles] = await Promise.all([
    restGet<{ metric: unknown }[]>(
      "corpus_records?select=metric:item->metric&dataset=eq.state_metrics_national&order=ordinal.asc&limit=500",
    ),
    restGet<Record<string, unknown>[]>(
      `corpus_records?select=usps:item->profile->>usps,name:item->profile->>name,${series}&dataset=eq.state_metrics_profiles&order=ordinal.asc&limit=100`,
    ),
  ]);
  const defs: MetricDef[] = metrics.rows.flatMap(({ metric }) => {
    const parsed = parseMetric(metric);
    return parsed ? [parsed] : [];
  });
  const states = profiles.rows.flatMap((row) => {
    const usps = row["usps"];
    const name = row["name"];
    if (typeof usps !== "string" || !/^[A-Z]{2}$/.test(usps) || typeof name !== "string" || !name)
      return [];
    const bySeries: Record<string, Record<string, number>> = {};
    for (const key of STATE_SERIES_KEYS) {
      const parsed = parseSeries(row[`s_${key}`]);
      if (Object.keys(parsed).length) bySeries[key] = parsed;
    }
    return [{ usps, name, series: bySeries }];
  });
  return defs.length && states.length ? { metrics: defs, states } : null;
});
