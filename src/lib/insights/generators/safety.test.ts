import { describe, expect, it } from "vitest";
import type { CpscAnalytics } from "@/lib/external/enforcement.functions";
import {
  generateCaersInsights,
  generateCpscInsights,
  generateFaersInsights,
  generateMaudeInsights,
  generateNhtsaInsights,
  type FaersInput,
  type MaudeInput,
  type ReportYear,
} from "./safety";

const ry = (year: number, reports: number, over: Partial<ReportYear> = {}): ReportYear => ({
  year,
  reports,
  partial: false,
  deaths: Math.round(reports * 0.07),
  serious: Math.round(reports * 0.54),
  lawyer: Math.round(reports * 0.005),
  ...over,
});

const product = (
  id: string,
  name: string,
  now: number,
  before: number,
  mdl: number | null = 2000,
) => ({
  id,
  product: name,
  mdl,
  years: [ry(2024, before), ry(2025, now)],
  peak: { year: 2014, reports: before * 2 },
});

const faers = (over: Partial<FaersInput> = {}): FaersInput => ({
  dataThrough: "2026-06-30",
  national: [
    ry(2023, 1_368_572),
    ry(2024, 1_319_106),
    ry(2025, 1_307_769),
    ry(2026, 673_772, { partial: true }),
  ],
  products: [
    product("a", "Drug A", 9000, 3600),
    product("b", "Drug B", 6000, 7000),
    product("c", "Drug C", 2000, 2500),
    product("d", "Drug D", 1500, 1000),
    product("e", "Drug E", 800, 1600),
    product("f", "Drug F", 300, 100),
  ],
  ...over,
});

const ids = (list: { id: string }[]) => list.map((i) => i.id).sort();

describe("generateFaersInsights", () => {
  it("compares the last complete year with the one before and ignores the partial year", () => {
    const i = generateFaersInsights(faers()).find((x) => x.id === "safety.faers-national")!;
    expect(i.headline).toBe(
      "FDA received 1.3 million drug adverse-event reports in 2025, down 0.9% from 2024",
    );
    expect(i.summary.join(" ")).toContain("highest complete year since 2023 was 2023");
    expect(i.caveat).toContain("Reports are not incidence");
    expect(i.dataThrough).toBe("2026-06-30");
  });

  it("ranks tracked products by reports received in the latest complete year", () => {
    const i = generateFaersInsights(faers()).find((x) => x.id === "safety.faers-tracked-products")!;
    expect(i.headline).toBe(
      "Among 6 tracked mass-tort drugs, Drug A had the most FDA adverse-event reports in 2025 (9,000)",
    );
    expect(i.points[0]).toMatchObject({
      label: "Drug A",
      note: "MDL 2000",
      href: "/matters/2000",
    });
  });

  it("finds the biggest rise and fall among products that had at least 500 reports the year before", () => {
    const i = generateFaersInsights(faers()).find((x) => x.id === "safety.faers-product-movers")!;
    // Drug A 3,600 -> 9,000 = +150%; Drug E 1,600 -> 800 = -50% (Drug F had only 100 the year before and is not compared)
    expect(i.headline).toBe(
      "FDA reports for Drug A rose 150% in 2025; reports for Drug E fell 50%",
    );
    expect(i.points.find((p) => p.label === "Products compared")!.value).toBe("5");
  });

  it("does not link a product that has no MDL id", () => {
    const i = generateFaersInsights(
      faers({ products: faers().products.map((p) => ({ ...p, mdl: null })) }),
    ).find((x) => x.id === "safety.faers-tracked-products")!;
    expect(i.points[0]!.href).toBeUndefined();
  });

  it("returns nothing without two complete national years, and no product insights without products", () => {
    expect(generateFaersInsights(faers({ national: [ry(2025, 10)] }))).toEqual([]);
    expect(ids(generateFaersInsights(faers({ products: [] })))).toEqual(["safety.faers-national"]);
  });
});

const myear = (year: number, reports: number, over: Record<string, unknown> = {}) => ({
  ...ry(year, reports),
  death: Math.round(reports * 0.01),
  injury: Math.round(reports * 0.36),
  malfunction: Math.round(reports * 0.62),
  ...over,
});
const maude = (over: Partial<MaudeInput> = {}): MaudeInput => ({
  dataThrough: "2026-06-30",
  total: 26_557_775,
  mix: [
    { label: "Malfunction", count: 16_607_966, share: 0.625352 },
    { label: "Injury", count: 9_556_216, share: 0.359827 },
    { label: "Death", count: 231_597, share: 0.00872 },
  ],
  national: [
    myear(1992, 3099),
    myear(2024, 2_000_000),
    myear(2025, 2_100_000),
    myear(2026, 1_000_000, { partial: true }),
  ],
  devices: [
    {
      id: "1",
      product: "Device One",
      mdl: 3014,
      years: [ry(2025, 49_608)],
      peak: { year: 2022, reports: 90_000 },
    },
    { id: "2", product: "Device Two", mdl: null, years: [ry(2025, 12_000)], peak: null },
    {
      id: "3",
      product: "Device Three",
      mdl: 2197,
      years: [ry(2025, 800)],
      peak: { year: 2012, reports: 18_781 },
    },
  ],
  ...over,
});

describe("generateMaudeInsights", () => {
  it("states the all-time event mix and the latest complete year", () => {
    const i = generateMaudeInsights(maude()).find((x) => x.id === "safety.maude-event-mix")!;
    expect(i.headline).toBe(
      "63% of FDA device adverse-event reports describe malfunctions; 36% describe injuries and 0.9% deaths",
    );
    expect(i.summary[1]).toBe(
      "In 2025, 2,100,000 reports were received, up 5.0% from 2024 (2,000,000).",
    );
  });

  it("ranks tracked devices by the latest complete year and relates it to the peak", () => {
    const i = generateMaudeInsights(maude()).find((x) => x.id === "safety.maude-tracked-devices")!;
    expect(i.headline).toContain("Device One drew the most FDA device reports in 2025 (49,608)");
    expect(i.summary[1]).toContain("peaked in 2022 at 90,000, so 2025 is 55% of the peak");
  });

  it("drops the mix when a category is missing", () => {
    const i = generateMaudeInsights(maude({ mix: maude().mix.filter((m) => m.label !== "Death") }));
    expect(ids(i)).toEqual(["safety.maude-tracked-devices"]);
  });
});

describe("generateCaersInsights", () => {
  const caers = {
    dataThrough: "2026-03-31",
    total: 151_589,
    years: [ry(2023, 8_813), ry(2024, 5_265), ry(2025, 6_308), ry(2026, 1_000, { partial: true })],
    industries: [
      { name: "Vit/Min/Prot/Unconv Diet(Human/Animal)", reports: 54_906 },
      { name: "Cosmetics", reports: 52_219 },
      { name: "Nuts/Edible Seed", reports: 5_737 },
      { name: "Bakery", reports: 3_978 },
    ],
  };
  it("covers three complete years and the leading categories", () => {
    const [i] = generateCaersInsights(caers);
    expect(i!.headline).toBe(
      "FDA food, supplement and cosmetic complaint reports were 6,308 in 2025, up 20% from 2024",
    );
    expect(i!.summary[1]).toContain("after a change of -40.3% the year before");
    expect(i!.summary[3]).toContain("account for 74% of the 151,589 reports on file");
  });
  it("needs three complete years", () => {
    expect(generateCaersInsights({ ...caers, years: caers.years.slice(1) })).toEqual([]);
  });
});

const cpsc = (): CpscAnalytics =>
  ({
    asOf: "2026-10-15",
    hazardLabels: {
      fire_burn: "Fire, burn and overheating",
      suffocation: "Suffocation",
      fall: "Fall",
      other: "Other or unclassified",
    },
    years: [
      {
        year: 2024,
        partial: false,
        recalls: 305,
        withCountry: 304,
        hazards: { fire_burn: 121, suffocation: 33, fall: 47, other: 26 },
        countries: { China: 185, "United States": 56, Taiwan: 14 },
        unitsParsed: 199,
        unitsSum: 11_644_889,
      },
      {
        year: 2025,
        partial: false,
        recalls: 420,
        withCountry: 420,
        hazards: { fire_burn: 126, suffocation: 81, fall: 72, other: 13 },
        countries: { China: 301, "United States": 48, Vietnam: 14 },
        unitsParsed: 328,
        unitsSum: 22_397_104,
      },
      {
        year: 2026,
        partial: true,
        recalls: 485,
        withCountry: 483,
        hazards: {},
        countries: {},
        unitsParsed: 0,
        unitsSum: 0,
      },
    ],
  }) as unknown as CpscAnalytics;

describe("generateCpscInsights", () => {
  it("compares recalls year over year and mentions the year in progress", () => {
    const i = generateCpscInsights(cpsc()).find((x) => x.id === "safety.cpsc-recalls")!;
    expect(i.headline).toBe(
      "The CPSC announced 420 product recalls in 2025, up 38% from 2024; 2026 has already reached 485",
    );
    expect(i.summary[1]).toContain("already more than in all of 2025");
    expect(i.summary[2]).toContain("328 of the 2025 recalls");
  });

  it("shares hazard categories as a share of recalls and names the biggest rise", () => {
    const i = generateCpscInsights(cpsc()).find((x) => x.id === "safety.cpsc-hazards")!;
    expect(i.headline).toContain(
      "Fire, burn and overheating was the most common hazard in 2025 CPSC recalls (30%)",
    );
    expect(i.headline).toContain("suffocation recalls rose from 33 to 81");
    expect(i.summary[2]).toContain("add up to more than 100%");
  });

  it("states the China share of recalls with a country, and the prior-year share", () => {
    const i = generateCpscInsights(cpsc()).find((x) => x.id === "safety.cpsc-origin")!;
    expect(i.headline).toBe(
      "72% of 2025 CPSC recalls named China as a country of manufacture, up from 61% in 2024",
    );
  });

  it("needs two complete years", () => {
    const one = cpsc();
    one.years = one.years.slice(1);
    expect(generateCpscInsights(one)).toEqual([]);
  });
});

describe("generateNhtsaInsights", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const make = ["FORD", "HONDA", "GMC", "KIA"][i % 4]!;
      return {
        make,
        component: `C${i}`,
        total: 1000,
        years: {
          "2024": make === "GMC" ? 250 : make === "FORD" ? 600 : 300,
          "2025": make === "GMC" ? 550 : make === "FORD" ? 700 : 300,
        },
      };
    });

  it("ranks makes by complaints in the last complete year and finds the biggest riser among larger makes", () => {
    const [i] = generateNhtsaInsights({ latestCompleteYear: 2025, rows: rows(120) });
    // 30 rows per make. FORD 21,000 (from 18,000); GMC 16,500 (from 7,500, +120%); HONDA and KIA 9,000
    expect(i!.headline).toBe(
      "NHTSA complaints in 2025: Ford had the most (21,000); Gmc rose most among larger makes (+120%)".replace(
        "Gmc",
        "GMC",
      ),
    );
    expect(i!.points[3]).toMatchObject({ label: "Largest rise: GMC", note: "7,500 to 16,500" });
  });

  it("does not repeat a make that both has the most complaints and rose most", () => {
    const data = rows(120).map((r) =>
      r.make === "GMC" ? { ...r, years: { "2024": 250, "2025": 900 } } : r,
    );
    const [i] = generateNhtsaInsights({ latestCompleteYear: 2025, rows: data });
    expect(i!.headline).toBe(
      "NHTSA complaints in 2025: GMC had the most (27,000) and also rose most among larger makes (+260%)",
    );
  });

  it("returns nothing when there are too few published pairs or no make with enough complaints to compare", () => {
    expect(generateNhtsaInsights({ latestCompleteYear: 2025, rows: rows(40) })).toEqual([]);
    expect(generateNhtsaInsights({ latestCompleteYear: 2030, rows: rows(120) })).toEqual([]);
  });
});
