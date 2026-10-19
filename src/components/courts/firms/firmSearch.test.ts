import { describe, expect, it } from "vitest";
import { normalizeFirmSearch, patchFirmSearch } from "./firmSearch";

describe("normalizeFirmSearch", () => {
  it("keeps valid values and drops defaults and junk", () => {
    expect(
      normalizeFirmSearch({
        side: "defense",
        q: "  Seeger   Weiss ",
        sort: "mdls",
        page: "3",
        firm: "firm:seeger-weiss",
        mdl: "3047",
      }),
    ).toEqual({
      side: "defense",
      q: "Seeger Weiss",
      sort: "mdls",
      page: 3,
      firm: "firm:seeger-weiss",
      mdl: 3047,
    });
    expect(
      normalizeFirmSearch({ side: "all", sort: "appearances", page: "1", firm: "../x", mdl: "-2" }),
    ).toEqual({});
    expect(normalizeFirmSearch({ sort: "drop table", page: "1.5" })).toEqual({});
  });
});

describe("patchFirmSearch", () => {
  it("returns to the first page when a filter changes but not when a row opens", () => {
    expect(patchFirmSearch({ page: 4, side: "plaintiff" }, { side: "defense" })).toEqual({
      side: "defense",
    });
    expect(patchFirmSearch({ page: 4 }, { firm: "firm:motley-rice" })).toEqual({
      page: 4,
      firm: "firm:motley-rice",
    });
    expect(patchFirmSearch({ firm: "firm:motley-rice" }, { firm: undefined })).toEqual({});
  });
});
