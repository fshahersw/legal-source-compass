import { describe, expect, it } from "vitest";
import { evaluateConversationRequest } from "./conversationAssessment.server";
import { planConversationAssessment } from "./conversationAssessment";
import {
  conversationInput,
  conversationScreens,
  type ConversationFacts,
} from "./conversationState";
import { conversationEvidenceDigest } from "./conversationWorkflow";
import {
  CONVERSATION_DATE_FIELDS,
  SUPPLEMENTAL_CONVERSATION_DATE_FIELDS,
  type ConversationCandidate,
  type ConversationFactField,
} from "./conversationExtraction";
import { SCREENING_QUESTIONS } from "./exceptionReview";
import type { LimitationRule, LimitationsSnapshot } from "./types";

function fact(field: ConversationFactField, value: string | null): ConversationCandidate {
  return {
    field,
    value,
    certainty: value === null ? "unknown" : "stated",
    replaces: false,
    evidence: { messageId: "user1", quote: value ?? "I do not know" },
  };
}
function fixture() {
  const rule = {
    id: "synthetic-retained-dates",
    schemaVersion: "1.0.0",
    ruleVersion: "fixture-1",
    jurisdiction: "CA",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["fixture-source"],
    pinpoint: "Synthetic fixture only, not law",
    scope: "Fixture",
    summary: "Synthetic fixture",
    accrualBasis: "confirmed_accrual",
    conditions: ["Unresolved synthetic qualification"],
    exclusions: [],
    warnings: [],
    effectiveFrom: "2020-01-01",
    effectiveThrough: null,
    validity: "Unresolved fixture applicability",
    historicalApplicability: "Synthetic history",
  } as LimitationRule;
  const snapshot = {
    schemaVersion: "1.0.0",
    ruleVersion: "fixture-release",
    snapshotDate: "2026-10-12",
    rules: [rule],
    sources: [
      {
        id: "fixture-source",
        state: "CA",
        authorityKind: "statute",
        sha256: "a".repeat(64),
        verifiedAt: "2026-10-01T00:00:00Z",
        url: "https://example.invalid/fixture",
      },
    ],
    cases: [],
    coverage: [{ state: "CA", name: "California" }],
  } as unknown as LimitationsSnapshot;
  const facts: ConversationFacts = {
    jurisdiction: fact("jurisdiction", "CA"),
    claimType: fact("claimType", "personal_injury"),
    eventState: fact("eventState", "CA"),
    forumState: fact("forumState", "CA"),
    residenceState: fact("residenceState", "CA"),
    accrualDate: fact("accrualDate", "2024-01-01"),
  };
  for (const id of [...SCREENING_QUESTIONS.map((question) => question.id), "calendar" as const])
    facts[`screen:${id}`] = fact(`screen:${id}`, "no");
  return { snapshot, rule, facts };
}
async function assess(snapshot: LimitationsSnapshot, facts: ConversationFacts) {
  const plan = planConversationAssessment(
    snapshot,
    conversationInput(facts),
    conversationScreens(facts),
  );
  return evaluateConversationRequest(snapshot, {
    facts: Object.values(facts),
    factsConfirmed: true,
    scenarioRequested: true,
    expectedEvidenceDigest: await conversationEvidenceDigest(plan.contextKey),
  });
}
async function withheld(snapshot: LimitationsSnapshot, facts: ConversationFacts) {
  const result = await assess(snapshot, facts);
  expect(result.status).toBe("assessed");
  if (result.status !== "assessed") throw new Error("Expected retained-fact assessment");
  expect(result.scenario).toMatchObject({
    status: "withheld",
    date: null,
    calendar: null,
    steps: [],
    verifiedFilingDeadline: false,
  });
  expect(JSON.stringify(result.scenario)).not.toContain("2026-01-01");
  return result.scenario.reasons.join(" ");
}

describe("server validation of all retained conversation facts", () => {
  it("preserves a valid adult account as conditional arithmetic, with no legal approval", async () => {
    const { snapshot, facts } = fixture();
    facts.birthDate = fact("birthDate", "1980-05-12");
    facts.injuryDate = fact("injuryDate", "2024-01-01");
    const before = structuredClone(facts);
    const result = await assess(snapshot, facts);
    expect(result.status === "assessed" && result.scenario).toMatchObject({
      status: "conditional_illustration",
      date: "2026-01-01",
      legalApplicabilityVerified: false,
    });
    expect(facts).toEqual(before);
  });

  it.each(["2024-02-30", "unknown", "January 1980"])(
    "withholds an invalid retained birth date %s",
    async (value) => {
      const { snapshot, facts } = fixture();
      facts.birthDate = fact("birthDate", value);
      expect(await withheld(snapshot, facts)).toContain(
        "Date of birth is not a real supported civil date",
      );
    },
  );

  it("preserves an explicitly unknown birth date as unresolved", async () => {
    const { snapshot, facts } = fixture();
    facts.birthDate = fact("birthDate", null);
    expect(await withheld(snapshot, facts)).toContain("unknown or uncertain");
  });

  it.each(SUPPLEMENTAL_CONVERSATION_DATE_FIELDS)(
    "does not drop invalid supplemental date %s",
    async (field) => {
      const { snapshot, facts } = fixture();
      facts[field] = fact(field, "2024-02-30");
      expect(await withheld(snapshot, facts)).toContain("not a real supported civil date");
    },
  );

  it.each(CONVERSATION_DATE_FIELDS)(
    "applies the oldest source cutoff to retained %s",
    async (field) => {
      const { snapshot, facts } = fixture();
      facts[field] = fact(field, "2026-10-02");
      expect(await withheld(snapshot, facts)).toContain("2026-10-01, the oldest review date");
    },
  );

  it("does not turn a birth date after the claimant's injury into an adult negative screen", async () => {
    const { snapshot, facts } = fixture();
    facts.birthDate = fact("birthDate", "2025-01-01");
    facts.injuryDate = fact("injuryDate", "2024-01-01");
    expect(await withheld(snapshot, facts)).toContain("precedes the reported birth date");
  });

  it("does not let pre-birth delivery hide a later minor's injury", async () => {
    const { snapshot, rule, facts } = fixture();
    rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 60,
      reposeTrigger: "first_delivery",
      reposeEffectiveFrom: "1970-01-01",
    };
    facts.firstProductDeliveryDate = fact("firstProductDeliveryDate", "2000-01-01");
    facts.birthDate = fact("birthDate", "2010-01-01");
    facts.injuryDate = fact("injuryDate", "2024-01-01");
    // The older all-event screen alone could miss this because its first event predates birth.
    expect(conversationScreens(facts).minority).toBe("no");
    expect(await withheld(snapshot, facts)).toContain("within the broad under-21 factual screen");
  });

  it("allows an adult's modeled historical delivery before birth without inventing a chronology conflict", async () => {
    const { snapshot, rule, facts } = fixture();
    rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 60,
      reposeTrigger: "first_delivery",
      reposeEffectiveFrom: "1970-01-01",
    };
    facts.firstProductDeliveryDate = fact("firstProductDeliveryDate", "1975-01-01");
    facts.birthDate = fact("birthDate", "1980-01-01");
    facts.injuryDate = fact("injuryDate", "2024-01-01");
    const result = await assess(snapshot, facts);
    expect(result.status === "assessed" && result.scenario).toMatchObject({
      status: "conditional_illustration",
      date: "2026-01-01",
    });
  });

  it.each([
    ["agreementStartDate", "agreementEndDate"],
    ["bankruptcyStartDate", "bankruptcyEndDate"],
    ["militaryStartDate", "militaryEndDate"],
    ["capacityStartDate", "capacityEndDate"],
    ["priorFilingDate", "dismissalDate"],
    ["dismissalDate", "refilingDate"],
  ] as const)("explains reversed %s / %s without applying an interval", async (start, end) => {
    const { snapshot, facts } = fixture();
    facts[start] = fact(start, "2024-09-01");
    facts[end] = fact(end, "2024-08-01");
    expect(await withheld(snapshot, facts)).toContain(
      "same event or proceeding; no interval is applied",
    );
  });

  it("keeps a valid supplemental interval unresolved despite every asserted negative screen", async () => {
    const { snapshot, facts } = fixture();
    facts.bankruptcyStartDate = fact("bankruptcyStartDate", "2024-02-01");
    facts.bankruptcyEndDate = fact("bankruptcyEndDate", "2024-05-01");
    const reasons = await withheld(snapshot, facts);
    expect(reasons).toContain("positive factual screen requires a supported legal effect");
    expect(reasons).not.toContain("precedes");
  });

  it.each(["unknown", "maybe", "alive"])(
    "does not silently discard a retained living status %s",
    async (value) => {
      const { snapshot, facts } = fixture();
      facts.vitalStatus = fact("vitalStatus", value);
      if (value === "alive") facts.deathDate = fact("deathDate", "2024-01-01");
      expect(await withheld(snapshot, facts)).toContain(
        value === "alive" ? "Clarify whose death" : "living status remains unknown",
      );
    },
  );

  it("rejects duplicate facts before last-value selection can erase a conflict", async () => {
    const { snapshot, facts } = fixture();
    const result = await evaluateConversationRequest(snapshot, {
      facts: [...Object.values(facts), fact("accrualDate", "2023-01-01")],
      factsConfirmed: true,
      scenarioRequested: true,
      expectedEvidenceDigest: "a".repeat(64),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("Conflicting reported facts"),
    });
  });

  it("does not ignore a reported death when no death date or modeled branch is supplied", async () => {
    const { snapshot, facts } = fixture();
    facts.vitalStatus = fact("vitalStatus", "deceased");
    expect(await withheld(snapshot, facts)).toContain("negative death screen cannot resolve");
  });

  it("preserves a fully dated modeled death cap as conditional arithmetic", async () => {
    const { snapshot, rule, facts } = fixture();
    rule.calculation = { mode: "discovery_min", deathCapYears: 1 };
    delete facts.accrualDate;
    facts.actualDiscoveryDate = fact("actualDiscoveryDate", "2024-03-01");
    facts.constructiveDiscoveryDate = fact("constructiveDiscoveryDate", "2024-03-01");
    facts.vitalStatus = fact("vitalStatus", "deceased");
    facts.deathDate = fact("deathDate", "2024-07-01");
    const result = await assess(snapshot, facts);
    expect(result.status === "assessed" && result.scenario).toMatchObject({
      status: "conditional_illustration",
      date: "2025-07-01",
      verifiedFilingDeadline: false,
    });
  });
});
