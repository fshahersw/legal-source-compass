import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let raw: Record<string, unknown> | null = null;

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (o: unknown) => o,
  useSuspenseQuery: () => ({ data: { raw } }),
}));
vi.mock("@/lib/external/entity.functions", () => ({ getEntity: vi.fn() }));
vi.mock("@/components/atlas/AppShell", () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("main", null, createElement("h1", null, title), children),
}));
vi.mock("@/components/corpus/DatasetBrowser", () => ({
  CorpusLink: ({ url, label }: { url: string; label: string }) =>
    createElement("a", { href: url, "data-corpus-link": "" }, label),
  DatasetBrowser: () => null,
  useAppRoutes: () => [],
  useDatasets: () => ({ aliases: {} }),
}));
vi.mock("@/components/corpus/CaseCatalog", () => ({ CaseCatalog: () => null }));
vi.mock("@/components/corpus/DocketDocuments", () => ({ DocketDocuments: () => null }));

import { EntityPage } from "./EntityPage";

const render = (dataset: string, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(EntityPage, { dataset, id: "x", crumbs: [], ...props }));
const text = (html: string) => html.replace(/<[^>]+>/g, "");

const q = (name: string) =>
  `https://api.fda.gov/device/event.json?search=device.manufacturer_d_name:"${name}"&count=device.manufacturer_d_name.exact&limit=100`;
const DOCS = {
  url: "https://open.fda.gov/apis/device/event/",
  label: "openFDA device adverse events",
};

beforeEach(() => {
  raw = null;
});

describe("EntityPage recorded no-result openFDA searches", () => {
  it("separates several no-match queries so they read as a list", () => {
    // Shape of company_adverse_manufacturers maude-sec-0001792044 (Viatris Inc).
    raw = {
      id: "maude-sec-0001792044",
      title: "Viatris Inc",
      facts: [["Matched MAUDE spellings", "None"]],
      links: [
        { url: q("UPJOHN"), label: "openFDA query" },
        { url: q("VIATRIS"), label: "openFDA query" },
        DOCS,
      ],
    };
    const t = text(render("company_adverse_manufacturers"));
    expect(t).toContain(
      "openFDA name search found no exact match: query 1 (no exact match), query 2 (no exact match)",
    );
    // The documentation page stays a source link.
    expect(t).toContain("openFDA device adverse events");
  });

  it("lists a query recorded as returning nothing on a matched record, keeping its other links", () => {
    raw = {
      id: "maude-100000010935",
      title: "BAUSCH HEALTH US, LLC",
      facts: [["Matched MAUDE spellings", "VALEANT PHARMACEUTICALS NORTH AMERICA LLC"]],
      links: [
        { url: q("BAUSCH%20HEALTH%20US"), label: "openFDA query (no matches)" },
        { url: q("VALEANT%20PHARMACEUTICALS%20NORTH%20AMERICA"), label: "openFDA query" },
        DOCS,
      ],
    };
    const html = render("company_adverse_manufacturers");
    const t = text(html);
    expect(t).toContain("openFDA name search returned no matches: query (no matches)");
    expect(t).not.toContain("no exact match");
    // The unlabelled query is not presumed empty: it stays an ordinary link.
    expect(html.match(/data-corpus-link/g)).toHaveLength(2);
  });
});

describe("EntityPage key facts box", () => {
  it("is not drawn when there are no key facts, lead or photo", () => {
    raw = { id: "firm:1", title: "Firm cluster" };
    expect(render("agency_safety_insights")).not.toContain("shadow-card sm:flex-row");
  });

  it("is drawn for key facts, a photo or a caller's lead", () => {
    raw = { id: "a", title: "A", facts: [["Court", "D.N.J."]] };
    expect(render("court_spine")).toContain("shadow-card sm:flex-row");
    raw = { id: "b", title: "B", photo_url: "https://example.gov/p.jpg" };
    expect(render("judge_profiles_fjc")).toContain('src="https://example.gov/p.jpg"');
    raw = { id: "c", title: "C", photo_url: "https://example.gov/p.jpg" };
    const html = render("court_spine", { lead: () => createElement("figure", null, "Artwork") });
    expect(html).toContain("<figure>Artwork</figure>");
    // A lead replaces the photo, as before.
    expect(html).not.toContain("p.jpg");
  });
});
