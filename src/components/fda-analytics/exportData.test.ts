import { describe, expect, it } from "vitest";
import type { FdaAnalyticsDataset } from "@/lib/fda-analytics/types";
import { exportFdaChartCsv } from "./exportData";

const range = { from: "2026-01-01", to: "2026-01-02" };
function dataset(): FdaAnalyticsDataset {
  return {
    id: "fixture",
    label: "=PUBLIC_LABEL()",
    endpoint: "https://api.fda.gov/drug/event.json",
    documentationUrl: "https://open.fda.gov/apis/drug/event/",
    productFamily: "drug",
    countUnit: "reports",
    status: "partial",
    statusReason: "Incomplete synthetic test capture",
    retrievedAt: "2026-01-03T00:00:00Z",
    sourceUpdatedAt: "2026-01-02",
    qualification: "Test only",
    total: { value: 10, scope: "all_time", receiptIds: ["total-proof"] },
    series: {
      dateField: "receivedate",
      dateMeaning: "Receipt date",
      range,
      complete: false,
      completeThrough: null,
      points: [{ date: range.from, count: 3 }],
      matchedRecords: null,
      receiptIds: ["series-proof"],
      qualification: "Test only",
    },
    facets: [
      {
        id: "outcome",
        label: "Outcome",
        field: "outcome",
        countUnit: "reports mentioning term",
        scope: { kind: "window", ...range },
        buckets: [{ key: "x", label: "@UNTRUSTED", count: 4 }],
        denominator: 10,
        denominatorLabel: "matching reports",
        multiValued: true,
        exhaustive: false,
        truncated: true,
        receiptIds: ["facet-proof"],
        qualification: "Categories overlap",
      },
    ],
  };
}

describe("FDA chart CSV export", () => {
  it("keeps missing observations blank and includes source scope and receipts", () => {
    const csv = exportFdaChartCsv([dataset()], range, "day");
    const missing = csv.split("\r\n").find((line) => line.includes('"2026-01-02","2026-01-02"'))!;
    expect(missing).toContain('"day","",,,,"false","true"');
    expect(csv).toContain('"receivedate"');
    expect(csv).toContain('"series-proof"');
    expect(csv).toContain('"all_time"');
  });
  it("neutralizes publisher formula labels and uses the actual denominator", () => {
    const csv = exportFdaChartCsv([dataset()], range, "day");
    expect(csv).toContain('"\'=PUBLIC_LABEL()"');
    expect(csv).toContain('"\'@UNTRUSTED","4","40","10","true"');
  });
  it("does not export a dated category under a different selected window", () => {
    const csv = exportFdaChartCsv([dataset()], { from: range.from, to: range.from }, "day");
    expect(csv).not.toContain("facet-proof");
    expect(csv).toContain("series-proof");
  });
  it("exports the exact source-aligned range shown by each chart", () => {
    const csv = exportFdaChartCsv([dataset()], { from: "2026-02-01", to: "2026-02-02" }, "day", {
      fixture: range,
    });
    expect(csv).toContain('"2026-01-01","2026-01-01"');
    expect(csv).not.toContain("2026-02-01");
    expect(csv).toContain("facet-proof");
  });
});
