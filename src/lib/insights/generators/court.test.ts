import { describe, expect, it } from "vitest";
import type { CourtStatsOverview, DistrictRow, Series } from "@/components/courts/courtStatsData";
import { generateCourtInsights } from "./court";

const N = 90;
const ser = (a: number | null, b: number | null): Series => [a, b];

function district(i: number, over: Partial<DistrictRow> = {}): DistrictRow {
  const big = i < 5;
  return {
    id: `d${i}`,
    name: `District ${i}`,
    circuit: "ca1",
    pl: ser(10, big ? 1000 - 100 * i : 10),
    civil: ser(1000, 1000),
    share: ser(1, 1),
    natShare: ser(1, 1),
    judgeships: ser(2, 2),
    plPerJudgeship: ser(5, big ? (1000 - 100 * i) / 2 : 5),
    civilPerJudgeship: ser(500, 500),
    median: ser(5, i < 3 ? 50 + i : 8),
    trial: ser(null, null),
    over3: ser(5, i < 3 ? 60 - i : 10),
    pending: ser(200, 200),
    pl5: null,
    mdl: {
      pendingDockets: 1,
      pendingActions: 1,
      plDockets: 1,
      plActions: i < 3 ? 500 - 100 * i : 0,
      asOf: "2026-10-01",
    },
    flags: [],
    dash: {},
    ...over,
  };
}

function overview(
  over: Partial<CourtStatsOverview> = {},
  natOver: Record<string, unknown> = {},
): CourtStatsOverview {
  return {
    years: [2024, 2025],
    national: {
      years: [2024, 2025],
      latest: 2025,
      series: {
        pl_total: ser(5000, 4850),
        civil_filed: ser(100000, 90000),
        pl_share_pct: ser(5, 5.4),
        pl_top5_share_pct: ser(null, 82.5),
      },
      notes: [
        "Fiscal years are the 12-month periods ending September 30.",
        "Filings include cases transferred to MDL districts.",
      ],
      listing:
        "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts",
      mdlCorrelation: { rho: 0.7154, n: 90, x: "x", y: "y", asOf: "2026-10-01" },
      ...natOver,
    },
    districts: Array.from({ length: N }, (_, i) => district(i)),
    circuits: Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? "cadc" : `ca${i}`,
      name: i === 0 ? "D.C. Circuit" : `Circuit ${i}`,
      appealsFiled: ser(100, 100 + i),
    })),
    ...over,
  } as unknown as CourtStatsOverview;
}

const byId = (o: CourtStatsOverview) =>
  Object.fromEntries(generateCourtInsights(o).map((i) => [i.id, i]));

describe("generateCourtInsights", () => {
  it("produces the national trend with its peak and a caveat from the source notes", () => {
    const i = byId(overview())["court.pl-filings-national"]!;
    expect(i.headline).toBe(
      "Product liability filings in federal district courts were 4,850 in FY2025, down 3.0% from FY2024",
    );
    expect(i.points.slice(0, 3).map((p) => p.value)).toEqual(["4,850", "5,000", "-3.0%"]);
    expect(i.summary.join(" ")).toContain("5.4% of all civil filings");
    expect(i.caveat).toBe("Filings include cases transferred to MDL districts.");
    expect(i.sources[0]!.href).toContain("uscourts.gov");
    expect(i.dataThrough).toBe("FY2025");
  });

  it("measures concentration against the national total", () => {
    const i = byId(overview())["court.pl-filings-concentration"]!;
    // top five: 1000+900+800+700+600 = 4000 of 4850 = 82.5%
    expect(i.headline).toBe("Five districts received 82% of product liability filings in FY2025");
    expect(i.points[0]).toMatchObject({ label: "District 0", value: "1,000", href: "/courts/d0" });
    expect(i.points[3]).toMatchObject({ label: "Top five combined", value: "4,000" });
  });

  it("drops the concentration insight when the published top-five share disagrees with the rows", () => {
    const o = overview(
      {},
      { series: { pl_total: ser(5000, 4850), pl_top5_share_pct: ser(null, 40) } },
    );
    expect(byId(o)["court.pl-filings-concentration"]).toBeUndefined();
  });

  it("names the biggest rise and fall by district", () => {
    const i = byId(overview())["court.pl-filings-movers"]!;
    // District 0: 10 -> 1000 (+990); no district fell, so no fall is reported and the insight is dropped
    expect(i).toBeUndefined();
    const fall = overview();
    fall.districts[7] = district(7, { pl: ser(500, 10) });
    const j = byId(fall)["court.pl-filings-movers"]!;
    expect(j.headline).toBe(
      "District 0 had the largest rise in product liability filings in FY2025 (+990); District 7 had the largest fall (-490)",
    );
    expect(j.points.find((p) => p.label.startsWith("Districts up"))!.value).toBe("5 / 1");
  });

  it("leaves small districts out of the delay and backlog rankings", () => {
    const o = overview();
    o.districts[0] = district(0, { pending: ser(10, 12), median: ser(5, 99), over3: ser(5, 90) });
    const ids = byId(o);
    expect(ids["court.time-to-disposition"]!.headline).toContain("to 52.0 months in District 2");
    expect(ids["court.aging-backlog"]!.headline).toContain("District 1");
    expect(ids["court.aging-backlog"]!.caveat).toContain("fewer than 100 pending civil cases");
  });

  it("reports the circuit appeal total with its change", () => {
    const i = byId(overview())["court.appeals-filed"]!;
    // 12 x 100 = 1200 -> 1200 + (0+...+11) = 1266: up 5.5%
    expect(i.headline).toBe(
      "Appeals filed in the regional courts of appeals were up 5.5% in FY2025 (1,266)",
    );
    expect(i.summary[1]).toContain("11");
  });

  it("states the MDL correlation without implying cause", () => {
    const i = byId(overview())["court.mdl-and-filings"]!;
    expect(i.summary.join(" ")).toContain("0.72");
    expect(i.summary.join(" ")).toContain("does not show that one causes the other");
    expect(i.points[2]).toMatchObject({ value: "500", href: "/courts/d0" });
  });

  it("drops candidates whose inputs are missing instead of printing placeholders", () => {
    const sparse = overview({ districts: [] });
    expect(Object.keys(byId(sparse))).toEqual(["court.pl-filings-national", "court.appeals-filed"]);
    const noSeries = overview({ districts: [], circuits: [] }, { series: {} });
    expect(generateCourtInsights(noSeries)).toEqual([]);
    expect(generateCourtInsights(overview({ years: [2025] }))).toEqual([]);
  });

  it("every candidate satisfies the card contract", () => {
    for (const i of generateCourtInsights(overview())) {
      expect(i.summary.length).toBeGreaterThanOrEqual(2);
      expect(i.summary.length).toBeLessThanOrEqual(4);
      expect(i.points.length).toBeGreaterThanOrEqual(3);
      expect(i.points.length).toBeLessThanOrEqual(5);
      expect(i.id.startsWith("court.")).toBe(true);
      expect(JSON.stringify(i)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
