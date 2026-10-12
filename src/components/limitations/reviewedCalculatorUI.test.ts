import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewedCalculator } from "./ReviewedCalculator";
import { reviseCaseFacts, intakeCaseFacts, chooseIntakeCase, isEvidenceRefresh } from "./caseFacts";
import { parseIntake, confirmIntake } from "@/lib/limitations/intake";
import { unconfirmedClaimInput } from "./calculatorGuidance";
import type { LimitationsSnapshot } from "@/lib/limitations/types";
const empty = {
  rules: [],
  sources: [],
  coverage: [],
  cases: [],
  snapshotDate: "2026-10-08",
  ruleVersion: "test-release",
} as unknown as LimitationsSnapshot;

describe("guided calculator", () => {
  it("starts with a single compact step and no invented deadline", () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewedCalculator, {
        snapshot: empty,
        state: "",
        claim: undefined,
        onNavigate: () => {},
        renderAuthority: () => null,
      }),
    );
    expect(markup).toContain("Case &amp; law");
    expect(markup).toContain("Timeline");
    expect(markup).toContain("Review &amp; result");
    expect(markup).toContain("Choose a state");
    expect(markup).toContain("Start with a description");
    expect(markup).not.toContain("Reviewed scenario date");
  });
  it("makes incomplete rule coverage explicit instead of selecting another claim", () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewedCalculator, {
        snapshot: empty,
        state: "AR",
        claim: "defamation",
        onNavigate: () => {},
        renderAuthority: () => null,
      }),
    );
    expect(markup).toContain("No supported calculation");
    expect(markup).toContain("Review recorded sources");
    expect(markup).toContain("A missing rule does not establish that the claim has no time limit");
  });
  it("editing a timeline clears fact-specific confirmations and exception review", () => {
    const previous = {
      ...unconfirmedClaimInput("CA", "personal_injury"),
      accrualDate: "2024-01-01",
      governingLawConfirmed: true,
      accrualConfirmed: true,
      applicabilityConfirmed: true,
      reposeApplicabilityConfirmed: true,
      exceptionReview: "no_unresolved_issues" as const,
    };
    const next = reviseCaseFacts(previous, { accrualDate: "2024-02-01" });
    expect(next.accrualConfirmed).toBe(false);
    expect(next.applicabilityConfirmed).toBe(false);
    expect(next.reposeApplicabilityConfirmed).toBe(false);
    expect(next.exceptionReview).toBe("unresolved");
    expect(previous.accrualDate).toBe("2024-01-01");
  });
  it("confirmation changes do not accidentally clear the selected confirmation", () => {
    const previous = unconfirmedClaimInput("CA", "personal_injury");
    expect(reviseCaseFacts(previous, { accrualConfirmed: true }).accrualConfirmed).toBe(true);
  });
  it("applying confirmed intake never confirms governing law, accrual or exceptions", () => {
    const result = parseIntake("California personal injury. Injury date: 2024-01-15.");
    const accepted = confirmIntake(
      result,
      result.facts.map((f) => f.field),
      true,
    )!;
    const input = intakeCaseFacts(accepted, "", undefined);
    expect(input.jurisdiction).toBe("CA");
    expect(input.claimType).toBe("personal_injury");
    expect(input.injuryDate).toBe("2024-01-15");
    expect(input.accrualDate).toBe("");
    expect(input.governingLawConfirmed).toBe(false);
    expect(input.accrualConfirmed).toBe(false);
    expect(input.applicabilityConfirmed).toBe(false);
    expect(input.exceptionReview).toBe("unresolved");
  });
  it("completing a partial intake preserves dates while resetting legal decisions", () => {
    const previous = {
      ...unconfirmedClaimInput("CA", "personal_injury"),
      injuryDate: "2024-01-15",
      governingLawConfirmed: true,
      accrualConfirmed: true,
    };
    const input = chooseIntakeCase(previous, "NY", "product_liability");
    expect(input.injuryDate).toBe("2024-01-15");
    expect(input.accrualDate).toBe("");
    expect(input.jurisdiction).toBe("NY");
    expect(input.claimType).toBe("product_liability");
    expect(input.governingLawConfirmed).toBe(false);
    expect(input.accrualConfirmed).toBe(false);
  });
  it("does not describe an initial intake or deliberate new case/version as changed evidence", () => {
    const selected = { selectionKey: "CA/personal_injury/general", sourceKey: "evidence-a" };
    expect(isEvidenceRefresh({ selectionKey: "", sourceKey: "" }, selected)).toBe(false);
    expect(isEvidenceRefresh({ ...selected, sourceKey: "" }, selected)).toBe(false);
    expect(
      isEvidenceRefresh(selected, {
        selectionKey: "NY/personal_injury/general",
        sourceKey: "evidence-b",
      }),
    ).toBe(false);
    expect(
      isEvidenceRefresh(selected, {
        selectionKey: "CA/personal_injury/latent_toxic",
        sourceKey: "evidence-c",
      }),
    ).toBe(false);
  });
  it("still invalidates refreshed or removed authority within the same selected case", () => {
    const selected = { selectionKey: "CA/personal_injury/general", sourceKey: "evidence-a" };
    expect(isEvidenceRefresh(selected, { ...selected, sourceKey: "evidence-b" })).toBe(true);
    expect(isEvidenceRefresh(selected, { ...selected, sourceKey: "" })).toBe(true);
    expect(isEvidenceRefresh(selected, selected)).toBe(false);
  });
});

it("renders an explicit evidence-refresh failure without crashing or showing a date", () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewedCalculator, {
      snapshot: empty,
      state: "CA",
      claim: "personal_injury",
      sourceRefreshFailed: true,
      onNavigate: () => {},
      renderAuthority: () => null,
    }),
  );
  expect(markup).toContain("Source refresh failed");
  expect(markup).not.toContain("guided-result");
});
