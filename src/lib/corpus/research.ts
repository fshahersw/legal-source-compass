import { fetchBundleSnapshot } from "@/lib/private-data/client";
import type { CatalogMatter } from "@/lib/atlas/catalogMatters";
import { mdlForMatter } from "@/lib/atlas/catalogMatters";
import { exactCourtLocations } from "./courtLocations";

export type ResearchSource = {
  id: string;
  file: string;
  url: string;
  page: string;
  fetchedAt: string;
  bytes: number;
  sha256: string;
};
export type PopulationState = {
  code: string;
  name: string;
  fips: string;
  population2024: number;
  population2025: number;
};
export type JudicialService = {
  sequence: string;
  court: string;
  type: string;
  state: string | null;
  nominationDate: string | null;
  confirmationDate: string | null;
  commissionDate: string | null;
  recessDate: string | null;
  seniorDate: string | null;
  terminationDate: string | null;
  terminationReason: string | null;
  chiefBegin: string | null;
  chiefEnd: string | null;
};
export type FjcJudge = { id: string; name: string; services: JudicialService[] };
export type WorkloadState = {
  code: string;
  filed2024: number;
  filed2025: number;
  terminated2024: number;
  terminated2025: number;
  pending2024: number;
  pending2025: number;
};
export type TimingMetric = { cases: number; medianMonths: number | null };
export type TimingRow = { label: string; state: string; metrics: Record<string, TimingMetric> };
export type ResourceLink = {
  label: string;
  url: string;
  section: string;
  subsection: string | null;
};
export type StateResources = {
  code: string;
  name: string;
  sourceUrl: string;
  publisherModifiedAt: string | null;
  retrievedAt: string;
  links: ResourceLink[];
};
export type ResearchData = {
  population: { referenceDate: string; national2025: number; states: PopulationState[] };
  judiciary: {
    asOf: string;
    judgeCount: number;
    serviceCount: number;
    scope: string;
    judges: FjcJudge[];
  };
  timing: {
    periodEnd: string;
    national: Record<string, TimingMetric>;
    districts: TimingRow[];
    notes: string[];
  };
  workload: {
    period: string;
    sourceUrl: string;
    jurisdictions: WorkloadState[];
    totals: Omit<WorkloadState, "code">;
  };
  resources: { retrievedAt: string; states: StateResources[] };
  courts: { records: { id: string; title: string; state: string }[] };
  sources: { sources: ResearchSource[] };
};

async function json<T>(url: string): Promise<T> {
  const response = await fetchBundleSnapshot(url);
  if (!response.ok) throw new Error(`Research source could not load (${response.status}).`);
  return response.json() as Promise<T>;
}
export async function loadResearch(): Promise<ResearchData> {
  const [population, judiciary, timing, workload, resources, courts, sources] = await Promise.all([
    json<ResearchData["population"]>("/data/research/population.json"),
    json<ResearchData["judiciary"]>("/data/research/judicial-service.json"),
    json<ResearchData["timing"]>("/data/research/court-duration.json"),
    json<ResearchData["workload"]>("/data/quality/reference/uscourts-table-c-2025.json"),
    json<ResearchData["resources"]>("/data/research/state-resources.json"),
    json<ResearchData["courts"]>("/data/research/court-crosswalk.json"),
    json<ResearchData["sources"]>("/data/research/source-manifest.json"),
  ]);
  return { population, judiciary, timing, workload, resources, courts, sources };
}

/** Full ISO dates only; rejects calendar rollover and partial dates. */
export function recordedDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
export function completedDays(row: CatalogMatter): number | null {
  if (row.status !== "terminated") return null;
  const start = recordedDate(row.date_filed),
    end = recordedDate(row.date_terminated);
  return start !== null && end !== null && end >= start ? (end - start) / 86_400_000 : null;
}
export function quantile(values: number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || !Number.isFinite(p) || p < 0 || p > 1) return null;
  const index = (sorted.length - 1) * p,
    floor = Math.floor(index);
  return sorted[floor]! + (sorted[Math.ceil(index)]! - sorted[floor]!) * (index - floor);
}
export function summarizeCases(rows: CatalogMatter[]) {
  const durations = rows.map(completedDays).filter((v): v is number => v !== null);
  const terminated = rows.filter((r) => r.status === "terminated").length;
  const active = rows.filter((r) => r.status === "active").length;
  return {
    total: rows.length,
    active,
    terminated,
    other: rows.length - active - terminated,
    datedTerminations: durations.length,
    excludedTerminations: terminated - durations.length,
    medianDays: quantile(durations, 0.5),
    p25: quantile(durations, 0.25),
    p75: quantile(durations, 0.75),
  };
}

/** Exact names with punctuation, spacing and case normalized; initials and suffixes stay significant. */
export function judgeNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function uniqueJudge(name: string, judges: FjcJudge[]): FjcJudge | null {
  const key = judgeNameKey(name);
  if (!key) return null;
  const matches = judges.filter((j) => judgeNameKey(j.name) === key);
  return matches.length === 1 ? matches[0]! : null;
}
export function openServiceAt(service: JudicialService, date: string): boolean {
  const start = recordedDate(service.commissionDate ?? service.recessDate),
    end = recordedDate(service.terminationDate),
    asOf = recordedDate(date);
  if (start === null || asOf === null || start > asOf) return false;
  if ((service.terminationReason || service.terminationDate) && end === null) return false;
  return end === null || end > asOf;
}
export function ongoingJudges(judges: FjcJudge[], state: string, asOf: string) {
  return judges.filter((j) =>
    j.services.some(
      (s) => s.type === "U.S. District Court" && s.state === state && openServiceAt(s, asOf),
    ),
  );
}

/** Ambiguous native court IDs stay unmapped, even if both rows have familiar titles. */
export function courtStates(courts: ResearchData["courts"]["records"]): Map<string, string> {
  return exactCourtLocations(courts);
}
export function casesForState(
  rows: CatalogMatter[],
  state: string,
  mapping: Map<string, string>,
): CatalogMatter[] {
  return state === "ALL"
    ? rows
    : rows.filter((row) => row.court && mapping.get(row.court) === state);
}
export type StateComparison = PopulationState &
  WorkloadState & {
    filingsPer100k: number | null;
    filingChange: number | null;
    clearance: number | null;
    pendingPer100k: number | null;
    sampleCases: number;
    districtJudges: number;
  };
export function stateComparisons(data: ResearchData, cases: CatalogMatter[]): StateComparison[] {
  const mapping = courtStates(data.courts.records);
  return data.population.states.flatMap((state) => {
    const workload = data.workload.jurisdictions.find((w) => w.code === state.code);
    if (!workload) return [];
    return [
      {
        ...state,
        ...workload,
        filingsPer100k:
          state.population2025 > 0 ? (workload.filed2025 / state.population2025) * 100000 : null,
        pendingPer100k:
          state.population2025 > 0 ? (workload.pending2025 / state.population2025) * 100000 : null,
        filingChange:
          workload.filed2024 > 0 ? (workload.filed2025 / workload.filed2024 - 1) * 100 : null,
        clearance:
          workload.filed2025 > 0 ? (workload.terminated2025 / workload.filed2025) * 100 : null,
        sampleCases: casesForState(cases, state.code, mapping).length,
        districtJudges: ongoingJudges(data.judiciary.judges, state.code, "2025-09-30").length,
      },
    ];
  });
}

export type Pair = { label: string; x: number | null; y: number | null };
function pearson(pairs: { x: number; y: number }[]): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length,
    x = pairs.reduce((s, p) => s + p.x, 0) / n,
    y = pairs.reduce((s, p) => s + p.y, 0) / n;
  const xx = pairs.reduce((s, p) => s + (p.x - x) ** 2, 0),
    yy = pairs.reduce((s, p) => s + (p.y - y) ** 2, 0);
  if (!xx || !yy) return null;
  return Math.max(
    -1,
    Math.min(1, pairs.reduce((s, p) => s + (p.x - x) * (p.y - y), 0) / Math.sqrt(xx * yy)),
  );
}
function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let begin = 0; begin < sorted.length;) {
    let end = begin + 1;
    while (end < sorted.length && sorted[end]!.value === sorted[begin]!.value) end++;
    for (let i = begin; i < end; i++) result[sorted[i]!.index] = (begin + end + 1) / 2;
    begin = end;
  }
  return result;
}
export function correlations(input: Pair[]) {
  const pairs = input.filter(
    (p): p is Pair & { x: number; y: number } =>
      typeof p.x === "number" &&
      Number.isFinite(p.x) &&
      typeof p.y === "number" &&
      Number.isFinite(p.y),
  );
  const xRanks = ranks(pairs.map((p) => p.x)),
    yRanks = ranks(pairs.map((p) => p.y));
  return {
    n: pairs.length,
    excluded: input.length - pairs.length,
    pairs,
    pearson: pearson(pairs),
    spearman: pearson(pairs.map((_, index) => ({ x: xRanks[index]!, y: yRanks[index]! }))),
  };
}

export type Relationship = "mdl" | "judge" | "firm" | "court";
export function relatedCases(
  selected: CatalogMatter,
  rows: CatalogMatter[],
  relationship: Relationship,
  masters: Record<string, string>,
) {
  const mdl = mdlForMatter(selected, masters);
  return rows.filter(
    (row) =>
      row.docket_id !== selected.docket_id &&
      (relationship === "mdl"
        ? !!mdl && mdlForMatter(row, masters) === mdl
        : relationship === "judge"
          ? !!selected.judge && row.judge === selected.judge
          : relationship === "court"
            ? !!selected.court && row.court === selected.court
            : (selected.firms ?? []).some((firm) => (row.firms ?? []).includes(firm))),
  );
}

export function exportJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Keep the Blob URL alive until the browser has started consuming the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
