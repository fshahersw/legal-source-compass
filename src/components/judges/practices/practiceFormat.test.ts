import { describe, expect, it } from "vitest";
import { isListingHeading, titleLine } from "./practiceFormat";

describe("title words and where they were read", () => {
  it("tells a list heading from words said of the judge", () => {
    expect(isListingHeading("listing heading")).toBe(true);
    expect(isListingHeading("listing page heading")).toBe(true);
    expect(isListingHeading("judge page heading")).toBe(false);
    expect(isListingHeading("listing link text")).toBe(false);
    expect(isListingHeading(null)).toBe(false);
  });

  it("does not present a list heading as the judge's own title", () => {
    expect(titleLine("United States District Judges", "listing heading")).toBe(
      "Listed under “United States District Judges”",
    );
    expect(titleLine("Chief Magistrate Judge", "listing link text")).toBe("Chief Magistrate Judge");
    expect(titleLine(null, null)).toBe("Title not stated on the page");
  });
});
