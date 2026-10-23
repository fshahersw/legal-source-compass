import { DEFAULT_MAP_METRIC, STATE_METRIC_BY_KEY } from "@/lib/external/mapMetricsModel";

export type MapSearch = { metric?: string; layer?: "counties" };

/** Search parameters of the home map: a known metric key (anything else is dropped) and the optional county layer. */
export function parseMapSearch(value: Record<string, unknown>): MapSearch {
  const metric =
    typeof value["metric"] === "string" && STATE_METRIC_BY_KEY.has(value["metric"])
      ? value["metric"]
      : undefined;
  return {
    ...(metric && metric !== DEFAULT_MAP_METRIC ? { metric } : {}),
    ...(value["layer"] === "counties" ? { layer: "counties" as const } : {}),
  };
}

/** The metric a search selects (the default when absent), and whether the county layer applies to it. */
export function resolveMapSelection(search: MapSearch): { metric: string; counties: boolean } {
  const metric = search.metric ?? DEFAULT_MAP_METRIC;
  const def = STATE_METRIC_BY_KEY.get(metric);
  return { metric, counties: search.layer === "counties" && !!def?.county };
}
