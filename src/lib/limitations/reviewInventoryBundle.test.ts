import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateLimitationsSnapshot } from "./validation";
import { buildReviewInventory, reviewContextKey, reviewProgress } from "./reviewInventory";
import { unconfirmedClaimInput } from "../../components/limitations/calculatorGuidance";
const root = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const json = (file: string) => JSON.parse(readFileSync(`${root}/${file}.json`, "utf8"));
const snapshot = validateLimitationsSnapshot({
  rules: json("rules"),
  sources: json("sources"),
  coverage: json("coverage"),
  cases: json("case-references"),
});

describe("every recorded rule's review inventory (real immutable release)", () => {
  it("retains every source location, including exact duplicates and all exclusions", () => {
    let checkedOrigins = 0;
    for (const rule of snapshot.rules) {
      const factors = buildReviewInventory(rule),
        origins = factors.flatMap((f) => f.origins);
      expect(new Set(factors.map((f) => f.id)).size, rule.id).toBe(factors.length);
      const locations = [
        ...rule.conditions.map((_, i) => `conditions[${i}]`),
        ...rule.exclusions.map((_, i) => `exclusions[${i}]`),
        ...rule.warnings.map((_, i) => `warnings[${i}]`),
        ...(rule.provenance?.tolling ?? []).map((_, i) => `provenance.tolling[${i}]`),
        ...(rule.provenance?.repose ?? []).map((_, i) => `provenance.repose[${i}]`),
        ...(rule.provenance?.flags ?? []).map((_, i) => `provenance.flags[${i}]`),
      ];
      for (const origin of locations) expect(origins, `${rule.id} / ${origin}`).toContain(origin);
      checkedOrigins += locations.length;
      expect(reviewProgress(factors, {}).resolved).toBe(0);
      expect(reviewProgress(factors, {}).complete).toBe(false);
    }
    expect(checkedOrigins).toBeGreaterThan(snapshot.rules.length);
  });
  it("changes review context when actual sources change for every supported baseline", () => {
    for (const rule of snapshot.rules.filter((r) => r.computation === "baseline_only")) {
      const input = unconfirmedClaimInput(
        rule.jurisdiction,
        rule.claimType,
        rule.subtype ?? "general",
      );
      const before = reviewContextKey(snapshot, rule, input);
      expect(before).not.toBe(
        reviewContextKey(snapshot, rule, { ...input, accrualDate: "2024-01-01" }),
      );
    }
  });
  it("does not put executable legal periods into narrative review factors", () => {
    for (const rule of snapshot.rules) {
      for (const factor of buildReviewInventory(rule)) {
        expect(factor).not.toHaveProperty("amount");
        expect(factor).not.toHaveProperty("automaticallyApplied");
      }
    }
  });
});


it("invalidates reviews when any selected primary authority fingerprint changes", () => {
  for (const rule of snapshot.rules.filter(r => r.computation === "baseline_only")) {
    const input = unconfirmedClaimInput(rule.jurisdiction, rule.claimType, rule.subtype ?? "general");
    const before = reviewContextKey(snapshot, rule, input);
    const id = rule.sourceIds[0]!;
    const changed = { ...snapshot, sources: snapshot.sources.map(source => source.id === id ? { ...source, sha256: source.sha256 === "b".repeat(64) ? "a".repeat(64) : "b".repeat(64) } : source) };
    expect(reviewContextKey(changed, rule, input), rule.id).not.toBe(before);
  }
});

it("records the exact size of the reviewed inventory without claiming exhaustive law", () => {
  const inventories = snapshot.rules.map(buildReviewInventory);
  const notes = inventories.flatMap(factors => factors.filter(f => f.kind !== "screen"));
  const summary = { release: snapshot.ruleVersion, rules: snapshot.rules.length, recordedSourceLocations: notes.reduce((n,f) => n+f.origins.length,0), displayedRecordedFactors: notes.length, recordedTollingFactors: notes.filter(f=>f.kind === "tolling").length, recordedExclusionFactors: notes.filter(f=>f.kind === "exclusion").length, exhaustiveApplicableLaw: false };
  expect(summary.recordedSourceLocations).toBeGreaterThanOrEqual(summary.displayedRecordedFactors);
  console.info("RECORDED_REVIEW_INVENTORY", JSON.stringify(summary));
});
