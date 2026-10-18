import { describe, expect, it } from "vitest";
import { generateJudgeInsights, type JudgeInput, type JudgePointLite } from "./judge";

const point = (i: number, over: Partial<JudgePointLite> = {}): JudgePointLite => {
  const pending = i === 0 ? 1000 : i === 1 ? 500 : i < 10 ? 100 : 2;
  return {
    nid: `n${i}`,
    name: `Judge ${i}`,
    courtId: `c${i}`,
    party: i % 3 === 0 ? "Republican" : "Democratic",
    pendingMdls: i === 0 ? 3 : i < 3 ? 2 : 1,
    pendingActions: pending,
    historicalMdls: 1,
    totalActions: pending * 10,
    sharePct: null,
    profileId: i % 2 === 0 ? `profile${i}` : null,
    ...over,
  };
};

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    courtId: `c${i}`,
    name: `District ${i}`,
    pendingMdls: 1,
    pendingActions: i < 5 ? 400 : 10,
    judgeships: 4,
    sharePct: null,
  }));

function input(over: Partial<JudgeInput> = {}): JudgeInput {
  const points = Array.from({ length: 30 }, (_, i) => point(i));
  // 1000 + 500 + 8 x 100 + 20 x 2 = 2340; top ten = 2300 = 98.3%
  return {
    asOf: "2026-10-01",
    pendingMdls: 50,
    pendingActions: 2340,
    judges: 30,
    judgesWithPending: 30,
    judgesHistoryOnly: 0,
    judgesMultiPending: 3,
    top10SharePct: 98.3,
    medianYearsPendingJudges: 14.9,
    points,
    national: {
      asOf: "2026-10-01",
      districts: 91,
      sitting: 100,
      active: 60,
      senior: 40,
      partyActive: { Democratic: 35, Republican: 25 },
      tenure: { "30+ yrs": 20, "Under 5 yrs": 10, "5–10 yrs": 30, "10–15 yrs": 39 },
      medianYearsActive: 7.3,
      districtsWithPending: 49,
      // five districts at 400 = 2000 of 2340 = 85.5%
      top5DistrictSharePct: 85.5,
      pendingActions: 2340,
      circuits: Object.fromEntries(
        Array.from({ length: 12 }, (_, k) => [
          String(k),
          { active: 5, senior: 3, pendingMdls: 2, pendingActions: k === 3 ? 1000 : 100 },
        ]),
      ),
      rows: [...rows(60)].map((r, i) =>
        i < 5 ? r : { ...r, pendingActions: Math.round(340 / 55) },
      ),
    },
    ...over,
  };
}

const byId = (d: JudgeInput) => Object.fromEntries(generateJudgeInsights(d).map((i) => [i.id, i]));

describe("generateJudgeInsights", () => {
  it("states the share held by the ten busiest judges and checks it against the rows", () => {
    const i = byId(input())["judge.pending-concentration"]!;
    expect(i.headline).toBe("Ten judges oversee 98% of the 2,340 actions pending in federal MDLs");
    expect(i.summary[2]).toContain("Judge 0 alone has 1,000 (42.7%) across 3 MDLs");
    expect(i.points[0]).toMatchObject({
      label: "Most pending actions: Judge 0",
      value: "1,000",
      href: "/judges/profile0",
    });
    // published share that disagrees with the rows is not shown
    expect(byId(input({ top10SharePct: 60 }))["judge.pending-concentration"]).toBeUndefined();
  });

  it("links a judge only when the stored row carries a profile id", () => {
    const i = byId(input())["judge.multi-mdl-judges"]!;
    const hrefs = i.points.map((p) => p.href);
    expect(hrefs[0]).toBe("/judges/profile0");
    expect(hrefs[1]).toBeUndefined(); // Judge 1 has no profileId
  });

  it("lists judges with several pending MDLs and requires the published count to match", () => {
    const i = byId(input())["judge.multi-mdl-judges"]!;
    expect(i.headline).toBe("3 judges oversee two or more pending MDLs; Judge 0 has 3");
    expect(byId(input({ judgesMultiPending: 18 }))["judge.multi-mdl-judges"]).toBeUndefined();
  });

  it("summarizes district and circuit concentration", () => {
    const ids = byId(input());
    expect(ids["judge.district-concentration"]!.headline).toBe(
      "Five districts host 86% of pending MDL actions; District 0 alone hosts 17%",
    );
    expect(ids["judge.circuit-load"]!.headline).toBe(
      "The 3rd Circuit holds 43% of pending MDL actions",
    );
    expect(ids["judge.circuit-load"]!.summary[0]).toContain("1,000 across 2 MDLs");
  });

  it("describes tenure and appointing party without implying anything about rulings", () => {
    const ids = byId(input());
    expect(ids["judge.bench-tenure"]!.headline).toBe(
      "Of 100 sitting federal district judges, 20% have served 30 years or more",
    );
    expect(ids["judge.bench-tenure"]!.caveat).toContain(
      "99 judges with a recorded commission date",
    );
    const party = ids["judge.appointing-party"]!;
    expect(party.headline).toBe(
      "35 active district judges were appointed by Democratic presidents and 25 by Republican presidents",
    );
    expect(party.summary.join(" ")).toContain("It says nothing about how a judge rules.");
  });

  it("drops bench candidates when the active and senior counts do not add up to the sitting total", () => {
    const bad = input();
    bad.national!.senior = 10;
    const ids = byId(bad);
    expect(ids["judge.bench-tenure"]).toBeUndefined();
  });

  it("ranks MDL experience and notes judges known only through ended MDLs", () => {
    const i = byId(input({ judgesHistoryOnly: 5, judges: 35 }))["judge.mdl-experience"]!;
    expect(i.headline).toContain(
      "Judge 0 has handled the most MDL actions of any judge in the dataset (10,000)",
    );
    expect(i.summary[2]).toContain("5 of them only through MDLs that have ended");
  });

  it("works with no national summary: only the profile-based candidates remain", () => {
    const ids = Object.keys(byId(input({ national: null })));
    expect(ids.sort()).toEqual(
      ["judge.mdl-experience", "judge.multi-mdl-judges", "judge.pending-concentration"].sort(),
    );
  });

  it("returns nothing for an empty dataset", () => {
    expect(
      generateJudgeInsights(
        input({
          points: [],
          national: null,
          judges: 0,
          judgesWithPending: 0,
          judgesHistoryOnly: 0,
        }),
      ),
    ).toEqual([]);
  });

  it("history-only candidate only appears when there is history to report", () => {
    expect(byId(input())["judge.history-only-judges"]).toBeUndefined();
    const i = byId(input({ judgesHistoryOnly: 279, judges: 420, judgesWithPending: 141 }))[
      "judge.history-only-judges"
    ]!;
    expect(i.headline).toBe("Only 141 of 420 judges with MDL experience have a pending MDL today");
  });
});
