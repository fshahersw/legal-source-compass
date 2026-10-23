import { describe, expect, it } from "vitest";
import { parseMapSearch, resolveMapSelection } from "./mapSearch";

describe("parseMapSearch", () => {
  it("keeps a known metric and the county layer", () => {
    expect(parseMapSearch({ metric: "pop", layer: "counties" })).toEqual({
      metric: "pop",
      layer: "counties",
    });
  });
  it("drops unknown metrics, other layers and the default metric", () => {
    expect(parseMapSearch({ metric: "nope", layer: "tracts" })).toEqual({});
    expect(parseMapSearch({ metric: "fed_filings_rate" })).toEqual({});
    expect(parseMapSearch({ metric: 5 })).toEqual({});
  });
});

describe("resolveMapSelection", () => {
  it("defaults to federal civil filings per 100,000 residents on the state layer", () => {
    expect(resolveMapSelection({})).toEqual({ metric: "fed_filings_rate", counties: false });
  });
  it("turns the county layer on only for metrics with county data", () => {
    expect(resolveMapSelection({ metric: "pop", layer: "counties" }).counties).toBe(true);
    expect(resolveMapSelection({ metric: "mdl_pending", layer: "counties" }).counties).toBe(false);
    expect(resolveMapSelection({ metric: "acs:poverty_rate", layer: "counties" }).counties).toBe(
      true,
    );
  });
});
