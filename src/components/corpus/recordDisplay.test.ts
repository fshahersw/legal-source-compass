import { describe, expect, it } from "vitest";
import { isSourceIdKey, splitProvenanceLabel, subtitleWithoutIds } from "./recordDisplay";

describe("record display rules", () => {
  it("treats source identifiers and provider flags as technical keys", () => {
    expect(isSourceIdKey("Record id")).toBe(true);
    expect(isSourceIdKey("CourtListener court id")).toBe(true);
    expect(isSourceIdKey("In use (CourtListener flag)")).toBe(true);
    expect(isSourceIdKey("Short name")).toBe(false);
    expect(isSourceIdKey("Court type")).toBe(false);
    expect(isSourceIdKey("Paid")).toBe(false);
  });

  it("drops only the identifier segment of the header line", () => {
    expect(subtitleWithoutIds("Federal district · S.D.N.Y. · CourtListener id nysd")).toBe(
      "Federal district · S.D.N.Y.",
    );
    expect(subtitleWithoutIds("Federal district · S.D.N.Y.")).toBe("Federal district · S.D.N.Y.");
    expect(subtitleWithoutIds("CourtListener id nysd")).toBeNull();
    expect(subtitleWithoutIds(null)).toBeNull();
  });

  it("moves a provenance note out of a link label, keeping other parentheses", () => {
    expect(
      splitProvenanceLabel("Court website (url as recorded by CourtListener, not re-checked)"),
    ).toEqual({ text: "Court website", note: "url as recorded by CourtListener, not re-checked" });
    expect(splitProvenanceLabel("Court homepage (local registry FD:nysd, not re-checked)")).toEqual(
      {
        text: "Court homepage",
        note: "local registry FD:nysd, not re-checked",
      },
    );
    expect(
      splitProvenanceLabel("MDLs in this court (14 pending, JPML report dated 2026-10-01)"),
    ).toEqual({
      text: "MDLs in this court (14 pending, JPML report dated 2026-10-01)",
      note: null,
    });
  });
});
