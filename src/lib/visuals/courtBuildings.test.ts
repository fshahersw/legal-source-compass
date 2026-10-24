import { describe, expect, it } from "vitest";
import { court_buildings } from "./fixtures/rows";
import {
  addressLine,
  buildingsCountLine,
  mapLink,
  MAX_BUILDINGS,
  parseCourtBuilding,
  parseCourtBuildings,
} from "./courtBuildings";

const ilnd = court_buildings.find((r) => r.id === "ilnd")!.item;
const ca10 = court_buildings.find((r) => r.id === "ca10")!.item;
const buildings = ilnd["buildings"] as Record<string, unknown>[];
const first = buildings[0]!;

describe("parseCourtBuildings", () => {
  it("keeps every fixture building, primary first, with its recorded counts", () => {
    const d = parseCourtBuildings("ilnd", ilnd["buildings"], ilnd["counts"])!;
    expect(d.buildings.map((b) => b.building)).toEqual([
      "Dirksen Federal Building and US Courthouse",
      "Stanley J. Roszkowski Federal Courthouse",
    ]);
    expect(d.listed).toBe(2);
    expect(d.shown).toBe(2);
    expect(d.dropped).toBe(0);
    const loc = parseCourtBuildings("ca10", ca10["buildings"], ca10["counts"])!;
    expect(loc.buildings[0]!.photo.origin).toBe("loc");
    expect(loc.buildings[0]!.relationshipLabel).toBe("Headquarters listed by U.S. Courts");
  });

  it("drops a building that fails, counts it, and never repairs it", () => {
    const bad = { ...first, asset_id: "court-building-x", evidence_url: "https://example.com/x" };
    const d = parseCourtBuildings("ilnd", [first, bad, first], ilnd["counts"])!;
    expect(d.buildings).toHaveLength(1);
    expect(d.dropped).toBe(2); // the non-official evidence link and the duplicate asset id
  });

  it("returns null when nothing valid remains, for a bad court id, or for a non-array", () => {
    expect(parseCourtBuildings("ilnd", [{ ...first, photo: null }], {})).toBeNull();
    expect(parseCourtBuildings("ILND", ilnd["buildings"], ilnd["counts"])).toBeNull();
    expect(parseCourtBuildings("ilnd", { 0: first }, ilnd["counts"])).toBeNull();
  });

  it("reads at most twelve buildings", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...first,
      asset_id: `court-building-${i}`,
    }));
    expect(parseCourtBuildings("ilnd", many, {})!.buildings).toHaveLength(MAX_BUILDINGS);
  });

  it("shows a missing count as Not recorded, never zero", () => {
    const d = parseCourtBuildings("ilnd", ilnd["buildings"], { buildings_listed: 4 })!;
    expect(buildingsCountLine(d)).toBe(
      "4 buildings listed by U.S. Courts; shown with a photograph: Not recorded",
    );
    expect(buildingsCountLine({ listed: 1, shown: 1 })).toBe(
      "1 building listed by U.S. Courts; 1 shown with a photograph",
    );
    expect(buildingsCountLine({ listed: null, shown: 2 })).toBe(
      "Buildings listed by U.S. Courts: Not recorded; 2 shown with a photograph",
    );
    expect(
      parseCourtBuildings("ilnd", ilnd["buildings"], { buildings_listed: -1 })!.listed,
    ).toBeNull();
  });
});

describe("parseCourtBuilding", () => {
  it("requires an official listing link on a .gov or .us host", () => {
    expect(parseCourtBuilding(first)?.evidenceUrl).toContain("uscourts.gov");
    expect(
      parseCourtBuilding({ ...first, evidence_url: "https://www.courts.state.co.us/x" }),
    ).not.toBeNull();
    expect(
      parseCourtBuilding({ ...first, evidence_url: "https://uscourts.gov.example.com/x" }),
    ).toBeNull();
    expect(parseCourtBuilding({ ...first, evidence_url: "http://www.uscourts.gov/x" })).toBeNull();
  });

  it("drops out-of-range coordinates and keeps a position only with both", () => {
    expect(parseCourtBuilding({ ...first, latitude: 141 })).toBeNull();
    const half = parseCourtBuilding({ ...first, longitude: null })!;
    expect(half.latitude).toBeNull();
    expect(mapLink(half)).toBeNull();
    expect(mapLink(parseCourtBuilding(first)!)).toBe(
      "https://www.openstreetmap.org/?mlat=41.87882&mlon=-87.62896#map=17/41.87882/-87.62896",
    );
  });

  it("builds the address line from what is recorded", () => {
    expect(addressLine(parseCourtBuilding(first)!)).toBe("219 South Dearborn Street, Chicago, IL");
    expect(addressLine({ streetAddress: null, city: null, state: null })).toBeNull();
  });
});
