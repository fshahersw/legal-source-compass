import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn(), ilikeTerm: (q: string) => `*${q}*` }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  parseDistrictProsecutions,
  parseDistrictSentencing,
  parseExclusionRow,
  parseExclusionsOverview,
  parseFsisChecks,
  parseFsisRow,
  parseOffenses,
  parseTotals,
} from "./enforcementExtra.functions";

// Shapes copied from the published rows (sam_exclusions, oig_leie_exclusions, fsis_recalls,
// ussc_sentencing_districts, eousa_caseload_annual).
describe("parseExclusionRow", () => {
  it("reads a SAM row with its official record link", () => {
    const h = parseExclusionRow("sam", {
      id: "sam:fcdbd4a3-1fa6-4b5b-b135-55e79f258fc2",
      title: "Dr. Ariel Fernandez",
      source_url: "https://sam.gov/exclusion/fcdbd4a3-1fa6-4b5b-b135-55e79f258fc2/view",
      c: {
        classification: "Individual",
        agency: "HHS",
        type: "Ineligible (Proceedings Complete)",
        active: "2026-03-25",
        termination: "2041-03-24",
        place: "Riverside, CT, USA",
        state: "CT",
      },
    });
    expect(h).toMatchObject({
      list: "sam",
      dataset: "sam_exclusions",
      name: "Dr. Ariel Fernandez",
      agency: "HHS",
      start: "2026-03-25",
      end: "2041-03-24",
      state: "CT",
      identifiers: null,
      sourceUrl: "https://sam.gov/exclusion/fcdbd4a3-1fa6-4b5b-b135-55e79f258fc2/view",
    });
  });

  it("keeps Indefinite, identifiers and only 10-digit CIKs", () => {
    const h = parseExclusionRow("sam", {
      id: "sam:46f774dc-79c1-4a03-b480-21a39b3069c8",
      title: "0DAY TECHNOLOGIES",
      source_url: "javascript:alert(1)",
      c: {
        classification: "Special Entity Designation",
        termination: "Indefinite",
        uei: "XPZTY4KVJL51",
        company_cik: "123",
      },
    });
    expect(h?.end).toBe("Indefinite");
    expect(h?.identifiers).toBe("UEI XPZTY4KVJL51");
    expect(h?.companyCik).toBeNull();
    expect(h?.sourceUrl).toBeNull();
  });

  it("reads LEIE rows and rejects rows from the other list or without a name", () => {
    const h = parseExclusionRow("leie", {
      id: "leie:908519d8d98201b1",
      title: "AKINS, DANIEL LEE",
      source_url: "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv",
      c: {
        kind: "Individual",
        general: "PHYSICIAN (MD, DO)",
        code: "1128b4",
        excluded: "2014-07-20",
        place: "CLEARWATER, FL",
        state: "FL",
        npi: "1942203880",
      },
    });
    expect(h).toMatchObject({
      classification: "Individual",
      type: "1128b4",
      start: "2014-07-20",
      end: null,
      identifiers: "NPI 1942203880",
    });
    expect(parseExclusionRow("leie", { id: "sam:x", title: "A", c: {} })).toBeNull();
    expect(parseExclusionRow("sam", { id: "sam:x", title: "", c: {} })).toBeNull();
    expect(parseExclusionRow("sam", { id: "sam:x y", title: "A", c: {} })).toBeNull();
  });
});

describe("parseExclusionsOverview", () => {
  it("reads both dataset summaries and drops malformed agency rows", () => {
    const o = parseExclusionsOverview([
      {
        id: "sam_exclusions",
        m: {
          summary: {
            records: 169031,
            source: {
              file: "SAM_Exclusions_Public_Extract_V2_26295.ZIP",
              retrieved_at: "2026-10-23T01:13:21Z",
              data_page: "https://sam.gov/data-services/Exclusions/Public%20V2?privacy=Public",
            },
            by_agency: [
              { value: "HHS", records: 70193 },
              { value: null, records: 3 },
            ],
          },
        },
      },
      {
        id: "oig_leie_exclusions",
        m: { summary: { records: 84093, source: { retrieved_at: "2026-10-23T01:13:06Z" } } },
      },
    ]);
    expect(o.sam?.records).toBe(169031);
    expect(o.leie?.records).toBe(84093);
    expect(o.samAgencies).toEqual([{ value: "HHS", records: 70193 }]);
    expect(parseExclusionsOverview([]).sam).toBeNull();
  });
});

describe("FSIS", () => {
  it("parses a recall row and restricts links to fsis.usda.gov", () => {
    const r = parseFsisRow({
      id: "fsis:kayem-foods-inc--recalls-meat-and-poultry-products-due-possible-temperature-abuse",
      title: "Kayem Foods Inc. Recalls Meat and Poultry Products Due to Possible Temperature Abuse",
      source_url:
        "https://www.fsis.usda.gov/recalls-alerts/kayem-foods-inc--recalls-meat-and-poultry-products-due-possible-temperature-abuse",
      c: {
        number: "026-2026",
        kind: "Recall",
        class: "I",
        reason: "Processing Defect",
        date: "2026-10-17",
        states: "Nationwide",
        pounds: 1584361,
        establishment: "Kayem Foods Inc.",
      },
    });
    expect(r).toMatchObject({ cls: "I", pounds: 1584361, closed: null, expansion: false });
    expect(r?.sourceUrl).toMatch(/^https:\/\/www\.fsis\.usda\.gov\//);
    expect(
      parseFsisRow({
        id: "fsis:x",
        title: "T",
        source_url: "https://example.com/x",
        c: { class: "IV" },
      }),
    ).toMatchObject({ cls: null, sourceUrl: null });
    expect(parseFsisRow({ id: "other:x", title: "T", c: {} })).toBeNull();
  });

  it("reads the official comparison", () => {
    expect(
      parseFsisChecks({
        official_comparison: [
          {
            year: 2025,
            official_recalls: 42,
            listing_recalls_by_number_year_excluding_expansions: 42,
          },
          { year: "x" },
        ],
      }),
    ).toEqual([{ year: 2025, official: 42, listing: 42 }]);
  });
});

const TXSD_2025 = {
  cases: 7545,
  prison_n: 7356,
  prison_median: 6.71,
  prison_mean: 21.25,
  sentence_median: 7,
  within_pct: 69.6,
  above_pct: 1.4,
  below_pct: 29,
  below_gov: 980,
  range_valid: 7542,
  mm_pct: 9.9,
  sentence_types: { "1": 7191, "2": 165, "3": 53, "4": 136, x: 4 },
};

describe("USSC sentencing", () => {
  it("parses totals and drops unknown sentence-type keys", () => {
    const t = parseTotals(TXSD_2025);
    expect(t?.sentenceTypes).toEqual({ "1": 7191, "2": 165, "3": 53, "4": 136 });
    expect(parseTotals({ cases: "7545" })).toBeNull();
  });

  it("orders offenses and drops the missing-code row", () => {
    const o = parseOffenses([
      { code: 10, label: "Drug Trafficking", cases: 623, prison_median: 60 },
      { code: 17, label: "Immigration", cases: 6049, prison_median: 5 },
      { code: null, label: "Missing", cases: 2 },
    ]);
    expect(o.map((x) => x.label)).toEqual(["Immigration", "Drug Trafficking"]);
  });

  it("builds the district series, ignores rows of another court and computes national shares", () => {
    const s = parseDistrictSentencing({
      courtId: "txsd",
      district: [
        {
          fy: 2025,
          name: "S.D. Texas",
          court: "txsd",
          t: TXSD_2025,
          ov: "OFFGUIDE",
          rv: "SENTRNGE",
        },
        {
          fy: 2024,
          name: "S.D. Texas",
          court: "txsd",
          t: { ...TXSD_2025, cases: 7000 },
          ov: "OFFGUIDE",
        },
        { fy: 2023, name: "N.D. Texas", court: "txnd", t: TXSD_2025 },
      ],
      national: [{ fy: 2025, t: { ...TXSD_2025, cases: 66662 } }],
      latestOffenses: [{ code: 17, label: "Immigration", cases: 6049 }],
      latestNationalOffenses: [
        { code: 17, label: "Immigration", cases: 25119 },
        { code: 10, label: "Drug Trafficking", cases: 16222 },
      ],
      sourceUrl: "https://www.ussc.gov/sites/default/files/zip/opafy25nid_csv.zip",
    });
    expect(s?.years.map((y) => y.fy)).toEqual([2024, 2025]);
    expect(s?.years[1]?.national?.cases).toBe(66662);
    expect(s?.years[0]?.national).toBeNull();
    expect(s?.latest?.fy).toBe(2025);
    expect(s?.latest?.nationalShare["Immigration"]).toBeCloseTo((25119 / 41341) * 100, 5);
    expect(
      parseDistrictSentencing({
        courtId: "txsd",
        district: [],
        national: [],
        latestOffenses: [],
        latestNationalOffenses: [],
        sourceUrl: null,
      }),
    ).toBeNull();
  });
});

describe("EOUSA prosecutions", () => {
  const profile = {
    fy: 2025,
    district_code: "TXS",
    district_name: "TEXAS SOUTHERN",
    court_id: "txsd",
    criminal_lead_charge_records: {
      records: 3751,
      by_program_master: [{ code: "IMMI", label: "IMMIGRATION", records: 2500 }],
      top_program_categories: [
        { code: "055", label: "Violations of the Immigration and Nationality Act", records: 2400 },
      ],
      top_usc_titles: [
        { title: "8", records: 2400 },
        { title: null, records: 3 },
      ],
      top_lead_charges: [{ code: "08 :01326", label: "Reentry of deported alien", records: 1500 }],
    },
    government_defendant_civil: { cases: 1200, participant_rows: 2400 },
    business_property: { civil_cases: 300, criminal_cases: 200 },
  };
  it("parses a district profile", () => {
    const p = parseDistrictProsecutions({
      courtId: "txsd",
      profile,
      national: { lead_charge_records_total: 49107 },
      sourceUrl: "https://www.justice.gov/usao/resources/foia-library/national-caseload-data/2025",
    });
    expect(p).toMatchObject({
      districtCode: "TXS",
      criminalRecords: 3751,
      govDefendantCases: 1200,
      nationalRecords: 49107,
      businessProperty: { civil: 300, criminal: 200 },
    });
    expect(p?.usTitles).toEqual([{ title: "8", records: 2400 }]);
  });
  it("refuses a profile for another court", () => {
    expect(
      parseDistrictProsecutions({ courtId: "txnd", profile, national: null, sourceUrl: null }),
    ).toBeNull();
  });
});
