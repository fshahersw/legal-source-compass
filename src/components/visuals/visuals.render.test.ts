import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agency_images, court_buildings, state_capitol_images } from "@/lib/visuals/fixtures/rows";
import { parseAgencyImages } from "@/lib/visuals/agencyImages";
import { parseCourtBuildings } from "@/lib/visuals/courtBuildings";
import { parseStateCapitol } from "@/lib/visuals/stateCapitols";

const state = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isPending: false, isError: false, refetch: vi.fn(), ...state.result }),
  queryOptions: (o: unknown) => o,
}));
vi.mock("@/lib/visuals/visuals.functions", () => ({
  getAgencyImages: vi.fn(),
  getCommitteeMark: vi.fn(),
  getCourtBuildings: vi.fn(),
  getOpenCompanyLogo: vi.fn(),
  getOpenJudgePortrait: vi.fn(),
  getStateCapitol: vi.fn(),
}));

import { AgencyBuildingPhoto } from "./AgencyBuildingPhoto";
import { CourtBuildingsPanel } from "./CourtBuildingsPanel";
import { OpenImageCredit } from "./ImageCredit";
import { StateCapitolHeader } from "./StateCapitolHeader";

const ilnd = court_buildings.find((r) => r.id === "ilnd")!.item;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

beforeEach(() => {
  state.result = {};
});

describe("credits", () => {
  const base = {
    filePage: "https://commons.wikimedia.org/wiki/File:X.jpg",
    origin: "commons" as const,
    author: "DXR",
    credit: null,
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  };
  it("shows author, licence linked to its deed and the file page", () => {
    const out = html(createElement(OpenImageCredit, { image: base }));
    expect(out).toContain("Photo: DXR");
    expect(out).toContain('href="https://creativecommons.org/licenses/by-sa/4.0"');
    expect(out).toContain(">Wikimedia Commons</a>");
  });
  it("shows only the source site when no licence is recorded", () => {
    const out = html(
      createElement(OpenImageCredit, {
        image: {
          ...base,
          origin: "other",
          filePage: "https://www.fjc.gov/history/courthouse/chicago-illinois-1964",
          license: null,
          licenseUrl: null,
        },
      }),
    );
    expect(out).toContain("Source: ");
    expect(out).toContain(">fjc.gov</a>");
    expect(out).not.toContain("Photo:");
  });
  it("shows an unlinked licence when the record has no licence link", () => {
    const out = html(createElement(OpenImageCredit, { image: { ...base, licenseUrl: null } }));
    expect(out).toContain("CC BY-SA 4.0 · ");
    expect(out).not.toContain("creativecommons.org");
  });
});

describe("page sections", () => {
  it("render nothing while loading or when the dataset has no record", () => {
    state.result = { isPending: true };
    expect(html(createElement(CourtBuildingsPanel, { courtId: "ilnd" }))).toBe("");
    state.result = { data: null };
    expect(html(createElement(CourtBuildingsPanel, { courtId: "ilnd" }))).toBe("");
    expect(html(createElement(AgencyBuildingPhoto, { agencyId: "160", name: "FBI" }))).toBe("");
    expect(html(createElement(StateCapitolHeader, { usps: "AL", stateName: "Alabama" }))).toBe("");
  });

  it("courthouses: cards with the recorded label, the count line and a retry on a failed read", () => {
    state.result = { data: parseCourtBuildings("ilnd", ilnd["buildings"], ilnd["counts"]) };
    const out = html(createElement(CourtBuildingsPanel, { courtId: "ilnd" }));
    expect(out).toContain("Courthouses");
    expect(out).toContain("2 buildings listed by U.S. Courts; 2 shown with a photograph");
    expect(out).toContain("Listed by U.S. Courts as a location of this court");
    expect(out).toContain('loading="lazy"');
    expect(out).toContain("330w");
    state.result = { isError: true };
    expect(html(createElement(CourtBuildingsPanel, { courtId: "ilnd" }))).toContain("Retry");
  });

  it("agency building: caption with the year, the occupancy note and the archive credit line", () => {
    const row = agency_images.find((r) => r.id === "160")!.item;
    state.result = { data: parseAgencyImages("160", row["photos"], row["marks"]) };
    const out = html(createElement(AgencyBuildingPhoto, { agencyId: "160", name: "FBI" }));
    expect(out).toContain("J. Edgar Hoover Building");
    expect(out).toContain("· photographed 2012");
    expect(out).toContain("current occupancy is not verified");
    expect(out).toContain("LC-DIG-highsm-25144");
  });

  it("state capitol: the building, its credit and no state name repeated", () => {
    const row = state_capitol_images[0]!.item;
    state.result = { data: parseStateCapitol("AL", row["photo"]) };
    const out = html(createElement(StateCapitolHeader, { usps: "AL", stateName: "Alabama" }));
    expect(out).toContain("Alabama State Capitol");
    expect(out).toContain("Photo: DXR");
    expect(out).not.toContain("Capitol</span><span");
  });
});
