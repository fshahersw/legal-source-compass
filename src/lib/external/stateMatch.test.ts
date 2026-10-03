import { describe, expect, it } from "vitest";
import { stateFilterValue, stateMatchValues, stateQueryValue } from "./stateMatch";

describe("state matching", () => {
  it("matches both stored spellings of the same state", () => {
    expect(stateMatchValues("Indiana")).toEqual(["Indiana", "IN"]);
    expect(stateMatchValues("IN")).toEqual(["Indiana", "IN"]);
    expect(stateMatchValues(" in ")).toEqual(["Indiana", "IN"]);
    expect(stateMatchValues("District of Columbia")).toEqual(["District of Columbia", "DC"]);
    expect(stateMatchValues("New Hampshire")).toEqual(["New Hampshire", "NH"]);
  });

  it("never treats the US country value as a state, and does not guess", () => {
    for (const v of ["US", "us", "USA", "United States", "", "   ", null, undefined])
      expect(stateMatchValues(v)).toBeNull();
    // Not one of the 50 states + DC: matched exactly as given, with no fuzzy expansion.
    expect(stateMatchValues("Puerto Rico")).toEqual(["Puerto Rico"]);
    expect(stateMatchValues("indiana")).toEqual(["indiana"]);
    expect(stateMatchValues("Ind")).toEqual(["Ind"]);
  });

  it("builds a PostgREST value that is safe to append to a query string", () => {
    expect(stateFilterValue(["Indiana", "IN"])).toBe("in.(%22Indiana%22%2C%22IN%22)");
    expect(stateFilterValue(["New Hampshire", "NH"])).toBe("in.(%22New%20Hampshire%22%2C%22NH%22)");
    expect(stateFilterValue(["Guam"])).toBe("eq.Guam");
    expect(stateFilterValue(["a", "a"])).toBe("eq.a");
    // Quotes and commas inside a value cannot break out of the list.
    expect(decodeURIComponent(stateFilterValue(['x"),state=eq.y', "z"]))).toBe(
      'in.("x\\"),state=eq.y","z")',
    );
  });

  it("returns null for a non-state so callers must handle it explicitly", () => {
    expect(stateQueryValue("US")).toBeNull();
    expect(stateQueryValue("Texas")).toBe("in.(%22Texas%22%2C%22TX%22)");
  });
});
