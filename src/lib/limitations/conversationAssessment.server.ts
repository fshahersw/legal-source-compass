import {
  calculateConversationScenario,
  planConversationAssessment,
} from "./conversationAssessment";
import {
  CONVERSATION_LABELS,
  conversationInput,
  conversationScreens,
  type ConversationFacts,
} from "./conversationState";
import { conversationEvidenceDigest } from "./conversationWorkflow";
import {
  CONVERSATION_DATE_FIELDS,
  type ConversationCandidate,
  type ConversationFactField,
} from "./conversationExtraction";
import type { ConversationServerResult } from "./conversationAssessment.functions";
import { CLAIM_TYPES, type LimitationRule, type LimitationsSnapshot } from "./types";
import { parseCivilDate, sourceReviewDate } from "./engine";
import { STATES } from "@/lib/corpus/geo";

// Product delivery, construction and a defendant's act can precede a claimant's birth.
// They must not hide a later claimant event when checking the broad age screen.
const CLAIMANT_EVENT_DATES = [
  "accrualDate",
  "injuryDate",
  "actualDiscoveryDate",
  "constructiveDiscoveryDate",
  "diagnosisCommunicationDate",
  "deathDate",
  "causeDiscoveryDate",
  "qualifyingExposureDate",
] as const;
const INTERVALS = [
  ["agreementStartDate", "agreementEndDate"],
  ["bankruptcyStartDate", "bankruptcyEndDate"],
  ["militaryStartDate", "militaryEndDate"],
  ["capacityStartDate", "capacityEndDate"],
  ["priorFilingDate", "dismissalDate"],
  ["dismissalDate", "refilingDate"],
] as const;

/** Validate the retained account before projection drops non-arithmetic or invalid values. */
function retainedFactReasons(
  snapshot: LimitationsSnapshot,
  facts: ConversationFacts,
  rule: LimitationRule | null,
): string[] {
  const reasons: string[] = [];
  const dates = new Map<ConversationFactField, string>();
  const reviewedThrough = rule ? sourceReviewDate(snapshot, rule) : null;
  for (const field of CONVERSATION_DATE_FIELDS) {
    const fact = facts[field];
    if (!fact || fact.certainty !== "stated" || fact.value === null) continue;
    if (!parseCivilDate(fact.value)) {
      reasons.push(
        `${CONVERSATION_LABELS[field]} is not a real supported civil date. Retained dates cannot be discarded because they are outside this branch's arithmetic.`,
      );
      continue;
    }
    dates.set(field, fact.value);
    if (reviewedThrough && fact.value > reviewedThrough)
      reasons.push(
        `${CONVERSATION_LABELS[field]} (${fact.value}) is later than ${reviewedThrough}, the oldest review date among this rule's required authorities. Subsequent law must be reviewed before calculating from this account.`,
      );
  }
  for (const field of ["jurisdiction", "eventState", "forumState", "residenceState"] as const) {
    const fact = facts[field];
    if (fact?.certainty === "stated" && !STATES.some((state) => state.usps === fact.value))
      reasons.push(
        `${CONVERSATION_LABELS[field]} is not a recognized state selection. Clarify the location without inferring governing law.`,
      );
  }
  const claim = facts.claimType;
  if (claim?.certainty === "stated" && !CLAIM_TYPES.some((type) => type === claim.value))
    reasons.push(
      "The reported claim category is not supported. Clarify the claim rather than substituting a rule.",
    );
  const vital = facts.vitalStatus;
  if (vital?.certainty === "stated" && !["alive", "deceased"].includes(vital.value ?? ""))
    reasons.push(
      "The claimant's living status remains unknown or unsupported. Clarify the account before calculating.",
    );
  if (vital?.certainty === "stated" && vital.value === "alive" && dates.has("deathDate"))
    reasons.push(
      "A death date is reported while the claimant is recorded as alive. Clarify whose death is involved before calculating.",
    );
  if (
    vital?.certainty === "stated" &&
    vital.value === "deceased" &&
    rule &&
    rule.claimType !== "wrongful_death" &&
    !["death", "discovery_of_death"].includes(rule.accrualBasis) &&
    !rule.calculation?.deathCapYears &&
    rule.calculation?.mode !== "death_cause_min" &&
    !rule.calculation?.limbs?.some((limb) => limb.from === "death")
  )
    reasons.push(
      "The claimant is reported deceased, but this branch does not model a death-related claim or cap. A negative death screen cannot resolve that event's legal effect.",
    );

  const born = dates.get("birthDate");
  if (born) {
    const events = CLAIMANT_EVENT_DATES.flatMap((field) => {
      const date = dates.get(field);
      return date ? [{ field, date }] : [];
    });
    for (const { field, date } of events)
      if (date < born)
        reasons.push(
          `${CONVERSATION_LABELS[field]} (${date}) precedes the reported birth date (${born}). Clarify the person and event chronology; any prenatal or separate-person issue remains unresolved.`,
        );
    // Calendar comparison is only a broad factual screen, never a legal age or birthday rule.
    const withinAgeScreen = events.find(({ date }) => {
      if (date < born) return false;
      const yearDifference = Number(date.slice(0, 4)) - Number(born.slice(0, 4));
      return yearDifference < 21 || (yearDifference === 21 && date.slice(5) < born.slice(5));
    });
    if (withinAgeScreen)
      reasons.push(
        `The reported birth date places a claimant event (${withinAgeScreen.date}) within the broad under-21 factual screen. An unrelated earlier delivery or construction date, or a negative screening answer, cannot clear age-related review; no legal age threshold or extension is inferred.`,
      );
  }
  for (const [start, end] of INTERVALS) {
    const startDate = dates.get(start),
      endDate = dates.get(end);
    if (startDate && endDate && endDate < startDate)
      reasons.push(
        `${CONVERSATION_LABELS[end]} (${endDate}) precedes ${CONVERSATION_LABELS[start].toLowerCase()} (${startDate}). Clarify whether these dates concern the same event or proceeding; no interval is applied.`,
      );
  }
  return reasons;
}

/** Recomputes with the hash-verified server release; client/model legal conclusions are not accepted. */
export async function evaluateConversationRequest(
  snapshot: LimitationsSnapshot,
  request: {
    facts: ConversationCandidate[];
    factsConfirmed: boolean;
    scenarioRequested: boolean;
    expectedEvidenceDigest: string;
  },
): Promise<ConversationServerResult> {
  if (new Set(request.facts.map((fact) => fact.field)).size !== request.facts.length)
    return {
      status: "unavailable",
      message: "Conflicting reported facts require clarification before assessment.",
    };
  const facts: ConversationFacts = Object.fromEntries(
    request.facts.map((fact) => [fact.field, fact]),
  );
  const input = conversationInput(facts),
    screening = conversationScreens(facts);
  const plan = planConversationAssessment(snapshot, input, screening);
  const digest = await conversationEvidenceDigest(plan.contextKey);
  if (digest !== request.expectedEvidenceDigest)
    return {
      status: "unavailable",
      message:
        "The source evidence changed. Reload the source release and confirm your facts again before calculating.",
    };
  const missingGeography = ["eventState", "forumState", "residenceState"].some((field) => {
    const fact = facts[field as keyof ConversationFacts];
    return !fact || fact.certainty !== "stated" || !fact.value;
  });
  const uncertain =
    missingGeography ||
    request.facts.some((fact) => fact.certainty !== "stated" || fact.value === null);
  const factReasons = retainedFactReasons(snapshot, facts, plan.rule);
  const scenario = calculateConversationScenario(snapshot, input, {
    requested: request.scenarioRequested,
    factsConfirmed: request.factsConfirmed && !uncertain && factReasons.length === 0,
    screening,
  });
  scenario.reasons = [...new Set([...factReasons, ...scenario.reasons])];
  if (uncertain && !scenario.reasons.some((reason) => reason.includes("uncertain")))
    scenario.reasons.unshift(
      "Some reported facts or dates remain unknown or uncertain. No exact calculation is issued.",
    );
  if (missingGeography)
    scenario.reasons.unshift(
      "The event location, planned filing location and claimant's residence must each be established before a scenario can be calculated. These facts do not themselves determine governing law.",
    );
  const { rule, ...publicScenario } = scenario;
  return {
    status: "assessed",
    scenario: { ...publicScenario, ruleId: rule?.id ?? null },
    ruleVersion: snapshot.ruleVersion,
    evidenceDigest: digest,
  };
}
