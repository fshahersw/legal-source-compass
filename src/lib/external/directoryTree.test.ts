import { describe, expect, it } from "vitest";
import {
  countBy,
  filterJudgeProfiles,
  judgeCourts,
  judgeProfileInventory,
  judgeStates,
  judgeSystems,
  makeJudgeMatcher,
  NOT_RECORDED,
  surnameLetter,
  toCourtRow,
  toJudgeRow,
} from "./directoryTree";

describe("directory tree", () => {
  it("places an explicitly multi-state profile under both recorded states without inventing a combined state", () => {
    const source = {
      id: "5e81c60a1c3f6cbb30f0bae55f12e548",
      state: "Virginia; West Virginia",
      states: ["Virginia", "West Virginia"],
      system: "Federal",
      systems: ["federal"],
      courts: [
        "U.S. District Court for the Western District of Virginia",
        "U.S. District Court for the Northern District of West Virginia",
      ],
    };
    const row = toJudgeRow(source);
    expect(row.state).toBe(source.state);
    expect(judgeStates(row)).toEqual(["Virginia", "West Virginia"]);
    expect(countBy([row], judgeStates)).toEqual([
      { key: "Virginia", count: 1 },
      { key: "West Virginia", count: 1 },
    ]);
    expect(
      filterJudgeProfiles([row], { system: "Federal", state: "West Virginia", court: "*" }),
    ).toEqual([row]);
    expect(filterJudgeProfiles([row], { state: source.state })).toEqual([]);
    expect(source.states).toEqual(["Virginia", "West Virginia"]);
  });
  it("uses recorded arrays for association filters and never derives geography from court names", () => {
    const empty = toJudgeRow({
      id: "x",
      states: [],
      state: "Old scalar",
      courts: ["A court in California"],
      systems: [],
    });
    expect(judgeStates(empty)).toEqual([NOT_RECORDED]);
    expect(judgeSystems(empty)).toEqual([NOT_RECORDED]);
    expect(filterJudgeProfiles([empty], { state: "California" })).toEqual([]);
    const legacy = toJudgeRow({ id: "legacy", state: "Virginia; West Virginia" });
    expect(judgeStates(legacy)).toEqual(["Virginia; West Virginia"]);
  });
  it("counts profile layers as records even when names repeat, without merging source profiles", () => {
    const rows = [
      toJudgeRow({ id: "entity", name: "John Smith", profile_layer: "consolidated_entity" }),
      toJudgeRow({ id: "source", name: "John Smith", profile_layer: "official_source" }),
      toJudgeRow({ id: "unknown", name: "Jane Smith" }),
    ];
    expect(judgeProfileInventory(rows)).toEqual({
      records: 3,
      consolidatedProfiles: 1,
      officialSourceProfiles: 1,
      otherProfiles: 1,
    });
    expect(makeJudgeMatcher(rows)("John Smith")).toBeNull();
  });
  it("maps a court listing item using only supplied fields", () => {
    const r = toCourtRow({
      id: "cand",
      title: "District Court, N.D. California",
      subtitle: "Federal district · N.D. Cal. · CourtListener id cand",
      cells: { system: "Federal", state: "CA" },
    });
    expect(r).toEqual({
      id: "cand",
      title: "District Court, N.D. California",
      system: "Federal",
      type: "Federal district",
      state: "CA",
    });
    const blank = toCourtRow({ id: "x", cells: {} });
    expect([blank.system, blank.type, blank.state]).toEqual([
      NOT_RECORDED,
      NOT_RECORDED,
      NOT_RECORDED,
    ]);
  });
  it("counts a judge once per court and puts unrecorded last", () => {
    const js = [
      toJudgeRow({ id: "1", name: "A", courts: ["C1", "C2"] }),
      toJudgeRow({ id: "2", name: "B", courts: ["C1"] }),
      toJudgeRow({ id: "3", name: "C" }),
    ];
    expect(countBy(js, judgeCourts)).toEqual([
      { key: "C1", count: 2 },
      { key: "C2", count: 1 },
      { key: NOT_RECORDED, count: 1 },
    ]);
  });
  it("matches judge names exactly once, never guessing", () => {
    const js = [
      toJudgeRow({ id: "a", name: "Alice Beck Dubow" }),
      toJudgeRow({ id: "b", name: "John Smith" }),
      toJudgeRow({ id: "c", name: "John  Smith Jr." }),
    ];
    const m = makeJudgeMatcher(js);
    expect(m("alice beck dubow")).toBe("a");
    expect(m("John Smith")).toBe("b");
    expect(m("John Smith Jr.")).toBe("c");
    expect(m("Alice Dubow")).toBeNull();
    expect(surnameLetter("Alice Beck Dubow")).toBe("D");
  });
  it("does not route a shortened initial, missing suffix or removed accent to another person", () => {
    const match = makeJudgeMatcher([
      toJudgeRow({ id: "a", name: "María A. Peña Jr." }),
      toJudgeRow({ id: "b", name: "María A. Peña III" }),
      toJudgeRow({ id: "c", name: "John Smith" }),
      toJudgeRow({ id: "d", name: "John Smith" }),
    ]);
    expect(match("María A Peña Jr")).toBe("a");
    expect(match("María A Peña")).toBeNull();
    expect(match("Maria A Peña Jr")).toBeNull();
    expect(match("María Peña Jr")).toBeNull();
    expect(match("John Smith")).toBeNull();
  });
});
