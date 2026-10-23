import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) =>
    createElement("a", { href: to, ...rest }, children),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/components/analytics/hub/blockQuery", () => ({ analyticsBlockQuery: vi.fn() }));
vi.mock("@/lib/trends/profile.functions", () => ({ getProfileTrend: vi.fn() }));

import { buildMdlFyPending } from "@/lib/trends/mdl";
import { profileDef } from "@/lib/trends/profile";
import { StaticTrend, TrendGrid } from "./ProfileTrend";
import { staticDef } from "./trendDefs";

const def = profileDef("mdl-fy-pending", "2873");
const block = buildMdlFyPending({
  mdl: 2873,
  rows: [
    { fy: 2021, pending: 1681 },
    { fy: 2022, pending: 3037 },
    { fy: 2024, pending: 9896 },
    { fy: 2025, pending: 13942 },
  ],
  leftCensored: false,
});

const html = (node: ReactNode) => renderToStaticMarkup(node as never);

describe("StaticTrend", () => {
  it("draws the hub card: what is counted, the latest value, the source, the period and how to read it", () => {
    const out = html(createElement(StaticTrend, { def, block, emptyReason: "none" }));
    expect(out).toContain("Actions pending in MDL 2873 at the end of each fiscal year");
    expect(out).toContain("13,942");
    expect(out).toContain(
      "Judicial Panel on Multidistrict Litigation, Statistical Analysis of MDL",
    );
    expect(out).toContain('href="https://www.jpml.uscourts.gov/statistics-info"');
    expect(out).toContain("FY2021–FY2025");
    expect(out).toContain("How to read this");
    expect(out).toContain("Show data");
    expect(out).toContain("1 period not recorded, left as gaps (not zero)");
  });

  it("shows the reason, not an empty chart, when there is nothing to plot", () => {
    const out = html(
      createElement(StaticTrend, { def, block: null, emptyReason: "The statistics hold no row." }),
    );
    expect(out).toContain("The statistics hold no row.");
    expect(out).toContain('href="/matters/analytics"');
    expect(out).not.toContain("Show data");
  });
});

describe("TrendGrid and staticDef", () => {
  it("lays cards out one column on a phone, two at tablet width and three on a wide screen", () => {
    const out = html(createElement(TrendGrid, null, createElement("i")));
    expect(out).toContain("sm:grid-cols-2");
    expect(out).toContain("xl:grid-cols-3");
    expect(
      html(createElement(TrendGrid, { columns: 2, children: createElement("i") })),
    ).not.toContain("xl:grid-cols-3");
  });

  it("builds a card identity that carries only what the card shows", () => {
    expect(
      staticDef({
        id: "x",
        title: "T",
        measure: "m",
        detail: { to: "/a", label: "A" },
      }),
    ).toEqual({
      group: "courts",
      id: "x",
      title: "T",
      measure: "m",
      detail: { to: "/a", label: "A" },
    });
  });
});
