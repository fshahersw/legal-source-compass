import { describe, expect, it } from "vitest";
import { parseFdaAnalyticsEnvelope, parseFdaAnalyticsSnapshot } from "./validation";

const id = "a".repeat(64);
const sample = () => ({
  schemaVersion: "fda-analytics/1",
  runId: "12345678-1234-4234-8234-123456789abc",
  generatedAt: "2026-10-12T18:00:00Z",
  window: { from: "2020-01-01", to: "2026-10-11" },
  qualifications: ["Offline synthetic validation fixture."],
  receipts: [
    {
      id,
      url: "https://api.fda.gov/food/enforcement.json?count=report_date&limit=1000",
      sha256: "b".repeat(64),
      retrievedAt: "2026-10-12T17:00:00Z",
      lastUpdated: "2026-10-10",
      byteCount: 50,
      contentType: "application/json",
      httpStatus: 200,
    },
  ],
  datasets: [
    {
      id: "food_enforcement",
      label: "Test aggregate",
      endpoint: "https://api.fda.gov/food/enforcement.json",
      documentationUrl: "https://open.fda.gov/apis/food/enforcement/",
      productFamily: "food",
      countUnit: "enforcement report records",
      status: "ready",
      statusReason: null,
      retrievedAt: "2026-10-12T17:00:00Z",
      sourceUpdatedAt: null,
      qualification: "Source aggregate only.",
      total: { value: 8, scope: "all_time", receiptIds: [id] },
      series: {
        dateField: "report_date",
        dateMeaning: "Report date",
        range: { from: "2026-10-01", to: "2026-10-11" },
        complete: true,
        completeThrough: "2026-10-10",
        points: [
          { date: "2026-10-01", count: 2 },
          { date: "2026-10-10", count: 6 },
        ],
        matchedRecords: 8,
        receiptIds: [id],
        qualification: "API enumeration only.",
      },
      facets: [
        {
          id: "classification_30d",
          label: "Recall class",
          field: "classification",
          countUnit: "enforcement report records",
          scope: { kind: "window", from: "2026-10-01", to: "2026-10-11" },
          buckets: [{ key: "I", label: "Class I", count: 2 }],
          denominator: 8,
          denominatorLabel: "matched source records",
          multiValued: false,
          exhaustive: false,
          truncated: true,
          receiptIds: [id],
          qualification: "Top categories only.",
        },
      ],
    },
  ],
});
describe("FDA snapshot response validation", () => {
  it("allows a broad union envelope while each chart stays bounded", () => {
    expect(parseFdaAnalyticsSnapshot(sample()).datasets).toHaveLength(1);
    const changed = sample();
    changed.datasets[0]!.series.range.from = "2020-01-01";
    expect(() => parseFdaAnalyticsSnapshot(changed)).toThrow();
    expect(parseFdaAnalyticsEnvelope(null)).toBeNull();
  });
  it("rejects invented missing days, duplicate days and cutoffs based only on a newer release", () => {
    for (const mutate of [
      (value: ReturnType<typeof sample>) => {
        value.datasets[0]!.series.matchedRecords = 10;
      },
      (value: ReturnType<typeof sample>) => {
        value.datasets[0]!.series.completeThrough = "2026-10-11";
      },
      (value: ReturnType<typeof sample>) => {
        value.datasets[0]!.series.points.push({ date: "2026-10-01", count: 0 });
      },
    ]) {
      const value = sample();
      mutate(value);
      expect(() => parseFdaAnalyticsSnapshot(value)).toThrow();
    }
  });
  it("rejects credential-bearing URLs and cross-endpoint metric provenance", () => {
    for (const url of [
      "https://api.fda.gov/food/enforcement.json?api_key=secret",
      "https://api.fda.gov.evil.test/food/enforcement.json",
      "https://api.fda.gov/drug/event.json?count=receivedate",
    ]) {
      const value = sample();
      value.receipts[0]!.url = url;
      expect(() => parseFdaAnalyticsSnapshot(value)).toThrow();
    }
  });
  it("does not accept an exhaustive label for incomplete categories or numeric charts for failed data", () => {
    const wrong = sample();
    wrong.datasets[0]!.facets[0]!.exhaustive = true;
    expect(() => parseFdaAnalyticsSnapshot(wrong)).toThrow();
    const failed = sample();
    failed.datasets[0]!.status = "failed";
    expect(() => parseFdaAnalyticsSnapshot(failed)).toThrow();
  });
});
