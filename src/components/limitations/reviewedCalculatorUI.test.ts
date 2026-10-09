import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewedCalculator } from "./ReviewedCalculator";
import { reviseCaseFacts } from "./caseFacts";
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
