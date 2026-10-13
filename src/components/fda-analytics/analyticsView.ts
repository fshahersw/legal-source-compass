import type {
  FdaAnalyticsDataset,
  FdaAnalyticsFacet,
  FdaDateRange,
  FdaGranularity,
  FdaProductFamily,
} from "@/lib/fda-analytics/types";
import type { MonitoringSearch } from "@/components/regulatory/monitoringView";
import { sourceAlignedRange } from "@/lib/fda-analytics/analysis";

export const FDA_DOMAINS = [
  "overview",
  "devices",
  "drugs",
  "food",
  "cosmetics",
  "veterinary",
  "tobacco",
  "transparency",
  "catalog",
] as const;
export type FdaDashboardDomain = (typeof FDA_DOMAINS)[number];
export const FDA_PERIODS = ["30d", "90d", "1y", "2y", "custom"] as const;
export type FdaDashboardPeriod = (typeof FDA_PERIODS)[number];
export const FDA_DOMAIN_LABELS: Record<FdaDashboardDomain, string> = {
  overview: "Overview",
  devices: "Devices",
  drugs: "Drugs",
  food: "Food",
  cosmetics: "Cosmetics",
  veterinary: "Veterinary",
  tobacco: "Tobacco",
  transparency: "Transparency",
  catalog: "Catalog",
};
const familyDomain: Partial<Record<FdaDashboardDomain, FdaProductFamily>> = {
  devices: "device",
  drugs: "drug",
  food: "food",
  cosmetics: "cosmetic",
  veterinary: "animal_veterinary",
  tobacco: "tobacco",
};

export function selectedAnalyticsRange(
  search: MonitoringSearch,
  available: FdaDateRange,
): FdaDateRange | null {
  const period = search.analyticsPeriod ?? "1y";
  if (period === "custom") {
    return search.analyticsFrom && search.analyticsTo && search.analyticsFrom <= search.analyticsTo
      ? { from: search.analyticsFrom, to: search.analyticsTo }
      : null;
  }
  const days = period === "30d" ? 30 : period === "90d" ? 90 : period === "1y" ? 365 : 730;
  return {
    from: new Date(Date.parse(`${available.to}T00:00:00Z`) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    to: available.to,
  };
}

export function analyticsDatasetRanges(
  datasets: FdaAnalyticsDataset[],
  range: FdaDateRange,
  period: FdaDashboardPeriod,
) {
  const days = period === "30d" ? 30 : period === "90d" ? 90 : period === "1y" ? 365 : 730;
  return Object.fromEntries(
    datasets.map((dataset) => {
      return [
        dataset.id,
        period === "custom" ? range : (sourceAlignedRange(dataset, days) ?? range),
      ];
    }),
  ) as Record<string, FdaDateRange>;
}

export function datasetAt(datasets: FdaAnalyticsDataset[], endpoint: string) {
  return datasets.find((dataset) => {
    const path = dataset.endpoint
      .replace(/^https?:\/\/[^/]+/, "")
      .split("?")[0]
      ?.replace(/\.json\/?$/, "")
      .replace(/^\/+|\/+$/g, "");
    return path === endpoint.replace(/^\/+|\/+$/g, "");
  });
}

export function domainDatasets(datasets: FdaAnalyticsDataset[], domain: FdaDashboardDomain) {
  if (domain === "transparency")
    return datasets.filter((dataset) =>
      /(?:^|\/)(?:crl|transparency)(?:[/.]|$)|complete.response.letters?/i.test(
        `${dataset.endpoint} ${dataset.label}`,
      ),
    );
  const family = familyDomain[domain];
  return family ? datasets.filter((dataset) => dataset.productFamily === family) : datasets;
}

export function isInventory(dataset: FdaAnalyticsDataset) {
  return (
    dataset.total.scope === "inventory" ||
    (!dataset.series && !/\/(?:event|enforcement)(?:\.json)?$/.test(dataset.endpoint))
  );
}

export function granularityLabel(value: FdaGranularity) {
  return value === "day" ? "daily" : value === "week" ? "weekly" : "monthly";
}

/** Only recorded facet names are used; no synthetic category values are introduced. */
export function findFacet(
  dataset: FdaAnalyticsDataset | undefined,
  pattern: RegExp,
  range: FdaDateRange,
) {
  const candidates =
    dataset?.facets.filter((facet) => pattern.test(`${facet.id} ${facet.label} ${facet.field}`)) ??
    [];
  return (
    candidates.find(
      (facet) =>
        facet.scope.kind === "window" &&
        facet.scope.from === range.from &&
        facet.scope.to === range.to,
    ) ??
    candidates.find((facet) => facet.scope.kind !== "window") ??
    candidates[0]
  );
}

export function facetScopeLabel(facet: FdaAnalyticsFacet) {
  return facet.scope.kind === "window"
    ? `${facet.scope.from}–${facet.scope.to}`
    : facet.scope.kind === "inventory"
      ? "Current source inventory"
      : "All-time source scope";
}

export function percentChangeLabel(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function snapshotAgeLabel(generatedAt: string, now = Date.now()) {
  const age = now - Date.parse(generatedAt);
  if (!Number.isFinite(age) || age < 0) return "Capture time recorded";
  if (age < 3600000) return "Captured <1h ago";
  if (age < 86400000) return `Captured ${Math.floor(age / 3600000)}h ago`;
  return `Captured ${Math.floor(age / 86400000)}d ago`;
}
