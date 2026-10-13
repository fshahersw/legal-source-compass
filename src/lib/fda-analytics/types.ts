/** API aggregate observations, not individual cases, injuries, patients or inferred records. */
export type FdaProductFamily =
  | "drug"
  | "device"
  | "food"
  | "cosmetic"
  | "animal_veterinary"
  | "tobacco"
  | "transparency"
  | "other";
export type FdaAnalyticsStatus = "ready" | "partial" | "unavailable" | "failed";
export type FdaDateRange = { from: string; to: string };
export type FdaCount = number | null;
export type FdaAnalyticsReceipt = {
  id: string;
  url: string;
  sha256: string;
  retrievedAt: string;
  lastUpdated: string | null;
  byteCount: number;
  contentType: "application/json";
  httpStatus: number;
};
/** Administrative readback attestations, never an app mutation input. */
export type FdaAnalyticsStorageReceipt = {
  id: string;
  storageKey: string;
  readbackSha256: string;
};
export type FdaAnalyticsTotal = {
  value: FdaCount;
  scope: "all_time" | "inventory";
  receiptIds: string[];
};
export type FdaAnalyticsSeries = {
  dateField: string;
  dateMeaning: string;
  range: FdaDateRange;
  /** True only when the API date count enumeration reconciles to the scoped total. */
  complete: boolean;
  /** Conservative captured source-date cutoff, never later than the last observed day or prior UTC day.
   * This does not claim that real-world reporting is complete or immune to revisions. */
  completeThrough: string | null;
  /** A sparse missing day means zero only within the reconciled enumeration AND cutoff. */
  points: { date: string; count: number }[];
  matchedRecords: FdaCount;
  receiptIds: string[];
  qualification: string;
};
export type FdaAnalyticsFacet = {
  id: string;
  label: string;
  field: string;
  countUnit: string;
  scope: { kind: "all_time" | "inventory" } | { kind: "window"; from: string; to: string };
  buckets: { key: string; label: string; count: number }[];
  /** Exactly the records matching this facet's scope, not the sum of top categories. */
  denominator: FdaCount;
  denominatorLabel: string;
  multiValued: boolean;
  exhaustive: boolean;
  truncated: boolean;
  receiptIds: string[];
  qualification: string;
};
export type FdaAnalyticsDataset = {
  id: string;
  label: string;
  endpoint: string;
  documentationUrl: string;
  productFamily: FdaProductFamily;
  countUnit: string;
  status: FdaAnalyticsStatus;
  statusReason: string | null;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  qualification: string;
  total: FdaAnalyticsTotal;
  series: FdaAnalyticsSeries | null;
  facets: FdaAnalyticsFacet[];
};
export type FdaAnalyticsSnapshot = {
  schemaVersion: "fda-analytics/1";
  runId: string;
  generatedAt: string;
  window: FdaDateRange;
  datasets: FdaAnalyticsDataset[];
  receipts: FdaAnalyticsReceipt[];
  qualifications: string[];
};
export type FdaAnalyticsEnvelope = {
  payloadSha256: string;
  snapshot: FdaAnalyticsSnapshot;
};
export type FdaGranularity = "day" | "week" | "month";
export type FdaPeriodPoint = {
  start: string;
  end: string;
  label: string;
  value: FdaCount;
  knownDays: number;
  totalDays: number;
  partial: boolean;
};
export type FdaPeriodComparison = {
  current: { range: FdaDateRange; value: FdaCount; complete: boolean };
  previous: { range: FdaDateRange; value: FdaCount; complete: boolean };
  absoluteChange: number | null;
  percentChange: number | null;
  comparable: boolean;
  reason: string;
};
