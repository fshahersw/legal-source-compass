import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./search";

const mocks = vi.hoisted(() => ({
  q: "talc",
  navigate: vi.fn(),
  query: vi.fn(),
  results: {} as Record<string, Record<string, unknown>>,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => ({ q: mocks.q }),
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (previous: unknown) => previous,
  useQuery: (options: { queryKey: string[] }) => {
    mocks.query(options);
    return { isFetching: false, isLoading: false, ...mocks.results[options.queryKey[0]!] };
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/external/catalog.functions", () => ({ searchCorpus: vi.fn() }));
vi.mock("@/lib/law/stateCode.functions", () => ({
  listStateCodes: vi.fn(),
  searchStateCodes: vi.fn(),
}));
vi.mock("@/components/atlas/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/components/corpus/DatasetBrowser", () => ({ CorpusRecordLink: () => null }));
vi.mock("@/components/semantic/SemanticSearch", () => ({ SemanticSearch: () => null }));

const options = (
  Route as unknown as {
    options: {
      component: ComponentType;
      validateSearch: (input: Record<string, unknown>) => { q: string };
      remountDeps: (input: { search: { q: string } }) => { q: string };
    };
  }
).options;
const render = () => renderToStaticMarkup(createElement(options.component));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.q = "talc";
  mocks.results = {};
});

describe("search route query navigation", () => {
  it("changes the router remount identity for header/history queries so draft and pagination reset", () => {
    const first = options.remountDeps({ search: { q: "talc" } });
    const second = options.remountDeps({ search: { q: "asbestos" } });
    expect(second).not.toEqual(first);
    expect(options.remountDeps({ search: { q: "talc" } })).toEqual(first);
    for (const q of ["talc", "asbestos", "talc"]) {
      mocks.q = q;
      expect(render()).toContain(`value="${q}"`);
      expect(mocks.query).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["corpus-search", q, 0] }),
      );
    }
  });

  it("retains numeric queries from shared URLs", () => {
    expect(options.validateSearch({ q: 3140 })).toEqual({ q: "3140" });
  });

  it("shows failed code search even when it has no hits and is no longer fetching", () => {
    mocks.results["state-code-search"] = { error: new Error("Code search unavailable") };
    const html = render();
    expect(html).toContain("Full state codes");
    expect(html).toContain("Code search unavailable");
  });

  it("reports a catalog lookup failure instead of silently losing code links", () => {
    mocks.results["full-state-codes"] = { error: new Error("Code catalog unavailable") };
    expect(render()).toContain("Code catalog unavailable");
  });

  it("prevents advancing again while the next page is still loading", () => {
    mocks.results["corpus-search"] = {
      isFetching: true,
      data: { hits: [], returned: 1, hasMore: true },
    };
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });
});
