import { describe, expect, it } from "vitest";
import { normalizeCaseloadSearch, patchSearch, tabSearch } from "./caseloadSearch";

describe("normalizeCaseloadSearch", () => {
  it("keeps the default tab out of the address and reads the district parameters", () => {
    expect(normalizeCaseloadSearch({})).toEqual({});
    expect(
      normalizeCaseloadSearch({
        court: "cand",
        circuit: "ca9",
        state: "CA",
        q: " northern ",
        sort: "-medianDays",
      }),
    ).toEqual({ court: "cand", circuit: "ca9", state: "CA", q: "northern", sort: "-medianDays" });
    expect(normalizeCaseloadSearch({ tab: "districts", court: "cand" })).toEqual({ court: "cand" });
  });

  it("drops values that are not what the page can use rather than guessing", () => {
    expect(
      normalizeCaseloadSearch({
        court: "CAND",
        circuit: "ninth",
        state: "California",
        sort: "--x",
        q: "x".repeat(200),
      }),
    ).toEqual({});
    expect(normalizeCaseloadSearch({ tab: "everything" })).toEqual({});
    expect(normalizeCaseloadSearch({ court: 5, q: ["a"] })).toEqual({});
  });

  it("keeps each tab's own parameters and removes the other tabs'", () => {
    expect(
      normalizeCaseloadSearch({
        tab: "nos",
        court: "cand",
        nos: "nos:365",
        kind: "nos",
        group: "product",
        active: "yes",
      }),
    ).toEqual({
      tab: "nos",
      nos: "nos:365",
      kind: "nos",
      group: "product",
      active: "yes",
    });
    expect(
      normalizeCaseloadSearch({
        tab: "mdl",
        nos: "nos:365",
        mdl: "1358",
        jpml: "yes",
        pending: "yes",
      }),
    ).toEqual({
      tab: "mdl",
      mdl: 1358,
      jpml: "yes",
      pending: "yes",
    });
    expect(normalizeCaseloadSearch({ tab: "method", court: "cand", q: "x", mdl: "5" })).toEqual({
      tab: "method",
    });
  });

  it("keeps an MDL number as a number, from a number or digits, and nothing else", () => {
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: 1358 })).toEqual({ tab: "mdl", mdl: 1358 });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: "1358" })).toEqual({ tab: "mdl", mdl: 1358 });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: 13.5 })).toEqual({ tab: "mdl" });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: "0" })).toEqual({ tab: "mdl", mdl: 0 });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: "12a" })).toEqual({ tab: "mdl" });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: "123456" })).toEqual({ tab: "mdl" });
    expect(normalizeCaseloadSearch({ tab: "mdl", mdl: -1 })).toEqual({ tab: "mdl" });
  });

  it("accepts only the nature-of-suit record ids the data uses", () => {
    expect(
      normalizeCaseloadSearch({ tab: "nos", nos: "group:securities_antitrust_banking" }),
    ).toEqual({
      tab: "nos",
      nos: "group:securities_antitrust_banking",
    });
    expect(normalizeCaseloadSearch({ tab: "nos", nos: "nos:36" })).toEqual({ tab: "nos" });
    expect(normalizeCaseloadSearch({ tab: "nos", nos: "365" })).toEqual({ tab: "nos" });
    expect(normalizeCaseloadSearch({ tab: "nos", kind: "all", active: "no" })).toEqual({
      tab: "nos",
    });
  });
});

describe("patchSearch and tabSearch", () => {
  it("applies a change and removes a key set to undefined", () => {
    const cur = { court: "cand", q: "cal" };
    expect(patchSearch(cur, { circuit: "ca9" })).toEqual({
      court: "cand",
      q: "cal",
      circuit: "ca9",
    });
    expect(patchSearch(cur, { q: undefined })).toEqual({ court: "cand" });
    expect(patchSearch(cur, { court: undefined, q: undefined })).toEqual({});
  });

  it("keeps the tab when patching and clears the old tab's parameters when the tab changes", () => {
    expect(patchSearch({ tab: "mdl", mdl: 1358 }, { jpml: "yes" })).toEqual({
      tab: "mdl",
      mdl: 1358,
      jpml: "yes",
    });
    expect(patchSearch({ tab: "mdl", mdl: 1358 }, { tab: "nos" })).toEqual({ tab: "nos" });
  });

  it("opens a tab with only its own parameters", () => {
    expect(tabSearch("nos")).toEqual({ tab: "nos" });
    expect(tabSearch("districts")).toEqual({});
    expect(tabSearch("districts", { court: "njd" })).toEqual({ court: "njd" });
    expect(tabSearch("mdl", { court: "njd", mdl: 875 })).toEqual({ tab: "mdl", mdl: 875 });
    expect(normalizeCaseloadSearch({ q: 365 })).toEqual({ q: "365" });
  });
});

describe("published tables and bankruptcy tabs", () => {
  it("keeps a series, its period choice, row, column and up to five compared courts", () => {
    expect(
      normalizeCaseloadSearch({
        tab: "tables",
        series: "f-2-three-months",
        pub: "BF",
        col: "predominant_nature_of_debt/business_filings/total",
        court: "ca9",
        cmp: "nysd,cacd,nysd,BAD,txsd,flsd,ilnd,mad",
        q: "bankruptcy",
        fpub: "BF",
        fscope: "bankruptcy",
        mdl: 2738,
      }),
    ).toEqual({
      tab: "tables",
      series: "f-2-three-months",
      pub: "BF",
      col: "predominant_nature_of_debt/business_filings/total",
      court: "ca9",
      cmp: "nysd,cacd,txsd,flsd,ilnd",
      q: "bankruptcy",
      fpub: "BF",
      fscope: "bankruptcy",
    });
  });

  it("drops malformed series keys, period choices, scopes and measures", () => {
    expect(
      normalizeCaseloadSearch({
        tab: "tables",
        series: "F 2",
        pub: "jb",
        fscope: "everywhere",
        col: "A B",
      }),
    ).toEqual({ tab: "tables" });
    expect(
      normalizeCaseloadSearch({ tab: "bankruptcy", measure: "ch7", court: "azd", series: "c" }),
    ).toEqual({ tab: "bankruptcy", measure: "ch7", court: "azd" });
    expect(normalizeCaseloadSearch({ tab: "bankruptcy", measure: "everything" })).toEqual({
      tab: "bankruptcy",
    });
  });

  it("does not carry the published-table parameters into another tab", () => {
    expect(patchSearch({ tab: "tables", series: "c", pub: "JB" }, { tab: "districts" })).toEqual(
      {},
    );
    expect(tabSearch("bankruptcy")).toEqual({ tab: "bankruptcy" });
  });
});
