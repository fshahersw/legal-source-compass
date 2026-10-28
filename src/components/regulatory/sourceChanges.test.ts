import { describe, expect, it } from "vitest";
import { commonReason, sourceFamilyOf, trendSummary } from "./sourceChanges";

describe("source changes helpers", () => {
  it("maps every monitored source to its family", () => {
    expect(sourceFamilyOf("federal_register")).toBe("federal_register");
    expect(sourceFamilyOf("nhtsa_recalls")).toBe("nhtsa");
    expect(sourceFamilyOf("cpsc_recalls")).toBe("cpsc");
    expect(sourceFamilyOf("openfda_enforcement_drug")).toBe("fda");
    expect(sourceFamilyOf("fda_warning_letters")).toBe("fda");
  });

  it("splits daily events into first captures, changes and newly observed records", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      events: i === 2 ? 100 : i,
      initialRecords: i === 2 ? 90 : 0,
      changes: i === 9 ? 4 : 0,
    }));
    const summary = trendSummary({ points });
    expect(summary.total).toBe(100 + (0 + 1 + 3 + 4 + 5 + 6 + 7 + 8 + 9));
    expect(summary.initial).toBe(90);
    expect(summary.changes).toBe(4);
    expect(summary.newRecords).toBe(summary.total - 90 - 4);
    expect(summary.last7).toBe(3 + 4 + 5 + 6 + 7 + 8 + 9);
    expect(summary.peak).toEqual({ day: "2026-10-03", events: 100 });
    expect(summary.activeDays).toBe(9);
    // the remainder is never negative even if a source double-labels an event
    expect(
      trendSummary({ points: [{ day: "2026-10-01", events: 1, initialRecords: 1, changes: 1 }] })
        .newRecords,
    ).toBe(0);
  });

  it("prints a reason once only when most rows share it", () => {
    const same = Array.from({ length: 5 }, () => ({ reason: "Record newly observed." }));
    expect(commonReason(same)).toBe("Record newly observed.");
    expect(commonReason([...same.slice(0, 2), { reason: "Changed." }])).toBeNull();
    expect(
      commonReason([...same.slice(0, 3), { reason: "a" }, { reason: "b" }, { reason: "c" }]),
    ).toBe("Record newly observed.");
    expect(commonReason([])).toBeNull();
  });
});
