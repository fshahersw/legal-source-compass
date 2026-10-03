import { EntityType, LEGAL_SCHEMA_VERSION, legalRecord } from "./schema.ts";
import type { LegalRecord } from "./schema.ts";

export type SchemaReport = {
  schema_version: string; generated_at: string; population: string;
  total: number; valid: number; invalid: number;
  by_type: Record<string, { total: number; invalid: number }>;
  failures: { id: string | null; type: string; fields: string[] }[];
};
export function schemaReport(rows: Iterable<unknown>, population: string, at: string): SchemaReport {
  const report: SchemaReport = { schema_version: LEGAL_SCHEMA_VERSION, generated_at: at, population,
    total: 0, valid: 0, invalid: 0, by_type: Object.fromEntries([...EntityType.options, "unrecognized"].map((t) => [t, { total: 0, invalid: 0 }])), failures: [] };
  for (const row of rows) {
    const obj = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const parsedType = EntityType.safeParse(obj["type"]);
    const type = parsedType.success ? parsedType.data : "unrecognized";
    const counts = report.by_type[type]!;
    counts.total++; report.total++;
    const result = legalRecord.safeParse(row);
    if (result.success) report.valid++;
    else {
      counts.invalid++; report.invalid++;
      if (report.failures.length < 200) report.failures.push({ id: typeof obj["id"] === "string" ? obj["id"] : null, type,
        fields: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
  }
  return report;
}
export function schemaRegressions(current: SchemaReport, baseline: SchemaReport): string[] {
  const issues: string[] = [];
  if (current.schema_version !== baseline.schema_version) issues.push("Schema version differs from the reviewed baseline");
  if (current.population !== baseline.population) issues.push("Audit population differs from the reviewed baseline");
  for (const type of new Set([...Object.keys(current.by_type), ...Object.keys(baseline.by_type)])) {
    const now = current.by_type[type]; const before = baseline.by_type[type];
    if (!now || !before) { issues.push(`Missing baseline or current count for ${type}`); continue; }
    if (now.invalid > before.invalid) issues.push(`${type}: invalid records increased from ${before.invalid} to ${now.invalid}`);
    if (now.total < before.total) issues.push(`${type}: population decreased from ${before.total} to ${now.total}; requires a reviewed reconciliation`);
  }
  return issues;
}

export type CoverageRow = { source: string; year: number; accepted: number; rejected: number; status: "partial" | "not_started"; date_basis: "source_event" };
/** Empty years are explicit, and retrieval dates never fill historical coverage. */
export function coverageByYear(rows: readonly LegalRecord[], sources: readonly string[], endYear: number): CoverageRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.date_type === "retrieved") continue;
    const year = Number(row.date.slice(0, 4));
    if (year < 2000 || year > endYear) continue;
    const key = JSON.stringify([row.source_name, year]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...new Set(sources)].flatMap((source) => Array.from({ length: endYear - 1999 }, (_, i) => {
    const year = i + 2000; const accepted = counts.get(JSON.stringify([source, year])) ?? 0;
    return { source, year, accepted, rejected: 0, status: accepted ? "partial" : "not_started", date_basis: "source_event" };
  }));
}

export type AuditReview = { record_key: string; type_correct: boolean; title_correct: boolean; source_matches: boolean; link_status: number; checked_at: string; reviewer: string };
export function auditAcceptance(sample: readonly string[], reviews: readonly AuditReview[], required: number) {
  const expected = new Set(sample);
  const byKey = new Map(reviews.map((r) => [r.record_key, r]));
  const matched = sample.map((key) => byKey.get(key)).filter((r): r is AuditReview => !!r);
  const unique = expected.size === sample.length && byKey.size === reviews.length;
  const typeRate = matched.length ? matched.filter((r) => r.type_correct).length / matched.length : 0;
  const titleRate = matched.length ? matched.filter((r) => r.title_correct).length / matched.length : 0;
  const sourceRate = matched.length ? matched.filter((r) => r.source_matches && r.link_status >= 200 && r.link_status < 300 && r.reviewer.trim() && Number.isFinite(Date.parse(r.checked_at))).length / matched.length : 0;
  return { n: matched.length, required, typeRate, titleRate, sourceRate,
    passed: unique && sample.length >= required && matched.length === sample.length && typeRate >= .98 && titleRate >= .95 && sourceRate === 1 };
}
