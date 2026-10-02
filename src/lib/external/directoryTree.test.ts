import { describe, expect, it } from "vitest";
import { countBy, judgeCourts, makeJudgeMatcher, NOT_RECORDED, surnameLetter, toCourtRow, toJudgeRow } from "./directoryTree";

describe("directory tree", () => {
  it("maps a court listing item using only supplied fields", () => {
    const r = toCourtRow({ id: "cand", title: "District Court, N.D. California", subtitle: "Federal district · N.D. Cal. · CourtListener id cand", cells: { system: "Federal", state: "CA" } });
    expect(r).toEqual({ id: "cand", title: "District Court, N.D. California", system: "Federal", type: "Federal district", state: "CA" });
    const blank = toCourtRow({ id: "x", cells: {} });
    expect([blank.system, blank.type, blank.state]).toEqual([NOT_RECORDED, NOT_RECORDED, NOT_RECORDED]);
  });
  it("counts a judge once per court and puts unrecorded last", () => {
    const js = [toJudgeRow({ id: "1", name: "A", courts: ["C1", "C2"] }), toJudgeRow({ id: "2", name: "B", courts: ["C1"] }), toJudgeRow({ id: "3", name: "C" })];
    expect(countBy(js, judgeCourts)).toEqual([{ key: "C1", count: 2 }, { key: "C2", count: 1 }, { key: NOT_RECORDED, count: 1 }]);
  });
  it("matches judge names exactly once, never guessing", () => {
    const js = [toJudgeRow({ id: "a", name: "Alice Beck Dubow" }), toJudgeRow({ id: "b", name: "John Smith" }), toJudgeRow({ id: "c", name: "John  Smith Jr." })];
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
