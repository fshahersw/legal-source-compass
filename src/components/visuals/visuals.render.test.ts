import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agency_images, court_buildings, state_capitol_images } from "@/lib/visuals/fixtures/rows";
import { parseAgencyImages } from "@/lib/visuals/agencyImages";
import { parseCourtBuildings } from "@/lib/visuals/courtBuildings";
import { parseStateCapitol } from "@/lib/visuals/stateCapitols";
import { committee_marks } from "@/lib/visuals/fixtures/rows";
import { parseCommitteeMark } from "@/lib/visuals/committeeMarks";

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

import { AboutImage } from "./AboutImage";
import { AgencyBuildingPhoto } from "./AgencyBuildingPhoto";
import { AgencyEmblem, AgencyMarkCaption } from "./AgencyEmblem";
import { agencyArtwork } from "@/lib/visuals/registry";
import { CommitteeMarkCaption } from "./CommitteeMark";
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
  it("says only 'Source: <site>' when neither a licence nor an author is recorded", () => {
    const out = html(
      createElement(OpenImageCredit, {
        image: {
          ...base,
          origin: "other",
          filePage: "https://www.fjc.gov/history/courthouse/chicago-illinois-1964",
          author: null,
          license: null,
          licenseUrl: null,
        },
      }),
    );
    expect(out).toContain("Source: ");
    expect(out).toContain(">fjc.gov</a>");
    expect(out).not.toContain("Photo:");
    expect(out).not.toContain("Author not recorded");
  });
  it("keeps a recorded author when no licence is recorded", () => {
    const out = html(
      createElement(OpenImageCredit, { image: { ...base, license: null, licenseUrl: null } }),
    );
    expect(out).toContain("Photo: DXR");
    expect(out).toContain("Source: ");
  });
  it("shows a URL inside the author as a short link labelled with its host", () => {
    const out = html(
      createElement(OpenImageCredit, {
        image: {
          ...base,
          author: "James Brooks · https://www.flickr.com/photos/jkbrooks85/50796914563/",
        },
      }),
    );
    expect(out).toContain("Photo: James Brooks · ");
    expect(out).toContain('href="https://www.flickr.com/photos/jkbrooks85/50796914563/"');
    expect(out).toContain(">flickr.com</a>");
    // The raw address is never printed as text or in the tooltip.
    expect(out).not.toContain(">https://www.flickr.com");
    expect(out).toContain('title="Photo: James Brooks · flickr.com"');
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

  it("state capitol: a credit that records a URL shows its host, in a compact band", () => {
    const row = state_capitol_images[0]!.item["photo"] as Record<string, unknown>;
    state.result = {
      data: parseStateCapitol("AK", {
        ...row,
        author: "James Brooks · https://www.flickr.com/photos/jkbrooks85/50796914563/",
        building: "Alaska State Capitol",
      }),
    };
    const out = html(createElement(StateCapitolHeader, { usps: "AK", stateName: "Alaska" }));
    expect(out).toContain(">flickr.com</a>");
    expect(out).not.toContain(">https://www.flickr.com");
    expect(out).toContain("sm:h-24");
    expect(out).toContain("sm:flex-row");
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

describe("committee mark caption", () => {
  const mark = committee_marks[0]!.item["mark"] as Record<string, unknown>;
  const registryProse =
    "Committee/chamber symbols may have additional identity/endorsement conditions. Keep as source candidate until reviewed for the intended use.";

  it("is one short credit line with the registry's branding note kept in the About popover", () => {
    state.result = {
      data: parseCommitteeMark("hsru00", {
        ...mark,
        license: "Pending file-specific policy and visual review",
        branding_note: registryProse,
      }),
    };
    const out = html(createElement(CommitteeMarkCaption, { code: "hsru00" }));
    expect(out).toContain("Logo from the committee\u2019s website:");
    expect(out).toContain(">rules.house.gov</a>");
    // The branding prose and the review status are not on the page; the info button is.
    expect(out).not.toContain("Keep as source candidate");
    expect(out).not.toContain("Pending file-specific");
    expect(out).toContain('aria-label="About this image"');
    expect(out).toContain("<button");
  });

  it("adds author and licence only when the record has them", () => {
    state.result = {
      data: parseCommitteeMark("hsru00", {
        ...mark,
        author: "Committee staff",
        license: "U.S. government work under official committee copyright policy",
      }),
    };
    const out = html(createElement(CommitteeMarkCaption, { code: "hsru00" }));
    expect(out).toContain("Committee staff");
    expect(out).toContain("U.S. government work under official committee copyright policy");
  });

  it("shows no info button when there is no note and no policy page", () => {
    state.result = {
      data: parseCommitteeMark("hsru00", {
        ...mark,
        branding_note: null,
        policy_url: null,
        policy_quote: null,
      }),
    };
    expect(html(createElement(CommitteeMarkCaption, { code: "hsru00" }))).not.toContain("<button");
  });
});

describe("AboutImage", () => {
  it("is a labelled button that renders nothing when there is nothing to say", () => {
    expect(html(createElement(AboutImage, { notes: ["A note"] }))).toContain(
      'aria-label="About this image"',
    );
    expect(html(createElement(AboutImage, {}))).toBe("");
    expect(html(createElement(AboutImage, { notes: [], links: [] }))).toBe("");
  });
});

describe("agency seal", () => {
  const row = agency_images.find((r) => r.id === "160")!.item;
  const name = "Federal Bureau of Investigation";
  const gsa = agencyArtwork(name)!.path;
  const seal = parseAgencyImages("160", row["photos"], row["marks"]);
  const noMarks = parseAgencyImages("160", row["photos"], []);

  it("heads the page ahead of the GSA mark, whatever the registry's rights label says", () => {
    state.result = { data: seal };
    const out = html(createElement(AgencyEmblem, { agencyId: "160", name }));
    expect(out).toContain("agency-logos.federalregister.gov/160/");
    expect(out).toContain(`alt="${name} seal"`);
    expect(out).not.toContain(gsa);
  });

  it("keeps the GSA mark only when the agency has no registry mark, and waits while reading", () => {
    state.result = { data: noMarks };
    expect(html(createElement(AgencyEmblem, { agencyId: "160", name }))).toContain(gsa);
    state.result = { data: null, isPending: true };
    const waiting = html(createElement(AgencyEmblem, { agencyId: "160", name }));
    expect(waiting).not.toContain(gsa);
    expect(waiting).not.toContain("<img");
    state.result = { data: seal };
    expect(html(createElement(AgencyEmblem, { agencyId: "160", name, ready: false }))).toContain(
      "agency-logos.federalregister.gov/160/",
    );
  });

  it("credits it on one short line with the source host and an About button, and no rights warning", () => {
    state.result = { data: seal };
    const out = html(createElement(AgencyMarkCaption, { agencyId: "160" }));
    expect(out).toContain("Agency seal ·");
    expect(out).toContain(">federalregister.gov</a>");
    expect(out).toContain('aria-label="About this image"');
    expect(out).not.toMatch(/restricted|permission|rights|review|licen[cs]e/i);
    state.result = { data: noMarks };
    expect(html(createElement(AgencyMarkCaption, { agencyId: "160" }))).toBe("");
  });
});
