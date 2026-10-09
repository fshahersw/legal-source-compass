import { validateTollingPolicies } from "./tollingPolicy";
import { assertBundleBindings } from "./bundleBindings";
import {
  CLAIM_TYPES,
  PERIOD_LIMB_STARTS,
  RULE_BASES,
  RULE_CORRECTION_FIELDS,
  RULE_CURRENCY_STATUSES,
  SOURCE_CURRENCY_STATUSES,
  VERIFICATION_GRADES,
  type CoverageRow,
  type JudicialReference,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
  type RuleCorrectionField,
  type RuleBasis,
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
  "clocks_min",
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
  | "limbs"
  | "combine"
  | "clocks"
  | "unit"
  | "from"
  | "fetchRoute"
  | "kind"
  | "proxy"
  | "verification"
  | "grade"
  | "basis"
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
  | "claimType"
  | "corrections"
  | "startBasis"
  | "windowFrom";
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
    if (r["corrections"] !== undefined) {
      if (!Array.isArray(r["corrections"]) || !r["corrections"].length)
        fail(`${label}.corrections must be a non-empty array when present`);
      for (const [i, item] of (r["corrections"] as unknown[]).entries()) {
        const c = record(item, `${label}.corrections[${i}]`);
        string(c["appliedInVersion"], `${label}.corrections[${i}].appliedInVersion`);
        if (!RULE_CORRECTION_FIELDS.includes(c["field"] as RuleCorrectionField))
          fail(`${label}.corrections[${i}] changes an unsupported field`);
        if (!("from" in c) || !("to" in c)) fail(`${label}.corrections[${i}] lacks from/to`);
        string(c["reason"], `${label}.corrections[${i}].reason`);
        string(c["evidenceSourceId"], `${label}.corrections[${i}].evidenceSourceId`);
        string(c["evidenceQuote"], `${label}.corrections[${i}].evidenceQuote`);
        if (c["note"] !== undefined) {
          string(c["note"], `${label}.corrections[${i}].note`);
          if (!(r.conditions as string[]).includes(c["note"] as string))
            fail(
              `${label}.corrections[${i}] carries a note the rule's conditions no longer contain`,
            );
        }
        if (!(r.sourceIds as string[]).includes(c["evidenceSourceId"] as string))
          fail(`${label}.corrections[${i}] cites a source the rule does not link`);
      }
    }
    if (r["evidenceAttachment"] !== undefined) {
      const a = record(r["evidenceAttachment"], `${label}.evidenceAttachment`);
      string(a["appliedInVersion"], `${label}.evidenceAttachment.appliedInVersion`);
      string(a["reason"], `${label}.evidenceAttachment.reason`);
      string(a["evidenceSourceId"], `${label}.evidenceAttachment.evidenceSourceId`);
      if (!(r.sourceIds as string[]).includes(a["evidenceSourceId"] as string))
        fail(`${label}.evidenceAttachment cites a source the rule does not link`);
      if (r.provenance === undefined)
        fail(`${label}.evidenceAttachment is present but the rule carries no provenance`);
    }
    if (r["crossReferenceLinks"] !== undefined) {
      if (!Array.isArray(r["crossReferenceLinks"]))
        fail(`${label}.crossReferenceLinks must be an array`);
      if (r.provenance === undefined)
        fail(`${label}.crossReferenceLinks is present but the rule carries no provenance`);
      const p = record(r.provenance, `${label}.provenance`);
      const seen = new Set<string>();
      for (const [i, raw] of (r["crossReferenceLinks"] as unknown[]).entries()) {
        const l = record(raw, `${label}.crossReferenceLinks[${i}]`);
        const where = `${label}.crossReferenceLinks[${i}]`;
        if (l["kind"] !== "tolling" && l["kind"] !== "repose")
          fail(`${where}.kind must be tolling or repose`);
        const notes = p[l["kind"] as "tolling" | "repose"];
        if (
          !Number.isInteger(l["index"]) ||
          (l["index"] as number) < 0 ||
          !Array.isArray(notes) ||
          (l["index"] as number) >= notes.length
        )
          fail(`${where}.index names no ${l["kind"]} note on the rule`);
        const key = `${l["kind"]}:${l["index"]}`;
        if (seen.has(key)) fail(`${where} links the same note twice`);
        seen.add(key);
        string(l["citation"], `${where}.citation`);
        const note = record(
          notes[l["index"] as number],
          `${label}.provenance.${l["kind"]}[${l["index"]}]`,
        );
        if (note["citation"] !== l["citation"])
          fail(`${where}.citation does not match the note it links`);
        timestamp(l["checkedAt"], `${where}.checkedAt`);
        if (!Array.isArray(l["sections"]) || !l["sections"].length)
          fail(`${where}.sections names no section`);
        if (
          !Number.isInteger(l["sectionsNamed"]) ||
          (l["sectionsNamed"] as number) < (l["sections"] as unknown[]).length
        )
          fail(
            `${where}.sectionsNamed must be an integer no smaller than the sections that resolved`,
          );
        for (const [j, rawSection] of (l["sections"] as unknown[]).entries()) {
          const s = record(rawSection, `${where}.sections[${j}]`);
          string(s["nativeId"], `${where}.sections[${j}].nativeId`);
          if (!(s["nativeId"] as string).startsWith(`${r.jurisdiction as string}:`))
            fail(`${where}.sections[${j}] names a section outside the rule's jurisdiction`);
          string(s["textSha256"], `${where}.sections[${j}].textSha256`);
          if (!/^[0-9a-f]{64}$/.test(s["textSha256"] as string))
            fail(`${where}.sections[${j}].textSha256 must be a SHA-256 hex digest`);
        }
        if (!Array.isArray(l["terms"])) fail(`${where}.terms must be an array`);
        const terms = (l["terms"] as unknown[]).map((t, k) => {
          const term = record(t, `${where}.terms[${k}]`);
          string(term["term"], `${where}.terms[${k}].term`);
          if (typeof term["found"] !== "boolean")
            fail(`${where}.terms[${k}].found must be a boolean`);
          if (term["foundIn"] !== undefined) {
            string(term["foundIn"], `${where}.terms[${k}].foundIn`);
            if (term["found"] !== true)
              fail(`${where}.terms[${k}].foundIn is set on a term that was not found`);
            if (!(term["foundIn"] as string).startsWith(`${r.jurisdiction as string}:`))
              fail(`${where}.terms[${k}].foundIn names a section outside the rule's jurisdiction`);
          }
          return term as { term: string; found: boolean };
        });
        const expected =
          terms.length === 0
            ? "none_to_check"
            : terms.every((t) => t.found)
              ? "all_present"
              : "not_all_present";
        if (l["termCheck"] !== expected) fail(`${where}.termCheck does not follow from its terms`);
        if (l["intakeRunId"] !== null && typeof l["intakeRunId"] !== "string")
          fail(`${where}.intakeRunId must be a string or null`);
      }
    }
    if (r.provenance !== undefined) validateProvenance(r.provenance, label);
    if (r["verification"] !== undefined) {
      const v = record(r["verification"], `${label}.verification`);
      if (!VERIFICATION_GRADES.includes(v["grade"] as (typeof VERIFICATION_GRADES)[number]))
        fail(`${label}.verification has an unsupported grade`);
      string(v["basis"], `${label}.verification.basis`);
    }
    if (r["currency"] !== undefined) {
      const c = record(r["currency"], `${label}.currency`);
      timestamp(c["checkedAt"], `${label}.currency.checkedAt`);
      if (!RULE_CURRENCY_STATUSES.includes(c["status"] as (typeof RULE_CURRENCY_STATUSES)[number]))
        fail(`${label}.currency has an unsupported status`);
      string(c["detail"], `${label}.currency.detail`);
      for (const field of ["confirmedSourceIds", "uncheckedSourceIds", "lostSourceIds"])
        strings(c[field], `${label}.currency.${field}`);
      if (c["status"] === "evidence_lost" && r.computation === "baseline_only")
        fail(`${label} computes although its evidence was lost on recheck`);
      if (c["status"] === "evidence_lost" && !(c["lostSourceIds"] as string[]).length)
        fail(`${label}.currency reports lost evidence without naming a source`);
    }
    if (r.subtype !== undefined) string(r.subtype, `${label}.subtype`);
    if (r["basis"] !== undefined && !RULE_BASES.includes(r["basis"] as RuleBasis))
      fail(`${label} has an unsupported basis`);
    if (r["basis"] === "general_period" && !/general/i.test(r["summary"] as string))
      fail(`${label} applies a general provision but its summary does not say so`);
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
      if (calculation.mode === "clocks_min") {
        const limbs = calculation["limbs"];
        const clocks = calculation["clocks"] ?? [];
        if (!Array.isArray(limbs) || limbs.length < 1 || limbs.length > 2 || !Array.isArray(clocks))
          fail(`${label} has an unsupported clock configuration`);
        for (const [i, item] of (limbs as unknown[]).entries()) {
          const limb = record(item, `${label}.calculation.limbs[${i}]`);
          positiveInteger(limb["amount"], `${label}.calculation.limbs[${i}].amount`, 36500);
          if (
            !["calendar_years", "calendar_months", "calendar_days"].includes(limb["unit"] as string)
          )
            fail(`${label}.calculation.limbs[${i}] has an unsupported unit`);
          if (!PERIOD_LIMB_STARTS.includes(limb["from"] as (typeof PERIOD_LIMB_STARTS)[number]))
            fail(`${label}.calculation.limbs[${i}] has an unsupported start`);
        }
        if (
          (limbs as unknown[]).length === 2 &&
          !["earlier", "later"].includes(calculation["combine"] as string)
        )
          fail(`${label} has two period limbs without an earlier/later rule`);
        if (
          calculation["windowFrom"] !== undefined &&
          !(limbs as { from?: unknown }[]).some((l) => l.from === calculation["windowFrom"])
        )
          fail(`${label}.calculation.windowFrom is not the start of a listed limb`);
        for (const [i, item] of (clocks as unknown[]).entries()) {
          const clock = record(item, `${label}.calculation.clocks[${i}]`);
          positiveInteger(clock["years"], `${label}.calculation.clocks[${i}].years`, 100);
          if (
            ![
              "act_or_omission",
              "last_act_or_omission",
              "injury_date",
              "substantial_completion",
              "first_delivery",
            ].includes(clock["from"] as string)
          )
            fail(`${label}.calculation.clocks[${i}] has an unsupported start`);
          if (clock["effectiveFrom"] === null) {
            // A bar without a printed start date must say so explicitly; it is never silently open-ended.
            if (clock["startBasis"] !== "not_recorded")
              fail(
                `${label}.calculation.clocks[${i}] has no effectiveFrom and does not declare startBasis "not_recorded"`,
              );
          } else {
            civilDate(clock["effectiveFrom"], `${label}.calculation.clocks[${i}].effectiveFrom`);
            if (
              clock["startBasis"] !== undefined &&
              clock["startBasis"] !== "printed_effective_date"
            )
              fail(
                `${label}.calculation.clocks[${i}] has a dated start with a contradictory basis`,
              );
          }
          if (clock["effectiveThrough"] !== undefined) {
            civilDate(
              clock["effectiveThrough"],
              `${label}.calculation.clocks[${i}].effectiveThrough`,
            );
            if (
              clock["effectiveFrom"] !== null &&
              (clock["effectiveFrom"] as string) > (clock["effectiveThrough"] as string)
            )
              fail(`${label} has a reversed repose applicability window`);
          }
        }
        if (
          !["confirmed_accrual", "death"].includes(r.accrualBasis as string) ||
          calculation.deathCapYears !== undefined ||
          calculation.secondaryCapYears !== undefined ||
          calculation.requiresExposureWithinDeliveryYears !== undefined ||
          calculation.reposeYears !== undefined
        )
          fail(`${label} has an unsupported clocks combination`);
      } else if (calculation.mode === "accrual_repose_min") {
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
          !["last_act_or_omission", "act_or_omission", "first_delivery"].includes(
            calculation.reposeTrigger as string,
          ) ||
          !["confirmed_accrual", "death"].includes(r.accrualBasis as string) ||
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
    if (s["fetchRoute"] !== undefined) {
      const route = record(s["fetchRoute"], `${label}.fetchRoute`);
      if (!["direct", "proxied", "extraction"].includes(route["kind"] as string))
        fail(`${label}.fetchRoute has an unsupported kind`);
      if (
        route["kind"] === "proxied" &&
        !["firecrawl", "tavily"].includes(route["proxy"] as string)
      )
        fail(`${label}.fetchRoute names an unsupported proxy`);
    }
    if (s["currency"] !== undefined) {
      const c = record(s["currency"], `${label}.currency`);
      timestamp(c["checkedAt"], `${label}.currency.checkedAt`);
      if (
        !SOURCE_CURRENCY_STATUSES.includes(c["status"] as (typeof SOURCE_CURRENCY_STATUSES)[number])
      )
        fail(`${label}.currency has an unsupported status`);
      if (!["direct", "official_code_capture", "proxied", "none"].includes(c["route"] as string))
        fail(`${label}.currency has an unsupported route`);
      if (c["route"] === "proxied") {
        if (c["status"] === "confirmed_unchanged")
          fail(`${label}.currency: a proxied recheck cannot claim a byte-identical page`);
        if (c["rawSha256"] === undefined || c["rawStorageKey"] === undefined)
          fail(`${label}.currency: a proxied recheck must retain the proxy response`);
      }
      string(c["detail"], `${label}.currency.detail`);
      if (c["route"] === "none" && c["status"] !== "not_rechecked")
        fail(`${label}.currency claims a result without a fresh copy`);
      if (c["rawSha256"] !== undefined) digest(c["rawSha256"], `${label}.currency.rawSha256`);
      if (c["textSha256"] !== undefined) digest(c["textSha256"], `${label}.currency.textSha256`);
      if (c["httpStatus"] !== undefined)
        positiveInteger(c["httpStatus"], `${label}.currency.httpStatus`, 599);
      if (c["rawStorageKey"] !== undefined)
        string(c["rawStorageKey"], `${label}.currency.rawStorageKey`);
      if (c["freshTextPath"] !== undefined)
        textPath(c["freshTextPath"], `${label}.currency.freshTextPath`);
      if (c["route"] === "official_code_capture") {
        if (c["status"] === "confirmed_unchanged")
          fail(`${label}.currency: a code-capture recheck cannot claim a byte-identical page`);
        const cc = record(c["codeCapture"], `${label}.currency.codeCapture`);
        string(cc["jurisdiction"], `${label}.currency.codeCapture.jurisdiction`);
        string(cc["publisher"], `${label}.currency.codeCapture.publisher`);
        if (cc["runId"] !== null) string(cc["runId"], `${label}.currency.codeCapture.runId`);
        if (cc["manifestSha256"] !== null)
          digest(cc["manifestSha256"], `${label}.currency.codeCapture.manifestSha256`);
        if (cc["landedAt"] !== null)
          timestamp(cc["landedAt"], `${label}.currency.codeCapture.landedAt`);
        strings(cc["sectionNativeIds"], `${label}.currency.codeCapture.sectionNativeIds`);
        if (!cc["sectionNativeIds"].length) fail(`${label}.currency.codeCapture names no section`);
        strings(cc["sourceUrls"], `${label}.currency.codeCapture.sourceUrls`);
      } else if (c["codeCapture"] !== undefined) {
        fail(`${label}.currency carries code-capture provenance on a ${String(c["route"])} route`);
      }
      if (c["componentSourceIds"] !== undefined) {
        strings(c["componentSourceIds"], `${label}.currency.componentSourceIds`);
        if (!c["componentSourceIds"].length)
          fail(`${label}.currency.componentSourceIds names no component`);
        if (c["route"] !== "direct" || c["status"] !== "confirmed_evidence_intact")
          fail(
            `${label}.currency: a composite verdict must be a direct-route evidence-intact verdict`,
          );
        if (c["componentSourceIds"].includes(s.id as string))
          fail(`${label}.currency.componentSourceIds names the composite itself`);
      }
      if (c["passageRecheck"] !== undefined) {
        const pr = record(c["passageRecheck"], `${label}.currency.passageRecheck`);
        if (c["route"] === "proxied")
          fail(`${label}.currency.passageRecheck duplicates a proxied page-level verdict`);
        timestamp(pr["checkedAt"], `${label}.currency.passageRecheck.checkedAt`);
        if (pr["route"] !== "proxied")
          fail(`${label}.currency.passageRecheck route must be proxied`);
        string(pr["proxy"], `${label}.currency.passageRecheck.proxy`);
        digest(pr["rawSha256"], `${label}.currency.passageRecheck.rawSha256`);
        if (pr["textSha256"] !== undefined)
          digest(pr["textSha256"], `${label}.currency.passageRecheck.textSha256`);
        string(pr["rawStorageKey"], `${label}.currency.passageRecheck.rawStorageKey`);
        if (
          pr["rawStorageKey"] !==
          `limitations-raw-captures/sha256/${(pr["rawSha256"] as string).slice(0, 2)}/${String(pr["rawSha256"])}.bin`
        )
          fail(`${label}.currency.passageRecheck.rawStorageKey does not address its own rawSha256`);
        if (pr["freshTextPath"] !== undefined)
          textPath(pr["freshTextPath"], `${label}.currency.passageRecheck.freshTextPath`);
        positiveInteger(pr["passages"], `${label}.currency.passageRecheck.passages`, 10_000);
        string(pr["detail"], `${label}.currency.passageRecheck.detail`);
      }
    }
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
      if (t["supportingSourceIds"] !== undefined) {
        if (
          !Array.isArray(t["supportingSourceIds"]) ||
          t["supportingSourceIds"].length === 0 ||
          t["supportingSourceIds"].some((id) => typeof id !== "string" || id === t.sourceId)
        )
          fail(`${label}.timeComputation.supportingSourceIds must list other source IDs`);
      }
    }
    if (c["timeComputationNotRecorded"] !== undefined) {
      const n = record(c["timeComputationNotRecorded"], `${label}.timeComputationNotRecorded`);
      string(n["reason"], `${label}.timeComputationNotRecorded.reason`);
      if (typeof n["reason"] === "string" && n["reason"].trim().length < 20)
        fail(`${label}.timeComputationNotRecorded.reason must say why no rule could be recorded`);
      timestamp(n["reviewedOn"], `${label}.timeComputationNotRecorded.reviewedOn`);
      if (c.timeComputation !== undefined)
        fail(`${label} records both a counting rule and a reason for having none`);
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
        if (cc["basis"] !== undefined && !RULE_BASES.includes(cc["basis"] as RuleBasis))
          fail(`${label}.claimCoverage[${i}] has an unsupported basis`);
        if (
          cc["grade"] !== undefined &&
          !VERIFICATION_GRADES.includes(cc["grade"] as (typeof VERIFICATION_GRADES)[number])
        )
          fail(`${label}.claimCoverage[${i}] has an unsupported grade`);
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
  validateTollingPolicies(rules, sources);
  const coverage = validateCoverage(coverageFile.coverage);
  const cases = validateCases(casesFile.cases);
  const sourceIds = new Set(sources.map((source) => source.id));
  const caseIds = new Set(cases.map((item) => item.id));
  for (const source of sources) {
    for (const id of source.currency?.componentSourceIds ?? [])
      if (!sourceIds.has(id))
        fail(`source ${source.id} derives its verdict from a missing component source ${id}`);
  }
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
    if (row.timeComputation?.supportingSourceIds?.some((id) => !sourceIds.has(id)))
      fail(`${row.state} timeComputation names a missing supporting source`);
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
  assertBundleBindings(rules, sources, coverage);
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
