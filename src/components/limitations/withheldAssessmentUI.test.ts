import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assessDeadline } from "@/lib/limitations/deadlineAssessment";
import {
  buildReviewInventory,
  reviewContextKey,
  type ReviewState,
} from "@/lib/limitations/reviewInventory";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { ReviewedCalculator } from "./ReviewedCalculator";

const state = vi.hoisted(() => ({ index: 0, values: {} as Record<number, unknown> }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = state.index++;
      return react.useState(Object.hasOwn(state.values, index) ? state.values[index] : initial);
    },
  };
});

describe("withheld assessment rendering", () => {
  it.each(["flagged source", "rejected instruction"])(
    "does not render a computed date in the evidence trail for a %s",
    (caseName) => {
      const rule = {
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
        provenance: {
          entryStatus: caseName === "flagged source" ? "flagged" : "verified",
          lastAmended: { date: null, text: "Not recorded in synthetic fixture" },
          flags: [],
          tolling: [{ text: "Synthetic suspension note", citation: "Synthetic § 2" }],
          repose: [],
        },
      } as unknown as LimitationRule;
      const snapshot = {
        ruleVersion: "synthetic-release",
        snapshotDate: "2026-10-12",
        rules: [rule],
        sources: [
          {
            id: "synthetic-source",
            title: "Synthetic statute",
            state: "IL",
            authorityKind: "statute",
            sha256: "a".repeat(64),
            verifiedAt: "2026-10-12T00:00:00Z",
          },
        ],
        cases: [],
        coverage: [{ state: "IL", claimCoverage: [] }],
      } as unknown as LimitationsSnapshot;
      const input: BaselineInput = {
        jurisdiction: "IL",
        claimType: "personal_injury",
        accrualDate: "2024-01-01",
        governingLawConfirmed: true,
        accrualConfirmed: true,
        applicabilityConfirmed: true,
        exceptionReview: "unresolved",
        issues: [],
      };
      const contextKey = reviewContextKey(snapshot, rule, input);
      const review: ReviewState = {
        contextKey,
        decisions: Object.fromEntries(
          buildReviewInventory(rule).map((factor) => [factor.id, { status: "no_effect" }]),
        ),
      };
      if (caseName === "rejected instruction") {
        review.decisions["provenance.tolling[0]"] = {
          status: "instruction",
          instruction: {
            id: "late-pause",
            kind: "pause",
            startDate: "2025-03-01",
            resumeDate: "2025-04-01",
            authority: "Synthetic § 2",
            explanation: "Synthetic instruction after the original period expired.",
            reviewer: "Test reviewer",
            legalEffectConfirmed: true,
            boundariesConfirmed: true,
            interactionsConfirmed: true,
          },
        };
      }
      const assessment = assessDeadline(snapshot, input, review);
      expect(assessment.date).toBeNull();
      // Hydrate only the calculator's case facts, review and result states to render its real
      // post-assessment UI without replacing the result renderer or legal assessment function.
      state.index = 0;
      state.values = {
        3: input,
        5: review,
        6: { contextKey, decisionsKey: JSON.stringify(review.decisions), assessment },
      };
      const html = renderToStaticMarkup(
        createElement(ReviewedCalculator, {
          snapshot,
          state: "IL",
          claim: "personal_injury",
          onNavigate: () => {},
          renderAuthority: () => null,
        }),
      );
      expect(html).toContain("No deadline established");
      expect(html).toContain("Calculation and evidence trail");
      expect(html).toContain("synthetic-release");
      expect(html).not.toContain("2025-01-01");
      expect(html).not.toContain("Jan 1, 2025");
      expect(html).not.toContain("Weekend-only candidate");
      expect(html).toContain(
        caseName === "flagged source" ? "flagged legal-source entry" : "No revival was assumed",
      );
    },
  );
});
