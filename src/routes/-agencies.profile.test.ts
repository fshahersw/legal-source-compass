import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./agencies.$id";

const mocks = vi.hoisted(() => ({
  id: "199",
  tab: "Overview",
  query: vi.fn(),
  retry: vi.fn(),
  results: {} as Record<string, Record<string, unknown>>,
  source: {} as Record<string, unknown>,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      initial === "Overview" ? [mocks.tab, vi.fn()] : react.useState(initial),
  };
});
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ id: mocks.id }) }),
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => {
    mocks.query(options);
    return {
      isPending: false,
      isFetching: false,
      refetch: mocks.retry,
      ...mocks.results[options.queryKey[0]!],
    };
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/external/agency.functions", () => ({
  AGENCY_TYPES: ["Rule", "Proposed Rule", "Notice"],
  listAgencies: vi.fn(),
  getAgencyCounts: vi.fn(),
  listAgencyDocs: vi.fn(),
}));
vi.mock("@/lib/external/agencyProfile.functions", () => ({ getAgencyProfile: vi.fn() }));
vi.mock("@/components/agencies/AgencyProfileView", () => ({
  AgencyProfileView: () => createElement("section", null, "Agency analytics view"),
}));
vi.mock("@/components/agencies/AgencyMassTortPanel", () => ({ AgencyMassTortPanel: () => null }));
vi.mock("@/components/enforcement/parts", () => ({ LoadingBlock: () => null }));
vi.mock("@/components/atlas/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/components/corpus/EntityArtwork", () => ({ AgencyMark: () => null }));
vi.mock("@/components/visuals/AgencyEmblem", () => ({
  AgencyEmblem: () => null,
  AgencyMarkCaption: () => null,
}));
vi.mock("@/components/visuals/AgencyBuildingPhoto", () => ({ AgencyBuildingPhoto: () => null }));
vi.mock("@/components/enforcement/oversight/AgencyOversightPanel", () => ({
  AgencyOversightPanel: () => null,
}));
vi.mock("@/components/corpus/DatasetBrowser", () => ({
  DatasetBrowser: ({ dataset }: { dataset: string }) =>
    createElement("div", null, `browser:${dataset}`),
  useDatasets: () => ({
    isPending: false,
    isFetching: false,
    refetch: mocks.retry,
    ...mocks.source,
  }),
}));
const options = (
  Route as unknown as {
    options: {
      component: ComponentType;
      remountDeps: (input: { params: { id: string } }) => { id: string };
    };
  }
).options;
const render = () => renderToStaticMarkup(createElement(options.component));
const noProfile = { profile: null, trends: null, budget: null, spending: null };
const withProfile = {
  profile: { id: 557, name: "ACTION", stats: {} },
  trends: { asOf: "2026-10-19" },
  budget: null,
  spending: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.id = "199";
  mocks.tab = "Overview";
  mocks.results = {
    agencies: { data: [{ id: "199", name: "Food and Drug Administration", count: null }] },
    "agency-profile": { data: noProfile },
    "agency-counts": {
      data: {
        Rule: { total: 0, capped: false },
        Notice: { total: null, capped: true },
        "Proposed Rule": { total: null, capped: false },
      },
    },
    "agency-docs": { data: [] },
  };
  mocks.source = {
    data: [
      {
        id: "federal_register_history",
        label: "Recorded index label",
        qualification: "Captured index qualification as published.",
      },
    ],
  };
});

describe("agency profile data states", () => {
  it("renders the analytics view when the profile dataset has the agency, without index counts", () => {
    mocks.id = "557";
    mocks.results["agencies"] = { data: [] };
    mocks.results["agency-profile"] = { data: withProfile };
    const html = render();
    expect(html).toContain("Agency analytics view");
    expect(html).not.toContain("not in the Federal Register agency list");
    expect(html).toContain("2026-10-19");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["agency-counts", "557"], enabled: false }),
    );
  });

  it("surfaces directory failure with retry and does not claim the agency is absent", () => {
    mocks.results["agencies"] = { error: new Error("offline") };
    const html = render();
    expect(html).toContain("Agency directory could not be loaded");
    expect(html).toContain("Retry agency directory");
    expect(html).not.toContain("not in the Federal Register agency list");
    expect(html).not.toContain("Too large to count");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["agency-counts", "199"], enabled: false }),
    );
  });

  it("surfaces an analytics read failure with retry and keeps the index counts", () => {
    mocks.results["agency-profile"] = { error: new Error("read failed") };
    const html = render();
    expect(html).toContain("Retry agency analytics");
    expect(html).toContain("Too large to count");
  });

  it("distinguishes an absent agency from a loading profile", () => {
    mocks.results["agency-profile"] = { isPending: true };
    expect(render()).toContain("Loading agency profile");
    expect(render()).not.toContain("not in the Federal Register agency list");
    mocks.results["agency-profile"] = { data: noProfile };
    mocks.results["agencies"] = { data: [] };
    expect(render()).toContain("not in the Federal Register agency list");
  });

  it("renders recorded zero, missing totals and capped totals distinctly in the fallback", () => {
    const html = render();
    expect(html).toContain("Agency analytics are not recorded for this agency");
    expect(html).toContain(">0</div>");
    expect(html).toContain("Not recorded");
    expect(html).toContain("Too large to count");
    expect(html).toContain("Recorded index label");
    expect(html).toContain("Captured index qualification as published.");
    expect(html).toContain("Federal Register agency ID");
    expect(html).not.toContain("fda.gov");
  });

  it("renders count failures as unavailable with retry", () => {
    mocks.results["agency-counts"] = { error: new Error("read failed") };
    const html = render();
    expect(html).toContain("Retry document counts");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Too large to count");
  });

  it("distinguishes failed document requests from a valid empty filter", () => {
    mocks.tab = "Documents";
    mocks.results["agency-docs"] = { error: new Error("read failed") };
    expect(render()).toContain("Retry agency documents");
    expect(render()).not.toContain("No matching documents");
    mocks.results["agency-docs"] = { data: [] };
    expect(render()).toContain("No matching documents in the saved index");
  });

  it("filters the Unified Agenda browser to this agency", () => {
    mocks.tab = "Unified Agenda";
    expect(render()).toContain("browser:unified_agenda_pipeline");
  });

  it("reports source metadata failure instead of implying source coverage is absent", () => {
    mocks.source = { error: new Error("read failed") };
    expect(render()).toContain("Retry source metadata");
    expect(render()).not.toContain("Source coverage qualification: Not recorded");
  });

  it("changes route identity so agency transitions reset the selected tab and type", () => {
    expect(options.remountDeps({ params: { id: "199" } })).not.toEqual(
      options.remountDeps({ params: { id: "492" } }),
    );
    render();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["agency-docs", "199", ""], enabled: false }),
    );
    expect(render()).toContain('aria-pressed="true"');
  });
});
