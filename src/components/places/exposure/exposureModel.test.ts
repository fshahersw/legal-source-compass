import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/exposureGeo.functions", () => ({
  getStateExposure: vi.fn(),
  getCountyExposure: vi.fn(),
  getMdlExposure: vi.fn(),
}));

import {
  claimsSeries,
  derivedAdults,
  latestYear,
  linkedMeasures,
  measureDistribution,
  median,
  parsePartd,
  parsePlaces,
  parseUcmrState,
  parseUcmrSystem,
  shortMdlLabel,
  stateMdlRows,
} from "./exposureModel";
import { stateKpis, StateExposureView } from "./StateExposureSection";
import { countyRows } from "./CountyExposurePanel";
import { MdlExposureView, partdStateRows } from "./MdlExposurePanel";

// Shapes as written by scripts/enrichment/exposure_geo (item.exposure).
const product = (
  brand: string,
  generic: string,
  claims: number | null,
  benes: number | null = null,
) => ({
  brand,
  generic,
  prescribers: 10,
  claims,
  fills: claims,
  cost: 100.5,
  benes,
});
const partd = (
  usps: string,
  level: "state" | "national",
  series: unknown[],
  rank: unknown = null,
) => ({
  kind: "partd_mdl_drug",
  mdl: "3094",
  mdl_title:
    "IN RE: Glucagon-like Peptide-1 Receptor Agonists (GLP-1 RAs) Products Liability Litigation",
  basis: "title_names_class",
  scope: "ingredient",
  generic_names: ["Semaglutide", "Dulaglutide"],
  brand_names: [],
  class_name: "GLP-1 Receptor Agonist [EPC]",
  note: null,
  geo: {
    level,
    fips: level === "state" ? "34" : null,
    usps,
    name: usps === "US" ? "United States" : "New Jersey",
  },
  series,
  latest_rank: rank,
});
const point = (year: number, claims: number | null, lower = false, products: unknown[] = []) => ({
  year,
  claims,
  fills: claims,
  cost: 1,
  prescribers: null,
  benes: null,
  lower_bound: lower,
  missing_products: lower ? ["Trulicity (Dulaglutide)"] : [],
  products,
});

const NJ = parsePartd(
  partd("NJ", "state", [point(2023, 900), point(2024, 500, true)], {
    year: 2023,
    rank: 3,
    of: 51,
    measure: "claims",
    share_of_national: 0.05,
  }),
)!;
const US = parsePartd(partd("US", "national", [point(2023, 10000), point(2024, 20000)]))!;

const placesBody = (
  fips: string | null,
  county: string | null,
  diabetes: number | null,
  adults: number | null,
) => ({
  kind: "places_county",
  release: "2025",
  fips,
  usps: fips ? "NJ" : "US",
  state_name: fips ? "New Jersey" : "United States",
  county,
  population: 1000,
  adult_population: adults,
  measures: {
    DIABETES: {
      label: "Diagnosed diabetes among adults",
      year: "2023",
      crude: {
        v: diabetes,
        lo: diabetes === null ? null : diabetes - 1,
        hi: diabetes === null ? null : diabetes + 1,
      },
      age_adjusted: { v: null, lo: null, hi: null },
    },
    HEARING: {
      label: "Hearing disability among adults",
      year: "2023",
      crude: { v: 6, lo: 5, hi: 7 },
      age_adjusted: {},
    },
  },
  mdl_links: {
    DIABETES: [
      {
        mdls: ["3094", "3163"],
        basis: "label_indication",
        relation: "Treated population",
        source_label: "FDA label",
        source_url: "https://dailymed.nlm.nih.gov/x",
      },
    ],
    HEARING: [],
  },
});

describe("exposure model", () => {
  it("parses Part D records and keeps a lower-bound year flagged, never ranked as complete", () => {
    expect(NJ.label).toBe("GLP-1 RAs");
    expect(NJ.latestRank).toEqual({ year: 2023, rank: 3, of: 51, shareOfNational: 0.05 });
    const rows = stateMdlRows([NJ], [US], 2024);
    expect(rows[0]).toMatchObject({
      claims: null,
      lowerBound: true,
      atLeast: 500,
      share: null,
      rank: null,
    });
    const complete = stateMdlRows([NJ], [US], 2023);
    expect(complete[0]).toMatchObject({ claims: 900, share: 0.09, rank: { rank: 3, of: 51 } });
    expect(latestYear([US])).toBe(2024);
    expect(claimsSeries(NJ, [2022, 2023, 2024])).toEqual([
      { year: "2022", claims: null, partial: false },
      { year: "2023", claims: 900, partial: false },
      { year: "2024", claims: 500, partial: true },
    ]);
  });

  it("rejects malformed or foreign rows", () => {
    expect(parsePartd({ kind: "other" })).toBeNull();
    expect(parsePartd({ ...partd("NJ", "state", []), mdl: "abc" })).toBeNull();
    expect(parsePlaces(null)).toBeNull();
    expect(parseUcmrState({ kind: "ucmr5_state" })).toBeNull();
    expect(parseUcmrSystem({})).toBeNull();
  });

  it("shortens MDL titles to the named drug or class", () => {
    expect(shortMdlLabel("IN RE: Zantac (Ranitidine) Products Liability Litigation")).toBe(
      "Zantac (Ranitidine)",
    );
    expect(
      shortMdlLabel(
        "IN RE: Chantix (Varenicline) Marketing, Sales Practices and Products Liability Litigation (No. II)",
      ),
    ).toBe("Chantix (Varenicline)");
    expect(
      shortMdlLabel(
        "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
      ),
    ).toBe("Depo-Provera");
  });

  it("PLACES: only reviewed links count, gaps stay null and derived adults need every county", () => {
    const a = parsePlaces(placesBody("34001", "Atlantic", 10, 1000))!;
    const b = parsePlaces(placesBody("34003", "Bergen", 12, 2000))!;
    const c = parsePlaces(placesBody("34005", "Burlington", null, 3000))!;
    expect(linkedMeasures([a, b]).map((m) => m.id)).toEqual(["DIABETES"]);
    const d = measureDistribution([a, b, c], "DIABETES");
    expect(d.median).toBe(11);
    expect(d.recorded).toBe(2);
    expect(d.items.find((i) => i.fips === "34005")?.value).toBeNull();
    expect(derivedAdults([a, b], "DIABETES")).toBe(340);
    expect(derivedAdults([a, b, c], "DIABETES")).toBeNull();
    expect(median([])).toBeNull();
  });

  it("UCMR: parses state and system figures", () => {
    const s = parseUcmrState({
      kind: "ucmr5_state",
      agency: "NJ",
      agency_name: "New Jersey",
      systems_sampled: 10,
      systems_with_detect: 4,
      systems_pfoa_pfos_at_or_above_4: 2,
      population_with_detect: {
        sum: 5000,
        systems_with_population: 4,
        systems_without_population: 0,
      },
      systems_detecting_by_analyte: { PFOS: 2, PFOA: 3 },
      first_sample: "2023-01-04",
      last_sample: "2025-12-01",
    })!;
    expect(s.byAnalyte.map((a) => a.analyte)).toEqual(["PFOA", "PFOS"]);
    expect(s.populationSampled.sum).toBeNull();
    expect(
      parseUcmrSystem({ pwsid: "NJ1", pfoa_max_ngl: 4.2, pfoa_pfos_at_or_above_4: ["PFOA"] }),
    ).toMatchObject({
      name: "NJ1",
      pfoaMax: 4.2,
      populationServed: null,
      atOrAbove4: ["PFOA"],
    });
  });
});

describe("exposure views", () => {
  it("renders nothing when no exposure dataset is published", () => {
    const html = renderToStaticMarkup(
      createElement(StateExposureView, {
        data: { usps: "NJ", partd: null, places: null, pfas: null, readAt: "" },
        stateName: "New Jersey",
      }),
    );
    expect(html).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(MdlExposureView, { data: { mdl: "1", partd: null, pfas: null, readAt: "" } }),
      ),
    ).toBe("");
  });

  it("headline figures skip a lower-bound year and come from published values", () => {
    const kpis = stateKpis({
      usps: "NJ",
      partd: { state: [NJ], national: [US] },
      places: {
        counties: [parsePlaces(placesBody("34001", "Atlantic", 10, 1000))!],
        national: null,
      },
      pfas: null,
      readAt: "",
    });
    expect(kpis.map((k) => k.label)).toEqual(["Diagnosed diabetes among adults"]);
    expect(kpis[0]?.value).toBe("10%");
  });

  it("county rows compare with the state's counties and the nation", () => {
    const rows = countyRows({
      fips: "34001",
      county: parsePlaces(placesBody("34001", "Atlantic", 10, 1000)),
      peers: [
        parsePlaces(placesBody("34001", "Atlantic", 10, 1000))!,
        parsePlaces(placesBody("34003", "Bergen", 14, 2000))!,
      ],
      national: parsePlaces(placesBody(null, null, 11, 1000)),
      readAt: "",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "DIABETES",
      value: 10,
      min: 10,
      median: 12,
      max: 14,
      national: 11,
      mdls: ["3094", "3163"],
    });
  });

  it("MDL state rows leave a lower-bound state unranked", () => {
    const { year, rows } = partdStateRows([NJ, US]);
    expect(year).toBe(2024);
    expect(rows).toEqual([
      { id: "NJ", label: "New Jersey", claims: null, lowerBound: true, rank: null },
    ]);
  });
});
