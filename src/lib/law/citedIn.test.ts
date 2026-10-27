import { describe, expect, it } from "vitest";
import { citationYears, citingListLabel } from "./citedIn";

describe("citationYears", () => {
  it("fills the years between citing years with zero and drops malformed pairs", () => {
    expect(
      citationYears([
        [2019, 3],
        [2022, 1],
        [0, 5],
        [2021, Number.NaN],
      ]),
    ).toEqual([
      { year: "2019", filings: 3 },
      { year: "2020", filings: 0 },
      { year: "2021", filings: 0 },
      { year: "2022", filings: 1 },
    ]);
    expect(citationYears([])).toEqual([]);
  });
});

describe("citingListLabel", () => {
  it("says when the list is a newest-first slice of the total", () => {
    expect(citingListLabel(10, 54, false)).toBe("The newest 10 of 54 citing filings.");
    expect(citingListLabel(10, 54, true)).toBe(
      "The newest 10 of 54 citing filings; loading the rest.",
    );
    expect(citingListLabel(54, 54, false)).toBe("All 54 citing filings, newest first.");
  });
});
