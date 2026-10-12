import {
  guidedDateFields,
  isAccrualReposeRule,
  versionWindowLabel,
  type GuidedDateField,
} from "@/components/limitations/calculatorGuidance";
import { assessDeadline, type DeadlineAssessment } from "./deadlineAssessment";
import { baselineRule, calculateBaseline, parseCivilDate, sourceReviewDate } from "./engine";
import { SCREENING_QUESTIONS, type ScreeningAnswer, type ScreeningId } from "./exceptionReview";
import {
  buildReviewInventory,
  reviewContextKey,
  type ReviewFactor,
  type ReviewState,
} from "./reviewInventory";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type BaselineInput,
  type BaselineResult,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
} from "./types";

export type ConversationScreenId = ScreeningId | "calendar";
/** Accepted factual reports only. Transcript evidence and acceptance belong to the caller. */
export type ConversationScreening = Partial<Record<ConversationScreenId, ScreeningAnswer>>;
export type ConversationQuestion = {
  id: string;
  kind: "selection" | "date" | "factual_screen";
  prompt: string;
  explanation: string;
  field?: "jurisdiction" | "claimType" | "subtype" | "vitalStatus" | GuidedDateField["key"];
  screenId?: ConversationScreenId;
  options?: { value: string; label: string }[];
  factorIds: string[];
};
export type ConversationBlocker = {
  id: string;
  kind: "facts" | "review" | "source" | "coverage";
  reason: string;
};
export type ConversationScreen = {
  id: ConversationScreenId;
  prompt: string;
  explanation: string;
  answer: ScreeningAnswer | null;
  factorIds: string[];
};
export type ConversationPlan = {
  contextKey: string | null;
  rule: LimitationRule | null;
  questions: ConversationQuestion[];
  nextQuestion: ConversationQuestion | null;
  screens: ConversationScreen[];
  assessment: DeadlineAssessment;
  blockers: ConversationBlocker[];
  qualifications: ReviewFactor[];
  sourceReferences: LimitationSource[];
};
export type ConversationScenarioOptions = {
  requested: boolean;
  factsConfirmed: boolean;
  screening: ConversationScreening;
  sourceRefreshFailed?: boolean;
};
/** Deliberately separate from a deadline assessment or a legal-review decision. */
export type ConversationScenario = {
  status: "conditional_illustration" | "withheld";
  date: string | null;
  calendar: {
    adjustedDate: NonNullable<BaselineResult["adjustedDate"]> | null;
    weekendNotice: NonNullable<BaselineResult["weekendNotice"]> | null;
  } | null;
  steps: BaselineResult["steps"];
  rule: LimitationRule | null;
  reasons: string[];
  assumptions: string[];
  qualifications: ReviewFactor[];
  sourceReferences: LimitationSource[];
  scenarioOnly: true;
  verifiedFilingDeadline: false;
  legalApplicabilityVerified: false;
};

const FACT_PROMPTS: Record<ConversationScreenId, string> = {
  minority:
    "Was the claimant younger than 21 when any relevant events happened? Include their age or birth date.",
  incapacity:
    "Did a condition affect the claimant's ability to understand or manage their affairs?",
  military:
    "Was the claimant or a relevant family member in military service during this timeline?",
  confinement:
    "Was anyone detained, imprisoned, or involved in criminal proceedings connected to these events?",
  concealment:
    "Did anyone hide information, make misleading statements, threaten the claimant, or prevent them from bringing a claim?",
  discovery:
    "Were the injury or its cause learned later, or did the conduct, treatment, or representation continue over time?",
  absence: "Was a defendant absent, hard to locate, concealed, or using another name?",
  prior_action:
    "Was a lawsuit or administrative claim already filed, dismissed, appealed, or refiled?",
  class_action: "Was there a class action, MDL, claim registry, or related court order?",
  bankruptcy: "Was there a bankruptcy, injunction, or order stopping proceedings?",
  agreement:
    "Was there an agreement about time limits, arbitration, or when a claim could be filed?",
  government:
    "Does this involve a government body, public employee, or notice sent to a public body?",
  special_claim:
    "Does this involve medical or legal services, a product, sexual abuse, a statutory penalty, or another distinct kind of claim?",
  death: "Did anyone die, or is an estate or representative bringing the claim?",
  foreign_law:
    "Are another state, a contract choosing another state's law, a transfer, or direct filing involved?",
  repose:
    "Are there product delivery, construction completion, warranty, or earlier act dates separate from the injury or discovery date?",
  other:
    "Are there other events, agreements, orders, or uncertain facts that may affect this timeline?",
  calendar:
    "Are any court holidays, closures, emergency orders, service dates, or filing times known to be relevant?",
};
const SCREEN_FACTORS: Record<ConversationScreenId, string> = {
  minority: "disability",
  incapacity: "disability",
  military: "disability",
  confinement: "disability",
  concealment: "tolling",
  absence: "tolling",
  bankruptcy: "tolling",
  agreement: "tolling",
  discovery: "latent_exposure",
  prior_action: "prior_filing",
  class_action: "prior_filing",
  government: "special_claim",
  special_claim: "special_claim",
  death: "death_exception",
  foreign_law: "foreign_law",
  repose: "product_repose",
  other: "other",
  calendar: "calendar",
};
const DATE_PROMPTS: Record<GuidedDateField["key"], string> = {
  accrualDate:
    "What exact event date should this illustration use as its proposed starting date? Describe the event; its legal significance remains unresolved.",
  injuryDate: "On what date did the injury happen?",
  actualDiscoveryDate:
    "When did the claimant first learn of the injury and what caused it? Describe what they learned on that date.",
  constructiveDiscoveryDate:
    "Is there an earlier date when information about the injury or its cause was available? Describe that information, or say the date is unknown.",
  diagnosisCommunicationDate:
    "When did a physician first communicate the diagnosis and its connection to the injury or exposure?",
  deathDate: "On what date did the person die?",
  causeDiscoveryDate:
    "When was the cause of the death first learned, and what information revealed it?",
  firstProductDeliveryDate:
    "When was the product first delivered to its initial purchaser or lessee?",
  qualifyingExposureDate: "On what date did the exposure being considered happen?",
  substantialCompletionDate:
    "What date is recorded for substantial completion of the construction work?",
  reposeActDate:
    "When did the act or omission being considered happen? Describe it and any later related acts separately.",
};

function sourceReferences(snapshot: LimitationsSnapshot, rule: LimitationRule | null) {
  const coverage = snapshot.coverage.find((row) => row.state === rule?.jurisdiction);
  const ids = new Set([
    ...(rule?.sourceIds ?? []),
    ...(coverage?.timeComputation
      ? [coverage.timeComputation.sourceId, ...(coverage.timeComputation.supportingSourceIds ?? [])]
      : []),
  ]);
  return snapshot.sources.filter((source) => ids.has(source.id));
}

function screensFor(
  rule: LimitationRule | null,
  screening: ConversationScreening,
): ConversationScreen[] {
  const factors = rule ? buildReviewInventory(rule) : [];
  return [...SCREENING_QUESTIONS.map((question) => question.id), "calendar" as const].map((id) => {
    const original = SCREENING_QUESTIONS.find((question) => question.id === id);
    const supplied = screening[id];
    return {
      id,
      prompt: factualPrompt(id, rule),
      explanation:
        id === "minority"
          ? "21 is a broad factual screening threshold, not a statement of the applicable legal age or protection."
          : "Report what happened or say you do not know. This answer does not establish a legal effect or clear a recorded qualification.",
      answer: supplied === "yes" || supplied === "no" || supplied === "unsure" ? supplied : null,
      factorIds: factors
        .filter(
          (factor) =>
            factor.id === `screen:${SCREEN_FACTORS[id]}` ||
            (factor.kind !== "screen" && !!original?.terms.test(factor.text)),
        )
        .map((factor) => factor.id),
    };
  });
}

function factualPrompt(id: ConversationScreenId, rule: LimitationRule | null): string {
  if (!rule) return FACT_PROMPTS[id];
  if (id === "special_claim") {
    const additional = [
      ...(rule.claimType === "medical_malpractice" ? [] : ["medical services"]),
      ...(rule.claimType === "legal_malpractice" ? [] : ["legal services"]),
      ...(rule.claimType === "product_liability" || rule.claimType === "breach_of_warranty"
        ? []
        : ["a product or warranty"]),
      "sexual abuse",
      "a statutory penalty",
      "another separate claim",
    ];
    return `Apart from the ${CLAIM_LABELS[rule.claimType].toLowerCase()} claim being examined, does this also involve ${additional.join(", ")}?`;
  }
  if (
    id === "death" &&
    (rule.claimType === "wrongful_death" ||
      rule.accrualBasis === "death" ||
      rule.accrualBasis === "discovery_of_death" ||
      rule.calculation?.deathCapYears ||
      rule.calculation?.mode === "death_cause_min" ||
      rule.calculation?.limbs?.some((limb) => limb.from === "death"))
  )
    return "Beyond the death event used by this branch, are there separate survival claims, estate or representative disputes, appointment dates, another death, or an earlier injury claim?";
  if (
    id === "discovery" &&
    (["discovery_min", "diagnosis", "death_cause_min"].includes(rule.calculation?.mode ?? "") ||
      rule.calculation?.limbs?.some((limb) => limb.from === "discovery"))
  )
    return "Beyond the discovery or diagnosis events supplied for this branch, were there other discoveries, separate injuries, or continuing conduct, treatment, or representation?";
  if (
    id === "repose" &&
    (isAccrualReposeRule(rule) || rule.calculation?.requiresExposureWithinDeliveryYears)
  )
    return "Beyond the delivery, completion, injury, or act dates supplied for this branch's clocks, are there other relevant products, deliveries, acts, construction stages, warranty promises, or contractual time limits?";
  return FACT_PROMPTS[id];
}

/** The same branch-specific factual questions for trusted server extraction and the planner. */
export function conversationScreenDefinitions(
  rule: LimitationRule | null,
): { field: `screen:${ConversationScreenId}`; label: string }[] {
  return [...SCREENING_QUESTIONS.map((question) => question.id), "calendar" as const].map((id) => ({
    field: `screen:${id}`,
    label: factualPrompt(id, rule),
  }));
}

function requiredDateFields(rule: LimitationRule, input: BaselineInput): GuidedDateField[] {
  const fields = guidedDateFields(rule, input.jurisdiction, input.subtype);
  if (
    rule.calculation?.deathCapYears &&
    input.vitalStatus === "deceased" &&
    !fields.some((field) => field.key === "deathDate")
  )
    fields.push({
      key: "deathDate",
      label: "Date of death",
      help: "This recorded branch has a death-related cap.",
    });
  return fields;
}

/** Extra reported dates remain evidence even when a changed branch no longer consumes them. */
export function conversationDateBlockers(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  rule: LimitationRule | null,
): ConversationBlocker[] {
  if (!rule) return [];
  const consumed = new Set(requiredDateFields(rule, input).map((field) => field.key));
  const consumedDates = new Set(
    [...consumed].map((key) => input[key]).filter((date) => date && parseCivilDate(date)),
  );
  const reviewedThrough = sourceReviewDate(snapshot, rule);
  const result: ConversationBlocker[] = [];
  for (const key of Object.keys(DATE_PROMPTS) as GuidedDateField["key"][]) {
    const date = input[key];
    if (!date) continue;
    const label =
      key === "accrualDate"
        ? "proposed starting date"
        : key.replace(/([A-Z])/g, " $1").toLowerCase();
    if (!parseCivilDate(date)) {
      result.push({
        id: `date:reported-invalid:${key}`,
        kind: "facts",
        reason: `The reported ${label} is not a real supported civil date. A selected branch cannot discard an invalid reported event.`,
      });
      continue;
    }
    if (reviewedThrough && date > reviewedThrough)
      result.push({
        id: `date:source-cutoff:${key}`,
        kind: "source",
        reason: `The reported ${label} (${date}) is later than ${reviewedThrough}, the oldest review date among this rule's required authorities. Subsequent law must be reviewed even when this branch does not use that event.`,
      });
    // An injury can precede a modeled discovery or diagnosis. It does not by itself add a clock.
    // Other unused clock dates need review; equal calendar values still carry the disclosed
    // assumption about which legal event governs and are never copied into another field.
    if (!consumed.has(key) && key !== "injuryDate" && !consumedDates.has(date))
      result.push({
        id: `date:unmodeled:${key}`,
        kind: "review",
        reason: `The reported ${label} (${date}) is a separate event that this branch does not calculate. Review its legal effect or correct the event account before requesting an illustration; it cannot be silently ignored.`,
      });
  }
  if (
    consumed.has("accrualDate") &&
    !consumed.has("injuryDate") &&
    parseCivilDate(input.accrualDate) &&
    parseCivilDate(input.injuryDate ?? "") &&
    input.injuryDate! > input.accrualDate
  )
    result.push({
      id: "date:injury-after-start",
      kind: "review",
      reason:
        "The reported injury happened after the proposed starting date. Resolve this chronology before requesting an illustration; no legal starting point is inferred.",
    });
  return result;
}

function dateQuestions(rule: LimitationRule, input: BaselineInput): ConversationQuestion[] {
  const fields = requiredDateFields(rule, input);
  const questions: ConversationQuestion[] = fields
    .filter((field) => !parseCivilDate(input[field.key] ?? ""))
    .map((field) => ({
      id: `date:${field.key}`,
      kind: "date",
      field: field.key,
      prompt:
        field.key === "accrualDate" && rule.accrualBasis === "death"
          ? DATE_PROMPTS.deathDate
          : DATE_PROMPTS[field.key],
      explanation: `${input[field.key] ? "The supplied value is not a real supported civil date. " : ""}Recorded input: ${field.label}. ${field.help} Use an exact date, or leave it unknown; no other event date is substituted.`,
      factorIds: [],
    }));
  if (rule.calculation?.deathCapYears && (!input.vitalStatus || input.vitalStatus === "unknown"))
    questions.unshift({
      id: "fact:vitalStatus",
      kind: "selection",
      field: "vitalStatus",
      prompt: "Is the injured person alive?",
      explanation: "The recorded branch has a separate death-related cap.",
      options: [
        { value: "alive", label: "Alive" },
        { value: "deceased", label: "Deceased" },
        { value: "unknown", label: "Unknown" },
      ],
      factorIds: [],
    });
  return questions;
}

function intrinsicBlockers(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  rule: LimitationRule | null,
  refreshFailed = false,
): ConversationBlocker[] {
  const result: ConversationBlocker[] = [];
  if (refreshFailed)
    result.push({
      id: "source:refresh",
      kind: "source",
      reason:
        "Source refresh failed. Reload the released evidence before producing an illustration.",
    });
  if (!rule) {
    result.push({
      id: "coverage:rule",
      kind: "coverage",
      reason:
        "No unique supported baseline rule is released for this state, claim and branch. A conversational answer cannot supply a missing period.",
    });
    return result;
  }
  if (
    rule.computation !== "baseline_only" ||
    rule.reviewStatus !== "statutory_text_verified" ||
    rule.provenance?.entryStatus === "flagged"
  )
    result.push({
      id: "source:rule-status",
      kind: "source",
      reason:
        "This rule is research-only or carries a flagged source entry. Factual answers cannot promote it to a verified calculation rule." +
        (rule.provenance?.flags.length
          ? ` Recorded issues: ${rule.provenance.flags.join("; ")}`
          : ""),
    });
  if (
    rule.sourceIds.some((id) => {
      const sources = snapshot.sources.filter((source) => source.id === id);
      return sources.length !== 1 || sources[0]!.state !== rule.jurisdiction;
    })
  )
    result.push({
      id: "source:identity",
      kind: "source",
      reason: "A required source is missing, duplicated, or belongs to another jurisdiction.",
    });
  if (!sourceReviewDate(snapshot, rule))
    result.push({
      id: "source:review-date",
      kind: "source",
      reason:
        "Required statutory evidence has no reliable review date. A newer bundle does not refresh that evidence.",
    });
  if ((rule.provenance?.repose.length ?? 0) > 0 && !isAccrualReposeRule(rule))
    result.push({
      id: "review:unmodeled-repose",
      kind: "review",
      reason:
        "The rule records an independent repose limit that this branch does not calculate. An illustration cannot silently omit that outer limit.",
    });
  result.push(...conversationDateBlockers(snapshot, input, rule));
  return result;
}

function unknownScreening(screening: ConversationScreening): ConversationBlocker[] {
  return Object.keys(screening).some((id) => !Object.hasOwn(FACT_PROMPTS, id))
    ? [
        {
          id: "screen:unrecognized",
          kind: "facts",
          reason:
            "The screening contains an unrecognized question. Reconcile the accepted facts before calculating.",
        },
      ]
    : [];
}

/** Questions collect facts. They never produce legal confirmations or no-effect decisions. */
export function planConversationAssessment(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  screening: ConversationScreening = {},
  options: { review?: ReviewState | null; sourceRefreshFailed?: boolean } = {},
): ConversationPlan {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  const qualifications = rule ? buildReviewInventory(rule) : [];
  const screens = screensFor(rule, screening);
  const questions: ConversationQuestion[] = [];
  if (!snapshot.coverage.some((row) => row.state === input.jurisdiction))
    questions.push({
      id: "selection:jurisdiction",
      kind: "selection",
      field: "jurisdiction",
      prompt: "Which state's law would you like to examine?",
      explanation:
        "This chooses a scenario to explore; residence, injury location and court venue do not determine governing law.",
      options: snapshot.coverage.map((row) => ({ value: row.state, label: row.name })),
      factorIds: [],
    });
  if (!CLAIM_TYPES.includes(input.claimType))
    questions.push({
      id: "selection:claimType",
      kind: "selection",
      field: "claimType",
      prompt: "What happened, and what kind of claim are you considering?",
      explanation:
        "Different claims can have separate clocks. Do not combine distinct claims into one deadline.",
      options: CLAIM_TYPES.map((claim) => ({ value: claim, label: CLAIM_LABELS[claim] })),
      factorIds: [],
    });
  if (!rule && input.jurisdiction && CLAIM_TYPES.includes(input.claimType)) {
    const branches = snapshot.rules.filter(
      (candidate) =>
        candidate.jurisdiction === input.jurisdiction &&
        candidate.claimType === input.claimType &&
        candidate.computation === "baseline_only",
    );
    if (branches.length)
      questions.push({
        id: "selection:subtype",
        kind: "selection",
        field: "subtype",
        prompt: "Which recorded fact pattern would you like to examine?",
        explanation:
          "The branch selection is an assumption to explore, not a decision that its statutory scope applies.",
        options: branches.map((branch) => ({
          value: branch.subtype ?? "general",
          label: `${branch.scope || branch.summary} (${versionWindowLabel(branch) ?? "historical window not recorded"})`,
        })),
        factorIds: [],
      });
  }
  if (rule) {
    questions.push(...dateQuestions(rule, input));
    questions.push(
      ...screens
        .filter((screen) => screen.answer === null)
        .map((screen): ConversationQuestion => ({
          id: `screen:${screen.id}`,
          kind: "factual_screen",
          screenId: screen.id,
          prompt: screen.prompt,
          explanation: screen.explanation,
          factorIds: screen.factorIds,
        })),
    );
  }
  const blockedScreens = screens.filter((screen) => screen.answer !== "no");
  const blockers = [
    ...intrinsicBlockers(snapshot, input, rule, options.sourceRefreshFailed),
    ...unknownScreening(screening),
  ];
  const assessment = assessDeadline(
    snapshot,
    input,
    blockedScreens.length || blockers.length ? null : (options.review ?? null),
    options,
  );
  blockers.push(
    ...questions
      .filter((question) => question.kind !== "factual_screen")
      .map((question): ConversationBlocker => ({
        id: question.id,
        kind: "facts",
        reason: question.prompt,
      })),
  );
  blockers.push(
    ...blockedScreens.map((screen): ConversationBlocker => ({
      id: `screen:${screen.id}`,
      kind: screen.answer === null ? "facts" : "review",
      reason: `${screen.prompt} ${screen.answer === "yes" ? "A relevant fact was reported; its legal effect is unresolved." : screen.answer === "unsure" ? "The factual answer remains uncertain." : "This factual screen has not been answered."}`,
    })),
  );
  for (const reason of [...assessment.reasons, ...assessment.baseline.reasons])
    if (!blockers.some((blocker) => blocker.reason === reason))
      blockers.push({ id: `assessment:${blockers.length}`, kind: "review", reason });
  return {
    contextKey: rule ? reviewContextKey(snapshot, rule, input) : null,
    rule,
    questions,
    nextQuestion: questions[0] ?? null,
    screens,
    assessment,
    blockers,
    qualifications,
    sourceReferences: sourceReferences(snapshot, rule),
  };
}

/** Rephrase generated engine templates only; cited text, source notes and arithmetic stay intact. */
function scenarioStepText(text: string): string {
  if (text.startsWith("Use the confirmed "))
    return text.replace("Use the confirmed ", "Use the proposed ");
  if (text.startsWith("Use the earlier of actual discovery ("))
    return text.replace(
      "legally confirmed reasonable-diligence discovery",
      "proposed reasonable-diligence discovery",
    );
  if (text.startsWith("Use the legally qualifying physician communication date:"))
    return text.replace(
      "Use the legally qualifying physician communication date:",
      "Use the proposed physician communication date, assumed to meet this branch's requirements:",
    );
  if (text.startsWith("Use cause-of-death discovery ("))
    return text
      .replace("Use cause-of-death discovery", "Use the proposed cause-of-death discovery")
      .replace("independently recorded death date", "separately reported death date");
  if (text.startsWith("Recorded qualifying exposure ("))
    return text
      .replace("Recorded qualifying exposure", "Reported exposure")
      .replace(
        "first qualifying purchaser / lessee delivery",
        "reported first purchaser / lessee delivery",
      )
      .replace(
        "Other branch definitions and exceptions were separately confirmed.",
        "Whether these events meet the branch's definitions, and whether any exception applies, remains unresolved.",
      );
  if (text.startsWith("The confirmed ")) return text.replace("The confirmed ", "The proposed ");
  if (text.startsWith("Repose: "))
    return text.replace(
      "applied as current law",
      "assumed to apply in this illustration; historical applicability remains unresolved",
    );
  if (text.startsWith("The earliest applicable date is "))
    return text.replace(
      "The earliest applicable date is ",
      "The earliest date under these assumptions is ",
    );
  return text;
}

function scenarioEngineReason(text: string): string {
  if (text.startsWith("The captured text does not print the date the "))
    return text
      .replace(
        "the current bar was applied to the entered dates",
        "the retained outer limit was assumed to apply to the entered dates for this illustration",
      )
      .replace(
        "confirm the historical outer limit",
        "review the historical outer limit; its applicability remains unresolved",
      );
  if (text.startsWith("The "))
    return text.replace(/confirmed accrual(?: or discovery)? date/, (phrase) =>
      phrase.replace("confirmed", "proposed"),
    );
  return text;
}

/** Explicitly requested arithmetic under disclosed assumptions; never a filing deadline. */
export function calculateConversationScenario(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  options: ConversationScenarioOptions,
): ConversationScenario {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  const assumptions = [
    "For this illustration only, the selected state's recorded rule is assumed to govern this claim and defendant. Actual governing law and statutory applicability remain unresolved.",
    "The supplied event dates are assumed to be the legally relevant starts required by this branch. Injury, exposure, discovery and accrual are not automatically interchangeable.",
    "No additional tolling, special claim, procedural deadline or exception is applied. Every recorded legal qualification below remains unresolved.",
    "The calculation uses retained source evidence, not a certification of current law. Holidays, closures, service and filing cutoffs remain uncomputed.",
  ];
  if (isAccrualReposeRule(rule))
    assumptions.push(
      "The recorded repose clock is assumed to apply to this claim and defendant; all of its supplied dates and historical limits still pass through the existing engine.",
    );
  const empty: ConversationScenario = {
    status: "withheld",
    date: null,
    calendar: null,
    steps: [],
    rule,
    reasons: [],
    assumptions,
    qualifications: rule ? buildReviewInventory(rule) : [],
    sourceReferences: sourceReferences(snapshot, rule),
    scenarioOnly: true,
    verifiedFilingDeadline: false,
    legalApplicabilityVerified: false,
  };
  const reasons = [
    ...intrinsicBlockers(snapshot, input, rule, options.sourceRefreshFailed),
    ...unknownScreening(options.screening),
  ].map((blocker) => blocker.reason);
  if (options.requested !== true)
    reasons.push(
      "A conditional illustration has not been explicitly requested after its assumptions were shown.",
    );
  if (options.factsConfirmed !== true)
    reasons.push(
      "Confirm the exact proposed facts before requesting an illustration; ambiguous or conflicting facts must remain unresolved.",
    );
  for (const screen of screensFor(rule, options.screening))
    if (screen.answer !== "no")
      reasons.push(
        `${screen.prompt} ${screen.answer === "yes" ? "A positive factual screen requires a supported legal effect; none is inferred." : screen.answer === "unsure" ? "The answer is uncertain." : "An explicit factual answer is missing."}`,
      );
  if (rule) reasons.push(...dateQuestions(rule, input).map((question) => question.prompt));
  if (input.issues.length)
    reasons.push(
      "Previously recorded special issues remain unresolved; a new request or screening answer does not clear them.",
    );
  if (reasons.length) return { ...empty, reasons };
  // These are local hypothetical premises, never persisted input confirmations or review decisions.
  const baseline = calculateBaseline(snapshot, {
    ...input,
    governingLawConfirmed: true,
    accrualConfirmed: true,
    applicabilityConfirmed: true,
    reposeApplicabilityConfirmed: true,
    exceptionReview: "no_unresolved_issues",
  });
  if (baseline.status !== "baseline" || !baseline.date)
    return { ...empty, reasons: baseline.reasons.map(scenarioEngineReason) };
  return {
    ...empty,
    status: "conditional_illustration",
    date: baseline.date,
    calendar: {
      adjustedDate: baseline.adjustedDate ?? null,
      weekendNotice: baseline.weekendNotice ?? null,
    },
    steps: baseline.steps.map((step) => ({ ...step, text: scenarioStepText(step.text) })),
    reasons: [
      "Conditional calendar illustration only. This is not a verified filing deadline; the stated legal assumptions and every recorded qualification remain unresolved.",
      ...baseline.reasons.map((reason) =>
        rule?.warnings.includes(reason) ? reason : scenarioEngineReason(reason),
      ),
    ],
  };
}
