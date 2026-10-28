import { describe, expect, it } from "vitest";
import { HUBS } from "./hubs";
import { linksNotInHeader } from "./hubLinkFilter";

describe("linksNotInHeader", () => {
  it("drops Courts landing links that repeat the header menu (Judges, Caseload, Vacancies, Compare)", () => {
    const kept = linksNotInHeader("courts", HUBS.courts.links).map((l) => l.to);
    for (const to of [
      "/judges",
      "/courts/caseload",
      "/courts/vacancies",
      "/courts/analytics",
      "/judges/analytics",
    ])
      expect(kept).not.toContain(to);
  });

  it("keeps a link whose query the menu does not carry, and links into other sections", () => {
    const places = linksNotInHeader("places", HUBS.places.links);
    expect(places.map((l) => `${l.to}?${new URLSearchParams(l.search ?? {}).toString()}`)).toEqual([
      "/places?layer=counties",
    ]);
    const overview = linksNotInHeader("overview", HUBS.overview.links);
    expect(overview).toHaveLength(HUBS.overview.links.length);
  });
});
