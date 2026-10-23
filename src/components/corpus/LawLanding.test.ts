import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetInfo } from "@/lib/external/catalog.functions";
import { FederalLawCollections, LawLanding } from "./LawLanding";

const mocks = vi.hoisted(() => ({ links: [] as Record<string, unknown>[] }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => {
    mocks.links.push(props);
    return createElement("a", null, children);
  },
}));
vi.mock("./EntityArtwork", () => ({ AgencyMark: () => null, StateMark: () => null }));

const dataset = (id: string, extra: Partial<DatasetInfo> = {}): DatasetInfo => ({
  id,
  label: id,
  ready: true,
  records: null,
  columns: [],
  filters: [],
  qualification: null,
  aliases: [],
  ...extra,
});
const directory = (options: { value: string; label: string }[]) =>
  dataset("federal_register_history", {
    filters: [{ name: "agency", type: "select", label: "Agency", options }],
  });
const render = (datasets: DatasetInfo[] = []) =>
  renderToStaticMarkup(createElement(LawLanding, { datasets }));
const renderFederal = (datasets: DatasetInfo[] = []) =>
  renderToStaticMarkup(createElement(FederalLawCollections, { datasets }));
const agencyLink = (name: string) =>
  mocks.links.find((link) => String(link["aria-label"]).endsWith(name));
const federalLink = (group: string) =>
  mocks.links.find(
    (link) => (link["search"] as Record<string, unknown> | undefined)?.["group"] === group,
  );

beforeEach(() => {
  mocks.links = [];
});

describe("law landing recorded destinations", () => {
  it("opens a profile only for a unique exact recorded agency name", () => {
    render([directory([{ value: "199", label: "Food and Drug Administration" }])]);
    expect(agencyLink("Food and Drug Administration")).toMatchObject({
      to: "/agencies/$id",
      params: { id: "199" },
      "aria-label": "Open Food and Drug Administration",
    });
    expect(agencyLink("Environmental Protection Agency")).toMatchObject({
      to: "/agencies",
      search: { q: "Environmental Protection Agency" },
      "aria-label": "Browse agency directory for Environmental Protection Agency",
    });
  });

  it("keeps ambiguous, approximate and invalid agency matches as explicitly labeled browse links", () => {
    const html = render([
      directory([
        { value: "199", label: "Food and Drug Administration" },
        { value: "200", label: "Food and Drug Administration" },
        { value: "145", label: "Environmental Protection Agency Office" },
        { value: "invalid", label: "Federal Trade Commission" },
      ]),
    ]);
    expect(mocks.links.some((link) => link["to"] === "/agencies/$id")).toBe(false);
    expect(html.match(/Browse agency directory/g)).toHaveLength(8);
  });

  it("opens the sole recorded available collection for its actual law group", () => {
    renderFederal([dataset("public_laws"), dataset("federal_register_history")]);
    expect(federalLink("statutes")).toMatchObject({
      to: "/law",
      search: { scope: "federal", group: "statutes", ds: "public_laws" },
    });
    expect(federalLink("register")).toMatchObject({
      search: { scope: "federal", group: "register", ds: "federal_register_history" },
    });
  });

  it("uses the group browse route for multiple, unavailable or unknown collections", () => {
    const html = renderFederal([
      dataset("federal_regulations_titles"),
      dataset("federal_regulations_sections"),
      dataset("public_laws", { ready: false }),
      dataset("federal", { ready: null }),
    ]);
    for (const group of ["statutes", "regulations", "register"]) {
      expect(federalLink(group)?.["search"]).toEqual({ scope: "federal", group });
    }
    expect(html.match(/Browse collections/g)).toHaveLength(3);
    expect(html).not.toContain("Open collection");
  });

  it("browses agencies for notices instead of opening unrelated court reference websites or an empty group", () => {
    const html = renderFederal([
      dataset("federal", { label: "Federal court websites and legal reference resources" }),
    ]);
    expect(
      mocks.links.find((link) => link["aria-label"] === "Browse agencies for published notices"),
    ).toMatchObject({ to: "/agencies", search: { q: "" } });
    expect(federalLink("notices")).toBeUndefined();
    expect(
      mocks.links.some(
        (link) => (link["search"] as Record<string, unknown> | undefined)?.["ds"] === "federal",
      ),
    ).toBe(false);
    expect(html).toContain("Browse agencies");
    expect(html).not.toContain("Federal court websites and legal reference resources");
  });

  it("shows metadata loading and failure without pretending a direct destination is recorded", () => {
    const pending = renderToStaticMarkup(createElement(LawLanding, { metadataState: "loading" }));
    expect(pending).toContain("Loading agency shortcuts");
    const failed = renderToStaticMarkup(createElement(LawLanding, { metadataState: "error" }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry shortcut metadata");
    expect(failed).toContain("Browse agency directory");
    expect(mocks.links.some((link) => link["to"] === "/agencies/$id")).toBe(false);
  });
});
