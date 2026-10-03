import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCourtLocationInsights, exactCourtLocations, recordedStateCode } from "./courtLocations";
import { mattersForState, parseInsights, type Insights } from "./insights";
import { joinByState, statesOfSource } from "./join";
import type { Source } from "@/lib/atlas/types";

describe("exact court-location tagging", () => {
  it("rejects captions, inferred native IDs and ambiguous/unknown directory locations", () => {
    const mapping = exactCourtLocations([
      { id: "njd", state: "New Jersey" },
      { id: "conflict", state: "NJ" }, { id: "conflict", state: "NY" },
      { id: "unknown", state: "NJ" }, { id: "unknown", state: "" },
      { id: "jpml", state: "" },
    ]);
    expect([...mapping]).toEqual([["njd", "NJ"]]);
    expect(mapping.get("D. New Jersey")).toBeUndefined();
    expect(recordedStateCode("New Jersey talc litigation")).toBeNull();
    expect(recordedStateCode("JP")).toBeNull();
  });

  it("retains the source state literal and flags a conflict while using the exact court location", () => {
    const original = { qualification: "fixture", matters: [{ court: "njd", state: "NY" }], masters: [] } as unknown as Insights;
    const result = deriveCourtLocationInsights(original, [{ id: "njd", state: "NJ" }]);
    expect(result.matters[0]).toMatchObject({ state: "NJ", recorded_state: "NY", state_conflict: true, state_basis: "exact_court_location" });
    expect(original.matters[0]!.state).toBe("NY");
    expect(deriveCourtLocationInsights(result, [{ id: "njd", state: "NJ" }])).toEqual(result);
  });

  it("maps all 518 actual njd rows without adding cases or inventing a talc association", () => {
    const original = parseInsights(JSON.parse(readFileSync("private/data/corpus/insights.json", "utf8")));
    const courts = JSON.parse(readFileSync("private/data/research/court-crosswalk.json", "utf8"));
    const frozen = JSON.stringify(original);
    const derived = deriveCourtLocationInsights(original, courts.records);
    expect(original.matters).toHaveLength(2122);
    expect(mattersForState(original, "NJ")).toHaveLength(0);
    expect(mattersForState(derived, "NJ")).toHaveLength(518);
    expect(derived.matters.filter((row) => row.state_basis === "unresolved")).toHaveLength(99);
    expect(derived.matters.filter((row) => row.recorded_state === "" && row.state_basis === "exact_court_location")).toHaveLength(869);
    expect(derived.matters.filter((row) => row.state_conflict)).toHaveLength(0);
    expect(derived.matters).toHaveLength(original.matters.length);
    expect(derived.matters.filter((row) => row.mdl === "2738" || /talc/i.test(row.mdl_name))).toHaveLength(0);
    expect(joinByState([], derived).byState.get("NJ")!.matters).toBe(518);
    expect(joinByState([], derived).mattersWithoutState).toBe(99);
    expect(JSON.stringify(original)).toBe(frozen);
  });

  it("accepts explicit source USPS jurisdictions without assigning blank or federal sources to a state", () => {
    const source = { jurisdiction_values: [" NJ ", "New Jersey", "US", "", "D. New Jersey"] } as unknown as Source;
    expect(statesOfSource(source)).toEqual({ usps: ["NJ"], unmatched: ["US", "", "D. New Jersey"] });
  });
});
