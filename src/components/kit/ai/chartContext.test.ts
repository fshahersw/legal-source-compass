import { describe, expect, it } from "vitest";
import { chartContext } from "./chartContext";

const columns = [
  { key: "state", label: "State", value: (r: { state: string; n: number | null }) => r.state },
  { key: "n", label: "Cases", value: (r: { state: string; n: number | null }) => r.n },
];

describe("chartContext", () => {
  it("retains measure, selected scope and explicit column units", () => {
    const ctx = chartContext({ title: "District clearance", topic: "Courts", filters: "Texas · complete fiscal years", measure: "Terminations / filings × 100", period: "FY2025", source: "Publisher A; Publisher B", columns: [{key:"district",label:"District",value:()=>"Northern"},{key:"rate",label:"Clearance",unit:"%",value:()=>120}], rows:[{}] });
    expect(ctx.scope).toBe("Courts · Texas · complete fiscal years");
    expect(ctx.period).toBe("FY2025");
    expect(ctx.source).toBe("Publisher A; Publisher B");
    expect(ctx.figures[0]).toMatchObject({value:"120",unit:"%",note:"Terminations / filings × 100"});
  });
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
