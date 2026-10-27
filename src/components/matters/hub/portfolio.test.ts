import { describe, expect, it } from "vitest";
import type { HubRow } from "@/lib/matters/types";
import {
  coverageRows,
  coverageTakeaway,
  pdfTotals,
  portfolioGrowth,
  portfolioKpis,
} from "./portfolio";
import { buildVelocity, shiftMonth } from "./velocity";

const hub = (over: Partial<HubRow> & Pick<HubRow, "mdl">): HubRow => ({
  tier: 1,
  shortName: `Matter ${over.mdl}`,
  inCorpus: true,
  title: null,
  status: "pending",
  courtName: null,
  masterDocket: null,
  judgePrinted: null,
  judgeProfileId: null,
  totalActions: null,
  pendingActions: null,
  asOf: "2026-10-01",
  casesInSample: null,
  docketEntriesInSample: null,
  savedDocuments: null,
  swAppearances: null,
  registry: null,
  registryDockets: null,
  metrics: null,
  ...over,
});

const pts = (from: string, totals: number[], pending: number[]) =>
  totals.map((total, i) => ({ date: `${shiftMonth(from, i)}-01`, total, pending: pending[i]! }));

// 13 reports, 2025-10 to 2026-10. 3140 and 2738 are hub matters; 3084 is not.
const model = buildVelocity(
  [
    { mdl: "3140", title: null, type: "Products Liability", points: pts("2025-10", Array.from({ length: 13 }, (_, i) => 1000 + i * 10), Array(13).fill(6412)) },
    { mdl: "2738", title: null, type: "Products Liability", points: pts("2025-10", Array.from({ length: 13 }, (_, i) => 2000 + i), Array(13).fill(69340)) },
    { mdl: "3084", title: null, type: "Products Liability", points: pts("2025-10", Array(13).fill(10), Array(13).fill(1000)) },
    { mdl: "3199", title: null, type: "Products Liability", points: pts("2026-08", [5, 9, 12], [5, 9, 12]) },
  ],
  { portfolio: new Set(["3140", "2738", "3199"]), registry: new Set(["3140", "2738", "3199"]) },
);

describe("portfolioKpis", () => {
  it("sums only matters dated by the latest JPML report and shares them against the same report", () => {
    const rows = [
      hub({ mdl: "3140", pendingActions: 6412, totalActions: 6524 }),
      hub({ mdl: "2738", pendingActions: 69340, totalActions: 72024 }),
      hub({ mdl: "2545", status: "terminated", pendingActions: null, totalActions: 8133, asOf: "2025-09-30" }),
      hub({ mdl: "2606", status: "terminated", pendingActions: 3, asOf: "2025-09-30" }),
    ];
    const k = portfolioKpis(rows, model);
    expect(k).toMatchObject({
      matters: 4,
      pendingMatters: 2,
      pendingActions: 75752,
      counted: 2,
      reportDate: "2026-10-01",
      national: 6412 + 69340 + 1000 + 12,
      nationalMdls: 4,
    });
    expect(k.sharePct).toBeCloseTo((75752 / (6412 + 69340 + 1012)) * 100, 6);
    expect(k.otherDates.map((o) => o.mdl)).toEqual(["2545", "2606"]);
  });

  it("shows no share without the national series", () => {
    const k = portfolioKpis([hub({ mdl: "3140", pendingActions: 1 })], null);
    expect(k.pendingActions).toBeNull();
    expect(k.sharePct).toBeNull();
  });
});

describe("portfolioGrowth", () => {
  it("ranks hub matters by 12-month adds and keeps new MDLs apart", () => {
    const g = portfolioGrowth(
      [hub({ mdl: "3140" }), hub({ mdl: "2738" }), hub({ mdl: "3199" })],
      model,
    );
    expect(g.ranked.map((r) => [r.mdl, r.added12m, r.name])).toEqual([
      ["3140", 120, "Matter 3140"],
      ["2738", 12, "Matter 2738"],
    ]);
    expect(g.notRecorded.map((r) => r.mdl)).toEqual(["3199"]);
    expect(g.added12m).toBe(132);
    expect(g.added3m).toBe(33);
  });
});

describe("coverage", () => {
  it("compares registry dockets with JPML actions as N of M, lowest first, gaps apart", () => {
    const { rows, notRecorded } = coverageRows([
      hub({ mdl: "3140", registryDockets: 35, totalActions: 6524 }),
      hub({ mdl: "2804", registryDockets: 3413, totalActions: 3184 }),
      hub({ mdl: "2592", registryDockets: 31603, totalActions: null }),
      hub({ mdl: "2738", registryDockets: 36167, totalActions: 72024 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["3140", "2738", "2804"]);
    expect(rows[0]).toMatchObject({ dockets: 35, actions: 6524 });
    expect(rows[2]!.value).toBeGreaterThan(100); // stated as published, never capped
    expect(notRecorded.map((r) => r.mdl)).toEqual(["2592"]);
    expect(coverageTakeaway(rows)).toBe(
      "The registry holds under 10% of the JPML actions for 1 of 3 matters",
    );
    expect(coverageTakeaway([])).toBeNull();
  });
});

describe("pdfTotals", () => {
  it("sums the chips the table shows, and is partial when a reader was not connected", () => {
    expect(
      pdfTotals({
        "2738": { open: 31, held: 37452, total: 37483 },
        "3180": { open: 42, held: 4, total: 46 },
        "3031": { none: true },
        "9999": { notConnected: true },
        "2545": null,
      }),
    ).toEqual({ total: 37529, open: 73, held: 37456, matters: 2, notConnected: 1 });
    expect(pdfTotals(undefined)).toBeNull();
    expect(pdfTotals({ x: { notConnected: true } })).toBeNull();
  });
});
