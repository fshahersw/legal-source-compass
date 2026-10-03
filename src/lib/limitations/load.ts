import { fetchBundleSnapshot } from "@/lib/private-data/client";
import type { LimitationsSnapshot } from "./types";

async function json(path: string): Promise<Record<string, unknown>> {
  const response = await fetchBundleSnapshot(path);
  if (!response.ok) throw new Error(`Limitations source failed to load (${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid limitations source.");
  return value as Record<string, unknown>;
}

export async function loadLimitations(): Promise<LimitationsSnapshot> {
  const [rules, sources, coverage, cases] = await Promise.all([
    json("/data/limitations/rules.json"),
    json("/data/limitations/sources.json"),
    json("/data/limitations/coverage.json"),
    json("/data/limitations/case-references.json"),
  ]);
  if (
    [rules, sources, coverage, cases].some((x) => x["schemaVersion"] !== "1.0.0") ||
    !Array.isArray(rules["rules"]) ||
    !Array.isArray(sources["sources"]) ||
    !Array.isArray(coverage["coverage"]) ||
    !Array.isArray(cases["cases"])
  )
    throw new Error("Unsupported limitations schema.");
  if (
    typeof rules["snapshotDate"] !== "string" ||
    typeof rules["ruleVersion"] !== "string" ||
    [sources, coverage, cases].some((x) => x["snapshotDate"] !== rules["snapshotDate"])
  )
    throw new Error("Limitations source snapshots are from inconsistent versions.");
  const snapshot = {
    ...rules,
    sources: sources["sources"],
    coverage: coverage["coverage"],
    cases: cases["cases"],
  } as LimitationsSnapshot;
  const ids = new Set(snapshot.sources.map((s) => s.id));
  const caseIds = new Set(snapshot.cases.map((c) => c.id));
  if (
    ids.size !== snapshot.sources.length ||
    new Set(snapshot.rules.map((r) => r.id)).size !== snapshot.rules.length ||
    snapshot.rules.some(
      (r) => !Array.isArray(r.sourceIds) || r.sourceIds.some((id) => !ids.has(id)),
    ) ||
    snapshot.coverage.length !== 51 ||
    caseIds.size !== snapshot.cases.length ||
    snapshot.rules.some((r) => r.caseReferenceIds?.some((id) => !caseIds.has(id))) ||
    new Set(snapshot.coverage.map((c) => c.state)).size !== 51
  )
    throw new Error("Limitations evidence links or jurisdiction inventory are inconsistent.");
  return snapshot;
}
