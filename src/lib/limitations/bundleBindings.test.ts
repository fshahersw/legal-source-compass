import { describe, expect, it } from "vitest";
import { assertBundleBindings } from "./bundleBindings";
import type { CoverageRow, LimitationRule, LimitationSource, ClaimCoverage } from "./types";

const source = (id = "source", state = "IL") => ({ id, state }) as LimitationSource;
const rule = (extra: Partial<LimitationRule> = {}) =>
  ({
    id: "rule",
    jurisdiction: "IL",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    sourceIds: ["source"],
    period: { amount: 2, unit: "calendar_years" },
    ...extra,
  }) as LimitationRule;
const cell = (extra: Partial<ClaimCoverage> = {}) =>
  ({ claimType: "personal_injury", status: "baseline", ruleId: "rule", ...extra }) as ClaimCoverage;
const coverage = (c = cell()) => [{ state: "IL", claimCoverage: [c] }] as CoverageRow[];

describe("rule, authority, and general-claim identity binding", () => {
  it("accepts the exact same-state general rule", () =>
    expect(() => assertBundleBindings([rule()], [source()], coverage())).not.toThrow());
  it("rejects wrong-state authorities", () =>
    expect(() => assertBundleBindings([rule()], [source("source", "NY")], coverage())).toThrow(
      /jurisdiction/,
    ));
  it("rejects wrong-state general rules", () =>
    expect(() =>
      assertBundleBindings([rule({ jurisdiction: "NY" })], [source("source", "NY")], coverage()),
    ).toThrow(/jurisdiction/));
  it("rejects wrong-claim general rules", () =>
    expect(() =>
      assertBundleBindings([rule({ claimType: "fraud" })], [source()], coverage()),
    ).toThrow(/claim/));
  it("cannot use a narrow variant as the general rule", () =>
    expect(() =>
      assertBundleBindings([rule({ subtype: "minor" })], [source()], coverage()),
    ).toThrow(/general/));
  it("rejects changed computation status", () =>
    expect(() =>
      assertBundleBindings([rule({ computation: "research_only" })], [source()], coverage()),
    ).toThrow(/status/));
  it("rejects missing rule IDs and not-recorded cells that still bind a rule", () => {
    expect(() => assertBundleBindings([], [], coverage())).toThrow(/missing/);
    expect(() =>
      assertBundleBindings(
        [rule()],
        [source()],
        coverage(cell({ status: "not_recorded", reason: "not reviewed" })),
      ),
    ).toThrow(/not_recorded/);
  });
  it("keeps historical variants with the same subtype but different rule IDs", () => {
    const rules = [
      rule(),
      rule({
        id: "v1",
        subtype: "special",
        effectiveFrom: "2000-01-01",
        effectiveThrough: "2019-12-31",
      }),
      rule({ id: "v2", subtype: "special", effectiveFrom: "2020-01-01" }),
    ];
    const row = cell({
      variants: [
        { subtype: "special", ruleId: "v1", status: "baseline" },
        { subtype: "special", ruleId: "v2", status: "baseline" },
      ],
    });
    expect(() => assertBundleBindings(rules, [source()], coverage(row))).not.toThrow();
  });
  it("rejects the wrong variant subtype and duplicate rule IDs", () => {
    const r = rule({ id: "v", subtype: "special" });
    expect(() =>
      assertBundleBindings(
        [rule(), r],
        [source()],
        coverage(cell({ variants: [{ subtype: "different", ruleId: "v", status: "baseline" }] })),
      ),
    ).toThrow(/subtype/);
    expect(() =>
      assertBundleBindings(
        [rule(), r],
        [source()],
        coverage(
          cell({
            variants: [
              { subtype: "special", ruleId: "v", status: "baseline" },
              { subtype: "special", ruleId: "v", status: "baseline" },
            ],
          }),
        ),
      ),
    ).toThrow(/duplicate/);
  });
  it("rejects counting authorities from another jurisdiction", () => {
    const rows = [{ state: "IL", timeComputation: { sourceId: "ny" } }] as CoverageRow[];
    expect(() => assertBundleBindings([], [source("ny", "NY")], rows)).toThrow(/jurisdiction/);
  });
});
