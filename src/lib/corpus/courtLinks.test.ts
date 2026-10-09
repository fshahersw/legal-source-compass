import { describe, expect, it } from "vitest";
import { courtLinkCompatible } from "./courtLinks";
describe("court source namespace collisions", () => {
  it("withholds the Nebraska bankruptcy homepage from the Nebraska Supreme Court record", () =>
    expect(
      courtLinkCompatible(
        {
          label: "Court homepage (local registry FB:neb, not re-checked)",
          url: "https://www.neb.uscourts.gov/",
        },
        "State",
      ),
    ).toBe(false));
  it("retains the recorded Nebraska Supreme Court source", () =>
    expect(
      courtLinkCompatible(
        {
          label: "Court website (url as recorded by CourtListener, not re-checked)",
          url: "https://supremecourt.ne.gov/",
        },
        "State",
      ),
    ).toBe(true));
  it("does not discard valid federal court homepages", () =>
    expect(
      courtLinkCompatible(
        { label: "Court website", url: "https://www.ned.uscourts.gov/" },
        "Federal",
      ),
    ).toBe(true));
  it("does not use unrelated link text to assert that a recorded source is a court homepage", () =>
    expect(
      courtLinkCompatible(
        { label: "Related federal opinion", url: "https://www.ned.uscourts.gov/opinion.pdf" },
        "State",
      ),
    ).toBe(true));
});
