import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  search: {} as Record<string, unknown>,
}));
vi.mock("@tanstack/react-router", () => ({
  // Router-only props are dropped; everything else (aria-current, data-status, className) is
  // rendered exactly as AppShell passes it. The query a link carries is appended to its href.
  Link: ({
    children,
    to,
    activeOptions: _activeOptions,
    activeProps: _activeProps,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    activeOptions?: unknown;
    activeProps?: unknown;
    search?: Record<string, string>;
  }) => {
    const q = search ? new URLSearchParams(search).toString() : "";
    return createElement("a", { href: q ? `${to}?${q}` : to, ...rest }, children);
  },
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (s: { location: { pathname: string; search: Record<string, unknown> } }) => unknown;
  }) => select({ location: { pathname: mocks.pathname, search: mocks.search } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ cancelQueries: vi.fn() }) }));
vi.mock("@/components/auth/CorpusAccessGate", () => ({ useCorpusAccessMode: () => "optional" }));
vi.mock("@/lib/auth/session", () => ({ signOutEverywhere: vi.fn() }));
vi.mock("@/lib/auth/useSession", () => ({ useSessionUser: () => ({ user: null, ready: false }) }));
vi.mock("@/lib/atlas/store", () => ({
  useAtlas: () => ({
    overlays: {},
    bookmarks: { a: true, b: true },
    localStateWarning: null,
    persistWarning: null,
  }),
}));

type Anchor = { label: string; href: string; ariaCurrent: string | null; attrs: string };

function anchors(html: string): Anchor[] {
  return [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    label: inner
      .replace(/<span class="rounded[^"]*">\d+<\/span>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim(),
    href: (/href="([^"]*)"/.exec(attrs)?.[1] ?? "").replace(/&amp;/g, "&"),
    ariaCurrent: /aria-current="([^"]*)"/.exec(attrs)?.[1] ?? null,
    attrs,
  }));
}

function nav(html: string, label: string): string | null {
  return new RegExp(`<nav aria-label="${label}"[^>]*>(.*?)</nav>`).exec(html)?.[1] ?? null;
}

function render(pathname: string, search: Record<string, unknown> = {}, crumbs = [{ label: "T" }]) {
  mocks.pathname = pathname;
  mocks.search = search;
  const html = renderToStaticMarkup(
    createElement(AppShell, { title: "T", breadcrumbs: crumbs, children: "body" }),
  );
  const section = nav(html, "Section");
  const crumbHtml = nav(html, "Breadcrumb") ?? "";
  return {
    html,
    tabs: section === null ? null : anchors(section),
    primary: anchors(nav(html, "Primary") ?? ""),
    utilities: anchors(nav(html, "Utilities") ?? ""),
    crumbs: [...crumbHtml.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, li = ""]) =>
      li
        .replace(/<span aria-hidden="true"[^>]*>›<\/span>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .trim(),
    ),
  };
}

const lit = (links: Anchor[]) =>
  links.filter((a) => a.ariaCurrent !== null).map((a) => [a.label, a.ariaCurrent]);

beforeEach(() => {
  mocks.pathname = "/";
  mocks.search = {};
});

describe("AppShell sidebar", () => {
  it("shows the nine sections in order, then Sources and Saved work", () => {
    const { primary, utilities } = render("/");
    expect(primary.map((a) => [a.label, a.href])).toEqual([
      ["Overview", "/"],
      ["Places", "/places"],
      ["Courts & judges", "/courts"],
      ["Litigation", "/litigation"],
      ["Law & government", "/law"],
      ["Enforcement", "/enforcement"],
      ["Products & safety", "/safety"],
      ["Companies", "/companies"],
      ["Insights", "/insights"],
    ]);
    expect(utilities.map((a) => [a.label, a.href])).toEqual([
      ["Sources", "/sources"],
      ["Saved work", "/saved-sources"],
    ]);
  });

  it.each([
    ["/", {}, "Overview", "page"],
    ["/places", {}, "Places", "page"],
    ["/places/NY", {}, "Places", "true"],
    ["/courts/nysd", {}, "Courts & judges", "true"],
    ["/judges/analytics", {}, "Courts & judges", "true"],
    ["/litigation", {}, "Litigation", "page"],
    ["/matters/lens/3026", {}, "Litigation", "true"],
    ["/courts/collection", {}, "Litigation", "true"],
    ["/law", {}, "Law & government", "page"],
    ["/law", { scope: "federal" }, "Law & government", "true"],
    ["/limitations", {}, "Law & government", "true"],
    ["/enforcement", {}, "Enforcement", "page"],
    ["/enforcement", { tab: "actions" }, "Enforcement", "true"],
    ["/safety", {}, "Products & safety", "page"],
    ["/law/monitoring", {}, "Products & safety", "true"],
    ["/companies/payments", {}, "Companies", "true"],
    ["/insights", {}, "Insights", "page"],
    ["/analytics", {}, "Insights", "true"],
  ])("%s %j lights only %s (aria-current=%s)", (path, search, label, current) => {
    const { primary, utilities } = render(path, search);
    expect(lit(primary)).toEqual([[label, current]]);
    expect(lit(utilities)).toEqual([]);
    const active = primary.filter((a) => a.attrs.includes('data-status="active"'));
    expect(active.map((a) => a.label)).toEqual([label]);
  });

  it("lights a utility for its pages and nothing for an unsectioned page", () => {
    expect(lit(render("/sources/library").utilities)).toEqual([["Sources", "true"]]);
    expect(lit(render("/saved-sources").utilities)).toEqual([["Saved work", "page"]]);
    const search = render("/search", { q: "x" });
    expect(lit(search.primary)).toEqual([]);
    expect(lit(search.utilities)).toEqual([]);
    expect(search.tabs).toBeNull();
  });

  it("keeps the label as the accessible name in the icon rail and badges saved work", () => {
    const { primary, utilities, html } = render("/");
    for (const a of primary) expect(a.attrs).toContain(`title="${a.label.replace("&", "&amp;")}"`);
    expect(utilities.find((a) => a.label.startsWith("Saved work"))?.attrs).toBeDefined();
    expect(html).toContain(">2</span>");
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain('aria-label="Search all corpus data"');
  });
});

describe("AppShell section tabs", () => {
  it.each([
    ["/courts/nysd", {}, "Courts", "true"],
    ["/judges/123", {}, "Judges", "true"],
    ["/courts/analytics", {}, "Compare courts", "page"],
    ["/litigation/settlements", {}, "Settlements", "page"],
    ["/matters/intel", {}, "MDLs & mass torts", "true"],
    ["/cases/abc", {}, "Case law", "true"],
    ["/law", {}, "Overview", "page"],
    ["/law", { scope: "federal" }, "Federal law", "page"],
    ["/law/uscode/42", {}, "Federal law", "true"],
    ["/law", { scope: "states", state: "NY" }, "State law", "true"],
    ["/limitations/statutory", {}, "Time limits", "true"],
    ["/enforcement", {}, "Overview", "page"],
    ["/enforcement", { tab: "actions" }, "Actions by agency", "page"],
    ["/enforcement", { tab: "actions", agency: "sec" }, "Actions by agency", "true"],
    ["/enforcement", { tab: "oversight" }, "Oversight reports", "page"],
    ["/safety", { view: "neiss" }, "Injuries (NEISS)", "page"],
    ["/safety", { agency: "FDA" }, "Collections", "true"],
    ["/safety/signals", {}, "Signals", "page"],
    ["/companies/0001326801", {}, "Directory", "true"],
    ["/companies/payments", {}, "Industry payments", "page"],
    ["/places/analytics", {}, "Compare", "page"],
    ["/saved-sources", {}, "Saved sources", "page"],
  ])("%s %j lights only %s (aria-current=%s)", (path, search, label, current) => {
    const { tabs } = render(path, search);
    expect(tabs).not.toBeNull();
    expect(lit(tabs!)).toEqual([[label, current]]);
    for (const tab of tabs!) {
      const active = tab.label === label;
      expect(tab.attrs.includes("font-semibold text-primary")).toBe(active);
      expect(tab.attrs.includes("text-muted-foreground")).toBe(!active);
    }
  });

  it("links query tabs with their query", () => {
    expect(render("/enforcement").tabs!.map((t) => t.href)).toEqual([
      "/enforcement",
      "/enforcement?tab=actions",
      "/enforcement?tab=exclusions",
      "/enforcement?tab=oversight",
      "/enforcement?tab=merger",
      "/enforcement?tab=sources",
    ]);
    expect(render("/safety").tabs!.map((t) => t.href)).toEqual([
      "/safety",
      "/law/monitoring",
      "/safety?view=neiss",
      "/safety?view=reports",
      "/safety/signals",
      "/safety/products",
      "/safety?view=list",
    ]);
  });

  it("has no tab strip on the map home or a state page", () => {
    expect(render("/").tabs).toBeNull();
    expect(render("/places/NE").tabs).toBeNull();
  });
});

describe("AppShell breadcrumbs", () => {
  it("shows Section › sub-area › entity", () => {
    expect(
      render("/matters/lens/2873", {}, [
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "MDL analytics", to: "/matters/analytics" },
        { label: "MDL 2873" },
      ] as never).crumbs,
    ).toEqual(["Litigation", "MDLs & mass torts", "MDL 2873"]);
    expect(render("/litigation", {}, []).crumbs).toEqual(["Litigation"]);
  });
});
