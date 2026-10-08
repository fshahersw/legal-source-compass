import {
  RULE_CORRECTION_FIELDS,
  type LimitationRule,
  type RuleCorrection,
  type RuleCorrectionField,
} from "../types";
import { containsLiteral } from "./entries";

/**
 * One reviewed change to a released rule, as written in the correction ledger (`work/corrections.json`).
 * Every field other than `ruleId` is copied verbatim onto the rule's `corrections[]` once applied.
 */
export type CorrectionInput = {
  ruleId: string;
  field: RuleCorrectionField;
  /** The value the live rule must hold right now (deep-equal); `null` for an absent field. */
  from: unknown;
  to: unknown;
  reason: string;
  /** A source already in the release (or linked by `linkSource`) whose stored text contains `evidenceQuote`. */
  evidenceSourceId: string;
  evidenceQuote: string;
  /** Add the evidence source to the rule's sources when the rule does not link it yet. */
  linkSource?: boolean;
  /** A condition to append to the rule with this change (shown to users; kept on the ledger entry). */
  note?: string;
};

export type CorrectionOutcome =
  | { ruleId: string; field: RuleCorrectionField; status: "applied" }
  | { ruleId: string; field: RuleCorrectionField; status: "rejected"; reason: string };

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  ) ?? "null";

/**
 * Apply ledgered corrections to released rules, in place, refusing any whose premise no longer holds.
 *
 * A correction is applied only when (1) the rule exists, (2) the field is one the ledger may change, (3) the
 * rule's current value deep-equals `from`, (4) the evidence source is known and its stored text literally
 * contains `evidenceQuote`, and (5) the rule links that source (or `linkSource` is set). A `computation`
 * change to `research_only` also drops the calculation so the rule stops computing; a change back to
 * `baseline_only` requires the rule to still hold a calculation or a period.
 */
export function applyCorrections(
  rules: LimitationRule[],
  ledger: CorrectionInput[],
  io: {
    ruleVersion: string;
    hasSource: (id: string) => boolean;
    textOf: (id: string) => string;
  },
): CorrectionOutcome[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: CorrectionOutcome[] = [];
  for (const c of ledger) {
    const reject = (reason: string) =>
      out.push({ ruleId: c.ruleId, field: c.field, status: "rejected", reason });
    const rule = byId.get(c.ruleId);
    if (!rule) {
      reject("rule is not in the release");
      continue;
    }
    if (!RULE_CORRECTION_FIELDS.includes(c.field)) {
      reject(`field "${String(c.field)}" may not be corrected in place`);
      continue;
    }
    const missing = (
      [
        ["reason", c.reason],
        ["evidenceSourceId", c.evidenceSourceId],
        ["evidenceQuote", c.evidenceQuote],
      ] as const
    ).find(([, v]) => typeof v !== "string" || !v.trim());
    if (missing) {
      reject(`${missing[0]} is required`);
      continue;
    }
    if (c.note !== undefined && (typeof c.note !== "string" || !c.note.trim())) {
      reject("note must be a non-empty string when present");
      continue;
    }
    const live = (rule as unknown as Record<string, unknown>)[c.field];
    const liveCanon = canonical(live === undefined ? null : live);
    if (liveCanon !== canonical(c.from)) {
      reject(`live value differs from the ledger's expected value (live ${liveCanon.slice(0, 160)})`);
      continue;
    }
    if (canonical(c.to) === liveCanon) {
      reject("to equals the live value; nothing to change");
      continue;
    }
    if (!io.hasSource(c.evidenceSourceId)) {
      reject(`evidence source ${c.evidenceSourceId} is not in the release`);
      continue;
    }
    if (!containsLiteral(io.textOf(c.evidenceSourceId), c.evidenceQuote)) {
      reject(`evidence quote is not a literal passage of ${c.evidenceSourceId}`);
      continue;
    }
    if (!rule.sourceIds.includes(c.evidenceSourceId)) {
      if (!c.linkSource) {
        reject(`rule does not link ${c.evidenceSourceId}; set linkSource to add it`);
        continue;
      }
      rule.sourceIds = [...rule.sourceIds, c.evidenceSourceId];
    }
    if (c.field === "computation") {
      if (c.to !== "baseline_only" && c.to !== "research_only") {
        reject("computation must be baseline_only or research_only");
        continue;
      }
      if (c.to === "baseline_only" && !rule.calculation && !rule.period) {
        reject("cannot restore computation without a calculation or period");
        continue;
      }
      rule.computation = c.to;
      if (c.to === "research_only") delete rule.calculation;
    } else if (c.field === "calculation") {
      if (c.to === null || c.to === undefined) delete rule.calculation;
      else rule.calculation = c.to as NonNullable<LimitationRule["calculation"]>;
    } else {
      (rule as unknown as Record<string, unknown>)[c.field] = c.to;
    }
    const entry: RuleCorrection = {
      appliedInVersion: io.ruleVersion,
      field: c.field,
      from: c.from,
      to: c.to,
      reason: c.reason,
      evidenceSourceId: c.evidenceSourceId,
      evidenceQuote: c.evidenceQuote,
      ...(c.note ? { note: c.note } : {}),
    };
    if (c.note && !rule.conditions.includes(c.note)) rule.conditions = [...rule.conditions, c.note];
    rule.corrections = [...(rule.corrections ?? []), entry];
    rule.ruleVersion = io.ruleVersion;
    out.push({ ruleId: c.ruleId, field: c.field, status: "applied" });
  }
  return out;
}
