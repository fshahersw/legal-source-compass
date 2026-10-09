import { describe, expect, it } from "vitest";
import { buildReviewInventory, reviewContextKey, reviewProgress } from "./reviewInventory";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";

const note = { text: "A disability at accrual suspends this clock.", citation: "Test Code § 12" };
const rule = (extra: Partial<LimitationRule> = {}) =>
  ({
    id: "fixture-rule",
    jurisdiction: "IL",
    claimType: "personal_injury",
    ruleVersion: "v1",
    sourceIds: ["s1"],
    conditions: [],
    exclusions: [],
    warnings: [],
    provenance: { tolling: [note], repose: [] },
    ...extra,
  }) as LimitationRule;
const input = {
  jurisdiction: "IL",
  claimType: "personal_injury",
  accrualDate: "2024-01-01",
  issues: [],
  governingLawConfirmed: false,
  accrualConfirmed: false,
  applicabilityConfirmed: false,
  exceptionReview: "unresolved",
} as BaselineInput;
const snapshot = (r: LimitationRule) =>
  ({
    ruleVersion: "release-1",
    snapshotDate: "2026-10-08",
    rules: [r],
    sources: [
      {
        id: "s1",
        sha256: "a",
        state: "IL",
        verifiedAt: "2026-10-08",
        currency: { status: "confirmed_unchanged" },
      },
    ],
    cases: [],
    coverage: [],
  }) as unknown as LimitationsSnapshot;

describe("complete recorded-factor inventory", () => {
  it("retains every condition, exclusion, tolling/repose note and warning origin", () => {
    const r = rule({
      conditions: ["Condition A", "Condition B"],
      exclusions: ["Exclusion A"],
      warnings: ["Warning A"],
    });
    r.provenance!.repose = [
      { years: 10, citation: "Test Code § 13", trigger: "act", effectiveFrom: null },
    ];
    const origins = buildReviewInventory(r).flatMap((x) => x.origins);
    for (const key of [
      "conditions[0]",
      "conditions[1]",
      "exclusions[0]",
      "warnings[0]",
      "provenance.tolling[0]",
      "provenance.repose[0]",
    ])
      expect(origins).toContain(key);
  });
  it("deduplicates only exact repeated tolling text while preserving the condition origin", () => {
    const r = rule({
      conditions: [
        `Statutory tolling (not applied by the calculator): ${note.text} (${note.citation}).`,
      ],
    });
    const factors = buildReviewInventory(r).filter((f) =>
      f.origins.includes("provenance.tolling[0]"),
    );
    expect(factors).toHaveLength(1);
    expect(factors[0]!.origins).toContain("conditions[0]");
  });
  it("never merges equal prose citing different provisions", () => {
    const r = rule();
    r.provenance!.tolling.push({ ...note, citation: "Test Code § 14" });
    expect(buildReviewInventory(r).filter((f) => f.kind === "tolling")).toHaveLength(2);
  });
  it("does not interpret a number in prose as an automatically executable period", () => {
    const r = rule();
    r.provenance!.tolling = [
      { text: "May extend by 30 days, unless an exception applies", citation: "Test § 14" },
    ];
    const f = buildReviewInventory(r).find((f) => f.kind === "tolling")!;
    expect(f).not.toHaveProperty("amount");
    expect(f).not.toHaveProperty("automaticallyApplied");
  });
  it("includes screening even where the release has no tolling notes", () => {
    const r = rule();
    delete r.provenance;
    const factors = buildReviewInventory(r);
    expect(factors.filter((f) => f.kind === "screen").length).toBeGreaterThanOrEqual(8);
    expect(factors.some((f) => f.id === "screen:other")).toBe(true);
  });
  it("rejects an unrecognized review status rather than counting it complete", () => {
    const factors = buildReviewInventory(rule());
    const progress = reviewProgress(factors, { [factors[0]!.id]: { status: "invented" } } as never);
    expect(progress.resolved).toBe(0);
    expect(progress.pending).toBe(factors.length);
  });
  it("a factor marked needs review remains blocking", () => {
    const factors = buildReviewInventory(rule());
    const p = reviewProgress(
      factors,
      Object.fromEntries(factors.map((f) => [f.id, { status: "needs_review" }])),
    );
    expect(p.unresolved).toBe(factors.length);
    expect(p.complete).toBe(false);
  });
  it("an applied instruction requires its actual verified-in-case inputs", () => {
    const factors = buildReviewInventory(rule());
    const p = reviewProgress(factors, { [factors[0]!.id]: { status: "instruction" } });
    expect(p.resolved).toBe(0);
    expect(p.complete).toBe(false);
  });
});

describe("review context cannot go stale silently", () => {
  it("changes when any entered date changes", () => {
    const r = rule(),
      s = snapshot(r);
    expect(reviewContextKey(s, r, input)).not.toBe(
      reviewContextKey(s, r, { ...input, deathDate: "2025-01-01" }),
    );
  });
  it("changes for release, source hash, currency or literal legal-note edits", () => {
    const r = rule(),
      s = snapshot(r),
      key = reviewContextKey(s, r, input);
    for (const mutate of [
      (x: LimitationsSnapshot) => {
        x.ruleVersion = "release-2";
      },
      (x: LimitationsSnapshot) => {
        x.sources[0]!.sha256 = "b";
      },
      (x: LimitationsSnapshot) => {
        x.sources[0]!.currency!.status = "evidence_lost";
      },
    ]) {
      const next = structuredClone(s);
      mutate(next);
      expect(reviewContextKey(next, r, input)).not.toBe(key);
    }
    const next = structuredClone(r);
    next.provenance!.tolling[0]!.text += " Changed.";
    expect(reviewContextKey(s, next, input)).not.toBe(key);
  });
  it("is independent of object property insertion order", () => {
    const r = rule(),
      s = snapshot(r);
    expect(reviewContextKey(s, r, input)).toBe(
      reviewContextKey(s, r, Object.fromEntries(Object.entries(input).reverse()) as BaselineInput),
    );
  });
});
