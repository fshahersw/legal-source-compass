import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./companies.$cik";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ cik: "x" }) }),
  notFound: (options: unknown) => ({ isNotFound: true, ...(options as object) }),
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params?: { cik?: string };
  }) => createElement("a", { href: params?.cik ? to.replace("$cik", params.cik) : to }, children),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@/components/atlas/AppShell", () => ({
  AppShell: ({
    title,
    breadcrumbs,
    children,
  }: {
    title: string;
    breadcrumbs: { label: string }[];
    children: ReactNode;
  }) =>
    createElement(
      "main",
      null,
      createElement(
        "ol",
        null,
        breadcrumbs.map((c) => createElement("li", { key: c.label }, c.label)),
      ),
      createElement("h1", null, title),
      children,
    ),
}));
vi.mock("@/components/companies/CompanyProfile", () => ({
  CompanyProfile: () => null,
  companyDetailQuery: (cik: string) => ({ queryKey: ["company-sec-detail", cik] }),
  companyTitle: () => "Company",
}));

type Head = { meta: { title?: string; name?: string; content?: string }[] };
type HeadInput = {
  loaderData?: { found: boolean; name: string | null };
  match: { status: string };
  params: { cik: string };
};
const options = (
  Route as unknown as {
    options: {
      beforeLoad?: unknown;
      params: {
        parse: (params: { cik: string }) => { cik: string };
        stringify: (params: { cik: string }) => { cik: string };
      };
      loader: (input: {
        context: {
          queryClient: {
            ensureQueryData: () => Promise<unknown>;
            prefetchQuery: (options: unknown) => Promise<unknown>;
          };
        };
        params: { cik: string };
      }) => Promise<{ found: boolean; name: string | null }>;
      head: (input: HeadInput) => Head;
      notFoundComponent: ComponentType<{ data?: unknown }>;
    };
  }
).options;
const title = (head: Head) => head.meta.find((m) => m.title)?.title;
const description = (head: Head) => head.meta.find((m) => m.name === "description")?.content;
const renderNotFound = (data: unknown) =>
  renderToStaticMarkup(createElement(options.notFoundComponent, { data }));

describe("/companies/$cik address check", () => {
  it("throws notFound from params.parse, carrying the typed value, for a non-CIK address", () => {
    const thrown = (cik: string) => {
      try {
        options.params.parse({ cik });
      } catch (e) {
        return e;
      }
      return undefined;
    };
    expect(thrown("notacik")).toMatchObject({ isNotFound: true, data: { cik: "notacik" } });
    expect(thrown("1326801")).toMatchObject({ isNotFound: true, data: { cik: "1326801" } });
    expect(thrown("0001326801")).toBeUndefined();
    expect(options.params.parse({ cik: "0001326801" })).toEqual({ cik: "0001326801" });
    expect(options.params.stringify({ cik: "0001326801" })).toEqual({ cik: "0001326801" });
    // The check lives in params.parse (run while matching, including during SSR) so the response is a 404.
    expect(options.beforeLoad).toBeUndefined();
  });

  it("reports whether a record exists from the loader", async () => {
    const prefetchQuery = vi.fn(async () => undefined);
    const run = (data: unknown) =>
      options.loader({
        context: { queryClient: { ensureQueryData: async () => data, prefetchQuery } },
        params: { cik: "0001326801" },
      });
    await expect(run(null)).resolves.toEqual({ found: false, name: null });
    // The statements read starts alongside the profile read, for the same company.
    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(["0001326801"]) }),
    );
    await expect(run({ summary: { profile: { name: "Meta Platforms, Inc." } } })).resolves.toEqual({
      found: true,
      name: "Meta Platforms, Inc.",
    });
  });
});

describe("/companies/$cik tab title", () => {
  it("says the company was not found when the address check fails", () => {
    const head = options.head({ match: { status: "notFound" }, params: { cik: "notacik" } });
    expect(title(head)).toMatch(/^Company not found — /);
  });
  it("names the CIK, not a company, when no record is published", () => {
    const head = options.head({
      loaderData: { found: false, name: null },
      match: { status: "success" },
      params: { cik: "0000000001" },
    });
    expect(title(head)).toMatch(/^CIK 0000000001 — /);
    expect(description(head)).toBe(
      "No SEC company-intelligence record is published for CIK 0000000001.",
    );
  });
  it("uses the registrant's name when the record exists", () => {
    const head = options.head({
      loaderData: { found: true, name: "Meta Platforms, Inc." },
      match: { status: "success" },
      params: { cik: "0001326801" },
    });
    expect(title(head)).toMatch(/^Meta Platforms, Inc\. — /);
  });
  it("falls back to the CIK, never claiming no record, when the load failed", () => {
    const head = options.head({ match: { status: "error" }, params: { cik: "0001326801" } });
    expect(title(head)).toMatch(/^CIK 0001326801 — /);
    expect(description(head)).not.toMatch(/No SEC company-intelligence record/);
  });
});

describe("/companies/$cik not-found page", () => {
  it("renders inside the app shell with the company trail and a way back", () => {
    const html = renderNotFound({ cik: "notacik" });
    expect(html).toContain("<h1>Company not found</h1>");
    expect(html).toContain(
      "<li>Home</li><li>Law &amp; regulation</li><li>Companies</li><li>Not found</li>",
    );
    expect(html).toContain("notacik");
    expect(html).toContain('<a href="/companies">Back to all companies</a>');
    expect(html).not.toContain("With leading zeros");
  });
  it("offers the zero-padded address for a CIK typed without leading zeros", () => {
    const html = renderNotFound({ cik: "1326801" });
    expect(html).toContain('<a href="/companies/0001326801">/companies/0001326801</a>');
  });
  it("still explains the address when no value is available", () => {
    const html = renderNotFound(undefined);
    expect(html).toContain("needs the registrant");
    expect(html).not.toContain("is not a 10-digit SEC");
  });
});
