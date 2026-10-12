import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SCREENING_QUESTIONS } from "@/lib/limitations/exceptionReview";
import { reviewContextKey } from "@/lib/limitations/reviewInventory";
import type { LimitationsSnapshot } from "@/lib/limitations/types";
import { GuidedCalculator } from "./GuidedCalculator";
import { unconfirmedClaimInput } from "./calculatorGuidance";

const hooks = vi.hoisted(() => ({
  index: 0,
  initial: {} as Record<number, unknown>,
  rendered: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      const result = react.useState(
        Object.hasOwn(hooks.initial, index) ? hooks.initial[index] : initial,
      );
      hooks.rendered[index] = result[0];
      return result;
    },
  };
});

function fixture(): LimitationsSnapshot {
  return {
    ruleVersion: "synthetic-release",
    snapshotDate: "2026-10-12",
    rules: [
      {
        id: "synthetic-rule",
        jurisdiction: "IL",
        claimType: "personal_injury",
        subtype: "general",
        ruleKind: "limitations",
        computation: "baseline_only",
        reviewStatus: "statutory_text_verified",
        period: { amount: 1, unit: "calendar_years" },
        sourceIds: ["synthetic-source"],
        pinpoint: "Synthetic § 1",
        scope: "Synthetic fixture only",
        accrualBasis: "confirmed_accrual",
        conditions: [],
        exclusions: [],
        warnings: [],
        effectiveFrom: "2020-01-01",
        effectiveThrough: null,
        provenance: { entryStatus: "verified", flags: [], tolling: [], repose: [] },
      },
    ],
    sources: ["synthetic-source", "counting-source"].map((id) => ({
      id,
      title: "Synthetic statute",
      state: "IL",
      authorityKind: "statute",
      sha256: "a".repeat(64),
      verifiedAt: "2026-10-12T00:00:00Z",
    })),
    cases: [],
    coverage: [
      {
        state: "IL",
        claimCoverage: [],
        timeComputation: {
          sourceId: "counting-source",
          citation: "Synthetic § 2",
          weekend: "next_business_day",
        },
      },
    ],
  } as unknown as LimitationsSnapshot;
}

function renderAfterRefresh(next: LimitationsSnapshot, previous = fixture()) {
  const rule = previous.rules[0]!;
  const input = {
    ...unconfirmedClaimInput("IL", "personal_injury"),
    accrualDate: "2024-01-01",
    injuryDate: "2023-12-30",
    governingLawConfirmed: true,
    accrualConfirmed: true,
    applicabilityConfirmed: true,
    reposeApplicabilityConfirmed: true,
  };
  // Hydrate a completed real component, then let React perform its render-time source reset.
  // Only the first render is hydrated; rerenders retain React's actual updated state.
  hooks.index = 0;
  hooks.rendered = [];
  hooks.initial = {
    0: input,
    1: 2,
    2: 2,
    3: Object.fromEntries(SCREENING_QUESTIONS.map((q) => [q.id, "no"])),
    4: true,
    5: { policyId: "old-policy", majorityDate: "2024-01-01", conditionsConfirmed: true },
    6: { status: "baseline", date: "2025-01-01", rule, reasons: [], steps: [] },
    9: {
      selectionKey: JSON.stringify(["IL", "personal_injury", "general"]),
      sourceKey: reviewContextKey(previous, rule, unconfirmedClaimInput("IL", "personal_injury")),
    },
  };
  return renderToStaticMarkup(
    createElement(GuidedCalculator, {
      snapshot: next,
      state: "IL",
      claim: "personal_injury",
      onNavigate: () => {},
      renderEvidence: () => null,
      patternLabel: (subtype) => subtype,
    }),
  );
}

describe("statutory calculator evidence binding", () => {
  it("preserves a completed assessment for an equivalent snapshot object", () => {
    const html = renderAfterRefresh(fixture());
    expect(html).toContain('dateTime="2025-01-01"');
    expect(html).not.toContain("The rule or source evidence changed");
    expect(hooks.rendered[4]).toBe(true);
  });

  it.each([
    [
      "release change",
      (snapshot: LimitationsSnapshot) => {
        snapshot.ruleVersion = "synthetic-next";
      },
    ],
    [
      "same-release source bytes",
      (snapshot: LimitationsSnapshot) => {
        snapshot.sources[0]!.sha256 = "b".repeat(64);
      },
    ],
    [
      "same-release review date",
      (snapshot: LimitationsSnapshot) => {
        snapshot.sources[0]!.verifiedAt = "2026-10-11T00:00:00Z";
      },
    ],
    [
      "same-release rule qualification",
      (snapshot: LimitationsSnapshot) => {
        snapshot.rules[0]!.warnings = ["New synthetic qualification"];
      },
    ],
    [
      "counting evidence",
      (snapshot: LimitationsSnapshot) => {
        snapshot.sources[1]!.sha256 = "c".repeat(64);
      },
    ],
    [
      "removed rule",
      (snapshot: LimitationsSnapshot) => {
        snapshot.rules = [];
      },
    ],
  ] as const)("clears old approvals and date before rendering a %s", (_name, change) => {
    const snapshot = fixture();
    change(snapshot);
    const html = renderAfterRefresh(snapshot);
    expect(html).not.toContain("2025-01-01");
    expect(html).not.toContain("January 1, 2025");
    expect(html).not.toContain('data-testid="guided-result"');
    expect(html).toContain("The rule or source evidence changed");
    const rerender = hooks.rendered.slice(11, 22);
    expect(rerender[0]).toMatchObject({
      accrualDate: "2024-01-01",
      injuryDate: "2023-12-30",
      governingLawConfirmed: false,
      accrualConfirmed: false,
      applicabilityConfirmed: false,
      reposeApplicabilityConfirmed: false,
      exceptionReview: "unresolved",
    });
    expect(rerender[1]).toBe(0);
    expect(rerender[3]).toEqual({});
    expect(rerender[4]).toBe(false);
    expect(rerender[5]).toMatchObject({
      policyId: "",
      majorityDate: "",
      conditionsConfirmed: false,
    });
    expect(rerender[6]).toBeNull();
  });
});
