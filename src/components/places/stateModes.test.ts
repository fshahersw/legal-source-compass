import { describe, expect, it } from "vitest";
import { stateMode, STATE_MODES } from "./stateModes";
import { parsePlaceHubSearch } from "./placeSearch";

describe("state navigation modes", () => {
  it("offers four distinct modes", () => {
    expect(STATE_MODES.map((m) => m.id)).toEqual(["overview", "analysis", "directory", "sources"]);
  });
  it.each(["courts", "judges", "counties"])("preserves the legacy %s destination", (tab) => {
    const search = parsePlaceHubSearch({ tab });
    expect(search.tab).toBe(tab);
    expect(stateMode(search.tab ?? "overview")).toBe("directory");
  });
});