import { describe, expect, it } from "vitest";
import { isStoredFilePath, isStoredMarkLabel, plainMediaLabel } from "./heldMedia";

describe("stored media labels", () => {
  it("recognises stored identity-mark labels, with or without the earlier permission note", () => {
    expect(isStoredMarkLabel("Identity mark image")).toBe(true);
    expect(isStoredMarkLabel("Identity mark image (reuse permission not established)")).toBe(true);
    expect(isStoredMarkLabel("Identity marks (Reuse Permission Not Established)")).toBe(true);
    expect(isStoredMarkLabel("Official seal")).toBe(false);
    expect(isStoredMarkLabel("Page where it was observed")).toBe(false);
  });

  it("prints a label without the earlier permission annotation and leaves other labels alone", () => {
    expect(plainMediaLabel("Identity mark image (reuse permission not established)")).toBe(
      "Identity mark image",
    );
    expect(plainMediaLabel("Identity marks (Reuse Permission Not Established)")).toBe(
      "Identity marks",
    );
    expect(plainMediaLabel("Identity mark image (permission is not established)")).toBe(
      "Identity mark image",
    );
    expect(plainMediaLabel("Court seal (published by the court)")).toBe(
      "Court seal (published by the court)",
    );
  });

  it("treats only root-relative paths as stored files", () => {
    expect(isStoredFilePath("/supplement-files/court_spine/logo_0285f97dee8bc066")).toBe(true);
    expect(isStoredFilePath("https://www.ilnd.uscourts.gov/")).toBe(false);
    expect(isStoredFilePath("//third-party.test/logo.png")).toBe(false);
  });
});
