import { describe, expect, it } from "vitest";
import { chartContext } from "./chartContext";

const columns = [
  { key: "state", label: "State", value: (r: { state: string; n: number | null }) => r.state },
  { key: "n", label: "Cases", value: (r: { state: string; n: number | null }) => r.n },
];

describe("chartContext", () => {
  it("sends exactly the shown figures, with gaps as Not recorded", () => {
    const ctx = chartContext({
      title: "Cases by state",
      topic: "Litigation",
      columns,
      rows: [
        { state: "CA", n: 1200 },
        { state: "NY", n: null },
      ],
    });
    expect(ctx.figures.map((f) => [f.label, f.value])).toEqual([
      ["CA · Cases", "1,200"],
      ["NY · Cases", "Not recorded"],
    ]);
    expect(ctx.title).toBe("Cases by state");
  });
});
