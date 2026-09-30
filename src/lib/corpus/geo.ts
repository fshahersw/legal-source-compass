import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { geoPath } from "d3-geo";

/** FIPS / USPS / name for the 50 states + DC (same table as corpussite usmap.js). */
export const STATES: { fips: string; usps: string; name: string }[] = [
  ["01", "AL", "Alabama"], ["02", "AK", "Alaska"], ["04", "AZ", "Arizona"], ["05", "AR", "Arkansas"],
  ["06", "CA", "California"], ["08", "CO", "Colorado"], ["09", "CT", "Connecticut"], ["10", "DE", "Delaware"],
  ["11", "DC", "District of Columbia"], ["12", "FL", "Florida"], ["13", "GA", "Georgia"], ["15", "HI", "Hawaii"],
  ["16", "ID", "Idaho"], ["17", "IL", "Illinois"], ["18", "IN", "Indiana"], ["19", "IA", "Iowa"],
  ["20", "KS", "Kansas"], ["21", "KY", "Kentucky"], ["22", "LA", "Louisiana"], ["23", "ME", "Maine"],
  ["24", "MD", "Maryland"], ["25", "MA", "Massachusetts"], ["26", "MI", "Michigan"], ["27", "MN", "Minnesota"],
  ["28", "MS", "Mississippi"], ["29", "MO", "Missouri"], ["30", "MT", "Montana"], ["31", "NE", "Nebraska"],
  ["32", "NV", "Nevada"], ["33", "NH", "New Hampshire"], ["34", "NJ", "New Jersey"], ["35", "NM", "New Mexico"],
  ["36", "NY", "New York"], ["37", "NC", "North Carolina"], ["38", "ND", "North Dakota"], ["39", "OH", "Ohio"],
  ["40", "OK", "Oklahoma"], ["41", "OR", "Oregon"], ["42", "PA", "Pennsylvania"], ["44", "RI", "Rhode Island"],
  ["45", "SC", "South Carolina"], ["46", "SD", "South Dakota"], ["47", "TN", "Tennessee"], ["48", "TX", "Texas"],
  ["49", "UT", "Utah"], ["50", "VT", "Vermont"], ["51", "VA", "Virginia"], ["53", "WA", "Washington"],
  ["54", "WV", "West Virginia"], ["55", "WI", "Wisconsin"], ["56", "WY", "Wyoming"],
].map(([fips, usps, name]) => ({ fips: fips!, usps: usps!, name: name! }));

export const stateByUsps = new Map(STATES.map((s) => [s.usps, s]));
export const stateByFips = new Map(STATES.map((s) => [s.fips, s]));
/** Exact (case-sensitive after trim) state-name lookup; no fuzzy matching. */
export const stateByName = new Map(STATES.map((s) => [s.name, s]));

export type Shape = { id: string; name: string; d: string };
export type GeoData = {
  states: Shape[];
  counties: (Shape & { stateFips: string })[];
  stateBorders: string;
};

/** Decode the pre-projected us-atlas topology (975x610 viewport) into SVG paths. */
export function decodeTopology(topo: unknown): GeoData {
  const t = topo as Topology<{ states: GeometryCollection<{ name: string }>; counties: GeometryCollection<{ name: string }> }>;
  const path = geoPath(); // identity: geometry is already projected
  const toShapes = (key: "states" | "counties") =>
    (feature(t, t.objects[key]) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>).features.map(
      (f) => ({ id: String(f.id), name: f.properties?.name ?? String(f.id), d: path(f) ?? "" }),
    );
  return {
    states: toShapes("states"),
    counties: toShapes("counties").map((c) => ({ ...c, stateFips: c.id.slice(0, 2) })),
    stateBorders: path(mesh(t, t.objects.states, (a, b) => a !== b)) ?? "",
  };
}

export function bboxOfPath(d: string): [number, number, number, number] {
  const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]!, y = nums[i + 1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
