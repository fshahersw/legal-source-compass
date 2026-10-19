import { parseStateHubSearch, type StateHubSearch, type StateHubTab } from "@/lib/corpus/stateHub";
import { METRIC_BY_KEY } from "./placeMetrics";

/** Sub-views of a state's Analysis tab. */
export const ANALYSIS_VIEWS = ["map", "districts", "cities", "associations"] as const;
export type AnalysisView = (typeof ANALYSIS_VIEWS)[number];
export type PlaceHubTab = StateHubTab | "analysis";
export type PlaceHubSearch = Omit<StateHubSearch, "tab"> & {
  tab?: PlaceHubTab;
  view?: AnalysisView;
  metric?: string;
};

/** The state hub's search plus the Analysis tab, its sub-view and a known metric key (anything else is dropped). */
export function parsePlaceHubSearch(value: Record<string, unknown>): PlaceHubSearch {
  const base = parseStateHubSearch(value);
  const tab: PlaceHubTab = value["tab"] === "analysis" ? "analysis" : (base.tab ?? "overview");
  const view = ANALYSIS_VIEWS.find((v) => v === value["view"]);
  const metric =
    typeof value["metric"] === "string" && METRIC_BY_KEY.has(value["metric"])
      ? value["metric"]
      : undefined;
  return {
    ...base,
    tab,
    ...(tab === "analysis" && view ? { view } : {}),
    ...(tab === "analysis" && metric ? { metric } : {}),
  };
}

/** The search the existing court and judge directories understand (they never see the Analysis tab). */
export function directorySearch(search: PlaceHubSearch): StateHubSearch {
  const { tab, view: _view, metric: _metric, ...rest } = search;
  return { ...rest, tab: !tab || tab === "analysis" ? "overview" : tab };
}
