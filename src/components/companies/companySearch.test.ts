import { describe, expect, it } from "vitest";
import { normalizeCompanySearch, tabOf } from "./companySearch";

describe("normalizeCompanySearch", () => {
  it("keeps known tabs and drops the default", () => {
    expect(normalizeCompanySearch({ tab: "statements" })).toEqual({ tab: "statements" });
    expect(normalizeCompanySearch({ tab: "overview" })).toEqual({});
    expect(normalizeCompanySearch({ tab: "prices" })).toEqual({});
  });
  it("keeps the grain only on statements and segments", () => {
    expect(normalizeCompanySearch({ tab: "segments", grain: "quarterly" })).toEqual({
      tab: "segments",
      grain: "quarterly",
    });
    expect(normalizeCompanySearch({ tab: "filings", grain: "quarterly" })).toEqual({
      tab: "filings",
    });
    expect(normalizeCompanySearch({ tab: "statements", grain: "annual" })).toEqual({
      tab: "statements",
    });
  });
  it("keeps a well-formed document id only on the documents tab", () => {
    const doc = "0000001800:0001628280-26-048377:EX99.1:e77803";
    expect(normalizeCompanySearch({ tab: "documents", doc })).toEqual({ tab: "documents", doc });
    expect(normalizeCompanySearch({ tab: "documents", doc: "../etc" })).toEqual({
      tab: "documents",
    });
    expect(normalizeCompanySearch({ doc })).toEqual({});
  });
  it("reads the tab with its default", () => {
    expect(tabOf({})).toBe("overview");
    expect(tabOf({ tab: "litigation" })).toBe("litigation");
  });
});
