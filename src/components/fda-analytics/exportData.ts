import { aggregateSeries, facetBreakdown } from "@/lib/fda-analytics/analysis";
import type { FdaAnalyticsDataset, FdaDateRange, FdaGranularity } from "@/lib/fda-analytics/types";

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  // Public publisher labels remain untrusted spreadsheet input.
  const text =
    typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/** Export observed values and their scope; absent values stay blank, never guessed zero. */
export function exportFdaChartCsv(
  datasets: FdaAnalyticsDataset[],
  range: FdaDateRange,
  granularity: FdaGranularity,
  datasetRanges: Record<string, FdaDateRange> = {},
): string {
  const rows: (string | number | boolean | null)[][] = [
    [
      "metric_kind",
      "dataset",
      "api_endpoint",
      "count_unit",
      "date_field",
      "scope_start",
      "scope_end",
      "interval",
      "category",
      "count",
      "percent_of_matching_records",
      "denominator_records",
      "categories_can_overlap",
      "partial_period",
      "dataset_status",
      "publisher_updated",
      "captured_at",
      "capture_receipt_ids",
    ],
  ];
  for (const dataset of datasets) {
    const selectedRange = datasetRanges[dataset.id] ?? range;
    const suffix = [dataset.status, dataset.sourceUpdatedAt, dataset.retrievedAt];
    if (dataset.series) {
      for (const point of aggregateSeries(dataset, selectedRange, granularity)) {
        rows.push([
          "time_series",
          dataset.label,
          dataset.endpoint,
          dataset.countUnit,
          dataset.series.dateField,
          point.start,
          point.end,
          granularity,
          "",
          point.value,
          null,
          null,
          false,
          point.partial,
          ...suffix,
          dataset.series.receiptIds.join(" "),
        ]);
      }
    }
    // All-time/current inventory totals are intentionally separate from the selected time series.
    rows.push([
      dataset.total.scope,
      dataset.label,
      dataset.endpoint,
      dataset.countUnit,
      "",
      "",
      "",
      "snapshot",
      "",
      dataset.total.value,
      null,
      null,
      false,
      false,
      ...suffix,
      dataset.total.receiptIds.join(" "),
    ]);
    for (const facet of dataset.facets) {
      const breakdown = facetBreakdown(
        facet,
        facet.scope.kind === "window" ? selectedRange : undefined,
      );
      if (!breakdown.available) continue;
      for (const bucket of breakdown.buckets) {
        rows.push([
          `category_${facet.scope.kind}`,
          dataset.label,
          dataset.endpoint,
          facet.countUnit,
          facet.field,
          facet.scope.kind === "window" ? facet.scope.from : "",
          facet.scope.kind === "window" ? facet.scope.to : "",
          "category",
          bucket.label,
          bucket.count,
          bucket.percent,
          facet.denominator,
          facet.multiValued,
          false,
          ...suffix,
          facet.receiptIds.join(" "),
        ]);
      }
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
