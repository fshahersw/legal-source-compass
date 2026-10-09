import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";
import { validateInstruction, type ReviewedInstruction } from "./reviewedArithmetic";

export type ReviewGroup = "screening" | "tolling" | "scope" | "authority";
export const REVIEW_GROUP_LABELS: Record<ReviewGroup, string> = {
  screening: "Case facts that may change the clock",
  tolling: "Recorded tolling and outer limits",
  scope: "Scope, conditions and exclusions",
  authority: "Source and historical-law limitations",
};
export type ReviewFactor = {
  id: string;
  kind: "screen" | "tolling" | "repose" | "condition" | "exclusion" | "warning" | "validity";
  group: ReviewGroup;
  label: string;
  text: string;
  citation: string | null;
  /** Exact locations in the unchanged loaded rule. Duplicates retain all origins. */
  origins: string[];
  /** These are the rule's cited sources, not an assertion that each proves this note. */
  ruleSourceIds: string[];
  instructionAllowed: boolean;
};
export type ReviewDecision = {
  status: "no_effect" | "needs_review" | "instruction";
  note?: string;
  instruction?: ReviewedInstruction;
};
export type ReviewDecisions = Record<string, ReviewDecision>;
export type ReviewState = { contextKey: string; decisions: ReviewDecisions };

/** Screening prompts contain no legal periods and never determine a legal effect. */
const SCREENS = [
  {
    id: "disability",
    label: "Minority, capacity, incarceration or military service",
    text: "Did a protected status exist when the claim arose, or could a statutory protection apply during the running period? Confirm the applicable age, legal definition, cap and claim-specific exclusions; none are assumed.",
    instructionAllowed: true,
  },
  {
    id: "tolling",
    label: "Agreement, concealment, estoppel, stay or bankruptcy",
    text: "Is a tolling agreement, alleged concealment, court order, bankruptcy, mandatory process or other suspension relevant? A stay is not automatically an equal-length extension. Review the exact authority and event boundaries.",
    instructionAllowed: true,
  },
  {
    id: "prior_filing",
    label: "Earlier proceedings, dismissal, refiling or class action",
    text: "Was there an earlier lawsuit, nonsuit, administrative proceeding, class action, MDL registration or dismissal? Confirm any savings, exhaustion, relation-back or cross-jurisdictional tolling requirements.",
    instructionAllowed: true,
  },
  {
    id: "foreign_law",
    label: "Another jurisdiction, transfer or direct filing",
    text: "Could another state's law, a borrowing statute, choice-of-law clause, transfer or direct-filing order change the governing period? Location or venue alone is not a legal determination.",
    instructionAllowed: false,
  },
  {
    id: "special_claim",
    label: "Government defendant or special claim",
    text: "Does a government, public employee, professional, insurer, estate, special statutory remedy, sexual-abuse or revival provision require a different rule, notice or deadline? A generic toll cannot override a special claim exclusion.",
    instructionAllowed: false,
  },
  {
    id: "death_exception",
    label: "Death, representatives and underlying claims",
    text: "Is death, representative appointment, an expired underlying claim, homicide or a survival-versus-wrongful-death distinction relevant? Separate claims may have separate clocks.",
    instructionAllowed: false,
  },
  {
    id: "latent_exposure",
    label: "Discovery, continuing conduct or treatment",
    text: "Are discovery, latent exposure, continuing wrong, continuous treatment or representation, multiple injuries or separate breaches unresolved? Do not replace an accrual rule with a guessed incident date.",
    instructionAllowed: false,
  },
  {
    id: "product_repose",
    label: "Independent repose, delivery or warranty limits",
    text: "Could first delivery, substantial completion, an act or omission, an express warranty or a contractual limit impose an independent outer deadline? Ordinary tolling does not automatically extend it.",
    instructionAllowed: false,
  },
  {
    id: "calendar",
    label: "Holidays, emergencies, service and filing cutoffs",
    text: "Check the actual court's holiday and closure calendar, emergency orders, commencement/service rules, electronic-filing cutoff and time zone. The baseline engine does not supply a complete court calendar.",
    instructionAllowed: false,
  },
  {
    id: "other",
    label: "Any other exception or incomplete facts",
    text: "Is there any relevant protection, exclusion, amendment, conflicting authority or missing fact not captured above or in the recorded notes? This screening is not an assertion that all applicable law has been collected.",
    instructionAllowed: false,
  },
] as const;

export function buildReviewInventory(rule: LimitationRule): ReviewFactor[] {
  const factors: ReviewFactor[] = SCREENS.map((s) => ({
    ...s,
    id: `screen:${s.id}`,
    kind: "screen",
    group: "screening",
    citation: null,
    origins: [`screening.${s.id}`],
    ruleSourceIds: [],
  }));
  const add = (
    kind: ReviewFactor["kind"],
    group: ReviewGroup,
    text: string,
    citation: string | null,
    origin: string,
    instructionAllowed = false,
    label?: string,
  ) => {
    // Exact identity only: no fuzzy matching, truncation or interpretation.
    const found = factors.find(
      (f) => f.kind === kind && f.text === text && f.citation === citation,
    );
    if (found) {
      found.origins.push(origin);
      return found;
    }
    const factor: ReviewFactor = {
      id: origin,
      kind,
      group,
      text,
      citation,
      origins: [origin],
      ruleSourceIds: [...rule.sourceIds],
      instructionAllowed,
      label: label ?? citation ?? kind.charAt(0).toUpperCase() + kind.slice(1),
    };
    factors.push(factor);
    return factor;
  };
  const tolling = rule.provenance?.tolling ?? [];
  tolling.forEach((n, i) =>
    add("tolling", "tolling", n.text, n.citation, `provenance.tolling[${i}]`, true),
  );
  (rule.provenance?.repose ?? []).forEach((n, i) =>
    add(
      "repose",
      "tolling",
      `${n.years} years from ${n.trigger}. ${n.effectiveFrom ? `Recorded effective date: ${n.effectiveFrom}.` : "Effective date not recorded."}`,
      n.citation,
      `provenance.repose[${i}]`,
    ),
  );
  (rule.conditions ?? []).forEach((text, i) => {
    const repeated = tolling.findIndex(
      (n) =>
        text === `Statutory tolling (not applied by the calculator): ${n.text} (${n.citation}).`,
    );
    if (repeated >= 0) {
      const factor = factors.find((f) => f.origins.includes(`provenance.tolling[${repeated}]`))!;
      factor.origins.push(`conditions[${i}]`);
    } else add("condition", "scope", text, null, `conditions[${i}]`, false, `Condition ${i + 1}`);
  });
  (rule.exclusions ?? []).forEach((text, i) =>
    add("exclusion", "scope", text, null, `exclusions[${i}]`, false, `Exclusion ${i + 1}`),
  );
  (rule.warnings ?? []).forEach((text, i) =>
    add("warning", "authority", text, null, `warnings[${i}]`, false, `Limitation ${i + 1}`),
  );
  if (rule.validity?.trim())
    add("validity", "authority", rule.validity, null, "validity", false, "Operative-law review");
  if (rule.historicalApplicability?.trim())
    add(
      "validity",
      "authority",
      rule.historicalApplicability,
      null,
      "historicalApplicability",
      false,
      "Historical applicability",
    );
  (rule.provenance?.flags ?? []).forEach((text, i) =>
    add(
      "warning",
      "authority",
      text,
      null,
      `provenance.flags[${i}]`,
      false,
      "Recorded source issue",
    ),
  );
  return factors;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
/** Full exact canonical content, rather than a short collision-prone approval hash. */
export function reviewContextKey(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
  input: BaselineInput,
): string {
  const coverage = snapshot.coverage.find((c) => c.state === rule.jurisdiction);
  const ids = new Set([
    ...rule.sourceIds,
    ...(coverage?.timeComputation
      ? [coverage.timeComputation.sourceId, ...(coverage.timeComputation.supportingSourceIds ?? [])]
      : []),
  ]);
  return JSON.stringify(
    canonical({
      reviewSchema: "case-review/2",
      screeningPrompts: SCREENS,
      release: snapshot.ruleVersion,
      snapshotDate: snapshot.snapshotDate,
      rule,
      input,
      sources: snapshot.sources.filter((s) => ids.has(s.id)),
      cases: snapshot.cases.filter((c) => rule.caseReferenceIds?.includes(c.id)),
      timeComputation: coverage?.timeComputation,
      timeComputationNotRecorded: coverage?.timeComputationNotRecorded,
    }),
  );
}

export function decisionResolved(
  factor: ReviewFactor,
  decision: ReviewDecision | undefined,
): boolean {
  if (decision?.status === "no_effect") return true;
  return (
    decision?.status === "instruction" &&
    factor.instructionAllowed &&
    !!decision.instruction &&
    validateInstruction(decision.instruction).length === 0
  );
}
export function reviewProgress(factors: readonly ReviewFactor[], decisions: ReviewDecisions) {
  let resolved = 0,
    unresolved = 0,
    pending = 0;
  for (const factor of factors) {
    if (decisionResolved(factor, decisions[factor.id])) resolved++;
    else if (decisions[factor.id]?.status === "needs_review") unresolved++;
    else pending++;
  }
  return {
    total: factors.length,
    resolved,
    unresolved,
    pending,
    complete: resolved === factors.length && factors.length > 0,
  };
}
