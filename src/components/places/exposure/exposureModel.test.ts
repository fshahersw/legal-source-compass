import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/exposureGeo.functions", () => ({
  getStateExposure: vi.fn(),
  getCountyExposure: vi.fn(),
  getMdlExposure: vi.fn(),
}));

import {
  boundedLeader,
  boundedTakeaway,
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
  rankText,
  roundSig,
  shortMdlLabel,
  stateMdlRows,
} from "./exposureModel";
import { stateKpis, StateExposureView } from "./StateExposureSection";
import { countyRows } from "./CountyExposurePanel";
import { MdlExposureView, medianText, partdStateRows, pfasStateRows } from "./MdlExposurePanel";

// Shapes as written by scripts/enrichment/exposure_geo (item.exposure).
const GLP1_TITLE =
  "IN RE: Glucagon-like Peptide-1 Receptor Agonists (GLP-1 RAs) Products Liability Litigation";
const partd = (
  usps: string,
  level: "state" | "national",
  series: unknown[],
  rank: unknown = null,
  over: Record<string, unknown> = {},
) => ({
  kind: "partd_mdl_drug",
  mdl: "3094",
  mdl_title: GLP1_TITLE,
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
    name: usps === "US" ? "United States" : usps === "NJ" ? "New Jersey" : usps,
  },
  series,
  latest_rank: rank,
  ...over,
});
const point = (year: number, claims: number | null, missing: string[] = []) => ({
  year,
  claims,
  claims_max: claims === null ? null : claims + 10 * missing.length,
  fills: claims,
  cost: 1,
  prescribers: null,
  benes: null,
  lower_bound: missing.length > 0,
  missing_products: missing,
  products: [],
});
const rank = (r: number, rMax = r, share = 0.05, lower = false) => ({
  year: 2024,
  rank: r,
  rank_max: rMax,
  of: 51,
  measure: "claims",
  share_of_national: share,
  share_is_lower_bound: lower,
});

const NJ = parsePartd(
  partd("NJ", "state", [point(2023, 900), point(2024, 500, ["Zepbound (Tirzepatide)"])], {
    ...rank(3, 3, 0.025, true),
  }),
)!;
const US = parsePartd(partd("US", "national", [point(2023, 10000), point(2024, 20000)]))!;

// NY 2024 as measured in the packet: PPIs (2789) miss only IV esomeprazole, ARBs (2875) are complete.
const nyRecord = (
  mdl: string,
  title: string,
  generics: string[],
  claims: number,
  missing: string[],
) =>
  parsePartd(
    partd("NY", "state", [point(2024, claims, missing)], rank(3), {
      mdl,
      mdl_title: title,
      generic_names: generics,
    }),
  )!;
const nationalRecord = (mdl: string, title: string, generics: string[], claims: number) =>
  parsePartd(
    partd("US", "national", [point(2024, claims)], null, {
      mdl,
      mdl_title: title,
      generic_names: generics,
    }),
  )!;
const PPI_TITLE = "IN RE: Proton-Pump Inhibitor Products Liability Litigation (No. II)";
const ARB_TITLE = "IN RE: Valsartan, Losartan, and Irbesartan Products Liability Litigation";
const GLP = ["Semaglutide", "Tirzepatide"];
const NY = [
  nyRecord("2789", PPI_TITLE, ["Omeprazole", "Esomeprazole Sodium"], 3797196, [
    "Esomeprazole Sodium (Esomeprazole Sodium)",
  ]),
  nyRecord("2875", ARB_TITLE, ["Losartan Potassium"], 2824274, []),
  nyRecord("3094", GLP1_TITLE, GLP, 1473609, []),
  nyRecord("3163", GLP1_TITLE.replace("Products", "NAION Products"), GLP, 1473609, []),
];
const NATIONAL = [
  nationalRecord("2789", PPI_TITLE, ["Omeprazole", "Esomeprazole Sodium"], 59900000),
  nationalRecord("2875", ARB_TITLE, ["Losartan Potassium"], 43500000),
  nationalRecord("3094", GLP1_TITLE, GLP, 21825833),
  nationalRecord("3163", GLP1_TITLE, GLP, 21825833),
];

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
        sources: [
          { label: "FDA label", url: "https://dailymed.nlm.nih.gov/x" },
          { label: "Second label", url: "https://dailymed.nlm.nih.gov/y" },
        ],
      },
    ],
    HEARING: [],
  },
});

const ucmrState = (agency: string, over: Record<string, unknown> = {}) => ({
  kind: "ucmr5_state",
  agency,
  agency_name: agency,
  systems_sampled: 10,
  systems_with_detect: 4,
  systems_pfoa_pfos_at_or_above_4: 2,
  population_with_detect: { sum: 5000, systems_with_population: 4, systems_without_population: 0 },
  population_with_detect_cws: {
    sum: 4000,
    systems_with_population: 3,
    systems_without_population: 0,
  },
  large_systems_sampled: 4,
  large_systems_with_detect: 2,
  systems_detecting_by_analyte: { PFOS: 2, PFOA: 3 },
  first_sample: "2023-01-04",
  last_sample: "2025-12-01",
  epa_file_date: "2026-10-15",
  ...over,
});

describe("exposure model", () => {
  it("parses Part D records with their published interval and rank range", () => {
    expect(NJ.label).toBe("GLP-1 RAs");
    expect(NJ.latestRank).toEqual({
      year: 2024,
      rank: 3,
      rankMax: 3,
      of: 51,
      shareOfNational: 0.025,
      shareIsLowerBound: true,
    });
    expect(NJ.series.at(-1)).toMatchObject({ claims: 500, claimsMax: 510, lowerBound: true });
    expect(latestYear([US])).toBe(2024);
    expect(claimsSeries(NJ, [2022, 2023, 2024])).toEqual([
      { year: "2022", claims: null, partial: false },
      { year: "2023", claims: 900, partial: false },
      { year: "2024", claims: 500, partial: true },
    ]);
  });

  it("keeps a bounded state-year as 'at least' instead of dropping it", () => {
    const rows = stateMdlRows([NJ], [US], 2024);
    expect(rows[0]).toMatchObject({
      claims: 500,
      claimsMax: 510,
      lowerBound: true,
      share: 0.025,
      rank: { rank: 3, rankMax: 3, of: 51 },
    });
  });

  it("NY: names PPIs, whose lower bound exceeds the ARBs, as most prescribed", () => {
    const rows = stateMdlRows(NY, NATIONAL, 2024);
    const lead = boundedLeader(rows)!;
    expect(lead.certain).toBe(true);
    expect(lead.row.mdls).toEqual(["2789"]);
    const kpis = stateKpis({
      usps: "NY",
      partd: { state: NY, national: NATIONAL },
      places: null,
      pfas: null,
      readAt: "",
    });
    expect(kpis[0]).toMatchObject({
      label: "Most-prescribed MDL drug",
      value: "at least 3,797,196 claims",
    });
    expect(kpis[0]?.meta).toContain("MDL 2789");
    expect(boundedTakeaway(rows, (v) => v.toLocaleString("en-US"))).toBe(
      "Proton-Pump Inhibitor · MDL 2789 leads with at least 3,797,196; Valsartan, Losartan, and Irbesartan · MDL 2875 next at 2,824,274",
    );
  });

  it("merges MDLs that count the same drugs into one row", () => {
    const rows = stateMdlRows(NY, NATIONAL, 2024);
    const glp = rows.filter((r) => r.mdls.includes("3094") || r.mdls.includes("3163"));
    expect(glp).toHaveLength(1);
    expect(glp[0]).toMatchObject({
      id: "3094+3163",
      mdls: ["3094", "3163"],
      label: "GLP-1 RAs · MDL 3094, 3163",
      claims: 1473609,
    });
  });

  it("names no leader when another interval could overtake it", () => {
    const close = [
      { label: "A", claims: 100, claimsMax: 100, lowerBound: false },
      { label: "B", claims: 95, claimsMax: 105, lowerBound: true },
    ];
    expect(boundedLeader(close)?.certain).toBe(false);
    expect(boundedTakeaway(close, String)).toBeNull();
    expect(boundedLeader([{ label: "A", claims: 5, claimsMax: null }])?.certain).toBe(true);
    expect(
      boundedLeader([
        { label: "A", claims: 5, claimsMax: 5 },
        { label: "B", claims: 4, claimsMax: null },
      ])?.certain,
    ).toBe(false);
  });

  it("writes ranks as exact, a short range, or not ranked", () => {
    const r = (rank: number, rankMax: number) => ({
      year: 2024,
      rank,
      rankMax,
      of: 51,
      shareOfNational: null,
      shareIsLowerBound: false,
    });
    expect(rankText(r(3, 3))).toBe("3 of 51");
    expect(rankText(r(3, 4))).toBe("3–4 of 51");
    expect(rankText(r(20, 45))).toBeNull();
    expect(rankText(null)).toBeNull();
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

  it("PLACES: only reviewed links count, gaps stay null and every cited source is kept", () => {
    const a = parsePlaces(placesBody("34001", "Atlantic", 10, 1000))!;
    const b = parsePlaces(placesBody("34003", "Bergen", 12, 2000))!;
    const c = parsePlaces(placesBody("34005", "Burlington", null, 3000))!;
    expect(linkedMeasures([a, b]).map((m) => m.id)).toEqual(["DIABETES"]);
    expect(a.measures[0]?.links[0]?.sources.map((s) => s.url)).toEqual([
      "https://dailymed.nlm.nih.gov/x",
      "https://dailymed.nlm.nih.gov/y",
    ]);
    const d = measureDistribution([a, b, c], "DIABETES");
    expect(d.median).toBe(11);
    expect(d.recorded).toBe(2);
    expect(d.items.find((i) => i.fips === "34005")?.value).toBeNull();
    expect(median([])).toBeNull();
  });

  it("PLACES: derived adults are rounded to three significant figures with a range", () => {
    const a = parsePlaces(placesBody("34001", "Atlantic", 10.37, 123457))!;
    const b = parsePlaces(placesBody("34003", "Bergen", 12.11, 234561))!;
    const c = parsePlaces(placesBody("34005", "Burlington", null, 3000))!;
    // 12,802.5 + 28,405.3 = 41,207.8 -> 41,200; lo 11,567.9 + 26,059.7 -> 37,600; hi 14,037.1 + 30,750.9 -> 44,800
    expect(derivedAdults([a, b], "DIABETES")).toEqual({ v: 41200, lo: 37600, hi: 44800 });
    expect(derivedAdults([a, b, c], "DIABETES")).toBeNull();
    expect(roundSig(987654)).toBe(988000);
    expect(roundSig(0)).toBe(0);
  });

  it("UCMR: parses state and system figures, the file date and large systems", () => {
    const s = parseUcmrState(ucmrState("NJ", { population_with_detect_cws: undefined }))!;
    expect(s.byAnalyte.map((a) => a.analyte)).toEqual(["PFOA", "PFOS"]);
    expect(s.populationSampled.sum).toBeNull();
    expect(s.populationWithDetectCws.sum).toBeNull();
    expect(s).toMatchObject({ largeSampled: 4, largeWithDetect: 2, fileDate: "2026-10-15" });
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

  it("headline figures name the leader with 'at least' and use community-system population", () => {
    const kpis = stateKpis({
      usps: "NJ",
      partd: { state: [NJ], national: [US] },
      places: {
        counties: [parsePlaces(placesBody("34001", "Atlantic", 10, 1000))!],
        national: null,
      },
      pfas: {
        state: parseUcmrState(ucmrState("NJ")),
        national: null,
        systems: [],
        systemsTruncated: false,
      },
      readAt: "",
    });
    expect(kpis.map((k) => k.label)).toEqual([
      "Most-prescribed MDL drug",
      "Diagnosed diabetes among adults",
      "Water systems with PFAS detected",
      "People served by those systems",
    ]);
    expect(kpis[0]?.value).toBe("at least 500 claims");
    expect(kpis[1]?.value).toBe("10%");
    expect(kpis[3]?.value).toBe("4,000");
    expect(kpis[3]?.period).toBe("2023–2025 (EPA file of 2026-10-15)");
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
    expect(rows[0]?.sources).toHaveLength(2);
  });

  it("MDL state rows keep a bounded state with its rank, and territories are not compared", () => {
    const PR = parsePartd(partd("PR", "state", [point(2024, 900)]))!;
    const nation = parsePartd(
      partd("US", "national", [point(2023, 10000), point(2024, 20000)], null, {
        state_distribution: {
          year: 2024,
          states: 51,
          states_with_row: 40,
          states_lower_bound: 30,
          median_lo: 1200,
          median_hi: 1210,
        },
      }),
    )!;
    const { year, rows, dist } = partdStateRows([NJ, PR, nation]);
    expect(year).toBe(2024);
    expect(rows.map((r) => [r.id, r.claims, r.claimsMax, r.compared])).toEqual([
      ["PR", 900, 900, false],
      ["NJ", 500, 510, true],
    ]);
    expect(rows[1]?.rank).toMatchObject({ rank: 3, of: 51 });
    expect(dist).toMatchObject({ states: 51, medianLo: 1200, medianHi: 1210 });
    expect(medianText(dist!.medianLo, dist!.medianHi)).toBe("1,200–1,210");
    expect(medianText(5, 5)).toBe("5");
    expect(medianText(null, null)).toBeNull();
  });

  it("PFAS states are compared on large systems, without territories or tribal agencies", () => {
    const states = [
      parseUcmrState(ucmrState("US"))!,
      parseUcmrState(ucmrState("NJ", { large_systems_sampled: 4, large_systems_with_detect: 1 }))!,
      parseUcmrState(ucmrState("NY", { large_systems_sampled: 2, large_systems_with_detect: 2 }))!,
      parseUcmrState(ucmrState("PR", { large_systems_sampled: 1, large_systems_with_detect: 1 }))!,
      parseUcmrState(ucmrState("09"))!,
    ];
    const { compared, median: mid, medianOf, rows } = pfasStateRows(states);
    expect(compared.map((r) => r.id)).toEqual(["NJ", "NY"]);
    expect(rows).toHaveLength(4);
    expect(mid).toBe(0.625);
    expect(medianOf).toBe(2);
  });
});
