import { describe, expect, it } from "vitest";
import { changeSeries } from "./trendsModel";

const axis = {
  keys: ["2019", "2020", "2021", "2022"],
  label: (k: string) => k,
  tick: (k: string) => k,
};

describe("changeSeries", () => {
  it("lines series up on the axis, leaves gaps null and starts where every series has a value", () => {
    const r = changeSeries(
      [
        {
          id: "a",
          label: "A",
          points: [
            { key: "2020", value: 10 },
            { key: "2021", value: 12 },
            { key: "2022", value: 15 },
          ],
        },
        {
          id: "b",
          label: "B",
          points: [
            { key: "2019", value: 5 },
            { key: "2020", value: 6 },
            { key: "2022", value: 9 },
          ],
        },
      ],
      axis,
    )!;
    expect(r.series[0]!.points.map((p) => p.value)).toEqual([null, 10, 12, 15]);
    expect(r.series[1]!.points.map((p) => p.value)).toEqual([5, 6, null, 9]);
    expect(r.commonStart).toBe(1);
  });

  it("leaves out partial periods so a part-year never reads as a fall", () => {
    const r = changeSeries(
      [
        {
          id: "a",
          label: "A",
          points: [
            { key: "2019", value: 1 },
            { key: "2020", value: 2 },
            { key: "2021", value: 3 },
            { key: "2022", value: 1, partial: true },
          ],
        },
      ],
      axis,
    )!;
    expect(r.series[0]!.points.map((p) => p.date)).toEqual(["2019", "2020", "2021"]);
    expect(r.partialDropped).toEqual(["2022"]);
  });

  it("returns nothing when fewer than three complete periods remain", () => {
    expect(
      changeSeries([{ id: "a", label: "A", points: [{ key: "2021", value: 1 }] }], {
        ...axis,
        keys: ["2021", "2022"],
      }),
    ).toBeNull();
  });
});
