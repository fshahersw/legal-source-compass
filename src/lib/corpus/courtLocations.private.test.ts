import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCourtLocationInsights } from "./courtLocations";
import { mattersForState, parseInsights } from "./insights";
import { joinByState } from "./join";

describe("protected court-location snapshot", () => {
  it("maps all 518 actual njd rows without adding cases or inventing a talc association", () => {
    const original = parseInsights(
      JSON.parse(readFileSync("private/data/corpus/insights.json", "utf8")),
    );
    const courts = JSON.parse(readFileSync("private/data/research/court-crosswalk.json", "utf8"));
    const frozen = JSON.stringify(original);
    const derived = deriveCourtLocationInsights(original, courts.records);
    expect(original.matters).toHaveLength(2122);
    expect(mattersForState(original, "NJ")).toHaveLength(0);
    expect(mattersForState(derived, "NJ")).toHaveLength(518);
    expect(derived.matters.filter((row) => row.state_basis === "unresolved")).toHaveLength(99);
    expect(
      derived.matters.filter(
        (row) => row.recorded_state === "" && row.state_basis === "exact_court_location",
      ),
    ).toHaveLength(869);
    expect(derived.matters.filter((row) => row.state_conflict)).toHaveLength(0);
    expect(derived.matters).toHaveLength(original.matters.length);
    expect(
      derived.matters.filter((row) => row.mdl === "2738" || /talc/i.test(row.mdl_name)),
    ).toHaveLength(0);
    expect(joinByState([], derived).byState.get("NJ")!.matters).toBe(518);
    expect(joinByState([], derived).mattersWithoutState).toBe(99);
    expect(JSON.stringify(original)).toBe(frozen);
  });
});
