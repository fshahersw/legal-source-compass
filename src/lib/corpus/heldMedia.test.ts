import { describe, expect, it } from "vitest";
import { isHeldMediaLabel, isStoredFilePath } from "./heldMedia";

describe("held media", () => {
  it("recognises labels that say reuse permission is not established", () => {
    expect(isHeldMediaLabel("Identity mark image (reuse permission not established)")).toBe(true);
    expect(isHeldMediaLabel("Identity marks (Reuse Permission Not Established)")).toBe(true);
    expect(isHeldMediaLabel("Official seal")).toBe(false);
    expect(isHeldMediaLabel("Page where it was observed")).toBe(false);
  });

  it("treats only root-relative paths as stored files", () => {
    expect(isStoredFilePath("/supplement-files/court_spine/logo_0285f97dee8bc066")).toBe(true);
    expect(isStoredFilePath("https://www.ilnd.uscourts.gov/")).toBe(false);
    expect(isStoredFilePath("//third-party.test/logo.png")).toBe(false);
  });
});
