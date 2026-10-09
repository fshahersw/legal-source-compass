import { describe, expect, it } from "vitest";
import { applyReviewedInstructions, type ReviewedInstruction } from "./reviewedArithmetic";

// Independent day-by-day oracle. These are synthetic civil-date instructions, not law.
const date = (offset: number) => new Date(Date.UTC(2024, 0, 1 + offset)).toISOString().slice(0, 10);
const evidence = { authority: "Synthetic property test", explanation: "Explicit arithmetic assumptions for a synthetic test, not statutory interpretation.", reviewer: "Property test", legalEffectConfirmed: true, boundariesConfirmed: true, interactionsConfirmed: true };

describe("suspension arithmetic against an independent civil-day oracle", () => {
  it("checks 1000 seeded cases with overlaps, cap boundaries and post-expiry intervals", () => {
    let seed = 20261009;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let example = 0; example < 1000; example++) {
      const intervals = Array.from({ length: 1 + random(5) }, (_, i) => {
        const start = random(70) - 10, end = start + 1 + random(25), cap = random(3) === 0 ? 1 + random(15) : undefined;
        return { start, end, cap, id: `trial-${example}-${i}` };
      });
      const excluded = new Set<number>();
      for (const interval of intervals) {
        const end = Math.min(interval.end, interval.cap === undefined ? interval.end : interval.start + interval.cap);
        for (let day = Math.max(0, interval.start); day < end; day++) excluded.add(day);
      }
      let deadline = 30, excludedDays = 0;
      for (let cursor = 0; cursor <= deadline; cursor++) {
        if (excluded.has(cursor)) { deadline++; excludedDays++; }
      }
      const postExpiry = intervals.some(interval => Math.max(0, interval.start) > deadline);
      const instructions: ReviewedInstruction[] = intervals.map(interval => ({
        ...evidence, id: interval.id, kind: "pause", startDate: date(interval.start), resumeDate: date(interval.end),
        ...(interval.cap === undefined ? {} : { maximumExclusion: { amount: interval.cap, unit: "calendar_days" as const } }),
      }));
      const input = { startDate: date(0), baselineDate: date(30), period: { amount: 30, unit: "calendar_days" as const }, instructions };
      const result = applyReviewedInstructions(input);
      if (postExpiry) {
        expect(result.status, `trial ${example}`).toBe("needs_review");
        expect(result.date).toBeNull();
      } else {
        expect(result.status, `trial ${example}`).toBe("calculated");
        expect(result.date, `trial ${example}`).toBe(date(deadline));
        expect(result.excludedDays, `trial ${example}`).toBe(excludedDays);
      }
      const reversed = applyReviewedInstructions({ ...input, instructions: [...instructions].reverse() });
      expect([reversed.status, reversed.date], `order trial ${example}`).toEqual([result.status, result.date]);
    }
  });
});
