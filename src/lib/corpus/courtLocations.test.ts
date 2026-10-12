import { describe, expect, it } from "vitest";
import {
  deriveCourtLocationInsights,
  exactCourtLocations,
  recordedStateCode,
} from "./courtLocations";
import type { Insights } from "./insights";
import { statesOfSource } from "./join";
import type { Source } from "@/lib/atlas/types";

describe("exact court-location tagging", () => {
  it("rejects captions, inferred native IDs and ambiguous/unknown directory locations", () => {
    const mapping = exactCourtLocations([
      { id: "njd", state: "New Jersey" },
      { id: "conflict", state: "NJ" },
      { id: "conflict", state: "NY" },
      { id: "unknown", state: "NJ" },
      { id: "unknown", state: "" },
      { id: "jpml", state: "" },
    ]);
    expect([...mapping]).toEqual([["njd", "NJ"]]);
    expect(mapping.get("D. New Jersey")).toBeUndefined();
    expect(recordedStateCode("New Jersey talc litigation")).toBeNull();
    expect(recordedStateCode("JP")).toBeNull();
  });

  it("retains the source state literal and flags a conflict while using the exact court location", () => {
    const original = {
      qualification: "fixture",
      matters: [{ court: "njd", state: "NY" }],
      masters: [],
    } as unknown as Insights;
    const result = deriveCourtLocationInsights(original, [{ id: "njd", state: "NJ" }]);
    expect(result.matters[0]).toMatchObject({
      state: "NJ",
      recorded_state: "NY",
      state_conflict: true,
      state_basis: "exact_court_location",
    });
    expect(original.matters[0]!.state).toBe("NY");
    expect(deriveCourtLocationInsights(result, [{ id: "njd", state: "NJ" }])).toEqual(result);
  });

  it("accepts explicit source USPS jurisdictions without assigning blank or federal sources to a state", () => {
    const source = {
      jurisdiction_values: [" NJ ", "New Jersey", "US", "", "D. New Jersey"],
    } as unknown as Source;
    expect(statesOfSource(source)).toEqual({
      usps: ["NJ"],
      unmatched: ["US", "", "D. New Jersey"],
    });
  });
});
