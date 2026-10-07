import { describe, expect, it } from "vitest";
import type { MatrixEntryInput } from "./entries";
import type { RuleProvenance } from "../types";
import { buildEntryRuleConditions } from "./ruleConditions";

const baseProvenance = (): RuleProvenance => ({
  citation: "Minn. Stat. § 541.05 subd. 1(5)",
  excerpt: "six years",
  periodEvidence: "six years",
  accrualKind: "not_recorded",
  accrualText: "Not recorded",
  tolling: [],
  repose: [],
  lastAmended: { text: "Not recorded", date: null },
  effectiveDate: null,
  retrievedAt: "2026-10-06T00:00:00.000Z",
  entryStatus: "verified",
  confidence: "high",
  confidenceNote: "",
  flags: [],
  crossCheckSourceIds: ["bf-mn-541-073"],
});

const baseEntry = (crossNote: string): MatrixEntryInput => ({
  claimType: "personal_injury",
  status: "verified",
  period: { amount: 6, unit: "years" },
  periodEvidence: "six years",
  citation: "Minn. Stat. § 541.05 subd. 1(5)",
  excerpt: "six years",
  captureId: "mn-541-05",
  accrual: { kind: "not_recorded", text: "Not recorded", evidence: "Not recorded" },
  tolling: [],
  repose: [],
  lastAmended: { text: "Not recorded", date: null, evidence: "Not recorded" },
  effectiveDate: null,
  crossChecks: [{ captureId: "mn-541-073", note: crossNote }],
  confidence: "high",
  confidenceNote: "",
  flags: [],
});

describe("buildEntryRuleConditions", () => {
  it("reflects updated cross-check gloss (stale conditions are not preserved when period unchanged)", () => {
    const oldGloss =
      "Minn. Stat. § 541.073: six years from when the plaintiff knew or had reason to know of the injury.";
    const newGloss =
      "Minn. Stat. § 541.073 (2025 capture): for personal injury caused by sexual abuse, an action by a person " +
      "18 years of age or older must be commenced within six years of the abuse; there is no time limitation " +
      "for a person under 18. This is not the general negligence period under § 541.05 subd. 1(5).";

    const stale = buildEntryRuleConditions(
      baseEntry(oldGloss),
      baseProvenance(),
      true,
      [],
      false,
    );
    const fresh = buildEntryRuleConditions(
      baseEntry(newGloss),
      baseProvenance(),
      true,
      [],
      false,
    );

    const staleLine = stale.find((c) => c.includes("mn-541-073"))!;
    const freshLine = fresh.find((c) => c.includes("mn-541-073"))!;

    expect(staleLine).toContain("knew or had reason to know");
    expect(freshLine).toContain("sexual abuse");
    expect(freshLine).not.toContain("knew or had reason to know");
  });
});
