import { describe, expect, it } from "vitest";
import type { CourtRow } from "@/lib/external/directoryTree";
import { appellateCourts, courtCounts, filingsChange, uniqueCircuits } from "./stateOverviewView";

const court = (id: string, title: string, system: string, type: string): CourtRow => ({
  id,
  title,
  system,
  type,
  state: "CA",
});

describe("filingsChange", () => {
  it("is the percent change between two published counts", () => {
    expect(filingsChange({ value: 312, previous: 300 })).toBe("+4.0%");
    expect(filingsChange({ value: 270, previous: 300 })).toBe("−10.0%");
    expect(filingsChange({ value: 300, previous: 300 })).toBe("0.0%");
  });
  it("is null without an earlier count", () => {
    expect(filingsChange({ value: 5, previous: null })).toBeNull();
    expect(filingsChange({ value: 5, previous: 0 })).toBeNull();
  });
});

describe("uniqueCircuits", () => {
  it("keeps first-seen order and skips districts with no circuit", () => {
    expect(
      uniqueCircuits([
        { circuit: "Ninth Circuit" },
        { circuit: null },
        { circuit: "Ninth Circuit" },
        { circuit: "Tenth Circuit" },
      ]),
    ).toEqual(["Ninth Circuit", "Tenth Circuit"]);
  });
});

describe("court groupings", () => {
  const courts = [
    court("cal", "California Supreme Court", "State", "State supreme"),
    court("calctapp", "California Court of Appeal", "State", "State appellate"),
    court("cacd", "District Court, C.D. California", "Federal", "Federal district"),
    court("ca9", "Court of Appeals for the Ninth Circuit", "Federal", "Federal appellate"),
    court("reg-ST-ca_state", "California Courts", "State", "State judiciary system"),
    court("calsuperior", "Superior Court of Los Angeles", "State", "State trial"),
  ];
  it("counts judicial courts only, by system", () => {
    expect(courtCounts(courts)).toEqual({ total: 5, federal: 2, state: 3, other: 0 });
  });
  it("lists the state's supreme court first, then its appellate courts, and never federal courts", () => {
    expect(appellateCourts(courts).map((c) => c.id)).toEqual(["cal", "calctapp"]);
  });
});
