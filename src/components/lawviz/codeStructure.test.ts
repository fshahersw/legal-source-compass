import { describe, expect, it } from "vitest";
import {
  icicleLayout,
  shortContainer,
  topLevelRows,
  topRowName,
  type OutlineInput,
} from "./codeStructure";

const node = (
  index: number,
  parent: number | null,
  depth: number,
  total: number,
  direct = 0,
  num: string | null = `CHAPTER ${index}—`,
  status: string | null = null,
): OutlineInput => ({ index, parent, depth, num, heading: `H${index}`, status, total, direct });

describe("icicleLayout", () => {
  it("sizes each container by its share of the title and nests children inside their parent", () => {
    const l = icicleLayout([
      node(0, null, 0, 100, 0, "TITLE 1—"),
      node(1, 0, 1, 75),
      node(2, 0, 1, 25),
      node(3, 1, 2, 50),
      node(4, 1, 2, 25),
    ]);
    const c = Object.fromEntries(l.cells.map((x) => [x.key, x]));
    expect(l.total).toBe(100);
    expect(c["c1"]).toMatchObject({ row: 0, x0: 0, x1: 0.75 });
    expect(c["c2"]).toMatchObject({ row: 0, x0: 0.75, x1: 1 });
    expect(c["c3"]!.row).toBe(1);
    expect(c["c3"]!.x0).toBeCloseTo(0);
    expect(c["c3"]!.x1).toBeCloseTo(0.5);
    expect(c["c4"]!.x1).toBeCloseTo(0.75);
    expect(l.rows).toBe(2);
    expect(c["c1"]!.leaf).toBe(false);
    expect(c["c2"]!.leaf).toBe(true);
    expect(c["c3"]!.leaf).toBe(true);
    expect(l.excess).toEqual([]);
    expect(l.unbroken).toBe(0);
  });

  it("gives sections printed directly in a broken-down container their own cell", () => {
    const l = icicleLayout([node(0, null, 0, 10, 2, "TITLE 1—"), node(1, 0, 1, 8)]);
    const direct = l.cells.find((x) => x.kind === "direct")!;
    expect(direct.total).toBe(2);
    expect(direct.x0).toBeCloseTo(0.8);
    expect(direct.x1).toBeCloseTo(1);
  });

  it("turns a shortfall into a 'Not broken down' cell instead of stretching the children", () => {
    const l = icicleLayout([node(0, null, 0, 10, 0, "TITLE 1—"), node(1, 0, 1, 6)]);
    const rest = l.cells.find((x) => x.kind === "unbroken")!;
    expect(rest.total).toBe(4);
    expect(l.cells.find((x) => x.key === "c1")!.x1).toBeCloseTo(0.6);
    expect(l.unbroken).toBe(4);
  });

  it("drops the child row of a container whose children add up to more than it", () => {
    const l = icicleLayout([
      node(0, null, 0, 10, 0, "TITLE 1—"),
      node(1, 0, 1, 10),
      node(2, 1, 2, 7),
      node(3, 1, 2, 7),
    ]);
    expect(l.cells.map((x) => x.key)).toEqual(["c1"]);
    expect(l.excess).toEqual([1]);
  });

  it("uses the top-level containers as the first row when no title node is recorded", () => {
    const l = icicleLayout([node(1, null, 0, 3), node(2, null, 0, 1)]);
    expect(l.total).toBe(4);
    expect(l.cells.map((x) => [x.key, x.x0, x.x1])).toEqual([
      ["c1", 0, 0.75],
      ["c2", 0.75, 1],
    ]);
  });

  it("stops at the row limit and skips empty containers", () => {
    const l = icicleLayout(
      [
        node(0, null, 0, 4, 0, "TITLE 1—"),
        node(1, 0, 1, 4),
        node(2, 1, 2, 4),
        node(3, 2, 3, 4),
        node(4, 0, 1, 0),
      ],
      2,
    );
    expect(l.cells.map((x) => x.key)).toEqual(["c1", "c2"]);
  });
});

describe("shortContainer", () => {
  it.each([
    ["CHAPTER 21—", "Ch. 21"],
    ["SUBCHAPTER II—", "Subch. II"],
    ["subpart i—", "Subpt. i"],
    ["PART A—", "Pt. A"],
    ["[CHAPTER 3—", "Ch. 3"],
    ["SCHEDULE A", "SCHEDULE A"],
    [null, ""],
  ])("%s → %s", (num, out) => expect(shortContainer(num)).toBe(out));
});

describe("topLevelRows", () => {
  it("lists the first row with each container's share of the title", () => {
    const l = icicleLayout([node(0, null, 0, 8, 2, "TITLE 1—"), node(1, 0, 1, 6)]);
    expect(topLevelRows(l).map((r) => [r.kind, r.total, r.share])).toEqual([
      ["container", 6, 75],
      ["direct", 2, 25],
    ]);
  });
});

describe("topRowName", () => {
  it("names the top row by its recorded kind only when every container shares it", () => {
    const outline = [
      { ...node(0, null, 0, 4, 0, "TITLE 1—"), kind: "title" },
      { ...node(1, 0, 1, 3), kind: "chapter" },
      { ...node(2, 0, 1, 1), kind: "chapter" },
    ];
    expect(topRowName(outline, icicleLayout(outline))).toBe("2 chapters");
    const mixed = [...outline.slice(0, 2), { ...node(2, 0, 1, 1), kind: "subtitle" }];
    expect(topRowName(mixed, icicleLayout(mixed))).toBe("2 top-level containers");
  });
});
