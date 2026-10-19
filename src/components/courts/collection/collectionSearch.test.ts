import { describe, expect, it } from "vitest";
import {
  normalizeCollectionSearch,
  patchSearch,
  selOf,
  tabOf,
  tabSearch,
  viewSearch,
  viewOf,
} from "./collectionSearch";

describe("collection search state", () => {
  it("leaves the default tab and view out of the address", () => {
    expect(normalizeCollectionSearch({})).toEqual({});
    expect(normalizeCollectionSearch({ tab: "dockets", view: "states" })).toEqual({});
    expect(normalizeCollectionSearch({ tab: "citations", view: "map" })).toEqual({
      tab: "citations",
    });
    expect(tabOf({})).toBe("dockets");
  });

  it("drops an unknown tab, view and any value it cannot read", () => {
    expect(normalizeCollectionSearch({ tab: "nope", view: "zzz", q: "" })).toEqual({});
    expect(normalizeCollectionSearch({ tab: "dockets", view: "zzz" })).toEqual({});
    expect(normalizeCollectionSearch({ sort: "-dockets; drop", q: "x".repeat(200) })).toEqual({});
    expect(viewOf("citations", "edges")).toBe("edges");
    expect(viewOf("cited", "edges")).toBeUndefined();
  });

  it("keeps each view's own parameters and none from another view", () => {
    expect(
      normalizeCollectionSearch({
        view: "nos",
        q: "product",
        sort: "-dockets",
        sel: "nos:365",
        group: "product",
        level: "FD",
        span: "all",
        flow: "appeal",
        court: "ca9",
      }),
    ).toEqual({
      view: "nos",
      q: "product",
      sort: "-dockets",
      sel: "nos:365",
      group: "product",
      level: "FD",
      span: "all",
    });
    // The state view has no group filter, and a state code is not a nature-of-suit id.
    expect(normalizeCollectionSearch({ view: "states", group: "product", sel: "nos:365" })).toEqual(
      {},
    );
    expect(normalizeCollectionSearch({ view: "states", sel: "CA", q: "cal" })).toEqual({
      sel: "CA",
      q: "cal",
    });
    expect(normalizeCollectionSearch({ view: "causes", sel: "cause:001" })).toEqual({
      view: "causes",
      sel: "cause:001",
    });
    expect(normalizeCollectionSearch({ view: "causes", sel: "cause:1" })).toEqual({
      view: "causes",
    });
  });

  it("validates the selected row against the view it belongs to", () => {
    expect(normalizeCollectionSearch({ view: "states", sel: "ca" })).toEqual({});
    expect(normalizeCollectionSearch({ tab: "citations", view: "courts", sel: "ca9" })).toEqual({
      tab: "citations",
      view: "courts",
      sel: "ca9",
    });
    expect(normalizeCollectionSearch({ tab: "citations", view: "courts", sel: "a/b" })).toEqual({
      tab: "citations",
      view: "courts",
    });
    expect(normalizeCollectionSearch({ tab: "cited", sel: 145875 })).toEqual({
      tab: "cited",
      sel: 145875,
    });
    // The same cluster as text from an older address is read as the number.
    expect(normalizeCollectionSearch({ tab: "cited", sel: "145875" })).toEqual({
      tab: "cited",
      sel: 145875,
    });
    expect(selOf({ sel: 145875 })).toBe("145875");
    expect(selOf({ sel: "CA" })).toBe("CA");
    expect(selOf({})).toBeUndefined();
    expect(normalizeCollectionSearch({ tab: "schema", sel: "audio_audio" })).toEqual({
      tab: "schema",
      sel: "audio_audio",
    });
    expect(normalizeCollectionSearch({ tab: "schema", sel: "Audio;DROP" })).toEqual({
      tab: "schema",
    });
  });

  it("reads the filters of the other tabs", () => {
    expect(
      normalizeCollectionSearch({ tab: "cited", court: "scotus", decade: "1980", q: "iqbal" }),
    ).toEqual({ tab: "cited", court: "scotus", decade: 1980, q: "iqbal" });
    // A decade given as a number is read the same, and stays a number in the address.
    expect(normalizeCollectionSearch({ tab: "cited", decade: 1980 })).toEqual({
      tab: "cited",
      decade: 1980,
    });
    expect(normalizeCollectionSearch({ tab: "cited", decade: "1985" })).toEqual({ tab: "cited" });
    expect(
      normalizeCollectionSearch({ tab: "schema", bulk: "no", loaded: "none", group: "people_db" }),
    ).toEqual({ tab: "schema", bulk: "no", loaded: "none", group: "people_db" });
    expect(normalizeCollectionSearch({ tab: "schema", bulk: "maybe", loaded: "x" })).toEqual({
      tab: "schema",
    });
    expect(
      normalizeCollectionSearch({ tab: "disclosures", level: "State trial", sort: "-people" }),
    ).toEqual({ tab: "disclosures", level: "State trial", sort: "-people" });
    expect(
      normalizeCollectionSearch({
        tab: "citations",
        view: "edges",
        flow: "appeal",
        level: "Federal district",
        to: "State supreme",
      }),
    ).toEqual({
      tab: "citations",
      view: "edges",
      flow: "appeal",
      level: "Federal district",
      to: "State supreme",
    });
    expect(
      normalizeCollectionSearch({ tab: "citations", measure: "count", flow: "appeal" }),
    ).toEqual({ tab: "citations", measure: "count" });
  });

  it("does not let a stale filter survive a patch, a tab change or a view change", () => {
    const current = normalizeCollectionSearch({
      view: "nos",
      q: "x",
      group: "tax",
      sel: "nos:365",
    });
    // Switching to the state view keeps the text but drops the group filter and the nature-of-suit selection.
    expect(patchSearch(current, { view: "states" })).toEqual({ q: "x" });
    expect(patchSearch(current, { q: undefined })).toEqual({
      view: "nos",
      group: "tax",
      sel: "nos:365",
    });
    expect(tabSearch("cited", { q: "iqbal" })).toEqual({ tab: "cited", q: "iqbal" });
    expect(tabSearch("dockets", { q: "x" })).toEqual({ q: "x" });
  });

  it("keeps the span, the selected level and the measure when another view of the tab opens", () => {
    const docket = { span: "all", level: "FD", q: "ca", sort: "-courts", sel: "CA" } as const;
    expect(viewSearch(docket, "nos")).toEqual({ view: "nos", span: "all", level: "FD" });
    const cites = { tab: "citations", measure: "count", q: "x" } as const;
    expect(viewSearch(cites, "courts")).toEqual({
      tab: "citations",
      view: "courts",
    });
    expect(viewSearch(cites, "map")).toEqual({ tab: "citations", measure: "count" });
  });
});
