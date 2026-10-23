import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
  }) =>
    createElement(
      "a",
      { href: search ? `${to}?${new URLSearchParams(search).toString()}` : to, ...rest },
      children,
    ),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("./blockQuery", () => ({ analyticsBlockQuery: vi.fn() }));

import { BLOCKS, blockDef } from "@/lib/analytics/registry";
import { assembleBlock } from "@/lib/analytics/trend";
import { TrendCardView, type CardState } from "./TrendCard";

const def = blockDef("federal-civil")!;
const block = assembleBlock({
  id: "federal-civil",
  xKind: "fy",
  unit: "cases",
  series: [
    {
      id: "filed",
      label: "Filed",
      points: [
        { x: "2024", value: 291016 },
        { x: "2025", value: 303716 },
        { x: "2026", value: 276610, partial: true },
      ],
    },
    {
      id: "terminated",
      label: "Terminated",
      points: [
        { x: "2024", value: null },
        { x: "2025", value: 407539 },
        { x: "2026", value: 229735, partial: true },
      ],
    },
  ],
  source: { label: "Federal Judicial Center, Integrated Database", url: "https://www.fjc.gov/idb" },
  asOf: "2026-06-30",
  notes: ["Fiscal years run October 1 to September 30."],
});

const html = (state: CardState, d = def) =>
  renderToStaticMarkup(createElement(TrendCardView, { def: d, state }));

describe("TrendCardView", () => {
  it("loading: keeps the title, announces itself busy and shows no numbers", () => {
    const out = html({ kind: "loading" });
    expect(out).toContain("Federal civil cases filed and terminated");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading civil cases");
    expect(out).not.toMatch(/\d{3},\d{3}/);
  });

  it("error: says this block failed, offers retry and still links to the detail page", () => {
    const out = html({ kind: "error", onRetry: () => {} });
    expect(out).toContain('role="alert"');
    expect(out).toContain("could not be read");
    expect(out).toContain("Retry");
    expect(out).toContain('href="/courts/caseload"');
    expect(out).not.toContain("aria-busy");
  });

  it("empty: gives the reason and the detail link", () => {
    const out = html({ kind: "empty", reason: "The published data for this block is empty." });
    expect(out).toContain('role="status"');
    expect(out).toContain("The published data for this block is empty.");
    expect(out).toContain('href="/courts/caseload"');
  });

  it("loaded: title, unit and period, latest complete value with its change, source and detail link", () => {
    const out = html({ kind: "ok", block });
    expect(out).toContain("Federal civil cases filed and terminated");
    expect(out).toContain("Cases · FY2024–FY2026*");
    expect(out).toContain("Filed, FY2025");
    expect(out).toContain("303,716");
    expect(out).toContain("+12,700 (+4.4%) vs FY2024");
    expect(out).toContain('href="https://www.fjc.gov/idb"');
    expect(out).toContain('rel="noreferrer"');
    expect(out).toContain("Federal Judicial Center, Integrated Database");
    expect(out).toContain("data through June 30, 2026");
    expect(out).toContain('href="/courts/caseload"');
    expect(out).toContain("Federal civil caseload");
    expect(out).toContain("How to read this");
    expect(out).toContain("Fiscal years run October 1 to September 30.");
  });

  it("loaded: never shows the partial period as the latest value and explains the asterisk and the gap", () => {
    const out = html({ kind: "ok", block });
    expect(out).not.toContain("276,610 cases");
    expect(out).toContain("* Partial period");
    expect(out).toContain("1 period not recorded, left as gaps (not zero).");
  });

  it("loaded: the data table is collapsed until asked for, with a labelled toggle", () => {
    const out = html({ kind: "ok", block });
    expect(out).toContain("Show data");
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("hidden");
    expect(out).not.toContain("<table");
  });

  it("loaded: a block with no complete period says so instead of inventing a latest value", () => {
    const partialOnly = assembleBlock({
      id: "federal-civil",
      xKind: "fy",
      unit: "cases",
      series: [{ id: "filed", label: "Filed", points: [{ x: "2026", value: 5, partial: true }] }],
      source: { label: "S", url: "https://www.fjc.gov/idb" },
    });
    const out = html({ kind: "ok", block: partialOnly });
    expect(out).toContain("No complete period is recorded");
  });

  it("loaded: a missing change is explained, never blank", () => {
    const first = assembleBlock({
      id: "federal-civil",
      xKind: "year",
      unit: "cases",
      series: [{ id: "filed", label: "Filed", points: [{ x: "2025", value: 5 }] }],
      source: { label: "S", url: "https://www.fjc.gov/idb" },
    });
    expect(html({ kind: "ok", block: first })).toContain("No earlier period to compare with.");
  });

  it("links the detail pages with their search, such as the enforcement tab", () => {
    const osha = blockDef("osha-inspections")!;
    expect(html({ kind: "empty", reason: "none" }, osha)).toContain(
      'href="/law/enforcement?tab=osha"',
    );
  });

  it("every registered block renders in every state without throwing", () => {
    for (const d of BLOCKS)
      for (const state of [
        { kind: "loading" },
        { kind: "error", onRetry: () => {} },
        { kind: "empty", reason: "none" },
        { kind: "ok", block },
      ] as CardState[])
        expect(() => html(state, d)).not.toThrow();
  });
});
