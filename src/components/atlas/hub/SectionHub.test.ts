import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetInfo } from "@/lib/external/catalog.functions";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as DatasetInfo[] | undefined, error: null as Error | null },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) =>
    createElement(
      "a",
      { href: params ? to.replace("$dataset", params["dataset"] ?? "") : to, ...rest },
      children,
    ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ ...mocks.query, refetch: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/external/catalog.functions", () => ({ listDatasets: vi.fn() }));

const { HubKpis, HubLinks } = await import("./SectionHub");

const dataset = (id: string, records: number | null, label = `${id} label`): DatasetInfo => ({
  id,
  label,
  records,
  ready: true,
  columns: [],
  filters: [],
  qualification: null,
  aliases: [],
});
const kpis = (items: { dataset: string; label: string }[]) =>
  renderToStaticMarkup(createElement(HubKpis, { items }));

beforeEach(() => {
  mocks.query = { data: undefined, error: null };
});

describe("hub record counts", () => {
  it("shows each dataset's stored count with its dataset as the source link", () => {
    mocks.query.data = [dataset("sec_enforcement_actions", 30731, "SEC enforcement actions")];
    const html = kpis([{ dataset: "sec_enforcement_actions", label: "SEC enforcement actions" }]);
    expect(html).toContain("30,731");
    expect(html).toContain("Source and notes");
    expect(html).toContain('title="Source: SEC enforcement actions"');
  });
  it("says Not recorded when the catalog has no count, and drops a dataset it does not hold", () => {
    mocks.query.data = [dataset("a", null)];
    const html = kpis([
      { dataset: "a", label: "First" },
      { dataset: "missing", label: "Second" },
    ]);
    expect(html).toContain("Not recorded");
    expect(html).toContain("First");
    expect(html).not.toContain("Second");
    expect(html).not.toMatch(/>0</);
  });
  it("shows placeholders while loading and a retry on failure, never a number", () => {
    const loading = kpis([{ dataset: "a", label: "First" }]);
    expect(loading).toContain("animate-pulse");
    expect(loading).not.toMatch(/>[\d,]+</);
    mocks.query.error = new Error("down");
    const failed = kpis([{ dataset: "a", label: "First" }]);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry");
  });
  it("lists several counts of a link side by side, never summed", () => {
    mocks.query.data = [dataset("sam", 169031), dataset("leie", 84093)];
    const html = renderToStaticMarkup(
      createElement(HubLinks, {
        links: [
          {
            to: "/enforcement",
            search: { tab: "exclusions" },
            label: "Exclusions",
            description: "d",
            counts: [
              { dataset: "sam", label: "SAM.gov exclusions" },
              { dataset: "leie", label: "LEIE exclusions" },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("169,031 SAM.gov exclusions");
    expect(html).toContain("84,093 LEIE exclusions");
    expect(html).not.toContain("253,124");
  });
});
