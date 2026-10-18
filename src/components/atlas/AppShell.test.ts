import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const mocks = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("@tanstack/react-router", () => ({
  // Router-only props are dropped; everything else (aria-current, data-status, className) is
  // rendered exactly as AppShell passes it.
  Link: ({
    children,
    to,
    activeOptions: _activeOptions,
    activeProps: _activeProps,
    search: _search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    activeOptions?: unknown;
    activeProps?: unknown;
    search?: unknown;
  }) => createElement("a", { href: to, ...rest }, children),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ cancelQueries: vi.fn() }) }));
vi.mock("@/components/auth/CorpusAccessGate", () => ({ useCorpusAccessMode: () => "optional" }));
vi.mock("@/lib/auth/session", () => ({ signOutEverywhere: vi.fn() }));
vi.mock("@/lib/auth/useSession", () => ({ useSessionUser: () => ({ user: null, ready: false }) }));
vi.mock("@/lib/atlas/store", () => ({
  useAtlas: () => ({ overlays: {}, bookmarks: {}, localStateWarning: null, persistWarning: null }),
}));

type Anchor = { label: string; href: string; ariaCurrent: string | null; attrs: string };

function anchors(html: string): Anchor[] {
  return [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    label: inner
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim(),
    href: /href="([^"]*)"/.exec(attrs)?.[1] ?? "",
    ariaCurrent: /aria-current="([^"]*)"/.exec(attrs)?.[1] ?? null,
    attrs,
  }));
}

function nav(html: string, label: string): string | null {
  return new RegExp(`<nav aria-label="${label}"[^>]*>(.*?)</nav>`).exec(html)?.[1] ?? null;
}

function render(pathname: string) {
  mocks.pathname = pathname;
  const html = renderToStaticMarkup(
    createElement(AppShell, {
      title: "T",
      breadcrumbs: [{ label: "Home", to: "/" }],
      children: "body",
    }),
  );
  const section = nav(html, "Section");
  return {
    html,
    tabs: section === null ? null : anchors(section),
    primary: anchors(nav(html, "Primary") ?? ""),
    mobile: anchors(nav(html, "Sections") ?? ""),
  };
}

const lit = (links: Anchor[]) =>
  links.filter((a) => a.ariaCurrent !== null).map((a) => [a.label, a.ariaCurrent]);

beforeEach(() => {
  mocks.pathname = "/";
});

describe("AppShell section tabs", () => {
  it.each([
    ["/companies/payments", "Industry payments", "page"],
    ["/companies/0001326801", "Companies", "true"],
    ["/companies/notacik", "Companies", "true"],
    ["/safety/signals", "Product safety", "true"],
    ["/courts/ned", "All courts", "true"],
    ["/judges/123", "All judges", "true"],
    ["/law", "Overview", "page"],
    ["/places", "State map", "true"],
    ["/places/analytics", "State analytics", "page"],
  ])("%s lights only %s (aria-current=%s)", (path, label, current) => {
    const { tabs } = render(path);
    expect(tabs).not.toBeNull();
    expect(lit(tabs!)).toEqual([[label, current]]);
    for (const tab of tabs!) {
      const active = tab.label === label;
      expect(tab.attrs.includes("font-semibold text-primary")).toBe(active);
      expect(tab.attrs.includes("text-muted-foreground")).toBe(!active);
    }
  });

  it("shows the States & courts tabs with Court analytics lit as the parent of the MDL views", () => {
    for (const path of ["/matters/analytics", "/matters/intel", "/matters/lens/3026"]) {
      const { tabs, primary } = render(path);
      expect(tabs?.map((t) => t.href)).toEqual([
        "/",
        "/places/analytics",
        "/courts",
        "/courts/analytics",
        "/judges",
        "/judges/analytics",
      ]);
      expect(lit(tabs!)).toEqual([["Court analytics", "true"]]);
      expect(lit(primary)).toEqual([["States & courts", "true"]]);
    }
  });

  it("has no tab strip on the home map or an individual state page", () => {
    expect(render("/").tabs).toBeNull();
    expect(render("/places/NE").tabs).toBeNull();
  });
});

describe("AppShell primary sections", () => {
  it.each([
    ["/", "States & courts", "page"],
    ["/courts/ned", "States & courts", "true"],
    ["/law", "Law & regulation", "page"],
    ["/companies/payments", "Law & regulation", "true"],
    ["/sources/library", "Sources", "page"],
    ["/sources/catalog", "Sources", "true"],
    ["/limitations", "Time limits", "page"],
  ])("%s lights %s (aria-current=%s) in the sidebar and the mobile bar", (path, label, current) => {
    const { primary, mobile } = render(path);
    for (const links of [primary, mobile]) {
      expect(links).toHaveLength(4);
      expect(lit(links)).toEqual([[label, current]]);
      const active = links.filter((a) => a.attrs.includes('data-status="active"'));
      expect(active.map((a) => a.label)).toEqual([label]);
    }
  });

  it("lights no section on an unsectioned page", () => {
    const { primary, mobile, tabs } = render("/matters/123");
    expect(lit(primary)).toEqual([]);
    expect(lit(mobile)).toEqual([]);
    expect(tabs).toBeNull();
  });
});
