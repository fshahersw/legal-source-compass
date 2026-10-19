import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getCourtLocations,
  mapHref,
  parseCourtLocations,
  parseLocation,
} from "./courtLocations.functions";

// Shape copied from a published court_locations record.
const LOC = {
  name: "Thurgood Marshall Federal Judiciary Building",
  kind: "street",
  address1: "One Columbus Circle, NE",
  address2: "Room G-255, North Lobby",
  city: "Washington",
  state: "DC",
  zip: "20544",
  other_spellings: [],
  lat: 38.898,
  lon: -77.008,
  geocode_match: "Match",
  source_url: "https://www.jpml.uscourts.gov/",
  retrieved_at: "2026-10-19T03:05:11Z",
};
const PROFILE = {
  court_id: "jpml",
  court: "Judicial Panel",
  locations: [LOC],
  shared_site_with: [],
};

describe("parseLocation", () => {
  it("keeps a valid location and its coordinates only on a Census match", () => {
    const l = parseLocation(LOC)!;
    expect(l.address1).toBe("One Columbus Circle, NE");
    expect(l.lat).toBe(38.898);
    expect(parseLocation({ ...LOC, geocode_match: "Tie" })!.lat).toBeNull();
  });

  it("drops locations without a street, a valid state or ZIP, or an official source page", () => {
    expect(parseLocation({ ...LOC, address1: "" })).toBeNull();
    expect(parseLocation({ ...LOC, state: "Dist" })).toBeNull();
    expect(parseLocation({ ...LOC, zip: "2054" })).toBeNull();
    expect(parseLocation({ ...LOC, source_url: "https://example.com/" })).toBeNull();
  });

  it("marks P.O. boxes as mailing addresses", () => {
    expect(parseLocation({ ...LOC, address1: "P.O. Box 1957" })!.mailing).toBe(true);
  });
});

describe("parseCourtLocations", () => {
  it("rejects another court's record and counts dropped locations", () => {
    expect(parseCourtLocations(PROFILE, "cit")).toBeNull();
    const c = parseCourtLocations({ ...PROFILE, locations: [LOC, { ...LOC, zip: "x" }] }, "jpml")!;
    expect(c.locations).toHaveLength(1);
    expect(c.dropped).toBe(1);
  });

  it("returns null when no location survives", () => {
    expect(
      parseCourtLocations({ ...PROFILE, locations: [{ ...LOC, city: null }] }, "jpml"),
    ).toBeNull();
  });
});

describe("mapHref", () => {
  it("links a geocoded point and nothing else", () => {
    expect(mapHref({ lat: 38.898, lon: -77.008 })).toBe(
      "https://www.openstreetmap.org/?mlat=38.89800&mlon=-77.00800#map=17/38.89800/-77.00800",
    );
    expect(mapHref({ lat: null, lon: null })).toBeNull();
  });
});

describe("getCourtLocations", () => {
  it("reads one record by exact court id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ p: PROFILE }], total: null });
    const handler = getCourtLocations as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    const r = (await handler({ data: { id: "jpml" } })) as { locations: unknown[] };
    expect(r.locations).toHaveLength(1);
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.court_locations&id=eq.jpml");
  });
});
