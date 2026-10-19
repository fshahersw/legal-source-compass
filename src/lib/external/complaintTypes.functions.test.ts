import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (handler: unknown) => handler }),
}));

import { count, parseConsumer, parseDevices, parseVehicles } from "./complaintTypes.functions";

describe("complaint types", () => {
  it("reads stored display numbers", () => {
    expect(count("65,930")).toBe(65930);
    expect(count("5.5%")).toBe(5.5);
    expect(count("—")).toBeNull();
    expect(count(-1)).toBeNull();
  });

  it("sums vehicle complaints by component across makes", () => {
    const v = parseVehicles([
      {
        t: {
          make: "FORD",
          component: "POWER TRAIN",
          total: 100,
          crash: 3,
          fire: 1,
          injured: 2,
          deaths: 0,
          years: { "2024": 60, "2025": 40 },
        },
      },
      {
        t: {
          make: "GM",
          component: "POWER TRAIN",
          total: 50,
          crash: 1,
          fire: 0,
          injured: 0,
          deaths: 1,
          years: { "2025": 50 },
        },
      },
      { t: { make: "GM", component: "STEERING", total: 20 } },
      { t: { component: "BAD" } },
    ]);
    expect(v.total).toBe(170);
    expect(v.dropped).toBe(1);
    const pt = v.components[0]!;
    expect(pt).toMatchObject({ component: "POWER TRAIN", complaints: 150, crashes: 4, deaths: 1 });
    expect(pt.byYear).toEqual([
      { year: "2024", count: 60 },
      { year: "2025", count: 90 },
    ]);
    expect(pt.topMakes[0]).toEqual({ label: "FORD", count: 100 });
  });

  it("reads consumer categories and totals their hazard themes", () => {
    const c = parseConsumer([
      {
        c: { name: "Kitchen", reports: 25144, injuries: 4998, deaths: 9, change_pct: -1.02 },
        s: { themes: { fire: 10, burn: 5, unknown: 3 } },
      },
      { c: { name: "Toys", reports: "1,000" }, s: { themes: { fire: 1 } } },
      { c: {}, s: null },
    ]);
    expect(c.categories.map((x) => x.name)).toEqual(["Kitchen", "Toys"]);
    expect(c.themes[0]).toEqual({ label: "Fire", count: 11 });
    expect(c.dropped).toBe(1);
  });

  it("separates the MAUDE national series from product rows", () => {
    const d = parseDevices([
      {
        id: "national",
        k: "maude_national",
        c: {},
        pk: null,
        s: [
          {
            year: 1992,
            death: 298,
            injury: 1537,
            malfunction: 1116,
            other_or_unclassified: 148,
            partial: false,
          },
        ],
      },
      {
        id: "2197",
        k: "maude_product",
        c: { product: "DePuy ASR hip implant", reports: "65,930", deaths: "205" },
        pk: { year: 2012 },
        s: null,
      },
    ]);
    expect(d.national[0]).toMatchObject({ year: 1992, death: 298 });
    expect(d.products[0]).toMatchObject({
      product: "DePuy ASR hip implant",
      mdl: 2197,
      reports: 65930,
      peakYear: 2012,
    });
  });
});
