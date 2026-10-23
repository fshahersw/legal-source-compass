import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { linearScale } from "./scale";
import { Swimlanes, laneMarks } from "./Swimlanes";

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const domain: [number, number] = [ms("2017-01-01"), ms("2026-12-31")];
const x = linearScale(domain, [100, 900]);

describe("laneMarks", () => {
  it("merges same-day events and counts those outside the axis", () => {
    const r = laneMarks(
      {
        events: [
          { id: "a", date: "2020-05-05", label: "A" },
          { id: "b", date: "2020-05-05", label: "B" },
          { id: "c", date: "2023-01-01", label: "C" },
          { id: "old", date: "1938-06-25", label: "FDCA" },
          { id: "bad", date: "not a date", label: "?" },
        ],
      },
      x,
      domain,
    );
    expect(r.before).toBe(1);
    expect(r.after).toBe(0);
    expect(r.marks.map((m) => [m.key, m.n])).toEqual([
      ["2020-05-05", 2],
      ["2023-01-01", 1],
    ]);
    expect(r.marks[0]!.x).toBeLessThan(r.marks[1]!.x);
  });

  it("draws a crowded dot lane by month, summing event weights", () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      date: `2020-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + (i % 20)).padStart(2, "0")}`,
      label: "x",
      weight: 2,
    }));
    const r = laneMarks({ events }, x, domain);
    expect(r.marks.every((m) => m.month && m.dense)).toBe(true);
    expect(r.marks.map((m) => [m.key, m.n])).toEqual([
      ["2020-01", 40],
      ["2020-02", 40],
      ["2020-03", 40],
    ]);
  });

  it("places monthly bars over their month and counts bars outside the axis", () => {
    const r = laneMarks(
      {
        bars: [
          { month: "2016-12", n: 4 },
          { month: "2020-02", n: 9 },
          { month: "2027-03", n: 1 },
        ],
      },
      x,
      domain,
    );
    expect(r.before).toBe(4);
    expect(r.after).toBe(1);
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0]!.month).toBe(true);
    expect(r.marks[0]!.x1).toBeGreaterThan(r.marks[0]!.x);
  });
});

describe("Swimlanes render", () => {
  it("draws group bands, lanes, an empty-lane note and year ticks without raw colours", () => {
    const html = renderToStaticMarkup(
      createElement(Swimlanes, {
        groups: [
          { id: "law", label: "Authorizing statutes", slot: 0 },
          { id: "fr", label: "Federal Register", slot: 1 },
        ],
        lanes: [
          {
            id: "s1",
            group: "law",
            label: "21 U.S.C. 371",
            events: [{ id: "l", date: "2018-04-01", label: "Pub. L. 115-1" }],
          },
          { id: "f1", group: "fr", label: "Rules", bars: [{ month: "2019-01", n: 3 }] },
          { id: "f2", group: "fr", label: "Notices", events: [], emptyText: "No notices" },
        ],
        domain: ["2017-01-01", "2026-12-31"],
        ariaLabel: "Lineage.",
        width: 900,
      }),
    );
    expect(html).toContain("Authorizing statutes");
    expect(html).toContain("No notices");
    expect(html).toContain(">2020<");
    expect(html).toContain("var(--chart-1)");
    expect(html).toContain("var(--chart-2)");
    expect(html.slice(html.indexOf("<svg"))).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
