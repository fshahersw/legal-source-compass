import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getCourtStructure, parseCourtStructure, parseRef } from "./courtStructure.functions";

// Shape copied from the published courts_db record for cand.
const CAND = {
  court_id: "cand",
  name: "United States District Court for the Northern District of California",
  system: "Federal",
  level: "General jurisdiction trial court",
  type: "Trial",
  location: "California",
  citation_string: "N.D. Cal.",
  name_abbreviation: null,
  active: true,
  notes: "Subdivided",
  court_url: "http://www.cand.uscourts.gov/",
  periods: [{ start: "1850-01-01", end: null, reorganizations: ["1866-03-09", "1966-01-01"] }],
  divisions: ["Oakland", "San Francisco", "San Jose"],
  division_type: null,
  sub_names: [],
  parent_chain: [
    {
      id: "usdistct",
      name: "United States District Court",
      page: true,
      level: "Not recorded",
      active: null,
    },
  ],
  children: [],
  siblings: 66,
  appeal_to: {
    id: "ca9",
    name: "United States Court of Appeals for the Ninth Circuit",
    page: true,
    level: "Intermediate appellate court",
    active: true,
  },
  circuit: null,
  appealed_from: [],
  credit: "Courts-DB, compiled by Free Law Project (BSD-2-Clause), revision c22604df",
};

describe("court structure", () => {
  it("reads a stored profile", () => {
    const s = parseCourtStructure(CAND, "cand")!;
    expect(s.appealTo?.id).toBe("ca9");
    expect(s.parentChain.map((r) => r.id)).toEqual(["usdistct"]);
    expect(s.periods[0]?.reorganizations).toEqual(["1866-03-09", "1966-01-01"]);
    expect(s.website).toBe("http://www.cand.uscourts.gov/");
    expect(s.siblings).toBe(66);
  });

  it("refuses a profile for another court and drops malformed parts", () => {
    expect(parseCourtStructure(CAND, "casd")).toBeNull();
    const s = parseCourtStructure(
      {
        ...CAND,
        court_url: "javascript:alert(1)",
        periods: [{ start: "1850", end: null, reorganizations: ["x"] }],
        children: [
          { id: "../x", name: "bad" },
          { id: "ok1", name: "Fine" },
        ],
        siblings: -2,
      },
      "cand",
    )!;
    expect(s.website).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.children.map((r) => r.id)).toEqual(["ok1"]);
    expect(s.siblings).toBe(0);
  });

  it("only treats page === true as a court page", () => {
    expect(parseRef({ id: "abc", name: "A", page: "yes" })?.page).toBe(false);
    expect(parseRef({ id: "mtjdctFergus", page: true })?.page).toBe(true);
    expect(parseRef({ id: "a b" })).toBeNull();
  });

  it("queries courts_db by exact id", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [{ p: CAND }], total: null });
    const handler = getCourtStructure as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    const result = (await handler({ data: { id: "cand" } })) as { courtId: string };
    expect(result.courtId).toBe("cand");
    expect(vi.mocked(restGet).mock.calls[0]![0]).toContain("dataset=eq.courts_db&id=eq.cand");
  });
});
