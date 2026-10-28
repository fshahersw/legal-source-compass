import { describe, expect, it } from "vitest";
import {
  blendAt,
  codefendants,
  courtShort,
  displayCompany,
  dotCounts,
  latestMdls,
  packBlocks,
  parseAtlas,
  pendingAt,
  strandOrder,
  unitFor,
  unitGroups,
} from "./atlasModel";
import { parseNetwork } from "./storiesModel";

const raw = {
  dates: ["2025-01-02", "2025-02-03", "2025-03-03"],
  mdls: [
    {
      mdl: 2738,
      title:
        "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
      type: "Products Liability",
      district: "NJ",
      judge: "Michael A. Shipp",
      transferred: "2016-10-04",
      inLatest: true,
      total: 70000,
      start: 0,
      values: [500, 600, 700],
    },
    {
      mdl: 2873,
      title: "IN RE: Aqueous Film-Forming Foams Products Liability Litigation",
      type: "Products Liability",
      district: "SC",
      judge: "Richard M. Gergel",
      transferred: "2018-12-07",
      inLatest: true,
      total: 16000,
      start: 1,
      values: [200, 300],
    },
    {
      mdl: 3001,
      title: "IN RE: Some Antitrust Litigation",
      type: null,
      district: "NJ",
      judge: "Michael A. Shipp",
      transferred: null,
      inLatest: false,
      total: 5,
      start: 0,
      values: [3, null],
    },
    {
      mdl: 9,
      title: "bad",
      type: null,
      district: null,
      judge: null,
      transferred: null,
      inLatest: false,
      total: null,
      start: 2,
      values: [1, 2],
    },
  ],
  districts: [
    {
      code: "NJ",
      courtId: "njd",
      court: "District Court, D. New Jersey",
      lat: 40.73,
      lon: -74.17,
      city: "Newark",
      state: "NJ",
      placedBy: "court_locations",
      values: [503, 600, 700],
      counts: [2, 1, 1],
    },
    {
      code: "SC",
      courtId: "scd",
      court: "District Court, D. South Carolina",
      lat: null,
      lon: null,
      city: null,
      state: null,
      placedBy: null,
      values: [0, 200, 300],
      counts: [0, 1, 1],
    },
    {
      code: "XX1",
      courtId: "x",
      court: null,
      lat: null,
      lon: null,
      city: null,
      state: null,
      placedBy: null,
      values: [0],
      counts: [0],
    },
  ],
};

describe("atlasModel", () => {
  it("parses the atlas and drops rows that do not fit the frames", () => {
    const a = parseAtlas(raw);
    expect(a.mdls.map((m) => m.mdl)).toEqual([2738, 2873, 3001]);
    expect(a.districts.map((d) => d.code)).toEqual(["NJ", "SC"]);
    expect(a.dropped).toBe(2);
    expect(a.mdls[0]!.short).toBe("Johnson & Johnson Talcum Powder Products");
    expect(a.mdls[2]!.category).toBe("antitrust");
  });

  it("reads pending counts by frame and blends only between frames", () => {
    const a = parseAtlas(raw);
    const afff = a.mdls[1]!;
    expect(pendingAt(afff, 0)).toBe(0);
    expect(pendingAt(afff, 2)).toBe(300);
    expect(pendingAt(a.mdls[2]!, 1)).toBe(0);
    expect(blendAt([0, 200, 300], 1.5)).toBe(250);
    expect(blendAt([0, 200, 300], 9)).toBe(300);
  });

  it("groups the latest report and folds the tail for MDL, court and judge", () => {
    const a = parseAtlas(raw);
    const rows = latestMdls(a);
    expect(rows.map((r) => r.m.mdl)).toEqual([2738, 2873]);
    const byCourt = unitGroups(rows, "district", (c) => c);
    expect(byCourt.map((g) => [g.key, g.actions])).toEqual([
      ["NJ", 700],
      ["SC", 300],
    ]);
    const folded = unitGroups(rows, "mdl", (c) => c, 1);
    // a single group past the cut is shown by name, not folded into "All others"
    expect(folded.at(-1)!.label).toBe("Aqueous Film-Forming Foams");
    expect(unitGroups(rows, "mdl", (c) => c, 0).map((g) => g.label)).toEqual(["All other 2 MDLs"]);
    expect(folded.reduce((s, g) => s + g.actions, 0)).toBe(1000);
    const years = unitGroups(rows, "year", (c) => c);
    expect(years.map((g) => g.key)).toEqual(["2016", "2018"]);
  });

  it("gives every MDL at least one dot and packs blocks inside the width", () => {
    const a = parseAtlas(raw);
    const rows = latestMdls(a);
    const dots = dotCounts(rows, 1000);
    expect([...dots.values()]).toEqual([1, 1]);
    expect(unitFor(204977)).toBe(25);
    const groups = unitGroups(rows, "mdl", (c) => c);
    const { blocks, height } = packBlocks(groups, dotCounts(rows, 10), 300, 400);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.x + b.cols * 2).toBeLessThanOrEqual(300 + 1e-6);
    expect(blocks.reduce((s, b) => s + b.slots.length, 0)).toBe(100);
    expect(height).toBeGreaterThan(0);
  });

  it("orders strands by first appearance, size or type", () => {
    const a = parseAtlas(raw);
    expect(strandOrder(a.mdls, "start").map((m) => m.mdl)).toEqual([2738, 3001, 2873]);
    expect(strandOrder(a.mdls, "peak").map((m) => m.mdl)).toEqual([2738, 2873, 3001]);
    expect(strandOrder(a.mdls, "category").map((m) => m.mdl)).toEqual([2738, 2873, 3001]);
  });

  it("names courts and companies for display", () => {
    expect(courtShort({ court: "District Court, D. New Jersey", code: "NJ" })).toBe(
      "D. New Jersey",
    );
    expect(courtShort({ court: null, code: "OHS" })).toBe("OHS");
    expect(displayCompany("EXXON MOBIL CORP")).toBe("Exxon Mobil Corp");
    expect(displayCompany("Allergan plc")).toBe("Allergan plc");
    expect(displayCompany("3M CO")).toBe("3M Co");
  });

  it("builds the co-defendant matrix and folds identical MDL sets, never by name", () => {
    const link = (cik: string, company: string, mdl: number, tier = "A") => ({
      cik,
      company,
      mdl,
      tier,
      tierLabel: "x",
      verified: 1,
      first: null,
      last: null,
    });
    const net = parseNetwork({
      links: [
        link("0000000001", "PARENT PLC", 1),
        link("0000000001", "PARENT PLC", 2),
        link("0000000002", "PARENT FINANCE LLC", 1),
        link("0000000002", "PARENT FINANCE LLC", 2),
        link("0000000003", "OTHER INC", 2),
        link("0000000003", "OTHER INC", 3, "C"),
        link("0000000004", "LONE CO", 4),
      ],
      mdls: [],
      products: [],
    });
    const c = codefendants(net);
    expect(c.folded).toBe(1);
    expect(c.companies.map((x) => x.company)).toEqual(["OTHER INC", "PARENT FINANCE LLC"]);
    expect(c.companies[1]!.also.map((x) => x.cik)).toEqual(["0000000001"]);
    expect(c.matrix).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(c.shared[0]![1]).toEqual([2]);
    const strict = codefendants(net, 18, { tierC: false });
    expect(strict.companies.every((x) => !x.mdls.includes(3))).toBe(true);
  });
});
