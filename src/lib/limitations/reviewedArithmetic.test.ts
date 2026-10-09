import { describe, expect, it } from "vitest";
import {
  applyReviewedInstructions,
  validateInstruction,
  type ReviewedInstruction,
} from "./reviewedArithmetic";

const verification = {
  authority: "Synthetic test authority, not law",
  explanation: "The selected civil-date effect and its scope were confirmed for this test.",
  reviewer: "Test reviewer",
  legalEffectConfirmed: true,
  boundariesConfirmed: true,
  interactionsConfirmed: true,
};
const pause = (id: string, startDate: string, resumeDate: string): ReviewedInstruction => ({
  id,
  kind: "pause",
  startDate,
  resumeDate,
  ...verification,
});
const run = (instructions: ReviewedInstruction[], extra: Record<string, unknown> = {}) =>
  applyReviewedInstructions({
    startDate: "2024-01-01",
    baselineDate: "2025-01-01",
    period: { amount: 1, unit: "calendar_years" },
    instructions,
    ...extra,
  } as Parameters<typeof applyReviewedInstructions>[0]);

describe("reviewed arithmetic is not inferred legal advice", () => {
  it("does not invent an adjustment", () => expect(run([]).date).toBe("2025-01-01"));
  it("rejects unconfirmed legal effects and empty authority/reviewer", () => {
    for (const extra of [
      { legalEffectConfirmed: false },
      { boundariesConfirmed: false },
      { interactionsConfirmed: false },
      { authority: "" },
      { reviewer: "" },
      { explanation: "" },
    ]) {
      expect(
        validateInstruction({ ...pause("p", "2024-03-01", "2024-04-01"), ...extra }).length,
      ).toBeGreaterThan(0);
    }
  });
  it("uses civil days across the DST boundary", () =>
    expect(run([pause("p", "2024-03-01", "2024-04-01")]).date).toBe("2025-02-01"));
  it("counts overlapping and adjacent intervals only once", () => {
    const result = run([
      pause("a", "2024-03-01", "2024-04-01"),
      pause("b", "2024-03-15", "2024-04-15"),
      pause("c", "2024-04-15", "2024-04-20"),
    ]);
    expect(result.excludedDays).toBe(50);
    expect(result.date).toBe("2025-02-20");
  });
  it("clips an interval that began before accrual", () => {
    const r = run([pause("p", "2023-12-01", "2024-02-01")]);
    expect(r.excludedDays).toBe(31);
    expect(r.date).toBe("2025-02-01");
  });
  it("does not count an interval wholly before the clock began", () =>
    expect(run([pause("p", "2023-01-01", "2023-02-01")]).date).toBe("2025-01-01"));
  it("does not revive an expired limitation with a later pause", () => {
    const r = run([pause("p", "2025-01-02", "2025-02-01")]);
    expect(r.date).toBeNull();
    expect(r.status).toBe("needs_review");
  });
  it("uses extensions already earned when checking a later interval", () => {
    const a = pause("a", "2024-03-01", "2024-04-01"),
      b = pause("b", "2025-01-15", "2025-01-20");
    const r = run([b, a]);
    expect(r.excludedDays).toBe(36);
    expect(r.date).toBe("2025-02-06");
  });
  it("does not count a gap as tolling", () => {
    const r = run([pause("a", "2024-01-01", "2024-01-10"), pause("b", "2024-01-20", "2024-01-30")]);
    expect(r.excludedDays).toBe(19);
  });
  it("returns no endpoint for an ongoing suspension", () => {
    const r = run([pause("p", "2024-06-01", "")]);
    expect(r.date).toBeNull();
    expect(r.status).toBe("open_ended");
  });
  it.each([
    ["2024-02-30", "2024-03-01"],
    ["2024-03-03", "2024-03-02"],
    ["2024-03-03", "2024-03-03"],
    ["bad", "2024-03-03"],
  ])("rejects malformed interval %s to %s", (a, b) =>
    expect(run([pause("p", a, b)]).status).toBe("invalid"),
  );
  it("rejects duplicate instruction identity", () =>
    expect(
      run([pause("a", "2024-01-01", "2024-01-03"), pause("a", "2024-01-04", "2024-01-05")]).status,
    ).toBe("invalid"));
  it("preserves a missing leap anniversary as an unresolved issue", () => {
    const r = run([
      {
        id: "d",
        kind: "defer_start",
        resumeDate: "2024-02-29",
        presentAtAccrualConfirmed: true,
        ...verification,
      },
    ]);
    expect(r.date).toBeNull();
  });
  it("restarts the period at an explicitly reviewed resume date without changing historical accrual", () => {
    const r = run([
      {
        id: "d",
        kind: "defer_start",
        resumeDate: "2024-06-01",
        presentAtAccrualConfirmed: true,
        ...verification,
      },
    ]);
    expect(r.date).toBe("2025-06-01");
    expect(r.originalStartDate).toBe("2024-01-01");
    expect(r.effectiveStartDate).toBe("2024-06-01");
  });
  it("never assumes a later disability existed at accrual", () => {
    expect(
      run([
        {
          id: "d",
          kind: "defer_start",
          resumeDate: "2024-06-01",
          presentAtAccrualConfirmed: false,
          ...verification,
        },
      ]).date,
    ).toBeNull();
  });
  it("does not double-count a pause already covered by a delayed start", () => {
    const r = run([
      {
        id: "d",
        kind: "defer_start",
        resumeDate: "2024-06-01",
        presentAtAccrualConfirmed: true,
        ...verification,
      },
      pause("p", "2024-01-01", "2024-06-01"),
    ]);
    expect(r.date).toBe("2025-06-01");
    expect(r.excludedDays).toBe(0);
  });
  it("treats an extension floor as max(existing,date), not the length of a stay", () => {
    const r = run([
      {
        id: "floor",
        kind: "minimum_after_event",
        protectedFromDate: "2024-12-01",
        eventDate: "2025-03-01",
        amount: 30,
        unit: "calendar_days",
        ...verification,
      },
    ]);
    expect(r.date).toBe("2025-03-31");
    expect(r.excludedDays).toBe(0);
  });
  it("a floor does not shorten an existing deadline", () => {
    const r = run([
      {
        id: "floor",
        kind: "minimum_after_event",
        protectedFromDate: "2024-01-01",
        eventDate: "2024-02-01",
        amount: 30,
        unit: "calendar_days",
        ...verification,
      },
    ]);
    expect(r.date).toBe("2025-01-01");
  });
  it("blocks an extension floor with no protection before expiry", () => {
    const r = run([
      {
        id: "floor",
        kind: "minimum_after_event",
        protectedFromDate: "2025-01-02",
        eventDate: "2025-03-01",
        amount: 30,
        unit: "calendar_days",
        ...verification,
      },
    ]);
    expect(r.date).toBeNull();
  });
  it("does not silently extend an independent outer cap", () => {
    const r = run([pause("p", "2024-03-01", "2024-04-01")], {
      outerCaps: [{ date: "2025-01-10", citation: "Separate outer cap" }],
    });
    expect(r.date).toBe("2025-01-10");
    expect(r.capped).toBe(true);
  });
  it("requires explicit clock scope rather than mixing fixed-date overrides", () => {
    const fixed = {
      id: "f",
      kind: "fixed_deadline",
      date: "2025-05-01",
      ...verification,
    } as ReviewedInstruction;
    expect(run([fixed]).date).toBe("2025-05-01");
    expect(run([fixed, pause("p", "2024-02-01", "2024-03-01")]).date).toBeNull();
  });
  it("is invariant to the order of pause instructions", () => {
    const a = pause("a", "2024-03-01", "2024-05-01"),
      b = pause("b", "2024-04-01", "2024-07-01");
    expect(run([a, b]).date).toBe(run([b, a]).date);
  });
  it("does not mutate input instructions", () => {
    const a = [pause("a", "2024-03-01", "2024-04-01")];
    const copy = structuredClone(a);
    run(a);
    expect(a).toEqual(copy);
  });
});

describe("malformed and open-ended instructions remain fail-closed", () => {
  it("returns a validation error for a null record instead of throwing", () => {
    expect(run([null] as unknown as ReviewedInstruction[]).status).toBe("invalid");
  });
  it("does not call a post-expiry open pause an active protection", () => {
    const result = run([pause("late", "2025-01-02", "")]);
    expect(result.status).toBe("needs_review");
    expect(result.date).toBeNull();
  });
  it("admits an open pause only after earlier excluded days are considered", () => {
    const result = run([
      pause("first", "2024-03-01", "2024-04-01"),
      pause("open", "2025-01-20", ""),
    ]);
    expect(result.status).toBe("open_ended");
    expect(result.excludedDays).toBe(31);
  });
  it("does not silently present an express date before this claim arose", () => {
    const result = run([
      { id: "fixed", kind: "fixed_deadline", date: "2023-01-01", ...verification },
    ]);
    expect(result.date).toBeNull();
    expect(result.status).toBe("needs_review");
  });
});

describe("explicit limits on a reviewed suspension", () => {
  it("applies a stated calendar-month cap before merging excluded intervals", () => {
    const capped = {
      ...pause("cap", "2024-03-01", "2024-07-01"),
      maximumExclusion: { amount: 2, unit: "calendar_months" },
    } as ReviewedInstruction;
    const result = run([capped]);
    expect(result.excludedDays).toBe(61);
    expect(result.date).toBe("2025-03-03");
    expect(result.steps.some((s) => /cap|maximum/i.test(s.text))).toBe(true);
  });
  it("does not let an overlapping suspension erase another suspension's individual cap", () => {
    const result = run([
      {
        ...pause("a", "2024-03-01", "2024-07-01"),
        maximumExclusion: { amount: 1, unit: "calendar_months" },
      },
      {
        ...pause("b", "2024-03-15", "2024-05-01"),
        maximumExclusion: { amount: 1, unit: "calendar_months" },
      },
    ] as ReviewedInstruction[]);
    expect(result.excludedDays).toBe(45);
    expect(result.date).toBe("2025-02-15");
  });
  it("measures the explicit cap from the supplied protection start, not an invented later start", () => {
    const result = run([
      {
        ...pause("a", "2023-12-01", "2024-06-01"),
        maximumExclusion: { amount: 1, unit: "calendar_months" },
      } as ReviewedInstruction,
    ]);
    expect(result.excludedDays).toBe(0);
    expect(result.date).toBe("2025-01-01");
  });
  it("withholds a missing cap anniversary instead of substituting a date", () => {
    const result = run([
      {
        ...pause("a", "2024-02-29", "2025-06-01"),
        maximumExclusion: { amount: 1, unit: "calendar_years" },
      } as ReviewedInstruction,
    ]);
    expect(result.status).toBe("needs_review");
    expect(result.date).toBeNull();
  });
  it("rejects a malformed optional cap rather than silently ignoring it", () => {
    const result = run([
      {
        ...pause("a", "2024-03-01", "2024-05-01"),
        maximumExclusion: { amount: -1, unit: "business_days" },
      } as unknown as ReviewedInstruction,
    ]);
    expect(result.status).toBe("invalid");
  });
  it("does not assume an ongoing pause has used its full maximum", () => {
    const result = run([
      {
        ...pause("a", "2024-03-01", ""),
        maximumExclusion: { amount: 2, unit: "calendar_months" },
      } as ReviewedInstruction,
    ]);
    expect(result.status).toBe("open_ended");
    expect(result.date).toBeNull();
  });
});
