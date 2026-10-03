import { describe, expect, it } from "vitest";
import { validateMatterSearch, withEntry, withView } from "./search";

describe("matter page URL state", () => {
  it("keeps valid tabs, entry numbers and viewer keys", () => {
    expect(
      validateMatterSearch({
        tab: "documents",
        entry: "771",
        view: "docketbird|flnd-3:2025-md-03140-00771",
      }),
    ).toEqual({
      tab: "documents",
      entry: 771,
      view: "docketbird|flnd-3:2025-md-03140-00771",
    });
    expect(validateMatterSearch({ entry: 5 })).toEqual({ entry: 5 });
  });

  it("omits the default tab and drops anything unknown or malformed", () => {
    expect(validateMatterSearch({ tab: "overview" })).toEqual({});
    expect(validateMatterSearch({ tab: "admin", entry: "12a", view: "pacer|x" })).toEqual({});
    expect(validateMatterSearch({ entry: -1 })).toEqual({});
    expect(validateMatterSearch({ entry: 1.5 })).toEqual({});
    expect(validateMatterSearch({ entry: "99999999" })).toEqual({});
    expect(validateMatterSearch({ view: "docketbird|" })).toEqual({});
    expect(validateMatterSearch({ view: "|abc" })).toEqual({});
    expect(validateMatterSearch({ view: `docketbird|${"x".repeat(501)}` })).toEqual({});
    expect(validateMatterSearch({ view: "docketbird|a\u0000b" })).toEqual({});
  });
});

describe("URL state updates", () => {
  it("adds and removes keys without leaving undefined values", () => {
    expect(withEntry({ tab: "documents" }, 12)).toEqual({ tab: "documents", entry: 12 });
    expect(withEntry({ tab: "documents", entry: 12 }, null)).toEqual({ tab: "documents" });
    expect("entry" in withEntry({ entry: 1 }, null)).toBe(false);
    expect(withView({ tab: "documents" }, "docketbird|x")).toEqual({
      tab: "documents",
      view: "docketbird|x",
    });
    expect("view" in withView({ view: "docketbird|x" }, null)).toBe(false);
  });
});
