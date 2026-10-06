import {
  CLAIM_TYPES,
  type CoverageRow,
  type JudicialReference,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
  LIMITATION_SOURCE_AUTHORITY_KINDS,
} from "./types";

const STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);
const RULE_KINDS = new Set([
  "limitations",
  "repose",
  "accrual",
  "tolling",
  "borrowing",
  "validity",
  "counting",
  "transition",
]);
const COMPUTATIONS = new Set(["baseline_only", "research_only"]);
const SOURCE_AUTHORITY_KINDS = new Set<string>(LIMITATION_SOURCE_AUTHORITY_KINDS);
const ACCRUAL_BASES = new Set([
  "confirmed_accrual",
  "death",
  "discovery_of_death",
  "requires_review",
]);
const CALCULATION_MODES = new Set([
  "discovery_min",
  "diagnosis",
  "death_cause_min",
  "accrual_repose_min",
]);

// Every value is checked field-by-field below before the raw snapshot is cast to the app type.
type KnownField =
  | "id"
  | "schemaVersion"
  | "ruleVersion"
  | "jurisdiction"
  | "claimType"
  | "ruleKind"
  | "computation"
  | "reviewStatus"
  | "accrualBasis"
  | "period"
  | "amount"
  | "unit"
  | "sourceIds"
  | "conditions"
  | "exclusions"
  | "warnings"
  | "effectiveFrom"
  | "effectiveThrough"
  | "caseReferenceIds"
  | "subtype"
  | "calculation"
  | "mode"
  | "deathCapYears"
  | "secondaryCapYears"
  | "requiresExposureWithinDeliveryYears"
  | "reposeYears"
  | "reposeTrigger"
  | "reposeEffectiveFrom"
  | "reposeEffectiveThrough"
  | "title"
  | "publisher"
  | "method"
  | "validity"
  | "historicalApplicability"
  | "state"
  | "url"
  | "capturedAt"
  | "verifiedAt"
  | "textPath"
  | "sha256"
  | "byteLength"
  | "authorityKind"
  | "citation"
  | "court"
  | "decidedAt"
  | "copyPublisher"
  | "holding"
  | "applicationLimits"
  | "subsequentTreatment"
  | "officialPdfUrl"
  | "pdfDownloaded"
  | "rawCapture"
  | "contentType"
  | "retrievedAt"
  | "name"
  | "sourceStatus"
  | "coverage"
  | "discoverySource"
  | "discoveryLinks"
  | "publisherLinks"
  | "metadataOnlyReferences"
  | "status"
  | "format"
  | "note"
  | "referenceMeaning"
  | "snapshotDate"
  | "reviewMeaning"
  | "dateMeaning"
  | "rules"
  | "sources"
  | "cases"
  | "baselineRuleIds"
  | "researchRuleIds"
  | "gaps"
  | "variants"
  | "storageKey"
  | "storageBucket"
  | "note"
  | "sourceId"
  | "extendsWhenLastDayIsHoliday"
  | "extendsWhenLastDayIsWeekend"
  | "timeComputation"
  | "accrualKind"
  | "entryStatus"
  | "confidence"
  | "effectiveDate"
  | "lastAmended"
  | "text"
  | "date"
  | "tolling"
  | "repose"
  | "flags"
  | "years"
  | "trigger"
  | "crossCheckSourceIds"
  | "provenance"
  | "claimCoverage"
  | "ruleId"
  | "reason"
  | "excerpt"
  | "periodEvidence"
  | "accrualText"
  | "confidenceNote"
  | "claimType";
type UnknownRecord = Record<string, unknown> & Partial<Record<KnownField, unknown>>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as UnknownRecord;
}

function fail(message: string): never {
  throw new Error(`Invalid limitations snapshot: ${message}.`);
}

function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a nonempty string`);
}

function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))
    fail(`${label} must be an array of nonempty strings`);
  if (new Set(value).size !== value.length) fail(`${label} contains duplicate values`);
}

function civilDate(value: unknown, label: string): asserts value is string {
  string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be an ISO civil date`);
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31)
    fail(`${label} is out of range`);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  )
    fail(`${label} is not a real calendar date`);
}

function timestamp(value: unknown, label: string): asserts value is string {
  string(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    fail(`${label} must be a UTC ISO timestamp`);
}

function verificationDate(value: unknown, label: string): asserts value is string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) civilDate(value, label);
  else timestamp(value, label);
}

function url(value: unknown, label: string): asserts value is string {
  string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(`${label} must be an absolute HTTP(S) URL`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    fail(`${label} must be a safe HTTP(S) URL`);
}

function textPath(value: unknown, label: string): asserts value is string {
  string(value, label);
  if (!/^\/data\/limitations\/(?:text|opinion-text)\/[a-z0-9][a-z0-9._-]*\.txt$/.test(value))
    fail(`${label} must be a normalized limitations text path`);
}

function digest(value: unknown, label: string): asserts value is string {
  string(value, label);
  if (!/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be a lowercase SHA-256 digest`);
}

function positiveInteger(value: unknown, label: string, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max)
    fail(`${label} must be a positive integer no greater than ${max}`);
}

function validLink(value: unknown, label: string, hasStatus = false): void {
  const link = record(value, label);
  string(link.title, `${label}.title`);
  url(link.url, `${label}.url`);
  if (hasStatus) string(link.status, `${label}.status`);
}

const ACCRUAL_KINDS = new Set([
  "accrual",
  "discovery",
  "occurrence",
  "death",
  "treatment_end",
  "breach",
  "other",
  "not_recorded",
]);

function validateProvenance(value: unknown, label: string): void {
  const p = record(value, `${label}.provenance`);
  for (const field of ["citation", "excerpt", "periodEvidence", "accrualText", "confidenceNote"])
    string(p[field], `${label}.provenance.${field}`);
  if (!ACCRUAL_KINDS.has(p.accrualKind as string))
    fail(`${label}.provenance has an unsupported accrual kind`);
  if (!["verified", "flagged"].includes(p.entryStatus as string))
    fail(`${label}.provenance has an unsupported entry status`);
  if (!["high", "medium", "low"].includes(p.confidence as string))
    fail(`${label}.provenance has an unsupported confidence`);
  timestamp(p.retrievedAt, `${label}.provenance.retrievedAt`);
  if (p.effectiveDate !== null) civilDate(p.effectiveDate, `${label}.provenance.effectiveDate`);
  const amended = record(p.lastAmended, `${label}.provenance.lastAmended`);
  if (typeof amended.text !== "string")
    fail(`${label}.provenance.lastAmended.text must be a string`);
  if (amended.date !== null) civilDate(amended.date, `${label}.provenance.lastAmended.date`);
  if (!Array.isArray(p.tolling) || !Array.isArray(p.repose) || !Array.isArray(p.flags))
    fail(`${label}.provenance has malformed tolling, repose or flags`);
  for (const item of p.tolling as unknown[]) {
    const t = record(item, `${label}.provenance.tolling`);
    string(t.text, `${label}.provenance.tolling.text`);
    string(t.citation, `${label}.provenance.tolling.citation`);
  }
  for (const item of p.repose as unknown[]) {
    const r = record(item, `${label}.provenance.repose`);
    positiveInteger(r.years, `${label}.provenance.repose.years`, 100);
    string(r.citation, `${label}.provenance.repose.citation`);
    string(r.trigger, `${label}.provenance.repose.trigger`);
    if (r.effectiveFrom !== null)
      civilDate(r.effectiveFrom, `${label}.provenance.repose.effectiveFrom`);
  }
  if ((p.flags as unknown[]).some((f) => typeof f !== "string" || !f.trim()))
    fail(`${label}.provenance.flags must be nonempty strings`);
  strings(p.crossCheckSourceIds, `${label}.provenance.crossCheckSourceIds`);
}

function validateRules(values: unknown): LimitationRule[] {
  if (!Array.isArray(values)) fail("rules must be an array");
  const ids = new Set<string>();
  const baselineKeys = new Set<string>();
  for (const [index, value] of values.entries()) {
    const r = record(value, `rules[${index}]`);
    const label = `rule ${String(r.id ?? index)}`;
    for (const field of [
      "id",
      "schemaVersion",
      "ruleVersion",
      "jurisdiction",
      "pinpoint",
      "scope",
      "validity",
      "historicalApplicability",
      "summary",
    ])
      string(r[field], `${label}.${field}`);
    if (r.schemaVersion !== "1.0.0") fail(`${label} has an unsupported schema`);
    if (r.jurisdiction !== "US" && !STATE_CODES.has(r.jurisdiction as string))
      fail(`${label} has an unknown jurisdiction`);
    if (!CLAIM_TYPES.includes(r.claimType as (typeof CLAIM_TYPES)[number]))
      fail(`${label} has an unsupported claim type`);
    if (!RULE_KINDS.has(r.ruleKind as string) || !COMPUTATIONS.has(r.computation as string))
      fail(`${label} has an unsupported rule kind or computation`);
    if (r.reviewStatus !== "statutory_text_verified")
      fail(`${label} has an unsupported review status`);
    if (!ACCRUAL_BASES.has(r.accrualBasis as string))
      fail(`${label} has an unsupported accrual basis`);
    if (r.period !== null) {
      const period = record(r.period, `${label}.period`);
      positiveInteger(period.amount, `${label}.period.amount`, 36500);
      if (!["calendar_years", "calendar_months", "calendar_days"].includes(period.unit as string))
        fail(`${label} has an unsupported period unit`);
      if (period.unit === "calendar_years" && (period.amount as number) > 100)
        fail(`${label} period is out of range`);
      if (period.unit === "calendar_months" && (period.amount as number) > 1200)
        fail(`${label} period is out of range`);
      if (period.unit === "calendar_days" && (period.amount as number) > 36500)
        fail(`${label} period is out of range`);
    }
    if (r.computation === "baseline_only" && r.period === null)
      fail(`${label} baseline has no period`);
    strings(r.sourceIds, `${label}.sourceIds`);
    strings(r.conditions, `${label}.conditions`);
    strings(r.exclusions, `${label}.exclusions`);
    strings(r.warnings, `${label}.warnings`);
    if (!r.sourceIds.length) fail(`${label} has no source link`);
    for (const field of ["effectiveFrom", "effectiveThrough"])
      if (r[field] !== null) civilDate(r[field], `${label}.${field}`);
    if (
      r.effectiveFrom &&
      r.effectiveThrough &&
      (r.effectiveFrom as string) > (r.effectiveThrough as string)
    )
      fail(`${label} has an inverted effective window`);
    if (r.caseReferenceIds !== undefined) strings(r.caseReferenceIds, `${label}.caseReferenceIds`);
    if (r.provenance !== undefined) validateProvenance(r.provenance, label);
    if (r.subtype !== undefined) string(r.subtype, `${label}.subtype`);
    if (r.calculation !== undefined) {
      const calculation = record(r.calculation, `${label}.calculation`);
      if (!CALCULATION_MODES.has(calculation.mode as string))
        fail(`${label} has an unsupported calculation mode`);
      for (const field of [
        "deathCapYears",
        "secondaryCapYears",
        "requiresExposureWithinDeliveryYears",
        "reposeYears",
      ])
        if (calculation[field] !== undefined)
          positiveInteger(calculation[field], `${label}.calculation.${field}`, 100);
      if (calculation.mode === "accrual_repose_min") {
        positiveInteger(calculation.reposeYears, `${label}.calculation.reposeYears`, 100);
        civilDate(calculation.reposeEffectiveFrom, `${label}.calculation.reposeEffectiveFrom`);
        if (calculation.reposeEffectiveThrough !== undefined) {
          civilDate(
            calculation.reposeEffectiveThrough,
            `${label}.calculation.reposeEffectiveThrough`,
          );
          if (
            (calculation.reposeEffectiveFrom as string) >
            (calculation.reposeEffectiveThrough as string)
          )
            fail(`${label} has a reversed repose applicability window`);
        }
        if (
          !["last_act_or_omission", "act_or_omission"].includes(
            calculation.reposeTrigger as string,
          ) ||
          r.accrualBasis !== "confirmed_accrual" ||
          calculation.deathCapYears !== undefined ||
          calculation.secondaryCapYears !== undefined ||
          calculation.requiresExposureWithinDeliveryYears !== undefined
        )
          fail(`${label} has an unsupported accrual/repose combination`);
      } else if (
        calculation.reposeYears !== undefined ||
        calculation.reposeTrigger !== undefined ||
        calculation.reposeEffectiveFrom !== undefined ||
        calculation.reposeEffectiveThrough !== undefined
      ) {
        fail(`${label} has repose fields without the accrual/repose calculation mode`);
      }
    }
    if (r.computation === "baseline_only") {
      const key = `${r.jurisdiction}|${r.claimType}|${r.subtype ?? "general"}`;
      if (baselineKeys.has(key)) fail(`multiple baseline rules exist for ${key}`);
      baselineKeys.add(key);
    }
    if (ids.has(r.id as string)) fail(`duplicate rule ID ${String(r.id)}`);
    ids.add(r.id as string);
  }
  return values as LimitationRule[];
}

function validateRawCapture(value: unknown, label: string): UnknownRecord {
  const capture = record(value, label);
  digest(capture.sha256, `${label}.sha256`);
  positiveInteger(capture.byteLength, `${label}.byteLength`, Number.MAX_SAFE_INTEGER);
  string(capture.contentType, `${label}.contentType`);
  timestamp(capture.retrievedAt, `${label}.retrievedAt`);
  if (capture["storageKey"] !== undefined || capture["storageBucket"] !== undefined) {
    const key = capture["storageKey"];
    if (
      capture["storageBucket"] !== "corpus-originals" ||
      typeof key !== "string" ||
      !/^limitations-raw-captures\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.bin$/.test(key) ||
      key !==
        `limitations-raw-captures/sha256/${String(capture.sha256).slice(0, 2)}/${String(capture.sha256)}.bin`
    )
      fail(`${label} has an invalid raw-capture storage location`);
  }
  return capture;
}

function validateSources(values: unknown): LimitationSource[] {
  if (!Array.isArray(values)) fail("sources must be an array");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, value] of values.entries()) {
    const s = record(value, `sources[${index}]`);
    const label = `source ${String(s.id ?? index)}`;
    for (const field of [
      "id",
      "title",
      "publisher",
      "method",
      "schemaVersion",
      "validity",
      "historicalApplicability",
    ])
      string(s[field], `${label}.${field}`);
    if (s.schemaVersion !== "1.0.0" || !SOURCE_AUTHORITY_KINDS.has(s.authorityKind as string))
      fail(`${label} has unsupported source metadata`);
    if (s.state !== "US" && !STATE_CODES.has(s.state as string))
      fail(`${label} has an unknown jurisdiction code`);
    url(s.url, `${label}.url`);
    timestamp(s.capturedAt, `${label}.capturedAt`);
    verificationDate(s.verifiedAt, `${label}.verifiedAt`);
    textPath(s.textPath, `${label}.textPath`);
    digest(s.sha256, `${label}.sha256`);
    positiveInteger(s.byteLength, `${label}.byteLength`, Number.MAX_SAFE_INTEGER);
    if (s.rawCapture !== undefined) validateRawCapture(s.rawCapture, `${label}.rawCapture`);
    if (ids.has(s.id as string)) fail(`duplicate source ID ${String(s.id)}`);
    if (paths.has(s.textPath as string)) fail(`duplicate source text path ${String(s.textPath)}`);
    ids.add(s.id as string);
    paths.add(s.textPath as string);
  }
  return values as LimitationSource[];
}

function validateCases(values: unknown): JudicialReference[] {
  if (!Array.isArray(values)) fail("cases must be an array");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, value] of values.entries()) {
    const c = record(value, `cases[${index}]`);
    const label = `case ${String(c.id ?? index)}`;
    for (const field of [
      "id",
      "jurisdiction",
      "title",
      "citation",
      "court",
      "pinpoint",
      "copyPublisher",
      "holding",
      "applicationLimits",
      "subsequentTreatment",
    ])
      string(c[field], `${label}.${field}`);
    if (c.jurisdiction !== "US" && !STATE_CODES.has(c.jurisdiction as string))
      fail(`${label} has an unknown jurisdiction`);
    civilDate(c.decidedAt, `${label}.decidedAt`);
    timestamp(c.capturedAt, `${label}.capturedAt`);
    url(c.url, `${label}.url`);
    if (c.officialPdfUrl !== undefined) url(c.officialPdfUrl, `${label}.officialPdfUrl`);
    if (c["textScope"] !== undefined) string(c["textScope"], `${label}.textScope`);
    textPath(c.textPath, `${label}.textPath`);
    digest(c.sha256, `${label}.sha256`);
    positiveInteger(c.byteLength, `${label}.byteLength`, Number.MAX_SAFE_INTEGER);
    if (typeof c.pdfDownloaded !== "boolean")
      fail(`${label} has an unsupported PDF download state`);
    const raw =
      c.rawCapture === undefined ? null : validateRawCapture(c.rawCapture, `${label}.rawCapture`);
    const capturedPdf =
      typeof raw?.contentType === "string" &&
      raw.contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
    if (
      c.pdfDownloaded &&
      (!capturedPdf ||
        typeof c.officialPdfUrl !== "string" ||
        !c.officialPdfUrl.startsWith("https://"))
    )
      fail(`${label} has a PDF download claim without official HTTPS URL and raw PDF provenance`);
    if (!c.pdfDownloaded && capturedPdf)
      fail(`${label} contradicts its captured raw PDF provenance`);
    if (ids.has(c.id as string)) fail(`duplicate case ID ${String(c.id)}`);
    if (paths.has(c.textPath as string)) fail(`duplicate case text path ${String(c.textPath)}`);
    ids.add(c.id as string);
    paths.add(c.textPath as string);
  }
  return values as JudicialReference[];
}

function validateCoverage(values: unknown): CoverageRow[] {
  if (!Array.isArray(values) || values.length !== 51)
    fail("coverage must contain exactly 51 jurisdictions");
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const c = record(value, `coverage[${index}]`);
    const label = `coverage row ${String(c.state ?? index)}`;
    if (typeof c.state !== "string" || !STATE_CODES.has(c.state) || seen.has(c.state))
      fail(`${label} has an invalid or duplicate state code`);
    seen.add(c.state);
    string(c.name, `${label}.name`);
    if (!new Set(["primary_text_retrieved", "primary_text_pending"]).has(c.sourceStatus as string))
      fail(`${label} has an unsupported source status`);
    if (!new Set(["conditional_baselines", "research_only", "pending"]).has(c.coverage as string))
      fail(`${label} has an unsupported coverage state`);
    for (const field of ["sourceIds", "baselineRuleIds", "researchRuleIds", "gaps"])
      strings(c[field], `${label}.${field}`);
    url(c.discoverySource, `${label}.discoverySource`);
    if (
      !Array.isArray(c.discoveryLinks) ||
      !Array.isArray(c.publisherLinks) ||
      !Array.isArray(c.metadataOnlyReferences)
    )
      fail(`${label} has malformed source link collections`);
    if (c.timeComputation !== undefined) {
      const t = record(c.timeComputation, `${label}.timeComputation`);
      if (!["verified", "flagged"].includes(t.status as string))
        fail(`${label}.timeComputation has an unsupported status`);
      if (typeof t.extendsWhenLastDayIsWeekend !== "boolean")
        fail(`${label}.timeComputation.extendsWhenLastDayIsWeekend must be a boolean`);
      if (
        t.extendsWhenLastDayIsHoliday !== null &&
        typeof t.extendsWhenLastDayIsHoliday !== "boolean"
      )
        fail(`${label}.timeComputation.extendsWhenLastDayIsHoliday must be a boolean or null`);
      for (const f of ["citation", "excerpt", "sourceId", "note"])
        string(t[f], `${label}.timeComputation.${f}`);
      timestamp(t.retrievedAt, `${label}.timeComputation.retrievedAt`);
    }
    if (c.claimCoverage !== undefined) {
      if (!Array.isArray(c.claimCoverage)) fail(`${label}.claimCoverage must be an array`);
      const seenClaims = new Set<string>();
      for (const [i, item] of (c.claimCoverage as unknown[]).entries()) {
        const cc = record(item, `${label}.claimCoverage[${i}]`);
        if (
          !CLAIM_TYPES.includes(cc.claimType as (typeof CLAIM_TYPES)[number]) ||
          seenClaims.has(cc.claimType as string)
        )
          fail(`${label}.claimCoverage[${i}] has an unknown or duplicate claim type`);
        seenClaims.add(cc.claimType as string);
        if (!["baseline", "research_only", "flagged", "not_recorded"].includes(cc.status as string))
          fail(`${label}.claimCoverage[${i}] has an unsupported status`);
        if (cc.status === "not_recorded") string(cc.reason, `${label}.claimCoverage[${i}].reason`);
        else string(cc.ruleId, `${label}.claimCoverage[${i}].ruleId`);
        if (cc["variants"] !== undefined) {
          if (!Array.isArray(cc["variants"]))
            fail(`${label}.claimCoverage[${i}].variants must be an array`);
          for (const [j, v] of (cc["variants"] as unknown[]).entries()) {
            const variant = record(v, `${label}.claimCoverage[${i}].variants[${j}]`);
            string(variant["subtype"], `${label}.claimCoverage[${i}].variants[${j}].subtype`);
            string(variant.ruleId, `${label}.claimCoverage[${i}].variants[${j}].ruleId`);
            if (!["baseline", "research_only", "flagged"].includes(variant.status as string))
              fail(`${label}.claimCoverage[${i}].variants[${j}] has an unsupported status`);
          }
        }
      }
    }
    c.discoveryLinks.forEach((link, i) => validLink(link, `${label}.discoveryLinks[${i}]`));
    c.publisherLinks.forEach((link, i) => validLink(link, `${label}.publisherLinks[${i}]`, true));
    c.metadataOnlyReferences.forEach((value, i) => {
      const ref = record(value, `${label}.metadataOnlyReferences[${i}]`);
      string(ref.title, `${label}.metadataOnlyReferences[${i}].title`);
      url(ref.url, `${label}.metadataOnlyReferences[${i}].url`);
      string(ref.format, `${label}.metadataOnlyReferences[${i}].format`);
      string(ref.note, `${label}.metadataOnlyReferences[${i}].note`);
    });
  }
  if (seen.size !== STATE_CODES.size || [...STATE_CODES].some((state) => !seen.has(state)))
    fail("coverage is missing a state or DC");
  return values as CoverageRow[];
}

export function validateLimitationsSnapshot(input: {
  rules: unknown;
  sources: unknown;
  coverage: unknown;
  cases: unknown;
}): LimitationsSnapshot {
  const rulesFile = record(input.rules, "rules snapshot");
  const sourcesFile = record(input.sources, "sources snapshot");
  const coverageFile = record(input.coverage, "coverage snapshot");
  const casesFile = record(input.cases, "case snapshot");
  for (const [label, file] of [
    ["rules", rulesFile],
    ["sources", sourcesFile],
    ["coverage", coverageFile],
    ["cases", casesFile],
  ] as const) {
    if (file.schemaVersion !== "1.0.0") fail(`${label} snapshot has an unsupported schema`);
    civilDate(file.snapshotDate, `${label}.snapshotDate`);
  }
  string(rulesFile.ruleVersion, "rules.ruleVersion");
  string(rulesFile.reviewMeaning, "rules.reviewMeaning");
  string(rulesFile.dateMeaning, "rules.dateMeaning");
  string(casesFile.referenceMeaning, "cases.referenceMeaning");
  if (
    [sourcesFile, coverageFile, casesFile].some(
      (file) => file.snapshotDate !== rulesFile.snapshotDate,
    )
  )
    fail("source snapshots have inconsistent snapshot dates");

  const rules = validateRules(rulesFile.rules);
  const sources = validateSources(sourcesFile.sources);
  const coverage = validateCoverage(coverageFile.coverage);
  const cases = validateCases(casesFile.cases);
  const sourceIds = new Set(sources.map((source) => source.id));
  const caseIds = new Set(cases.map((item) => item.id));
  for (const rule of rules) {
    if (rule.sourceIds.some((id) => !sourceIds.has(id)))
      fail(`rule ${rule.id} links to a missing source`);
    if (
      rule.computation === "baseline_only" &&
      !rule.sourceIds.some((id) =>
        sources.some((source) => source.id === id && source.authorityKind === "statute"),
      )
    )
      fail(`baseline rule ${rule.id} must link to at least one statute source`);
    if (rule.caseReferenceIds?.some((id) => !caseIds.has(id)))
      fail(`rule ${rule.id} links to a missing case`);
  }
  for (const row of coverage) {
    if (row.timeComputation && !sourceIds.has(row.timeComputation.sourceId))
      fail(`${row.state} timeComputation links to a missing source`);
    const expectedSources = sources
      .filter((source) => source.state === row.state)
      .map((source) => source.id)
      .sort();
    const expectedBaseline = rules
      .filter((rule) => rule.jurisdiction === row.state && rule.computation === "baseline_only")
      .map((rule) => rule.id)
      .sort();
    const expectedResearch = rules
      .filter((rule) => rule.jurisdiction === row.state && rule.computation === "research_only")
      .map((rule) => rule.id)
      .sort();
    if (JSON.stringify([...row.sourceIds].sort()) !== JSON.stringify(expectedSources))
      fail(`${row.state} coverage source links do not match source inventory`);
    if (JSON.stringify([...row.baselineRuleIds].sort()) !== JSON.stringify(expectedBaseline))
      fail(`${row.state} baseline links do not match rule inventory`);
    if (JSON.stringify([...row.researchRuleIds].sort()) !== JSON.stringify(expectedResearch))
      fail(`${row.state} research links do not match rule inventory`);
    if ((row.sourceStatus === "primary_text_retrieved") !== expectedSources.length > 0)
      fail(`${row.state} source status conflicts with source inventory`);
    if ((row.coverage === "conditional_baselines") !== expectedBaseline.length > 0)
      fail(`${row.state} coverage label conflicts with baseline inventory`);
  }
  return {
    schemaVersion: "1.0.0",
    ruleVersion: rulesFile.ruleVersion as string,
    snapshotDate: rulesFile.snapshotDate as string,
    reviewMeaning: rulesFile.reviewMeaning as string,
    dateMeaning: rulesFile.dateMeaning as string,
    rules,
    sources,
    coverage,
    cases,
  };
}
