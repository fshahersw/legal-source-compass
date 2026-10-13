import { z } from "zod";
import { isFdaDate } from "./analysis";
import type { FdaAnalyticsEnvelope, FdaAnalyticsSnapshot } from "./types";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const day = z.string().refine(isFdaDate);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4000);
const ids = z
  .array(hash)
  .max(1000)
  .refine((items) => new Set(items).size === items.length);
const range = z
  .object({ from: day, to: day })
  .strict()
  .refine(
    (value) =>
      value.from <= value.to && (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= 731,
  );
const coverageUnion = z
  .object({ from: day, to: day })
  .strict()
  .refine(
    (value) =>
      value.from <= value.to &&
      (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 < 36_600,
  );
const apiUrl = z
  .string()
  .max(8192)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "api.fda.gov" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        /^\/[a-z]+\/[a-z0-9]+\.json$/.test(url.pathname) &&
        [...url.searchParams.keys()].every((key) =>
          ["search", "count", "limit", "skip", "sort"].includes(key),
        )
      );
    } catch {
      return false;
    }
  });
const receipt = z
  .object({
    id: hash,
    url: apiUrl,
    sha256: hash,
    retrievedAt: z.string().datetime({ offset: true }),
    lastUpdated: z.string().max(100).nullable(),
    byteCount: count.refine((value) => value > 0 && value <= 104_857_600),
    contentType: z.literal("application/json"),
    httpStatus: z.number().int().min(200).max(599),
  })
  .strict();
const facet = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
    label: text,
    field: text,
    countUnit: text,
    scope: z.union([
      z.object({ kind: z.enum(["all_time", "inventory"]) }).strict(),
      z.object({ kind: z.literal("window"), from: day, to: day }).strict(),
    ]),
    buckets: z
      .array(
        z.object({ key: z.string().max(1000), label: z.string().min(1).max(1000), count }).strict(),
      )
      .max(1000),
    denominator: count.nullable(),
    denominatorLabel: text,
    multiValued: z.boolean(),
    exhaustive: z.boolean(),
    truncated: z.boolean(),
    receiptIds: ids,
    qualification: text,
  })
  .strict();
const series = z
  .object({
    dateField: text,
    dateMeaning: text,
    range,
    complete: z.boolean(),
    completeThrough: day.nullable(),
    points: z.array(z.object({ date: day, count }).strict()).max(732),
    matchedRecords: count.nullable(),
    receiptIds: ids,
    qualification: text,
  })
  .strict();
const dataset = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
    label: text,
    endpoint: apiUrl.refine((value) => !new URL(value).search),
    documentationUrl: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          ["open.fda.gov", "www.fda.gov"].includes(url.hostname) &&
          !url.username &&
          !url.password
        );
      }),
    productFamily: z.enum([
      "drug",
      "device",
      "food",
      "cosmetic",
      "animal_veterinary",
      "tobacco",
      "transparency",
      "other",
    ]),
    countUnit: text,
    status: z.enum(["ready", "partial", "unavailable", "failed"]),
    statusReason: z.string().max(4000).nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceUpdatedAt: z.string().max(100).nullable(),
    qualification: text,
    total: z
      .object({
        value: count.nullable(),
        scope: z.enum(["all_time", "inventory"]),
        receiptIds: ids,
      })
      .strict(),
    series: series.nullable(),
    facets: z.array(facet).max(80),
  })
  .strict();
export const fdaAnalyticsSnapshotSchema = z
  .object({
    schemaVersion: z.literal("fda-analytics/1"),
    runId: z.string().uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    window: coverageUnion,
    datasets: z.array(dataset).min(1).max(40),
    receipts: z.array(receipt).max(1500),
    qualifications: z.array(text).min(1).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const receipts = new Map(value.receipts.map((item) => [item.id, item]));
    if (
      receipts.size !== value.receipts.length ||
      new Set(value.datasets.map((item) => item.id)).size !== value.datasets.length
    )
      issue("Duplicate capture or dataset identity");
    for (const item of value.datasets) {
      const refs = [
        ...item.total.receiptIds,
        ...(item.series?.receiptIds ?? []),
        ...item.facets.flatMap((entry) => entry.receiptIds),
      ];
      if (
        refs.some((id) => {
          const source = receipts.get(id);
          return (
            !source || new URL(source.url).origin + new URL(source.url).pathname !== item.endpoint
          );
        })
      )
        issue("Metric is not bound to this dataset's API capture");
      if (item.total.value !== null && !item.total.receiptIds.length)
        issue("Total requires capture evidence");
      if (
        ["failed", "unavailable"].includes(item.status) &&
        (item.total.value !== null || item.series !== null || item.facets.length)
      )
        issue("Failed dataset must not supply numeric charts");
      if (item.status !== "ready" && !item.statusReason)
        issue("Incomplete dataset requires a reason");
      if (new Set(item.facets.map((entry) => entry.id)).size !== item.facets.length)
        issue("Duplicate facet identity");
      const selected = item.series;
      if (selected) {
        if (
          selected.range.from < value.window.from ||
          selected.range.to > value.window.to ||
          !selected.receiptIds.length
        )
          issue("Series outside captured window or missing evidence");
        if (
          selected.completeThrough &&
          (selected.completeThrough < selected.range.from ||
            selected.completeThrough > selected.range.to ||
            selected.completeThrough >= value.generatedAt.slice(0, 10))
        )
          issue("Invalid complete calendar cutoff");
        if (
          new Set(selected.points.map((point) => point.date)).size !== selected.points.length ||
          selected.points.some(
            (point) => point.date < selected.range.from || point.date > selected.range.to,
          )
        )
          issue("Duplicate or out-of-range series date");
        const sum = selected.points.reduce((total, point) => total + point.count, 0);
        const lastObserved = selected.points
          .map((point) => point.date)
          .sort()
          .at(-1);
        if (selected.completeThrough && (!lastObserved || selected.completeThrough > lastObserved))
          issue("Coverage cutoff exceeds the last observed source date");
        if (
          !Number.isSafeInteger(sum) ||
          (selected.complete &&
            (selected.matchedRecords === null || sum !== selected.matchedRecords))
        )
          issue("Complete series must reconcile to its scoped total");
      }
      for (const entry of item.facets) {
        if (
          !entry.receiptIds.length ||
          new Set(entry.buckets.map((bucket) => bucket.key)).size !== entry.buckets.length
        )
          issue("Facet requires unique categories and capture evidence");
        if (
          entry.scope.kind === "window" &&
          (entry.scope.from > entry.scope.to ||
            entry.scope.from < value.window.from ||
            entry.scope.to > value.window.to)
        )
          issue("Facet outside capture window");
        if (entry.exhaustive && entry.truncated) issue("A truncated facet is not exhaustive");
        const sum = entry.buckets.reduce((total, bucket) => total + bucket.count, 0);
        if (
          entry.buckets.some(
            (bucket) => bucket.key === "" && bucket.label !== "(empty term in source)",
          )
        )
          issue("Empty native category must be labeled as an empty source term");
        if (
          entry.denominator !== null &&
          entry.buckets.some((bucket) => bucket.count > entry.denominator!)
        )
          issue("A category record count exceeds the matching-record denominator");
        if (
          !entry.multiValued &&
          entry.denominator !== null &&
          (sum > entry.denominator || (entry.exhaustive && sum !== entry.denominator))
        )
          issue("Exclusive facet counts do not match their denominator");
      }
    }
  });

export function parseFdaAnalyticsSnapshot(value: unknown): FdaAnalyticsSnapshot {
  return fdaAnalyticsSnapshotSchema.parse(value);
}
export function parseFdaAnalyticsEnvelope(value: unknown): FdaAnalyticsEnvelope | null {
  if (value === null) return null;
  return z
    .object({ payloadSha256: hash, snapshot: fdaAnalyticsSnapshotSchema })
    .strict()
    .parse(value);
}
