import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icicle, fitLabel, icicleLayout, type IcicleDatum } from "./Icicle";

const leaf = (id: string, value: number, fill: string | null = "var(--chart-1)"): IcicleDatum => ({
  id,
  label: id,
  value,
  fill,
});

const root: IcicleDatum = {
  id: "root",
  label: "Root",
  value: 10,
  fill: "var(--chart-1)",
  children: [
    { ...leaf("a", 6), children: [leaf("a1", 2), leaf("a2", 4)] },
    { ...leaf("b", 4), placeholder: "Open to see 12 parts" },
    leaf("zero", 0),
  ],
};

describe("icicleLayout", () => {
  it("partitions children and grandchildren proportionally, skipping zero values", () => {
    const { cells, placeholders, columns } = icicleLayout(root, 1000, 400);
    expect(columns).toBe(3);
    const by = Object.fromEntries(cells.map((c) => [c.d.id, c]));
    expect(by["zero"]).toBeUndefined();
    expect(by["a"]!.y0).toBe(0);
    expect(by["a"]!.y1).toBeCloseTo(240);
    expect(by["b"]!.y1).toBeCloseTo(400);
    expect(by["a1"]!.y1 - by["a1"]!.y0).toBeCloseTo(80);
    expect(by["a2"]!.y1).toBeCloseTo(240);
    expect(by["a1"]!.x0).toBeGreaterThan(by["a"]!.x1);
    expect(by["a"]!.x0).toBeGreaterThan(by["root"]!.x1);
    expect(placeholders).toEqual([
      expect.objectContaining({ text: "Open to see 12 parts", y0: by["b"]!.y0, y1: by["b"]!.y1 }),
    ]);
    expect(by["a1"]!.parent).toBe(cells.indexOf(by["a"]!));
  });

  it("uses two columns when nothing below the children is loaded or announced", () => {
    const flat = icicleLayout({ ...root, children: [leaf("x", 1), leaf("y", 3)] }, 500, 100);
    expect(flat.columns).toBe(2);
    expect(flat.cells.at(-1)!.x1).toBeLessThanOrEqual(500);
  });

  it("fits labels to the space and drops them when there is none", () => {
    expect(fitLabel("Chapter 7", 200, 10)).toBe("Chapter 7");
    expect(fitLabel("The Public Health and Welfare", 60, 10)).toMatch(/…$/);
    expect(fitLabel("Anything", 8, 10)).toBeNull();
  });
});

describe("Icicle render", () => {
  it("draws hatched cells for unrecorded colour and keeps labels in ink tokens", () => {
    const html = renderToStaticMarkup(
      createElement(Icicle, {
        root: { ...root, children: [leaf("known", 3), leaf("unknown", 3, null)] },
        width: 600,
        height: 200,
        ariaLabel: "Test icicle.",
        describe: (d) => d.label,
        tooltip: (d) => ({ title: d.label, rows: [] }),
        onSelect: () => {},
      }),
    );
    expect(html).toContain('aria-roledescription="partition chart"');
    expect(html).toMatch(/fill="url\(#[A-Za-z0-9]+\)"/);
    expect(html).toContain("var(--chart-ink)");
    expect(html.slice(html.indexOf("<svg"))).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
