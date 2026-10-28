import { describe, expect, it } from "vitest";
import {
  isSourceIdKey,
  isStorageMetaKey,
  splitProvenanceLabel,
  splitProviderKey,
  splitProviderValue,
  subtitleWithoutIds,
} from "./recordDisplay";

describe("record display rules", () => {
  it("treats source identifiers and provider flags as technical keys", () => {
    expect(isSourceIdKey("Record id")).toBe(true);
    expect(isSourceIdKey("CourtListener court id")).toBe(true);
    expect(isSourceIdKey("In use (CourtListener flag)")).toBe(true);
    expect(isSourceIdKey("FJC court id (as recorded by CourtListener)")).toBe(true);
    expect(isSourceIdKey("Local registry key")).toBe(true);
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

  it("moves a provider name out of a field name and a provenance explanation out of a value", () => {
    expect(splitProviderKey("Parent court (CourtListener)")).toEqual({
      text: "Parent court",
      note: "CourtListener",
    });
    expect(splitProviderKey("Court type (FD)")).toEqual({ text: "Court type (FD)", note: null });
    expect(splitProviderValue("NY — state name printed in the CourtListener court name")).toEqual({
      text: "NY",
      note: "state name printed in the CourtListener court name",
    });
    expect(splitProviderValue("Senior status — took senior status in 2019")).toEqual({
      text: "Senior status — took senior status in 2019",
      note: null,
    });
  });

  it("treats counts of the corpus's own stored files as technical", () => {
    expect(isStorageMetaKey("Saved raster identity marks")).toBe(true);
    expect(isStorageMetaKey("Stored PDF files")).toBe(true);
    expect(isStorageMetaKey("Pending MDLs (JPML report)")).toBe(false);
    expect(isStorageMetaKey("Images of the product")).toBe(false);
  });
});
