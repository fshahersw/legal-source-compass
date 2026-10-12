import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateConversationScenario,
  conversationDateBlockers,
  conversationScreenDefinitions,
  planConversationAssessment,
  type ConversationScreening,
} from "./conversationAssessment";
import { SCREENING_QUESTIONS } from "./exceptionReview";
import { calculateBaseline } from "./engine";
import { buildReviewInventory, reviewContextKey, type ReviewState } from "./reviewInventory";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";

function fixture() {
  const rule = {
    id: "synthetic",
    schemaVersion: "1.0.0",
    ruleVersion: "test-1",
    jurisdiction: "CA",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["source"],
    pinpoint: "Synthetic fixture only",
    scope: "Synthetic ordinary injury",
    summary: "Fixture",
    accrualBasis: "confirmed_accrual",
    conditions: ["Synthetic condition"],
    exclusions: ["Synthetic exclusion"],
    warnings: ["Synthetic warning"],
    effectiveFrom: "2020-01-01",
    effectiveThrough: null,
    validity: "Synthetic operative-law qualification",
    historicalApplicability: "Synthetic historical qualification",
    provenance: {
      tolling: [{ text: "Synthetic tolling note", citation: "Synthetic note" }],
      repose: [],
      flags: [],
      entryStatus: "verified",
    },
  } as unknown as LimitationRule;
  const snapshot = {
    schemaVersion: "1.0.0",
    ruleVersion: "test-release",
    snapshotDate: "2026-10-12",
    rules: [rule],
    sources: [
      {
        id: "source",
        state: "CA",
        authorityKind: "statute",
        sha256: "a".repeat(64),
        verifiedAt: "2026-10-01T00:00:00Z",
        url: "https://example.invalid/synthetic",
      },
    ],
    cases: [],
    coverage: [{ state: "CA", name: "California" }],
  } as unknown as LimitationsSnapshot;
  const input: BaselineInput = {
    jurisdiction: "CA",
    claimType: "personal_injury",
    accrualDate: "2024-01-01",
    governingLawConfirmed: false,
    accrualConfirmed: false,
    applicabilityConfirmed: false,
    exceptionReview: "unresolved",
    issues: [],
  };
  return { rule, snapshot, input };
}
function allNo(): ConversationScreening {
  return Object.fromEntries(
    [...SCREENING_QUESTIONS.map((screen) => screen.id), "calendar"].map((id) => [id, "no"]),
  );
}
const requested = () => ({ requested: true, factsConfirmed: true, screening: allNo() });
function independentReview(snapshot: LimitationsSnapshot, input: BaselineInput): ReviewState {
  const rule = snapshot.rules[0]!;
  return {
    contextKey: reviewContextKey(snapshot, rule, input),
    decisions: Object.fromEntries(
      buildReviewInventory(rule).map((factor) => [factor.id, { status: "no_effect" }]),
    ),
  };
}

describe("pure conversational question planning", () => {
  it("exports the exact branch-adjusted factual prompts used by the planner", () => {
    const { snapshot, input, rule } = fixture();
    rule.claimType = input.claimType = "product_liability";
    rule.calculation = { mode: "discovery_min" };
    const plan = planConversationAssessment(snapshot, input);
    expect(conversationScreenDefinitions(rule)).toEqual(
      plan.screens.map((screen) => ({ field: `screen:${screen.id}`, label: screen.prompt })),
    );
    expect(conversationScreenDefinitions(rule)).toHaveLength(18);
    expect(conversationScreenDefinitions(null)).toHaveLength(18);
    expect(
      conversationScreenDefinitions(rule).find((screen) => screen.field === "screen:discovery")!
        .label,
    ).toContain("Beyond the discovery");
  });
  it("covers every existing material screen and every exact recorded qualification", () => {
    const { snapshot, input, rule } = fixture();
    const plan = planConversationAssessment(snapshot, input);
    expect(plan.screens).toHaveLength(18);
    expect(plan.qualifications).toEqual(buildReviewInventory(rule));
    const covered = new Set(plan.screens.flatMap((screen) => screen.factorIds));
    for (const factor of plan.qualifications.filter((item) => item.kind === "screen"))
      expect(covered.has(factor.id)).toBe(true);
    expect(plan.qualifications.some((factor) => factor.text === "Synthetic exclusion")).toBe(true);
  });

  it("collects an exact proposed start without copying injury into accrual or asserting governing law", () => {
    const { snapshot, input } = fixture();
    input.accrualDate = "";
    input.injuryDate = "2024-01-01";
    const plan = planConversationAssessment(snapshot, input);
    expect(plan.nextQuestion?.field).toBe("accrualDate");
    expect(plan.nextQuestion?.prompt).toContain("proposed starting date");
    expect(input.accrualDate).toBe("");
    expect(input.accrualConfirmed).toBe(false);
    const empty = planConversationAssessment(snapshot, { ...input, jurisdiction: "" });
    expect(empty.nextQuestion?.field).toBe("jurisdiction");
    expect(empty.nextQuestion?.explanation).toContain("do not determine governing law");
  });

  it("asks the dates for discovery, diagnosis, death, independent repose and all multi-clock limbs", () => {
    const modes: [LimitationRule["calculation"], string[]][] = [
      [{ mode: "discovery_min" }, ["actualDiscoveryDate", "constructiveDiscoveryDate"]],
      [{ mode: "diagnosis" }, ["diagnosisCommunicationDate"]],
      [{ mode: "death_cause_min" }, ["deathDate", "causeDiscoveryDate"]],
      [
        {
          mode: "accrual_repose_min",
          reposeYears: 10,
          reposeTrigger: "first_delivery",
          reposeEffectiveFrom: "2020-01-01",
        },
        ["accrualDate", "firstProductDeliveryDate"],
      ],
      [
        {
          mode: "clocks_min",
          combine: "earlier",
          limbs: [
            { from: "injury_date", amount: 2, unit: "calendar_years" },
            { from: "discovery", amount: 1, unit: "calendar_years" },
          ],
          clocks: [{ from: "substantial_completion", years: 10, effectiveFrom: "2020-01-01" }],
        } as LimitationRule["calculation"],
        [
          "injuryDate",
          "actualDiscoveryDate",
          "constructiveDiscoveryDate",
          "substantialCompletionDate",
        ],
      ],
    ];
    for (const [calculation, fields] of modes) {
      const { snapshot, input, rule } = fixture();
      rule.calculation = calculation!;
      input.accrualDate = "";
      const plan = planConversationAssessment(snapshot, input);
      expect(
        plan.questions
          .filter((question) => question.kind === "date")
          .map((question) => question.field),
      ).toEqual(fields);
    }
  });

  it("retains factual answers across date changes, while uncertainty remains a blocker instead of a repeating question", () => {
    const { snapshot, input } = fixture();
    const screening: ConversationScreening = { ...allNo(), bankruptcy: "unsure" };
    const original = planConversationAssessment(snapshot, input, screening);
    const changed = planConversationAssessment(
      snapshot,
      { ...input, accrualDate: "2024-02-01" },
      screening,
    );
    expect(changed.screens).toEqual(original.screens);
    expect(changed.questions.some((question) => question.screenId === "bankruptcy")).toBe(false);
    expect(
      changed.blockers.some(
        (blocker) => blocker.id === "screen:bankruptcy" && blocker.reason.includes("uncertain"),
      ),
    ).toBe(true);
    expect(changed.assessment.date).toBeNull();
  });

  it("never converts factual yes/no answers into legal confirmations or review decisions", () => {
    const { snapshot, input } = fixture();
    const before = structuredClone(input);
    const plan = planConversationAssessment(snapshot, input, allNo());
    expect(input).toEqual(before);
    expect(plan.assessment.date).toBeNull();
    expect(plan.assessment.progress.resolved).toBe(0);
    expect(
      plan.blockers.some((blocker) => blocker.reason.includes("governing state's limitations law")),
    ).toBe(true);
  });

  it("invalidates independently supplied legal review after a date or source change", () => {
    const { snapshot, input } = fixture();
    Object.assign(input, {
      governingLawConfirmed: true,
      accrualConfirmed: true,
      applicabilityConfirmed: true,
    });
    const review = independentReview(snapshot, input);
    expect(planConversationAssessment(snapshot, input, allNo(), { review }).assessment.date).toBe(
      "2026-01-01",
    );
    expect(
      planConversationAssessment(snapshot, { ...input, accrualDate: "2024-01-02" }, allNo(), {
        review,
      }).assessment.date,
    ).toBeNull();
    snapshot.sources[0]!.sha256 = "b".repeat(64);
    expect(
      planConversationAssessment(snapshot, input, allNo(), { review }).assessment.date,
    ).toBeNull();
  });

  it("shows branch options without switching to an ambiguous or research rule", () => {
    const { snapshot, input, rule } = fixture();
    rule.subtype = "recorded-branch";
    const plan = planConversationAssessment(snapshot, input);
    expect(plan.rule).toBeNull();
    expect(plan.nextQuestion?.field).toBe("subtype");
    expect(plan.nextQuestion?.options?.[0]).toEqual({
      value: "recorded-branch",
      label: "Synthetic ordinary injury (accrual dates on or after 2020-01-01)",
    });
    rule.computation = "research_only";
    expect(planConversationAssessment(snapshot, input).questions).toEqual([]);
  });
});

describe("separate conditional illustrations", () => {
  it("requires an explicit request and confirmed facts after assumptions are shown", () => {
    const { snapshot, input } = fixture();
    for (const options of [
      { ...requested(), requested: false },
      { ...requested(), factsConfirmed: false },
    ]) {
      const result = calculateConversationScenario(snapshot, input, options);
      expect(result.status).toBe("withheld");
      expect(result.date).toBeNull();
      expect(result.steps).toEqual([]);
    }
  });

  it("performs only labeled hypothetical arithmetic and leaves inputs and every qualification unapproved", () => {
    const { snapshot, input, rule } = fixture();
    const before = structuredClone({ snapshot, input });
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.status).toBe("conditional_illustration");
    expect(result.date).toBe("2026-01-01");
    expect(result.verifiedFilingDeadline).toBe(false);
    expect(result.legalApplicabilityVerified).toBe(false);
    expect(result.qualifications).toEqual(buildReviewInventory(rule));
    expect(result.assumptions.join(" ")).toContain(
      "Actual governing law and statutory applicability remain unresolved",
    );
    expect({ snapshot, input }).toEqual(before);
    expect(planConversationAssessment(snapshot, input, allNo()).assessment.date).toBeNull();
  });

  it("presents all modeled calculation paths as proposed facts while preserving exact arithmetic and source citations", () => {
    const configure: ((f: ReturnType<typeof fixture>) => void)[] = [
      () => {},
      ({ rule }) => {
        rule.accrualBasis = "death";
      },
      ({ rule, input }) => {
        rule.calculation = { mode: "discovery_min" };
        input.accrualDate = "";
        input.actualDiscoveryDate = "2024-03-01";
        input.constructiveDiscoveryDate = "2024-02-01";
      },
      ({ rule, input }) => {
        rule.calculation = { mode: "diagnosis", requiresExposureWithinDeliveryYears: 10 };
        input.accrualDate = "";
        input.diagnosisCommunicationDate = "2024-03-01";
        input.firstProductDeliveryDate = "2020-01-01";
        input.qualifyingExposureDate = "2021-01-01";
      },
      ({ rule, input }) => {
        rule.calculation = { mode: "death_cause_min", secondaryCapYears: 3 };
        input.accrualDate = "";
        input.vitalStatus = "deceased";
        input.deathDate = "2023-01-01";
        input.causeDiscoveryDate = "2024-01-01";
      },
      ({ rule, input }) => {
        rule.calculation = {
          mode: "accrual_repose_min",
          reposeYears: 10,
          reposeTrigger: "act_or_omission",
          reposeEffectiveFrom: "2020-01-01",
        };
        input.reposeActDate = "2020-01-01";
      },
      ({ rule, input }) => {
        rule.calculation = {
          mode: "clocks_min",
          limbs: [{ from: "accrual", amount: 2, unit: "calendar_years" }],
          clocks: [
            { from: "act_or_omission", years: 10, effectiveFrom: null, startBasis: "not_recorded" },
          ],
        };
        input.reposeActDate = "2020-01-01";
      },
    ];
    for (const setup of configure) {
      const f = fixture();
      setup(f);
      const baseline = calculateBaseline(f.snapshot, {
        ...f.input,
        governingLawConfirmed: true,
        accrualConfirmed: true,
        applicabilityConfirmed: true,
        reposeApplicabilityConfirmed: true,
        exceptionReview: "no_unresolved_issues",
      });
      const result = calculateConversationScenario(f.snapshot, f.input, requested());
      expect(result.status, f.rule.calculation?.mode).toBe("conditional_illustration");
      expect(result.date).toBe(baseline.date);
      expect(result.calendar).toEqual({
        adjustedDate: baseline.adjustedDate ?? null,
        weekendNotice: baseline.weekendNotice ?? null,
      });
      expect(
        result.steps.map(({ text, ...citation }) => ({
          ...citation,
          dates: text.match(/\d{4}-\d{2}-\d{2}/g),
        })),
      ).toEqual(
        baseline.steps.map(({ text, ...citation }) => ({
          ...citation,
          dates: text.match(/\d{4}-\d{2}-\d{2}/g),
        })),
      );
      const explanations = [...result.steps.map((step) => step.text), ...result.reasons].join(" ");
      expect(explanations).not.toMatch(
        /\bconfirmed\b|legally qualifying|applied as current law|current bar was applied|earliest applicable date/i,
      );
      expect(result.qualifications).toEqual(buildReviewInventory(f.rule));
      expect(result.reasons).toContain("Synthetic warning");
      if (f.rule.calculation?.mode === "clocks_min") {
        expect(explanations).toContain("historical applicability remains unresolved");
        expect(explanations).toContain("retained outer limit was assumed");
      }
    }
  });

  it("does not call accrual confirmed in a withheld repose explanation", () => {
    const { snapshot, input, rule } = fixture();
    rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 1,
      reposeTrigger: "act_or_omission",
      reposeEffectiveFrom: "2020-01-01",
    };
    input.reposeActDate = "2020-01-01";
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.date).toBeNull();
    expect(result.reasons.join(" ")).toContain("proposed accrual date");
    expect(result.reasons.join(" ")).not.toContain("confirmed");
  });

  it("withholds for every positive, unknown or unanswered material screen", () => {
    const { snapshot, input } = fixture();
    for (const screen of planConversationAssessment(snapshot, input).screens) {
      for (const answer of ["yes", "unsure", undefined] as const) {
        const options = requested();
        if (answer) options.screening[screen.id] = answer;
        else delete options.screening[screen.id];
        const result = calculateConversationScenario(snapshot, input, options);
        expect(result.date, `${screen.id}: ${answer}`).toBeNull();
        expect(result.calendar).toBeNull();
        expect(result.steps).toEqual([]);
      }
    }
  });

  it("does not clear earlier special issues or accept unknown screening fields", () => {
    const { snapshot, input } = fixture();
    input.issues = ["prior_filing"];
    expect(calculateConversationScenario(snapshot, input, requested()).reasons.join(" ")).toContain(
      "Previously recorded special issues",
    );
    input.issues = [];
    const options = requested();
    Object.assign(options.screening, { fabricated: "no" });
    expect(calculateConversationScenario(snapshot, input, options).date).toBeNull();
  });

  it("preserves source identity, lost-evidence, stale-source, refresh and flagged-entry guards", () => {
    const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
      ({ snapshot }) => {
        snapshot.sources = [];
      },
      ({ snapshot }) => {
        snapshot.sources.push(structuredClone(snapshot.sources[0]!));
      },
      ({ snapshot }) => {
        snapshot.sources[0]!.state = "TX";
      },
      ({ snapshot }) => {
        snapshot.sources[0]!.verifiedAt = "2023-12-31T00:00:00Z";
      },
      ({ snapshot }) => {
        snapshot.sources[0]!.currency = { status: "evidence_lost" } as never;
      },
      ({ rule }) => {
        rule.provenance!.entryStatus = "flagged";
      },
      ({ rule }) => {
        rule.computation = "research_only";
      },
      ({ rule }) => {
        rule.effectiveThrough = "2023-12-31";
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      mutate(f);
      const result = calculateConversationScenario(f.snapshot, f.input, requested());
      expect(result.status).toBe("withheld");
      expect(result.date).toBeNull();
      expect(result.steps).toEqual([]);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
    const f = fixture();
    expect(
      calculateConversationScenario(f.snapshot, f.input, {
        ...requested(),
        sourceRefreshFailed: true,
      }).date,
    ).toBeNull();
  });

  it("never leaks an anniversary after an invalid date, leap-day gap or unmodeled repose limit", () => {
    for (const date of ["2024-02-30", "2024-02-29", "2027-01-01"]) {
      const f = fixture();
      f.input.accrualDate = date;
      const result = calculateConversationScenario(f.snapshot, f.input, requested());
      expect(result.date).toBeNull();
      expect(result.calendar).toBeNull();
      expect(result.steps).toEqual([]);
    }
    const f = fixture();
    f.rule.provenance!.repose = [
      { years: 10, trigger: "first delivery", citation: "Synthetic cap", effectiveFrom: null },
    ];
    expect(
      calculateConversationScenario(f.snapshot, f.input, requested()).reasons.join(" "),
    ).toContain("does not calculate");
  });

  it("does not discard distinct clock events when an ordinary branch no longer consumes them", () => {
    const fields = [
      "actualDiscoveryDate",
      "constructiveDiscoveryDate",
      "diagnosisCommunicationDate",
      "causeDiscoveryDate",
      "deathDate",
      "firstProductDeliveryDate",
      "qualifyingExposureDate",
      "substantialCompletionDate",
      "reposeActDate",
    ] as const;
    for (const field of fields) {
      const { snapshot, input } = fixture();
      input[field] = "2023-06-01";
      const plan = planConversationAssessment(snapshot, input, allNo());
      expect(
        plan.blockers.some((blocker) => blocker.id === `date:unmodeled:${field}`),
        field,
      ).toBe(true);
      const result = calculateConversationScenario(snapshot, input, requested());
      expect(result.status, field).toBe("withheld");
      expect(result.date).toBeNull();
      expect(result.calendar).toBeNull();
      expect(result.steps).toEqual([]);
    }
    const { snapshot, input, rule } = fixture();
    rule.calculation = { mode: "discovery_min" };
    input.actualDiscoveryDate = input.constructiveDiscoveryDate = "2024-03-01";
    expect(conversationDateBlockers(snapshot, input, rule)).toContainEqual(
      expect.objectContaining({ id: "date:unmodeled:accrualDate" }),
    );
  });

  it("retains matching event dates without copying or approving their legal meaning", () => {
    const { snapshot, input } = fixture();
    input.injuryDate = input.actualDiscoveryDate = input.reposeActDate = input.accrualDate;
    const before = structuredClone(input);
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.status).toBe("conditional_illustration");
    expect(result.legalApplicabilityVerified).toBe(false);
    expect(result.assumptions.join(" ")).toContain("not automatically interchangeable");
    expect(input).toEqual(before);
  });

  it("checks the source cutoff and validity of every supplied engine date, including unused injury dates", () => {
    const fields = [
      "accrualDate",
      "injuryDate",
      "actualDiscoveryDate",
      "constructiveDiscoveryDate",
      "diagnosisCommunicationDate",
      "causeDiscoveryDate",
      "deathDate",
      "firstProductDeliveryDate",
      "qualifyingExposureDate",
      "substantialCompletionDate",
      "reposeActDate",
    ] as const;
    for (const field of fields) {
      const { snapshot, input, rule } = fixture();
      input[field] = "2026-10-02"; // After source review, even though before the bundle snapshot.
      expect(conversationDateBlockers(snapshot, input, rule)).toContainEqual(
        expect.objectContaining({ id: `date:source-cutoff:${field}` }),
      );
      expect(calculateConversationScenario(snapshot, input, requested()).date, field).toBeNull();
      input[field] = "2024-02-30";
      expect(conversationDateBlockers(snapshot, input, rule)).toContainEqual(
        expect.objectContaining({ id: `date:reported-invalid:${field}` }),
      );
      expect(calculateConversationScenario(snapshot, input, requested()).date, field).toBeNull();
    }
  });

  it("questions injury after a proposed start but preserves earlier injury in a modeled discovery branch", () => {
    const { snapshot, input, rule } = fixture();
    input.injuryDate = "2024-02-01";
    expect(conversationDateBlockers(snapshot, input, rule)).toContainEqual(
      expect.objectContaining({ id: "date:injury-after-start" }),
    );
    expect(calculateConversationScenario(snapshot, input, requested()).date).toBeNull();
    rule.calculation = { mode: "discovery_min" };
    input.accrualDate = "";
    input.actualDiscoveryDate = "2024-04-01";
    input.constructiveDiscoveryDate = "2024-03-01";
    expect(conversationDateBlockers(snapshot, input, rule)).toEqual([]);
    expect(calculateConversationScenario(snapshot, input, requested()).date).toBe("2026-03-01");
  });

  it("recognizes a required death-cap event as consumed instead of rejecting a distinct modeled date", () => {
    const { snapshot, input, rule } = fixture();
    rule.calculation = { mode: "discovery_min", deathCapYears: 1 };
    input.accrualDate = "";
    input.actualDiscoveryDate = input.constructiveDiscoveryDate = "2024-03-01";
    input.vitalStatus = "deceased";
    input.deathDate = "2024-07-01";
    expect(conversationDateBlockers(snapshot, input, rule)).toEqual([]);
    expect(calculateConversationScenario(snapshot, input, requested()).date).toBe("2025-07-01");
  });

  it("uses the exact modeled discovery branch and asks only for additional discovery/claim complications", () => {
    const { snapshot, input, rule } = fixture();
    rule.claimType = input.claimType = "product_liability";
    rule.calculation = { mode: "discovery_min" };
    input.accrualDate = "";
    input.actualDiscoveryDate = "2024-03-01";
    input.constructiveDiscoveryDate = "2024-02-01";
    const plan = planConversationAssessment(snapshot, input, allNo());
    expect(plan.screens.find((screen) => screen.id === "discovery")!.prompt).toContain(
      "Beyond the discovery",
    );
    expect(plan.screens.find((screen) => screen.id === "special_claim")!.prompt).toContain(
      "Apart from the product",
    );
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.date).toBe("2026-02-01");
    expect(result.calendar?.weekendNotice?.kind).toBe("no_rule");
    expect(result.calendar?.adjustedDate).toBeNull();
    expect(
      calculateConversationScenario(snapshot, input, {
        ...requested(),
        screening: { ...allNo(), discovery: "yes" },
      }).date,
    ).toBeNull();
  });

  it("allows modeled death and repose assumptions without claiming their applicability was proved", () => {
    const { snapshot, input, rule } = fixture();
    rule.claimType = input.claimType = "wrongful_death";
    rule.accrualBasis = "death";
    rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 10,
      reposeTrigger: "act_or_omission",
      reposeEffectiveFrom: "2020-01-01",
    };
    input.reposeActDate = "2023-01-01";
    const plan = planConversationAssessment(snapshot, input, allNo());
    expect(plan.screens.find((screen) => screen.id === "death")!.prompt).toContain(
      "Beyond the death",
    );
    expect(plan.screens.find((screen) => screen.id === "repose")!.prompt).toContain(
      "Beyond the delivery",
    );
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.status).toBe("conditional_illustration");
    expect(result.date).toBe("2026-01-01");
    expect(input.reposeApplicabilityConfirmed).toBeUndefined();
    input.reposeActDate = "2019-01-01";
    expect(calculateConversationScenario(snapshot, input, requested()).date).toBeNull();
  });

  it("does not expose an ordinary assessment date when additional conversation source guards reject it", () => {
    const { snapshot, input } = fixture();
    Object.assign(input, {
      governingLawConfirmed: true,
      accrualConfirmed: true,
      applicabilityConfirmed: true,
    });
    snapshot.sources[0]!.state = "TX";
    const plan = planConversationAssessment(snapshot, input, allNo(), {
      review: independentReview(snapshot, input),
    });
    expect(plan.assessment.date).toBeNull();
    expect(plan.blockers.some((blocker) => blocker.id === "source:identity")).toBe(true);
  });
});

// Explicit opt-in: CI exercises synthetic guards above without requiring private source data.
const releasedBundle = process.env["LIM_BUNDLE_DIR"];
it.skipIf(!releasedBundle)(
  "released verified rule permits illustration while the flagged CA product entry remains withheld",
  () => {
    const json = (name: string) =>
      JSON.parse(readFileSync(`${releasedBundle}/${name}.json`, "utf8"));
    const snapshot: LimitationsSnapshot = {
      ...json("rules"),
      sources: json("sources").sources,
      coverage: json("coverage").coverage,
      cases: json("case-references").cases,
    };
    const input: BaselineInput = {
      ...fixture().input,
      jurisdiction: "CA",
      claimType: "product_liability",
      accrualDate: "",
      actualDiscoveryDate: "2024-03-01",
      constructiveDiscoveryDate: "2024-02-01",
    };
    const result = calculateConversationScenario(snapshot, input, requested());
    expect(result.status).toBe("withheld");
    expect(result.date).toBeNull();
    expect(result.reasons.join(" ")).toContain("no product-specific period");
    expect(result.verifiedFilingDeadline).toBe(false);
    expect(result.qualifications.length).toBeGreaterThan(10);
    const verified = calculateConversationScenario(
      snapshot,
      {
        ...fixture().input,
        jurisdiction: "IN",
        claimType: "personal_injury",
        accrualDate: "2024-03-01",
      },
      requested(),
    );
    expect(verified.status).toBe("conditional_illustration");
    expect(verified.date).toBe("2026-03-01");
    expect(verified.verifiedFilingDeadline).toBe(false);
  },
);
