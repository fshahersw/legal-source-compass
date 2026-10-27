import { describe, expect, it } from "vitest";
import {
  buildVelocity,
  growthLeaders,
  leaderboardKpis,
  monthOf,
  shiftMonth,
  shortCaption,
  type JpmlMdlInput,
} from "./velocity";

/** Monthly points shaped like `jpml_pending_history_mdls` item.analytics.series. */
const series = (from: string, totals: (number | null)[], pending?: (number | null)[]) =>
  totals.map((total, i) => {
    const m = shiftMonth(from, i);
    return { date: `${m}-01`, total, pending: pending?.[i] ?? total };
  });

const mdl = (id: string, points: JpmlMdlInput["points"], type = "Products Liability") => ({
  mdl: id,
  title: `IN RE: ${id} Products Liability Litigation`,
  type,
  points,
});

describe("months", () => {
  it("keys reports by month whatever day the Panel dated them", () => {
    expect(monthOf("2026-10-01")).toBe("2026-10");
    expect(monthOf("2026-10-05")).toBe("2026-10");
    expect(monthOf("2026-13-01")).toBeNull();
    expect(monthOf(null)).toBeNull();
  });
  it("shifts across years", () => {
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});

describe("buildVelocity", () => {
  // 25 monthly reports, 2024-10 to 2026-10, like the published series.
  const full = mdl(
    "3140",
    series(
      "2024-10",
      Array.from({ length: 25 }, (_, i) => 1000 + i * 100),
    ),
  );
  const young = mdl("3199", series("2026-04", [10, 20, 30, 40, 50, 60, 70]));
  const recount = mdl(
    "2885",
    series(
      "2024-10",
      Array.from({ length: 25 }, (_, i) => (i === 24 ? 100 : 5000)),
    ),
  );
  const gone = mdl("2592", series("2024-10", [500, 500, 500]));
  const gap = mdl(
    "3084",
    series(
      "2024-10",
      Array.from({ length: 25 }, (_, i) => (i === 21 ? null : 200 + i)),
    ),
  );
  const model = buildVelocity([full, young, recount, gone, gap], {
    portfolio: new Set(["3140", "2885"]),
    registry: new Set(["3140", "2885", "2592"]),
  });
  const row = (id: string) => model.rows.find((r) => r.mdl === id)!;

  it("finds the latest report", () => {
    expect(model.latestMonth).toBe("2026-10");
    expect(model.latestReport).toBe("2026-10-01");
  });

  it("keys a report dated after the 1st to its month", () => {
    const late = buildVelocity(
      [mdl("1", [{ date: "2025-10-03", total: 1, pending: 1 }, { date: "2026-10-05", total: 4, pending: 2 }])],
      { portfolio: new Set(), registry: null },
    );
    expect(late.latestReport).toBe("2026-10-05");
    expect(late.rows[0]).toMatchObject({ added12m: 3, window12: "complete" });
  });

  it("measures actions added as the change in the cumulative total over 12 and 3 reports", () => {
    expect(row("3140")).toMatchObject({
      inLatest: true,
      total: 3400,
      added12m: 1200,
      added3m: 300,
      pace3m: 1200,
      window12: "complete",
      inRegistry: true,
      inPortfolio: true,
      reports: 25,
    });
  });

  it("leaves a window without its base report Not recorded, never a short-window count", () => {
    expect(row("3199")).toMatchObject({ added12m: null, window12: "partial", added3m: 30 });
    // The report three months back has no total: Not recorded, not interpolated.
    expect(row("3084")).toMatchObject({ added3m: null, window3: "partial", added12m: 12 });
  });

  it("reads a falling cumulative total as a re-count, never as dismissals", () => {
    expect(row("2885")).toMatchObject({ added12m: null, window12: "recount" });
  });

  it("gives an MDL missing from the latest report no current figures", () => {
    expect(row("2592")).toMatchObject({ inLatest: false, pending: null, added12m: null });
  });

  it("flags registry membership by exact number, unknown when the registry was not read", () => {
    expect(row("3084").inRegistry).toBe(false);
    const unknown = buildVelocity([full], { portfolio: new Set(), registry: null });
    expect(unknown.rows[0]!.inRegistry).toBeNull();
  });

  it("sums the national and portfolio pending series per report", () => {
    const last = model.months.at(-1)!;
    // 3140 3400 + 3199 70 + 2885 100 + 3084 224 (2592 left the reports)
    expect(last).toMatchObject({
      month: "2026-10",
      national: 3400 + 70 + 100 + 224,
      nationalMdls: 4,
      portfolio: 3400 + 100,
      portfolioMdls: 2,
    });
    // A report with no pending figure for an MDL counts only the MDLs that have one.
    const m = model.months.find((x) => x.month === "2026-07")!;
    expect(m.nationalMdls).toBe(3);
  });

  it("ranks the leaders and lists incomplete windows apart", () => {
    const { ranked, notRecorded } = growthLeaders(model.rows);
    expect(ranked.map((r) => r.mdl)).toEqual(["3140", "3084"]);
    expect(notRecorded.map((r) => r.mdl)).toEqual(["2885", "3199"]);
  });

  it("computes the leaderboard KPIs from complete windows only", () => {
    const k = leaderboardKpis(model.rows);
    expect(k.fastQuarter).toBe(1);
    expect(k.plAdded12m).toBe(1212);
    expect(k.plAdded12mMdls).toBe(2);
    expect(k.plAdded12mExcluded).toBe(2);
    expect(k.plOutside).toBe(2);
    expect(k.plOutsidePending).toBe(70 + 224);
    expect(
      leaderboardKpis(buildVelocity([full], { portfolio: new Set(), registry: null }).rows)
        .plOutside,
    ).toBeNull();
  });
});

describe("shortCaption", () => {
  it("drops the JPML boilerplate", () => {
    expect(shortCaption("IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation")).toBe(
      "Depo-Provera (Depot Medroxyprogesterone Acetate)",
    );
    expect(shortCaption("IN RE: Uber Technologies, Inc., Passenger Sexual Assault Litigation")).toBe(
      "Uber Technologies, Inc., Passenger Sexual Assault",
    );
    expect(shortCaption(null)).toBeNull();
  });
});
