import { describe, expect, it } from "vitest";
import { MAX_TABS, splitTabs } from "./tabs";

const tabs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("splitTabs", () => {
  it("shows every tab up to the limit of seven", () => {
    expect(MAX_TABS).toBe(7);
    const { visible, overflow } = splitTabs(tabs(7), "t7");
    expect(ids(visible)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(overflow).toEqual([]);
  });

  it("keeps six tabs and moves the rest into the menu when there are more than seven", () => {
    const { visible, overflow } = splitTabs(tabs(9), "t2");
    expect(ids(visible)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(ids(overflow)).toEqual(["t7", "t8", "t9"]);
    expect(visible.length + 1).toBeLessThanOrEqual(MAX_TABS);
  });

  it("keeps the active tab visible, displacing the last visible one into the menu in order", () => {
    const { visible, overflow } = splitTabs(tabs(9), "t8");
    expect(ids(visible)).toEqual(["t1", "t2", "t3", "t4", "t5", "t8"]);
    expect(ids(overflow)).toEqual(["t6", "t7", "t9"]);
  });

  it("treats an unknown or missing active id as the first tabs", () => {
    expect(ids(splitTabs(tabs(8), "nope").visible)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(ids(splitTabs(tabs(8)).overflow)).toEqual(["t7", "t8"]);
  });

  it("never loses or duplicates a tab", () => {
    for (let n = 1; n <= 12; n++)
      for (let a = 0; a <= n; a++) {
        const { visible, overflow } = splitTabs(tabs(n), `t${a}`);
        expect([...ids(visible), ...ids(overflow)].sort()).toEqual(ids(tabs(n)).sort());
        if (a >= 1) expect(ids(visible)).toContain(`t${a}`);
      }
  });

  it("honours a smaller limit and clamps a nonsensical one", () => {
    expect(ids(splitTabs(tabs(5), "t5", 3).visible)).toEqual(["t1", "t5"]);
    expect(ids(splitTabs(tabs(5), null, 0).visible)).toEqual(["t1"]);
    expect(ids(splitTabs(tabs(3), null, Number.NaN).visible)).toEqual(["t1", "t2", "t3"]);
  });
});
