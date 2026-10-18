import { describe, expect, it } from "vitest";
import type { DistrictRow, JudgePoint } from "@/lib/external/judgeCross.functions";
import {
  circuitLabel,
  concentrationCurve,
  districtFlag,
  EMPTY_FILTER,
  filterJudges,
  judgeFlag,
  partySegments,
  sortJudges,
} from "./judgeCrossView";

const point = (over: Partial<JudgePoint>): JudgePoint => ({
  nid: "1",
  name: "A",
  courtId: "njd",
  state: "New Jersey",
  circuit: 3,
  status: "Active",
  party: "Democratic",
  president: null,
  years: 10,
  pendingMdls: 1,
  pendingActions: 100,
  historicalMdls: 0,
  historicalActions: 0,
  totalActions: 100,
  sharePct: 1,
  profileId: null,
  photo: null,
  rank: 1,
  plMdls: 1,
  topMdl: "IN RE: Talc",
  ...over,
});

describe("judge cross view", () => {
  const pts = [
    point({ nid: "1", name: "Ann", pendingActions: 300, sharePct: 6 }),
    point({
      nid: "2",
      name: "Bob",
      party: "Republican",
      status: "Senior",
      pendingActions: 100,
      circuit: 9,
    }),
    point({ nid: "3", name: "Cy", party: "None (reassignment)", pendingActions: 0, sharePct: 0 }),
  ];
  it("filters by party, status, circuit and search", () => {
    expect(filterJudges(pts, { ...EMPTY_FILTER, party: "Republican" }).map((p) => p.nid)).toEqual([
      "2",
    ]);
    expect(filterJudges(pts, { ...EMPTY_FILTER, party: "Other" }).map((p) => p.nid)).toEqual(["3"]);
    expect(filterJudges(pts, { ...EMPTY_FILTER, status: "Senior" }).map((p) => p.nid)).toEqual([
      "2",
    ]);
    expect(filterJudges(pts, { ...EMPTY_FILTER, status: "Active" }).map((p) => p.nid)).toEqual([
      "1",
      "3",
    ]);
    expect(filterJudges(pts, { ...EMPTY_FILTER, circuit: "9" }).map((p) => p.nid)).toEqual(["2"]);
    expect(filterJudges(pts, { ...EMPTY_FILTER, q: "talc" })).toHaveLength(3);
  });
  it("sorts and builds a cumulative concentration curve", () => {
    expect(sortJudges(pts, "pendingActions", true).map((p) => p.nid)).toEqual(["1", "2", "3"]);
    expect(sortJudges(pts, "name", false).map((p) => p.name)).toEqual(["Ann", "Bob", "Cy"]);
    expect(concentrationCurve(pts)).toEqual([
      { rank: 1, share: 75, name: "Ann" },
      { rank: 2, share: 100, name: "Bob" },
    ]);
  });
  it("applies the stated flag rules", () => {
    expect(judgeFlag(pts[0]!)).toBe(true);
    expect(judgeFlag(pts[1]!)).toBe(false);
    const d = { sharePct: 5 } as DistrictRow;
    expect(districtFlag(d)).toBe(true);
    expect(districtFlag({ ...d, sharePct: 4.99 })).toBe(false);
    expect(districtFlag({ ...d, sharePct: null })).toBe(false);
  });
  it("keeps unknown parties separate and labels circuits", () => {
    expect(partySegments({ Democratic: 2, Republican: 1, "None (assignment)": 1 })).toEqual({
      Democratic: 2,
      Republican: 1,
      Other: 1,
    });
    expect(circuitLabel(0)).toBe("D.C. Circuit");
    expect(circuitLabel(2)).toBe("2nd Circuit");
    expect(circuitLabel(11)).toBe("11th Circuit");
    expect(circuitLabel(null)).toBe("Not recorded");
  });
});
