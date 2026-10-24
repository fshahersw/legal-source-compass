import { describe, expect, it } from "vitest";
import type { NosRow } from "@/lib/external/courtCaseload.functions";
import { OTHER_GROUPS, caseTree } from "./caseTree";

const base = {
  terminations: null,
  medianDays: null,
  settledPct: null,
  trialPct: null,
  proSePct: null,
  classActionPct: null,
};
const group = (key: string, filings: number | null): NosRow => ({
  ...base,
  id: `group:${key}`,
  kind: "group",
  code: null,
  groupKey: key,
  name: key.toUpperCase(),
  filings,
});
const nos = (code: number, key: string, filings: number | null): NosRow => ({
  ...base,
  id: `nos:${code}`,
  kind: "nos",
  code,
  groupKey: key,
  name: `Code ${code}`,
  filings,
});

describe("caseTree", () => {
  it("keeps the largest groups and folds the rest under one remainder", () => {
    const t = caseTree(
      [group("a", 50), group("b", 30), group("c", 15), group("d", 5), nos(1, "a", 50)],
      { top: 2 },
    )!;
    expect(t.total).toBe(100);
    expect(t.groups.map((g) => g.key)).toEqual(["a", "b", OTHER_GROUPS]);
    expect(t.groups.at(-1)!.filings).toBe(20);
    expect(t.groups.map((g) => g.slot)).toEqual([0, 1, 5]);
  });

  it("adds a 'Not broken down' slice when codes fall short of the group", () => {
    const t = caseTree([group("a", 50), group("b", 30), nos(1, "a", 40)], { top: 2 })!;
    const a = t.root.children![0]!;
    expect(a.children!.map((c) => [c.name, c.value])).toEqual([
      ["Code 1", 40],
      ["Not broken down", 10],
    ]);
  });

  it("drops the code ring when codes exceed the group, never overstating it", () => {
    const t = caseTree([group("a", 50), group("b", 30), nos(1, "a", 70)], { top: 2 })!;
    expect(t.root.children![0]).toMatchObject({ name: "A", value: 50 });
    expect(t.root.children![0]!.children).toBeUndefined();
  });

  it("leaves out groups and codes with no recorded filings", () => {
    const t = caseTree(
      [group("a", 50), group("b", 30), group("unmapped", null), nos(1, "a", null)],
      { top: 5 },
    )!;
    expect(t.groups.map((g) => g.key)).toEqual(["a", "b"]);
    expect(t.total).toBe(80);
    expect(t.groups[0]!.codes).toEqual([]);
  });
});
