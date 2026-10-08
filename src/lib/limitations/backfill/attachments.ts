import type { LimitationRule, PeriodUnit as RulePeriodUnit, RuleEvidenceAttachment, RuleProvenance } from "../types";
import { ACCRUAL_KINDS, CONFIDENCE_LEVELS, containsLiteral, parsePeriodQuantities } from "./entries";

/**
 * One ledgered evidence attachment (`work/evidence-attachments.json`): quoted official text for a rule that was
 * released before provenance was recorded. Nothing here may change a period, a date or a calculation; the ledger
 * only adds the statute's own words so the rule can be re-checked against its source like every other rule.
 */
export type EvidenceAttachmentInput = {
  ruleId: string;
  /** A source already in the release (or linked by `linkSource`) whose stored text contains `excerpt`. */
  evidenceSourceId: string;
  citation: string;
  excerpt: string;
  /** The words inside `excerpt` that state the period (must parse to the rule's own period when it has one). */
  periodEvidence: string;
  accrualKind: RuleProvenance["accrualKind"];
  /** Literal passage stating when the period starts, or "Not recorded" when `accrualKind` is not_recorded. */
  accrualText: string;
  /** Literal tolling passages, each from the evidence source or another source the rule links. */
  tolling?: { text: string; citation: string; sourceId?: string }[];
  confidence: RuleProvenance["confidence"];
  confidenceNote: string;
  /**
   * "flagged" records that the quoted words document a published provision whose operative status or
   * application is unresolved (named in `flags`); "verified" (default) means the quote and period were matched
   * and nothing about the provision itself is in dispute. Flags require "flagged" and vice versa.
   */
  entryStatus?: RuleProvenance["entryStatus"];
  flags?: string[];
  reason: string;
  linkSource?: boolean;
};

export type AttachmentOutcome =
  | { ruleId: string; status: "applied"; evidenceSourceId: string }
  | { ruleId: string; status: "rejected"; reason: string };

const UNIT_WORD: Record<RulePeriodUnit, "years" | "months" | "days"> = {
  calendar_years: "years",
  calendar_months: "months",
  calendar_days: "days",
};

/**
 * Attach ledgered provenance to released rules, in place, refusing any whose premise does not hold.
 *
 * An attachment is applied only when (1) the rule exists and carries no provenance yet, (2) every required
 * string is present, (3) the evidence source is in the release and linked by the rule (or `linkSource` is set),
 * (4) `excerpt` is a literal passage of that source's stored text and `periodEvidence` is a literal part of the
 * excerpt, (5) when the rule has a period, the period words state exactly that amount and unit, (6) the accrual
 * passage and every tolling passage are literal passages of a source the rule links. The rule's period,
 * calculation, dates and computation are never touched.
 */
export function applyEvidenceAttachments(
  rules: LimitationRule[],
  ledger: EvidenceAttachmentInput[],
  io: {
    ruleVersion: string;
    hasSource: (id: string) => boolean;
    textOf: (id: string) => string;
    retrievedAtOf: (id: string) => string | null;
  },
): AttachmentOutcome[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: AttachmentOutcome[] = [];
  const seen = new Set<string>();
  for (const a of ledger) {
    const reject = (reason: string) => out.push({ ruleId: a.ruleId, status: "rejected", reason });
    const rule = byId.get(a.ruleId);
    if (!rule) {
      reject("rule is not in the release");
      continue;
    }
    if (seen.has(a.ruleId)) {
      reject("a second attachment for the same rule in one ledger");
      continue;
    }
    if (rule.provenance) {
      reject("rule already carries provenance; attachments never replace it");
      continue;
    }
    const missing = (
      [
        ["evidenceSourceId", a.evidenceSourceId],
        ["citation", a.citation],
        ["excerpt", a.excerpt],
        ["periodEvidence", a.periodEvidence],
        ["accrualText", a.accrualText],
        ["confidenceNote", a.confidenceNote],
        ["reason", a.reason],
      ] as const
    ).find(([, v]) => typeof v !== "string" || !v.trim());
    if (missing) {
      reject(`${missing[0]} is required`);
      continue;
    }
    if (!ACCRUAL_KINDS.includes(a.accrualKind)) {
      reject(`accrualKind "${String(a.accrualKind)}" is not supported`);
      continue;
    }
    if (!CONFIDENCE_LEVELS.includes(a.confidence)) {
      reject(`confidence "${String(a.confidence)}" is not supported`);
      continue;
    }
    if (!io.hasSource(a.evidenceSourceId)) {
      reject(`evidence source ${a.evidenceSourceId} is not in the release`);
      continue;
    }
    const linked = new Set(rule.sourceIds);
    if (!linked.has(a.evidenceSourceId)) {
      if (!a.linkSource) {
        reject(`rule does not link ${a.evidenceSourceId}; set linkSource to add it`);
        continue;
      }
      linked.add(a.evidenceSourceId);
    }
    const evidenceText = io.textOf(a.evidenceSourceId);
    if (!containsLiteral(evidenceText, a.excerpt)) {
      reject(`excerpt is not a literal passage of ${a.evidenceSourceId}`);
      continue;
    }
    if (!containsLiteral(a.excerpt, a.periodEvidence)) {
      reject("periodEvidence is not a literal part of the excerpt");
      continue;
    }
    if (rule.period) {
      const wantUnit = UNIT_WORD[rule.period.unit];
      const stated = parsePeriodQuantities(a.periodEvidence);
      if (!stated.some((q) => q.unit === wantUnit && q.amount === rule.period!.amount)) {
        reject(
          `periodEvidence states ${stated.map((q) => `${q.amount} ${q.unit}`).join(", ") || "no parseable period"}; rule says ${rule.period.amount} ${wantUnit}`,
        );
        continue;
      }
    }
    const literalInLinked = (needle: string, preferred?: string): boolean => {
      const ids = preferred ? [preferred] : [a.evidenceSourceId, ...linked];
      return ids.some((id) => linked.has(id) && io.hasSource(id) && containsLiteral(io.textOf(id), needle));
    };
    if (a.accrualKind === "not_recorded") {
      if (a.accrualText !== "Not recorded") {
        reject('accrualText must be "Not recorded" when accrualKind is not_recorded');
        continue;
      }
    } else if (!literalInLinked(a.accrualText)) {
      reject("accrualText is not a literal passage of a source the rule links");
      continue;
    }
    const tolling = a.tolling ?? [];
    const badTolling = tolling.findIndex(
      (t) =>
        typeof t.text !== "string" ||
        !t.text.trim() ||
        typeof t.citation !== "string" ||
        !t.citation.trim() ||
        (t.sourceId !== undefined && !linked.has(t.sourceId)) ||
        !literalInLinked(t.text, t.sourceId),
    );
    if (badTolling >= 0) {
      reject(`tolling[${badTolling}] is not a literal passage of a source the rule links`);
      continue;
    }
    const flags = a.flags ?? [];
    if (!Array.isArray(flags) || flags.some((f) => typeof f !== "string" || !f.trim())) {
      reject("flags must be nonempty strings");
      continue;
    }
    const entryStatus = a.entryStatus ?? (flags.length ? "flagged" : "verified");
    if (entryStatus !== "verified" && entryStatus !== "flagged") {
      reject(`entryStatus "${String(entryStatus)}" is not supported`);
      continue;
    }
    if (entryStatus === "flagged" && !flags.length) {
      reject("a flagged attachment must name its open issue in flags");
      continue;
    }
    if (entryStatus === "verified" && flags.length) {
      reject("verified attachments cannot carry flags; use entryStatus flagged");
      continue;
    }
    const retrievedAt = io.retrievedAtOf(a.evidenceSourceId);
    if (!retrievedAt) {
      reject(`evidence source ${a.evidenceSourceId} records no retrieval time`);
      continue;
    }
    rule.sourceIds = [...linked];
    rule.provenance = {
      citation: a.citation,
      excerpt: a.excerpt,
      periodEvidence: a.periodEvidence,
      accrualKind: a.accrualKind,
      accrualText: a.accrualText,
      tolling: tolling.map((t) => ({ text: t.text, citation: t.citation })),
      repose: [],
      lastAmended: { text: "Not recorded", date: null },
      effectiveDate: null,
      retrievedAt,
      entryStatus,
      confidence: a.confidence,
      confidenceNote: a.confidenceNote,
      flags: [...flags],
      crossCheckSourceIds: [],
    };
    const attachment: RuleEvidenceAttachment = {
      appliedInVersion: io.ruleVersion,
      reason: a.reason,
      evidenceSourceId: a.evidenceSourceId,
    };
    rule.evidenceAttachment = attachment;
    rule.ruleVersion = io.ruleVersion;
    seen.add(a.ruleId);
    out.push({ ruleId: a.ruleId, status: "applied", evidenceSourceId: a.evidenceSourceId });
  }
  return out;
}
