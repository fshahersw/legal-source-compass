import { fetchBundleSnapshot } from "@/lib/private-data/client";
export type EntryAnalysisScope = {
  nativeDocketId: string;
  sourceMdlNumber: string | null;
  complete: boolean;
  capturedEntries: number;
  eligibleEntries: number;
  excludedEntries: number;
  sourceBlockedEntries: number;
  explicitlySealedEntries: number;
  datedEntries: number;
  missingDateEntries: number;
  invalidDateEntries: number;
  afterCaptureDateEntries: number;
  filingRange: { first: string | null; last: string | null };
  filingYears: { year: number; entries: number }[];
  court: {
    nativeId: string;
    name: string;
    resourceUrl: string;
    officialUrl: string | null;
    sourceAsOf: string | null;
    recordSha256: string;
    sourceUrl: string;
    sourceSha256: string;
  };
  sourceDocketUrl: string;
  entryListingUrl: string | null;
  headerEvidence: {
    sourceUrl: string;
    retrievedAt: string;
    recordSha256: string;
    sourceSha256: string;
  };
};
export type EntryAnalysis = {
  schemaVersion: string;
  projectionSchema?: string;
  publicationState?: string;
  publicationProof?: {
    dataset: "cl_master_entries";
    ready: true;
    importedRecords: number;
    fullFieldsSha256: string;
    missingRecords: 0;
    mismatchedRecords: 0;
    unexpectedRecords: 0;
  };
  generatedAt: string;
  sourceRuns: string[];
  sourceSignatureSha256: string;
  grain: string;
  snapshot: { first: string; last: string };
  sourceFiles: { kind: string; bytes: number; sha256: string }[];
  pdfDownloads: number;
  qualification: string;
  scopeCount: number;
  completeScopeCount: number;
  partialScopeCount: number;
  totals: Omit<
    EntryAnalysisScope,
    | "nativeDocketId"
    | "sourceMdlNumber"
    | "complete"
    | "complete"
    | "filingRange"
    | "filingYears"
    | "court"
    | "sourceDocketUrl"
    | "entryListingUrl"
    | "headerEvidence"
  >;
  scopes: EntryAnalysisScope[];
};

export const ENTRY_ANALYSIS_URL = "/data/quality/courtlistener-entry-analysis-2026-10-02.json";

const SUPPORTED_SCHEMAS = new Set([
  "courtlistener-entry-analysis/1",
  "courtlistener-entry-analysis/3",
  "courtlistener-entry-analysis/4",
]);
const COUNT_FIELDS = [
  "capturedEntries",
  "eligibleEntries",
  "excludedEntries",
  "sourceBlockedEntries",
  "explicitlySealedEntries",
  "datedEntries",
  "missingDateEntries",
  "invalidDateEntries",
  "afterCaptureDateEntries",
] as const;
const SCOPE_FIELDS = [
  "nativeDocketId",
  "sourceMdlNumber",
  "complete",
  ...COUNT_FIELDS,
  "filingRange",
  "filingYears",
  "court",
  "sourceDocketUrl",
  "entryListingUrl",
  "headerEvidence",
];
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}
function webUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Validate the public aggregate boundary before rendering any counts or source links. */
function validSnapshot(value: unknown): value is EntryAnalysis {
  if (
    !isObject(value) ||
    typeof value["schemaVersion"] !== "string" ||
    !SUPPORTED_SCHEMAS.has(value["schemaVersion"])
  )
    return false;
  const required = [
    "schemaVersion",
    "generatedAt",
    "sourceRuns",
    "sourceSignatureSha256",
    "grain",
    "snapshot",
    "sourceFiles",
    "pdfDownloads",
    "qualification",
    "scopeCount",
    "completeScopeCount",
    "partialScopeCount",
    "totals",
    "scopes",
  ];
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) =>
        ![...required, "projectionSchema", "publicationState", "publicationProof"].includes(key),
    )
  )
    return false;
  if (
    value["grain"] !== "One unique native docket entry" ||
    value["pdfDownloads"] !== 0 ||
    !text(value["qualification"]) ||
    !value["qualification"].includes("privacy-eligible") ||
    !value["qualification"].includes(
      "Partial scopes must not be compared as complete filing volumes.",
    ) ||
    !value["qualification"].includes("no outcome, likelihood or causation is inferred.") ||
    !timestamp(value["generatedAt"]) ||
    !hash(value["sourceSignatureSha256"])
  )
    return false;
  if (
    value["projectionSchema"] !== undefined &&
    value["projectionSchema"] !==
      value["schemaVersion"].replace("entry-analysis", "master-entry-metadata-view")
  )
    return false;
  if (value["publicationState"] !== undefined && !text(value["publicationState"])) return false;
  if (
    !Array.isArray(value["sourceRuns"]) ||
    !value["sourceRuns"].length ||
    !value["sourceRuns"].every((run) => typeof run === "string" && /^[a-f0-9-]{36}$/.test(run)) ||
    new Set(value["sourceRuns"]).size !== value["sourceRuns"].length
  )
    return false;
  if (
    !isObject(value["snapshot"]) ||
    !exactKeys(value["snapshot"], ["first", "last"]) ||
    !timestamp(value["snapshot"]["first"]) ||
    !timestamp(value["snapshot"]["last"]) ||
    value["snapshot"]["first"] > value["snapshot"]["last"]
  )
    return false;
  if (
    !Array.isArray(value["sourceFiles"]) ||
    !value["sourceFiles"].length ||
    !value["sourceFiles"].every(
      (source) =>
        isObject(source) &&
        exactKeys(source, ["kind", "bytes", "sha256"]) &&
        typeof source["kind"] === "string" &&
        /^[a-z0-9-]{1,100}$/.test(source["kind"]) &&
        count(source["bytes"]) &&
        source["bytes"] > 0 &&
        hash(source["sha256"]),
    )
  )
    return false;
  if (
    !count(value["scopeCount"]) ||
    !count(value["completeScopeCount"]) ||
    !count(value["partialScopeCount"]) ||
    value["scopeCount"] !== value["completeScopeCount"] + value["partialScopeCount"] ||
    !Array.isArray(value["scopes"]) ||
    value["scopes"].length !== value["scopeCount"] ||
    !isObject(value["totals"]) ||
    !exactKeys(value["totals"], COUNT_FIELDS)
  )
    return false;
  const totals = value["totals"];
  if (!COUNT_FIELDS.every((field) => count(totals[field]))) return false;
  if (value["publicationProof"] !== undefined) {
    const proof = value["publicationProof"];
    if (
      !isObject(proof) ||
      !exactKeys(proof, [
        "dataset",
        "ready",
        "importedRecords",
        "fullFieldsSha256",
        "missingRecords",
        "mismatchedRecords",
        "unexpectedRecords",
      ]) ||
      proof["dataset"] !== "cl_master_entries" ||
      proof["ready"] !== true ||
      proof["importedRecords"] !== totals["eligibleEntries"] ||
      !hash(proof["fullFieldsSha256"]) ||
      proof["missingRecords"] !== 0 ||
      proof["mismatchedRecords"] !== 0 ||
      proof["unexpectedRecords"] !== 0
    )
      return false;
  }
  if (
    typeof value["publicationState"] === "string" &&
    value["publicationState"].startsWith("published-") &&
    value["publicationProof"] === undefined
  )
    return false;
  const ids = new Set<string>();
  for (const scope of value["scopes"]) {
    if (
      !isObject(scope) ||
      !exactKeys(scope, SCOPE_FIELDS) ||
      typeof scope["nativeDocketId"] !== "string" ||
      !/^[1-9]\d{0,19}$/.test(scope["nativeDocketId"]) ||
      ids.has(scope["nativeDocketId"]) ||
      typeof scope["complete"] !== "boolean" ||
      !(
        scope["sourceMdlNumber"] === null ||
        (typeof scope["sourceMdlNumber"] === "string" && /^\d{1,8}$/.test(scope["sourceMdlNumber"]))
      ) ||
      !COUNT_FIELDS.every((field) => count(scope[field]))
    )
      return false;
    ids.add(scope["nativeDocketId"]);
    const counts = scope as unknown as EntryAnalysisScope;
    if (
      counts.capturedEntries !== counts.eligibleEntries + counts.excludedEntries ||
      counts.excludedEntries !== counts.sourceBlockedEntries + counts.explicitlySealedEntries ||
      counts.eligibleEntries !==
        counts.datedEntries + counts.missingDateEntries + counts.invalidDateEntries ||
      counts.afterCaptureDateEntries > counts.datedEntries ||
      (counts.sourceBlockedEntries > 0 && counts.eligibleEntries !== 0)
    )
      return false;
    if (
      !isObject(scope["filingRange"]) ||
      !exactKeys(scope["filingRange"], ["first", "last"]) ||
      !Array.isArray(scope["filingYears"])
    )
      return false;
    const years = new Set<number>();
    let dated = 0;
    for (const row of scope["filingYears"]) {
      if (
        !isObject(row) ||
        !exactKeys(row, ["year", "entries"]) ||
        !count(row["year"]) ||
        row["year"] < 1 ||
        row["year"] > 9999 ||
        years.has(row["year"]) ||
        !count(row["entries"]) ||
        !row["entries"]
      )
        return false;
      years.add(row["year"]);
      dated += row["entries"];
    }
    if (dated !== counts.datedEntries) return false;
    if (dated === 0) {
      if (scope["filingRange"]["first"] !== null || scope["filingRange"]["last"] !== null)
        return false;
    } else if (
      !date(scope["filingRange"]["first"]) ||
      !date(scope["filingRange"]["last"]) ||
      scope["filingRange"]["first"] > scope["filingRange"]["last"] ||
      Number(scope["filingRange"]["first"].slice(0, 4)) !== Math.min(...years) ||
      Number(scope["filingRange"]["last"].slice(0, 4)) !== Math.max(...years)
    )
      return false;
    if (
      !isObject(scope["court"]) ||
      !exactKeys(scope["court"], [
        "nativeId",
        "name",
        "resourceUrl",
        "officialUrl",
        "sourceAsOf",
        "recordSha256",
        "sourceUrl",
        "sourceSha256",
      ]) ||
      typeof scope["court"]["nativeId"] !== "string" ||
      !/^[a-z0-9_-]{1,80}$/.test(scope["court"]["nativeId"]) ||
      !text(scope["court"]["name"]) ||
      scope["court"]["resourceUrl"] !==
        `https://www.courtlistener.com/api/rest/v4/courts/${scope["court"]["nativeId"]}/` ||
      !(scope["court"]["officialUrl"] === null || webUrl(scope["court"]["officialUrl"])) ||
      !(scope["court"]["sourceAsOf"] === null || date(scope["court"]["sourceAsOf"])) ||
      !webUrl(scope["court"]["sourceUrl"]) ||
      !hash(scope["court"]["recordSha256"]) ||
      !hash(scope["court"]["sourceSha256"])
    )
      return false;
    if (
      scope["sourceDocketUrl"] !==
        `https://www.courtlistener.com/docket/${scope["nativeDocketId"]}/` ||
      scope["entryListingUrl"] !==
        (counts.eligibleEntries
          ? `/data/cl_master_entries?f=${encodeURIComponent(JSON.stringify({ native_docket_id: scope["nativeDocketId"] }))}`
          : null) ||
      !isObject(scope["headerEvidence"]) ||
      !exactKeys(scope["headerEvidence"], [
        "sourceUrl",
        "retrievedAt",
        "recordSha256",
        "sourceSha256",
      ]) ||
      scope["headerEvidence"]["sourceUrl"] !==
        `https://www.courtlistener.com/api/rest/v4/dockets/${scope["nativeDocketId"]}/` ||
      !timestamp(scope["headerEvidence"]["retrievedAt"]) ||
      !hash(scope["headerEvidence"]["recordSha256"]) ||
      !hash(scope["headerEvidence"]["sourceSha256"])
    )
      return false;
  }
  const scopes = value["scopes"] as EntryAnalysisScope[];
  return (
    scopes.filter((scope) => scope["complete"]).length === value["completeScopeCount"] &&
    COUNT_FIELDS.every(
      (field) => scopes.reduce((sum, scope) => sum + scope[field], 0) === totals[field],
    )
  );
}

export async function loadEntryAnalysis(): Promise<EntryAnalysis> {
  const response = await fetchBundleSnapshot(ENTRY_ANALYSIS_URL);
  if (!response.ok) throw new Error(`Entry snapshot returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!validSnapshot(data)) {
    throw new Error("Unsupported native entry analysis snapshot");
  }
  return data;
}

export function entryScopeLabel(scope: EntryAnalysisScope) {
  return scope.sourceMdlNumber
    ? `Source MDL ${scope.sourceMdlNumber} · docket ${scope.nativeDocketId}`
    : `Native docket ${scope.nativeDocketId}`;
}

export function summarizeEntryScopes(scopes: EntryAnalysisScope[]) {
  const years = new Map<number, number>();
  const courts = new Map<string, { label: string; count: number }>();
  const dates = scopes
    .flatMap((scope) => [scope.filingRange.first, scope.filingRange.last])
    .filter((date): date is string => !!date)
    .sort();
  for (const scope of scopes) {
    for (const year of scope.filingYears)
      years.set(year.year, (years.get(year.year) ?? 0) + year.entries);
    const court = courts.get(scope.court.nativeId) ?? { label: scope.court.name, count: 0 };
    court.count += scope.eligibleEntries;
    courts.set(scope.court.nativeId, court);
  }
  const sum = (
    field:
      | "capturedEntries"
      | "eligibleEntries"
      | "excludedEntries"
      | "datedEntries"
      | "missingDateEntries"
      | "invalidDateEntries"
      | "afterCaptureDateEntries",
  ) => scopes.reduce((n, scope) => n + scope[field], 0);
  return {
    capturedEntries: sum("capturedEntries"),
    eligibleEntries: sum("eligibleEntries"),
    excludedEntries: sum("excludedEntries"),
    datedEntries: sum("datedEntries"),
    missingDateEntries: sum("missingDateEntries"),
    invalidDateEntries: sum("invalidDateEntries"),
    afterCaptureDateEntries: sum("afterCaptureDateEntries"),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    filingYears: [...years]
      .sort(([a], [b]) => a - b)
      .map(([year, count]) => ({ label: String(year), count })),
    courts: [...courts].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.count - a.count),
  };
}
