import { describe, expect, it } from "vitest";
import { courtTiers } from "./courtTiers";

const r = (type: string, system = "State", state = "CA") => ({ id: type + Math.random(), title: type, system, type, state });

describe("courtTiers", () => {
  it("counts each state tier only from recorded types and keeps unknown types apart", () => {
    const rows = [r("State supreme"), r("State appellate"), r("State trial"), r("State trial"), r("State attorney general"), r("State trial", "State", "NY")];
    const t = courtTiers(rows, "State", "CA");
    expect(t.main.map((x) => x.count)).toEqual([1, 1, 2]);
    expect(t.other).toBe(1);
    expect(t.total).toBe(5);
  });
  it("shows a missing tier as 0, not a guess", () => {
    const t = courtTiers([r("State trial")], "State", "CA");
    expect(t.main[0]!.count).toBe(0);
  });
});
