import { STATES } from "@/lib/corpus/geo";
import { parseCivilDate } from "./engine";
import { INTAKE_FIELD_LABELS } from "./intake";
import { CLAIM_LABELS, CLAIM_TYPES, type BaselineInput, type ClaimType } from "./types";
import {
  CONVERSATION_DATE_FIELDS,
  conversationCandidateSchema,
  type ConversationCandidate,
  type ConversationExtractionInput,
  type ConversationFactField,
} from "./conversationExtraction";
import type { ConversationScreening } from "./conversationAssessment";
import { SCREENING_QUESTIONS } from "./exceptionReview";

export type ConversationMessage = ConversationExtractionInput["messages"][number];
export type ConversationQuestion = NonNullable<ConversationExtractionInput["latestQuestion"]>;
export type ConversationFacts = Partial<Record<ConversationFactField, ConversationCandidate>>;
export type ConversationSession = {
  messages: ConversationMessage[];
  facts: ConversationFacts;
  conflicts: Partial<Record<ConversationFactField, ConversationCandidate[]>>;
  revision: number;
  confirmedRevision: number | null;
  scenarioRevision: number | null;
};

export const CONVERSATION_LABELS: Record<ConversationFactField, string> = {
  jurisdiction: "State law to explore",
  claimType: "Claim being explored",
  subtype: "Claim branch",
  forumState: "State where filing is planned",
  eventState: "State where events occurred",
  residenceState: "Claimant's state of residence",
  vitalStatus: "Claimant's vital status",
  accrualDate: "Proposed starting date — legal accrual unresolved",
  injuryDate: "Injury date",
  actualDiscoveryDate: "Actual discovery",
  constructiveDiscoveryDate: "Possible earlier discovery",
  diagnosisCommunicationDate: "Diagnosis communicated",
  deathDate: "Death date",
  causeDiscoveryDate: "Cause of death discovered",
  firstProductDeliveryDate: "First product delivery",
  qualifyingExposureDate: "Exposure date",
  substantialCompletionDate: "Substantial completion",
  reposeActDate: "Act or omission date",
  birthDate: "Date of birth",
  priorFilingDate: "Earlier filing",
  dismissalDate: "Dismissal",
  refilingDate: "Refiling",
  serviceDate: "Service",
  agreementStartDate: "Agreement start",
  agreementEndDate: "Agreement end",
  bankruptcyStartDate: "Bankruptcy or stay began",
  bankruptcyEndDate: "Bankruptcy or stay ended",
  militaryStartDate: "Military service began",
  militaryEndDate: "Military service ended",
  capacityStartDate: "Capacity issue began",
  capacityEndDate: "Capacity issue ended",
  concealmentEndDate: "Concealment discovered",
  treatmentEndDate: "Treatment ended",
  representationEndDate: "Representation ended",
  representativeAppointmentDate: "Representative appointed",
  noticeDate: "Notice or administrative presentation",
  ...Object.fromEntries(SCREENING_QUESTIONS.map((q) => [`screen:${q.id}`, q.label])),
  "screen:minority": "Was the claimant younger than 21 at any relevant event?",
  "screen:calendar": "Known court closure, emergency, service or filing issue",
} as Record<ConversationFactField, string>;

export function conversationFactLabel(field: ConversationFactField, value: string | null): string {
  if (!value) return "Not recorded";
  if (["jurisdiction", "forumState", "eventState", "residenceState"].includes(field))
    return STATES.find((state) => state.usps === value)?.name ?? value;
  if (field === "claimType") return CLAIM_LABELS[value as ClaimType] ?? value;
  return value.replaceAll("_", " ");
}

export function createConversationSession(state = "", claim?: ClaimType): ConversationSession {
  const facts: ConversationFacts = {};
  const seed = (field: ConversationFactField, value: string) => {
    facts[field] = {
      field,
      value,
      certainty: "stated",
      replaces: false,
      evidence: {
        messageId: "selection",
        quote: "Initial page selection; this is not a legal finding.",
      },
    };
  };
  if (STATES.some((item) => item.usps === state)) seed("jurisdiction", state);
  if (claim && CLAIM_TYPES.includes(claim)) seed("claimType", claim);
  return {
    messages: [],
    facts,
    conflicts: {},
    revision: 0,
    confirmedRevision: null,
    scenarioRevision: null,
  };
}

function validValue(candidate: ConversationCandidate): boolean {
  const { field, value, certainty } = candidate;
  if (certainty !== "stated") return true;
  if (!value) return false;
  if (field.endsWith("Date")) return !!parseCivilDate(value);
  if (["jurisdiction", "forumState", "eventState", "residenceState"].includes(field))
    return STATES.some((state) => state.usps === value);
  if (field === "claimType") return CLAIM_TYPES.includes(value as ClaimType);
  if (field === "vitalStatus") return ["alive", "deceased", "unknown"].includes(value);
  if (field.startsWith("screen:")) return ["yes", "no", "unsure"].includes(value);
  return field === "subtype" && /^[a-z0-9_:-]{1,150}$/.test(value);
}

/** Only evidence in the latest user turn can revise the current account. History is retained. */
export function applyConversationCandidates(
  session: ConversationSession,
  candidates: readonly ConversationCandidate[],
  question?: ConversationQuestion,
): ConversationSession {
  const latest = session.messages.at(-1);
  if (latest?.role !== "user") return session;
  const facts = { ...session.facts },
    conflicts = { ...session.conflicts };
  const groups = new Map<ConversationFactField, ConversationCandidate[]>();
  for (const raw of candidates) {
    const parsed = conversationCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    if (
      candidate.evidence.messageId !== latest.id ||
      !latest.content.includes(candidate.evidence.quote) ||
      !validValue(candidate)
    )
      continue;
    groups.set(candidate.field, [...(groups.get(candidate.field) ?? []), candidate]);
  }
  for (const [field, values] of groups) {
    const unique = [
      ...new Map(
        values.map((candidate) => [
          JSON.stringify([candidate.value, candidate.certainty]),
          candidate,
        ]),
      ).values(),
    ];
    const previous = facts[field];
    if (unique.length > 1) {
      conflicts[field] = unique;
      delete facts[field];
      continue;
    }
    const next = unique[0]!;
    const explicitlyResolving = question?.kind === "clarify" && question.field === field;
    if (
      previous &&
      previous.certainty === "stated" &&
      next.certainty === "stated" &&
      previous.value !== next.value &&
      !next.replaces &&
      !explicitlyResolving
    ) {
      conflicts[field] = [previous, next];
      delete facts[field];
    } else if (
      conflicts[field] &&
      !next.replaces &&
      !explicitlyResolving &&
      next.certainty === "stated"
    ) {
      conflicts[field] = [...conflicts[field]!, next];
    } else {
      facts[field] = next;
      delete conflicts[field];
    }
  }
  const changedClaimContext = (["jurisdiction", "claimType"] as const).some(
    (field) => facts[field]?.value !== session.facts[field]?.value,
  );
  if (changedClaimContext && !groups.has("subtype")) {
    delete facts.subtype;
    delete conflicts.subtype;
  }
  const changedSelection = (["jurisdiction", "claimType", "subtype"] as const).some(
    (field) => facts[field]?.value !== session.facts[field]?.value,
  );
  if (changedSelection) {
    // These questions ask about additional events beyond the selected modeled branch.
    // A negative under one branch is not an answer to the differently scoped next branch.
    for (const id of ["special_claim", "death", "discovery", "repose"] as const) {
      const field = `screen:${id}` as const;
      if (facts[field]?.value === "no") delete facts[field];
    }
  }
  const changed =
    JSON.stringify([facts, conflicts]) !== JSON.stringify([session.facts, session.conflicts]);
  return changed
    ? {
        ...session,
        facts,
        conflicts,
        revision: session.revision + 1,
        confirmedRevision: null,
        scenarioRevision: null,
      }
    : session;
}

export function conversationInput(facts: ConversationFacts): BaselineInput {
  const certain = (field: ConversationFactField) =>
    facts[field]?.certainty === "stated" ? (facts[field]?.value ?? "") : "";
  const input: BaselineInput = {
    jurisdiction: certain("jurisdiction"),
    claimType: certain("claimType") as ClaimType,
    subtype: certain("subtype") || "general",
    accrualDate: certain("accrualDate"),
    governingLawConfirmed: false,
    accrualConfirmed: false,
    applicabilityConfirmed: false,
    reposeApplicabilityConfirmed: false,
    exceptionReview: "unresolved",
    issues: [],
  };
  for (const field of CONVERSATION_DATE_FIELDS) {
    if (!Object.hasOwn(INTAKE_FIELD_LABELS, field)) continue;
    const value = certain(field);
    if (value && parseCivilDate(value))
      (input as unknown as Record<string, unknown>)[field] = value;
  }
  const vital = certain("vitalStatus");
  if (vital === "alive" || vital === "deceased" || vital === "unknown") input.vitalStatus = vital;
  return input;
}

export function conversationScreens(facts: ConversationFacts): ConversationScreening {
  const answers: ConversationScreening = {};
  for (const [field, fact] of Object.entries(facts)) {
    if (!field.startsWith("screen:") || !fact) continue;
    const key = field.slice(7) as keyof ConversationScreening;
    answers[key] =
      fact.certainty !== "stated" || !["yes", "no"].includes(fact.value ?? "")
        ? "unsure"
        : (fact.value as "yes" | "no");
  }
  // Geographical facts can open, but never settle, choice/borrowing-law review.
  const selected = facts.jurisdiction?.value;
  if (
    selected &&
    [facts.eventState, facts.forumState, facts.residenceState].some(
      (fact) => fact?.certainty === "stated" && fact.value && fact.value !== selected,
    )
  )
    answers.foreign_law = "yes";
  const eventScreens: Partial<Record<ConversationFactField, keyof ConversationScreening>> = {
    priorFilingDate: "prior_action",
    dismissalDate: "prior_action",
    refilingDate: "prior_action",
    serviceDate: "prior_action",
    agreementStartDate: "agreement",
    agreementEndDate: "agreement",
    bankruptcyStartDate: "bankruptcy",
    bankruptcyEndDate: "bankruptcy",
    militaryStartDate: "military",
    militaryEndDate: "military",
    capacityStartDate: "incapacity",
    capacityEndDate: "incapacity",
    concealmentEndDate: "concealment",
    treatmentEndDate: "discovery",
    representationEndDate: "discovery",
    representativeAppointmentDate: "death",
    noticeDate: "government",
  };
  for (const [field, screen] of Object.entries(eventScreens)) {
    const fact = facts[field as ConversationFactField];
    if (fact?.certainty === "stated" && fact.value && parseCivilDate(fact.value))
      answers[screen] = "yes";
  }
  const born = facts.birthDate?.certainty === "stated" ? facts.birthDate.value : null;
  const events = CONVERSATION_DATE_FIELDS.filter((field) => field !== "birthDate")
    .flatMap((field) =>
      facts[field]?.certainty === "stated" && facts[field]?.value ? [facts[field]!.value!] : [],
    )
    .sort();
  if (born && parseCivilDate(born) && events[0] && events[0] >= born) {
    const twentyFirstBirthday = `${Number(born.slice(0, 4)) + 21}${born.slice(4)}`;
    if (events[0] < twentyFirstBirthday) answers.minority = "yes";
  }
  return answers;
}

function acknowledgementText(text: string): string {
  return text
    .trim()
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();
}

/** Confirmation is a narrow conversational act; "yes, but ..." always goes back through extraction. */
export function isPlainConfirmation(text: string): boolean {
  const reply = acknowledgementText(text);
  if (/^(?:yes|confirmed|go ahead|please do|yes[,.]? please)$/i.test(reply)) return true;
  const statement = reply.replace(/^yes[,.]? /i, "");
  // Match the whole acknowledgment: extra facts or qualifications must go through extraction.
  return [
    /^(?:correct|accurate|(?:that(?:'s| is)|it(?:'s| is)) (?:right|correct|accurate)|looks (?:right|correct|accurate))$/i,
    /^(?:that(?:'s| is)|it(?:'s| is)) an accurate (?:account|summary) of (?:my|the) facts?$/i,
    /^(?:(?:the|my|your) (?:summary|account)(?: of (?:my|the) facts?)? is|(?:my|the) fact is|(?:my|the) facts are) (?:right|correct|accurate)$/i,
  ].some((pattern) => pattern.test(statement));
}

/** Confirming the facts alone is not a request to calculate under legal assumptions. */
export function isPlainScenarioRequest(text: string): boolean {
  const reply = acknowledgementText(text);
  if (/^(?:yes|yes[,.]? please|(?:yes[,.]? )?(?:go ahead|please do))$/i.test(reply)) return true;
  const request = reply.replace(/^yes[,.]? /i, "");
  return /^(?:please )?calculate(?: (?:a |the )?(?:conditional )?(?:calendar )?illustration)? under (?:those|the stated) assumptions$/i.test(
    request,
  );
}

export function factsSummary(session: ConversationSession): string {
  return Object.entries(session.facts)
    .map(([key, fact]) => {
      if (!fact) return "";
      const field = key as ConversationFactField;
      return `${CONVERSATION_LABELS[field]}: ${conversationFactLabel(field, fact.value)}${fact.certainty !== "stated" ? ` (${fact.certainty})` : ""}.`;
    })
    .filter(Boolean)
    .join("\n");
}

export function conversationBinding(session: ConversationSession, evidenceKey: string): string {
  return JSON.stringify([
    session.revision,
    session.confirmedRevision,
    session.scenarioRevision,
    session.facts,
    session.conflicts,
    evidenceKey,
  ]);
}
