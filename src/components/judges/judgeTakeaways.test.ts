import { describe, expect, it } from "vitest";
import type { DistrictRow, JudgePoint } from "@/lib/external/judgeCross.functions";
import { busiestDistrict, busiestJudge, judgeTakeaways } from "./judgeTakeaways";

const judge = (
  name: string,
  pendingActions: number,
  extra: Partial<JudgePoint> = {},
): JudgePoint => ({
  nid: name,
  name,
  courtId: "njd",
  state: "NJ",
  circuit: 3,
  status: "Active",
  party: "Democratic",
  president: null,
  years: 10,
  pendingMdls: pendingActions ? 2 : 0,
  pendingActions,
  historicalMdls: 0,
  historicalActions: 0,
  totalActions: pendingActions,
  sharePct: null,
  profileId: null,
  photo: null,
  rank: null,
  plMdls: 0,
  topMdl: null,
  ...extra,
});
const district = (name: string, sharePct: number | null, pendingActions: number): DistrictRow =>
  ({ courtId: name, name, circuit: 3, sharePct, pendingActions }) as DistrictRow;

const profiles = {
  pendingMdls: 150,
  pendingActions: 1000,
  judgesWithPending: 40,
  top10SharePct: 80.5,
  hhiByJudge: 1474,
  medianYearsPendingJudges: 14.9,
};

describe("judgeTakeaways", () => {
  it("picks the busiest judge and district deterministically", () => {
    expect(busiestJudge([judge("B", 5), judge("A", 5), judge("C", 0)])?.name).toBe("A");
    expect(busiestJudge([judge("C", 0)])).toBeNull();
    expect(
      busiestDistrict([district("X", 10, 1), district("Y", 40, 4), district("Z", null, 9)])?.name,
    ).toBe("Y");
    expect(busiestDistrict([district("Z", null, 9)])).toBeNull();
  });

  it("builds figures only from the supplied rows", () => {
    const items = judgeTakeaways({
      profiles,
      points: [judge("Ann Judge", 300), judge("Bo Judge", 100)],
      national: {
        rows: [district("D. New Jersey", 41.4, 414)],
        medianYearsActive: 7.3,
        top5DistrictSharePct: 72.8,
        hhiByDistrict: 2053,
      },
      disclosure: { exact: 0, near: 0, lines: 10690, checked: 47, targeted: 57 },
    });
    expect(items.map((i) => i.id)).toEqual([
      "concentration",
      "busiest-judge",
      "hub-district",
      "experience",
      "disclosure-matches",
    ]);
    expect(items[0]!.figure).toBe("80.5%");
    // 300 of 1,000 pending actions, computed because the judge row carries no recorded share.
    expect(items[1]!.figure).toBe("30.0%");
    expect(items[1]!.text).toContain("NJD");
    expect(items[2]!.text).toContain("72.8%");
    expect(items[3]!.figure).toBe("14.9 yrs");
    expect(items[4]!.figure).toBe("0 / 0");
    expect(items.every((i) => i.anchor)).toBe(true);
  });

  it("drops what it cannot compute and shows nothing when fewer than two remain", () => {
    expect(
      judgeTakeaways({
        profiles: { ...profiles, top10SharePct: null, medianYearsPendingJudges: null },
        points: [],
        national: null,
        disclosure: null,
      }),
    ).toEqual([]);
    const some = judgeTakeaways({
      profiles: { ...profiles, medianYearsPendingJudges: null },
      points: [judge("Ann Judge", 300, { sharePct: 29.6 })],
      national: null,
      disclosure: null,
    });
    expect(some.map((i) => i.id)).toEqual(["concentration", "busiest-judge"]);
    expect(some[1]!.figure).toBe("29.6%");
  });
});
