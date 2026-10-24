import { describe, expect, it } from "vitest";
import { parseAppealRoutes } from "./appealRoutes";

const CAFC = {
  court: { court_id: "cafc", name: "Court of Appeals for the Federal Circuit" },
  appeals_to: [],
  appeals_from: [
    {
      edge_id: 1,
      court_id: "uscfc",
      name: "United States Court of Federal Claims",
      link: "/courts/uscfc",
      start: "1982-04-02",
      end: null,
    },
    {
      edge_id: 7,
      court_id: "ptab",
      name: "Patent Trial and Appeal Board",
      link: "/courts/cafc",
      start: "2012-09-16",
    },
    { edge_id: "x", court_id: "bad" },
  ],
};

describe("parseAppealRoutes", () => {
  it("keeps exact links only and drops malformed edges", () => {
    const r = parseAppealRoutes(CAFC, "cafc")!;
    expect(r.appealsFrom.map((c) => [c.courtId, c.link])).toEqual([
      ["uscfc", "/courts/uscfc"],
      ["ptab", null],
    ]);
    expect(r.appealsTo).toEqual([]);
  });
  it("refuses another court's record and an empty one", () => {
    expect(parseAppealRoutes(CAFC, "ca9")).toBeNull();
    expect(
      parseAppealRoutes({ court: { court_id: "x" }, appeals_to: [], appeals_from: [] }, "x"),
    ).toBeNull();
  });
});
