import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getCaseloadDistrict,
  getCaseloadMdls,
  getCaseloadMethod,
  getCaseloadNational,
  parseDistrictDetail,
  parseDistrictRow,
  parseDistrictRows,
  parseMdlDetail,
  parseMdlRow,
  parseMdlRows,
  parseMethod,
  parseNational,
  parseNosDetail,
  parseNosRow,
  parseNosRows,
  parseStateRow,
  parseWindow,
  parseYears,
  throughDate,
  type DistrictDetail,
  type Listed,
  type MdlRow,
  type NationalCaseload,
  type CaseloadMethod,
} from "./courtCaseload.functions";

const mocked = vi.mocked(restGet);

// Values copied from the published rows (fjc_civil_districts cand, fjc_civil_national US:summary, fjc_civil_mdls mdl:1358 and mdl:2328).
const YEAR_2024 = {
  fy: 2024,
  partial: false,
  filings: 8385,
  terminations: 7000,
  pending_end: 11167,
  median_days: 240,
  p25_days: 91,
  p75_days: 453.25,
  p90_days: 900,
  class_action_pct: 7.1,
  pro_se_plaintiff_pct: 19.6,
  product_pct: 24.3,
  jury_demanded_pct: 51.2,
  settled_pct: 5.5,
  trial_pct: 0.4,
  with_mdl_number: 1200,
  mdl_transfer_in: 30,
  mdl_originating: 2000,
};
const YEAR_2025 = {
  ...YEAR_2024,
  fy: 2025,
  filings: 10708,
  terminations: 7536,
  pending_end: 14341,
  median_days: 200,
};
const YEAR_2026 = {
  fy: 2026,
  partial: true,
  filings: 447,
  terminations: 398,
  pending_end: 528,
  median_days: 138.5,
  p25_days: 74,
  p75_days: 335,
};
const WINDOW = {
  fy_from: 2021,
  fy_to: 2025,
  filings: 45767,
  groups: [
    {
      group: "product",
      label: "Product liability and health-care / pharma injury",
      filings: 12912,
      share_pct: 28.2,
      terminations: 11194,
      median_days: 763,
      settled_pct: 29.9,
      trial_pct: 0,
    },
    {
      group: "civil_rights",
      label: "Civil rights",
      filings: 6990,
      share_pct: 15.3,
      terminations: 7277,
      median_days: 219,
      settled_pct: 32.3,
      trial_pct: 0.7,
    },
    { group: "", label: "Dropped: no key", filings: 1, share_pct: 0 },
  ],
  top_nos: [
    { filings: 11855, label: "Personal Injury - Product Liability", nos: 365, share_pct: 25.9 },
    { filings: 3649, label: "Americans with Disabilities Act - Other", nos: 446, share_pct: 8 },
    { filings: 5, label: "", nos: 999 },
  ],
  jurisdiction: [
    { code: 3, filings: 21372, label: "Federal question", share_pct: 46.7 },
    { code: 4, filings: 19075, label: "Diversity of citizenship", share_pct: 41.7 },
    { code: 9, filings: "many", label: "Bad count and no share" },
  ],
  origin: [{ code: 1, filings: 27562, label: "Original proceeding", share_pct: 60.2 }],
  disposition_groups: [
    { group: "Dismissed", share_pct: 75.6, terminations: 32147 },
    { group: "Judgment", share_pct: 18, terminations: 7636 },
  ],
  dispositions: [
    {
      code: 12,
      group: "Dismissed",
      label: "Dismissed: voluntarily",
      share_pct: 39.4,
      terminations: 16770,
    },
  ],
  procedural_progress: [
    {
      code: 1,
      label: "No court action",
      share_pct: 47.9,
      stage: "Before issue joined",
      terminations: 20355,
    },
  ],
};

describe("parseYears", () => {
  it("keeps readable years in order, flags the partial one, and nulls bad values", () => {
    const years = parseYears(
      [
        YEAR_2026,
        YEAR_2025,
        { ...YEAR_2024, class_action_pct: 140, filings: -3, median_days: "slow" },
      ],
      2025,
    );
    expect(years.map((y) => y.fy)).toEqual([2024, 2025, 2026]);
    expect(years.map((y) => y.partial)).toEqual([false, false, true]);
    const y24 = years[0]!;
    expect(y24.classActionPct).toBeNull();
    expect(y24.filings).toBeNull();
    expect(y24.medianDays).toBeNull();
    expect(y24.terminations).toBe(7000);
    expect(years[1]!.p75Days).toBe(453.25);
  });

  it("drops rows with no usable fiscal year and repeated years", () => {
    const years = parseYears(
      [
        { filings: 5 },
        { fy: "2025", filings: 5 },
        { fy: 2025.5, filings: 5 },
        { fy: 2025, filings: 1 },
        { fy: 2025, filings: 2 },
        null,
        7,
      ],
      null,
    );
    expect(years).toHaveLength(1);
    expect(years[0]!.filings).toBe(1);
  });

  it("treats a year after the latest complete year as partial even without the flag", () => {
    const years = parseYears(
      [
        { fy: 2025, filings: 1 },
        { fy: 2026, filings: 1 },
      ],
      2025,
    );
    expect(years.map((y) => y.partial)).toEqual([false, true]);
  });

  it("returns nothing for a non-array", () => {
    expect(parseYears(undefined, 2025)).toEqual([]);
    expect(parseYears({ fy: 2025 }, 2025)).toEqual([]);
  });
});

describe("parseWindow", () => {
  it("keeps the readable mix rows and drops the ones with no key, label or numbers", () => {
    const w = parseWindow(WINDOW)!;
    expect(w.fyFrom).toBe(2021);
    expect(w.groups.map((g) => g.group)).toEqual(["product", "civil_rights"]);
    expect(w.topNos.map((n) => n.nos)).toEqual([365, 446]);
    expect(w.jurisdiction.map((j) => j.label)).toEqual([
      "Federal question",
      "Diversity of citizenship",
    ]);
    expect(w.dispositionGroups[0]).toMatchObject({
      label: "Dismissed",
      count: 32147,
      sharePct: 75.6,
    });
    expect(w.dispositions[0]!.group).toBe("Dismissed");
    expect(w.procedural[0]!.group).toBe("Before issue joined");
  });

  it("is null when the window is not a readable range", () => {
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow({ fy_from: 2025, fy_to: 2021 })).toBeNull();
    expect(parseWindow({ fy_from: "2021", fy_to: 2025 })).toBeNull();
  });
});

describe("parseNational", () => {
  it("reads the series, the latest complete year and the partial year", () => {
    const n = parseNational({
      latest_fy: 2025,
      partial_fy: 2026,
      series: [YEAR_2025, YEAR_2026, { fy: 2024 }],
      window: WINDOW,
    })!;
    expect(n.latestFy).toBe(2025);
    expect(n.partialFy).toBe(2026);
    expect(n.years.map((y) => y.fy)).toEqual([2024, 2025, 2026]);
    expect(n.years[0]!.filings).toBeNull();
    expect(n.window?.filings).toBe(45767);
  });

  it("falls back to the last complete year when none is declared, and is null with no usable series", () => {
    expect(parseNational({ series: [YEAR_2025, YEAR_2026] })!.latestFy).toBe(2025);
    expect(parseNational({ latest_fy: 2025, series: [] })).toBeNull();
    expect(parseNational({ latest_fy: 2025, series: [{ nope: true }] })).toBeNull();
    expect(parseNational("x")).toBeNull();
  });
});

describe("districts", () => {
  const cell = {
    circuit: "Ninth Circuit",
    class_action_pct: 8.2,
    court: "District Court, N.D. California",
    filings: 10708,
    median_days: 200,
    pending: 14341,
    pro_se_pct: 20.4,
    product_pct: 30.9,
    state: "CA",
    terminations: 7536,
    trial_pct: 0.4,
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: "cand",
    cells: cell,
    links: [{ label: "Court profile", url: "/courts/cand" }],
    filters: { circuit: ["ca9"], state: ["CA"] },
    ...over,
  });

  it("reads a district row and links its court page only from its own links", () => {
    const d = parseDistrictRow(row())!;
    expect(d).toMatchObject({
      id: "cand",
      state: "CA",
      circuitId: "ca9",
      filings: 10708,
      hasCourtPage: true,
    });
    expect(parseDistrictRow(row({ links: [{ url: "/courts/cacd" }] }))!.hasCourtPage).toBe(false);
    expect(parseDistrictRow(row({ links: undefined }))!.hasCourtPage).toBe(false);
  });

  it("shows unknown values as null rather than zero", () => {
    const d = parseDistrictRow(
      row({ cells: { ...cell, median_days: null, pending: "n/a", trial_pct: 120 } }),
    )!;
    expect(d.medianDays).toBeNull();
    expect(d.pending).toBeNull();
    expect(d.trialPct).toBeNull();
    expect(d.filings).toBe(10708);
  });

  it("drops a row with no court name, a bad id or no cells, and counts what it dropped", () => {
    const listed = parseDistrictRows(
      [
        row(),
        row({ id: "CAND" }),
        row({ id: "xx", cells: { ...cell, court: "" } }),
        row({ id: "nocells", cells: null }),
        row(),
      ],
      94,
    );
    expect(listed.rows.map((r) => r.id)).toEqual(["cand"]);
    expect(listed.dropped).toBe(4);
    expect(listed.total).toBe(94);
  });

  it("reads the rank pairs and drops the malformed ones", () => {
    const d = parseDistrictDetail("cand", {
      name: "District Court, N.D. California",
      state: "CA",
      circuit: "ca9",
      latest_fy: 2025,
      series: [YEAR_2025],
      window: WINDOW,
      ranks: {
        filings: [6, 94],
        pending_end: [5, 94],
        median_days: [95, 94],
        class_action_pct: [1],
        trial_pct: [0, 94],
        product_pct: ["8", 94],
        settled_pct: [75, 94, 3],
        unknown_metric: [1, 2],
      },
      change_vs_prior_fy: { filings_pct: 27.7, median_days_delta: -424, pending_pct: 28.4 },
    }) as DistrictDetail;
    expect(d.ranks).toEqual([
      { metric: "filings", rank: 6, of: 94 },
      { metric: "pending_end", rank: 5, of: 94 },
    ]);
    expect(d.change).toEqual({ filingsPct: 27.7, medianDaysDelta: -424, pendingPct: 28.4 });
    expect(d.latestFy).toBe(2025);
  });

  it("returns null for a profile with no name, year or series", () => {
    expect(parseDistrictDetail("cand", { latest_fy: 2025, series: [YEAR_2025] })).toBeNull();
    expect(parseDistrictDetail("cand", { name: "x", series: [YEAR_2025] })).toBeNull();
    expect(parseDistrictDetail("cand", { name: "x", latest_fy: 2025, series: [] })).toBeNull();
    expect(parseDistrictDetail("cand", null)).toBeNull();
  });

  it("reads state roll-ups and drops codes that are not two capital letters", () => {
    expect(
      parseStateRow({
        id: "CA",
        cells: {
          districts: 4,
          filings: 37443,
          terminations: 32280,
          pending: 34791,
          median_days: 147,
        },
      }),
    ).toEqual({
      code: "CA",
      districts: 4,
      filings: 37443,
      terminations: 32280,
      pending: 34791,
      medianDays: 147,
    });
    expect(parseStateRow({ id: "ca", cells: {} })).toBeNull();
    expect(parseStateRow({ id: "CA", cells: null })).toBeNull();
  });
});

describe("nature of suit", () => {
  const nos365 = {
    id: "nos:365",
    cells: {
      class_action_pct: 0.3,
      code: 365,
      filings: 22881,
      group: "Product liability and health-care / pharma injury",
      median_days: 1438,
      name: "Personal Injury - Product Liability",
      pro_se_pct: 1.6,
      settled_pct: 0.4,
      terminations: 152272,
      trial_pct: 0,
    },
    filters: { kind: ["nos"], group: ["product"] },
  };
  const groupProduct = {
    id: "group:product",
    cells: {
      class_action_pct: 0.5,
      code: "group",
      filings: 45712,
      group: "Product liability and health-care / pharma injury",
      median_days: 1449,
      name: "Product liability and health-care / pharma injury",
      pro_se_pct: 1.3,
      settled_pct: 2.3,
      terminations: 167662,
      trial_pct: 0,
    },
    filters: { kind: ["group"], group: ["product"] },
  };
  const inactive = {
    id: "nos:444",
    cells: {
      class_action_pct: null,
      code: 444,
      filings: null,
      group: "Codes not in a group above",
      median_days: null,
      name: "Code 444 (not in the codebook)",
      pro_se_pct: null,
      settled_pct: null,
      terminations: null,
      trial_pct: null,
    },
    filters: { kind: ["nos"], group: ["unmapped"] },
  };

  it("reads a code and a group, with the group key from the filters", () => {
    expect(parseNosRow(nos365)).toMatchObject({
      kind: "nos",
      code: 365,
      groupKey: "product",
      filings: 22881,
      terminations: 152272,
    });
    expect(parseNosRow(groupProduct)).toMatchObject({
      kind: "group",
      code: null,
      groupKey: "product",
      filings: 45712,
    });
  });

  it("keeps a code with no cases in the latest year, with every figure Not recorded", () => {
    const n = parseNosRow(inactive)!;
    expect(n.filings).toBeNull();
    expect(n.medianDays).toBeNull();
    expect(n.name).toBe("Code 444 (not in the codebook)");
  });

  it("drops malformed ids, codes without a number, and repeated ids", () => {
    const listed = parseNosRows(
      [
        nos365,
        { ...nos365, id: "nos:36" },
        { ...nos365, id: "nos:366", cells: { ...nos365.cells, code: "x" } },
        { ...nos365, cells: {} },
        groupProduct,
        nos365,
      ],
      130,
    );
    expect(listed.rows.map((r) => r.id)).toEqual(["nos:365", "group:product"]);
    expect(listed.dropped).toBe(4);
  });

  it("reads a detail record with its members and leading districts, dropping bad court ids", () => {
    const d = parseNosDetail("group:product", {
      group: "product",
      label: "Product liability and health-care / pharma injury",
      members: [{ name: "Personal Injury - Product Liability", nos: 365 }, { name: "no code" }],
      series: [YEAR_2025],
      window: WINDOW,
      top_districts: [
        { court_id: "flnd", filings: 189674 },
        { court_id: "FLND", filings: 5 },
        { court_id: "scd" },
      ],
    })!;
    expect(d.kind).toBe("group");
    expect(d.members).toEqual([{ nos: 365, name: "Personal Injury - Product Liability" }]);
    expect(d.topDistricts).toEqual([{ courtId: "flnd", filings: 189674 }]);
    expect(parseNosDetail("nos:365", { name: "x", series: [] })!.years).toEqual([]);
    expect(parseNosDetail("bad", { name: "x" })).toBeNull();
    expect(parseNosDetail("nos:365", {})).toBeNull();
  });
});

describe("MDL association", () => {
  const cells = (mdl: number, over: Record<string, unknown> = {}) => ({
    cases: 27,
    dismissed_other: 7,
    districts: 3,
    first_filed: "2003-02-14",
    last_filed: "2015-07-31",
    mdl,
    mdl_transfer_out: 3,
    median_days: 1517,
    pending: 5,
    settled: 0,
    top_district: "nysd",
    ...over,
  });
  const linksFor = (mdl: number) => [
    { label: "lens", url: `/matters/lens/${mdl}` },
    { label: "record", url: `/records/mdls/${mdl}` },
    { label: "source", url: "https://www.fjc.gov/research/idb" },
  ];

  it("offers the lens and record links only for a JPML number whose own links carry them", () => {
    const m = parseMdlRow(
      { id: "mdl:1358", cells: cells(1358), inCorpus: true },
      new Map([["mdl:1358", linksFor(1358)]]),
    )!;
    expect(m).toMatchObject({
      inJpml: true,
      lensHref: "/matters/lens/1358",
      recordHref: "/records/mdls/1358",
    });
  });

  it("never builds a link from the number alone, from another number's link, or for a number outside the JPML records", () => {
    const none = parseMdlRow({ id: "mdl:1358", cells: cells(1358), inCorpus: true }, new Map())!;
    expect(none.lensHref).toBeNull();
    const other = parseMdlRow(
      { id: "mdl:1358", cells: cells(1358), inCorpus: true },
      new Map([["mdl:1358", linksFor(1359)]]),
    )!;
    expect(other.lensHref).toBeNull();
    expect(other.recordHref).toBeNull();
    const outside = parseMdlRow(
      { id: "mdl:2328", cells: cells(2328), inCorpus: false },
      new Map([["mdl:2328", linksFor(2328)]]),
    )!;
    expect(outside.inJpml).toBe(false);
    expect(outside.lensHref).toBeNull();
  });

  it("keeps the number as recorded, including 0, and nulls an unknown median", () => {
    const zero = parseMdlRow({
      id: "mdl:0",
      cells: cells(0, { median_days: null, first_filed: "1990-8-24" }),
      inCorpus: false,
    })!;
    expect(zero.mdl).toBe(0);
    expect(zero.medianDays).toBeNull();
    expect(zero.firstFiled).toBeNull();
  });

  it("drops rows whose id does not match the number or that have no case count, and keeps the rest", () => {
    const listed: Listed<MdlRow> = parseMdlRows(
      [
        { id: "mdl:1358", cells: cells(1358), inCorpus: true },
        { id: "mdl:9", cells: cells(1358), inCorpus: false },
        { id: "mdl:5", cells: cells(5, { cases: null }), inCorpus: false },
        { id: "mdl:7", cells: cells(7, { cases: -1 }), inCorpus: false },
        { id: "mdl:1358", cells: cells(1358), inCorpus: true },
      ],
      [{ id: "mdl:1358", links: linksFor(1358) }],
      953,
    );
    expect(listed.rows.map((r) => r.id)).toEqual(["mdl:1358"]);
    expect(listed.rows[0]!.lensHref).toBe("/matters/lens/1358");
    expect(listed.dropped).toBe(4);
    expect(listed.total).toBe(953);
  });

  it("reads a detail record, keeping the defendant text exactly and ordering by cases", () => {
    const d = parseMdlDetail({
      mdl: 2328,
      in_corpus: false,
      by_fy: [
        { fy: 2013, cases: 2 },
        { fy: 2012, cases: 30 },
        { fy: "x", cases: 1 },
      ],
      defendants: [
        { cases: 1, first_listed_defendant: "SCP DISTRIBUTORS LLC, ET AL" },
        { cases: 31, first_listed_defendant: "POOL CORPORATION, ET AL" },
        { cases: 3 },
      ],
      districts: [
        { cases: 32, court_id: "laed" },
        { cases: 1, court_id: "BAD" },
      ],
      nos: [
        { cases: 31, label: "Antitrust", nos: 410 },
        { cases: 1, label: "Other Contract Actions", nos: 190 },
      ],
      totals: {
        cases: 32,
        class_action: 27,
        districts: 1,
        first_filed: "2011-11-23",
        last_filed: "2012-05-17",
        median_days: 1597.5,
        mdl_transfer_out: 0,
        originating: 0,
        pending: 0,
        settled: 0,
        transferred_in: 6,
        trial: 0,
        with_days: 32,
      },
    })!;
    expect(d.byFy.map((b) => b.fy)).toEqual([2012, 2013]);
    expect(d.defendants.map((x) => x.name)).toEqual([
      "POOL CORPORATION, ET AL",
      "SCP DISTRIBUTORS LLC, ET AL",
    ]);
    expect(d.districts).toEqual([{ courtId: "laed", cases: 32 }]);
    expect(d.nos[0]).toEqual({ nos: 410, label: "Antitrust", cases: 31 });
    expect(d.totals).toMatchObject({
      cases: 32,
      medianDays: 1597.5,
      transferredIn: 6,
      withDays: 32,
    });
    expect(d.inJpml).toBe(false);
    expect(parseMdlDetail({ mdl: 1, totals: {} })).toBeNull();
    expect(parseMdlDetail(null)).toBeNull();
  });
});

describe("method and checks", () => {
  const summary = {
    built_at: "2026-10-18T18:23:13Z",
    codebook: "https://www.fjc.gov/codebook.pdf",
    counting_rules: [
      "A case belongs to the statistical year of its filing or termination date.",
      "",
      5,
    ],
    formulas: {
      median_days: "median of TERMDATE - FILEDATE",
      trial_pct: "terminations with disposition 7, 8 or 9 divided by all terminations",
      bad: 3,
    },
    grouping_note: "NOS groups are this project's grouping.",
    latest_complete_fy: 2025,
    partial_fy: 2026,
    quality: {
      csv_records_loaded: 10959535,
      csv_records_rejected_by_reader: 1190,
      fy_filed_range: [1901, 2026],
      fy_terminated_range: [1987, 2026],
      missing_disp_terminated: 0,
      missing_nos: 0,
      pending: 479405,
      terminated: 7297049,
      terminated_before_filed: 0,
      terminated_with_valid_duration: 7297049,
      unmapped_nos_rows: 18755,
    },
    ranks_note: "Ranks are competition ranks.",
    snapshot: "cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30",
    source: "Federal Judicial Center, Integrated Database (IDB)",
    source_file: "https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip",
    source_page:
      "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
    terms: "Public data published by the Federal Judicial Center.",
    validation: {
      independent_recheck: {
        figures_recomputed: 115,
        method: "independent csv-module pass",
        mismatches: 0,
        note: "1,190 lines rejected",
        raw_rows_read: 10960173,
      },
      vs_ao: {
        scope: "94 districts x FY2014-FY2025",
        source: "court_stats_district_nos",
        reading: "IDB terminations equal the AO's in every district-year.",
        filings: { compared: 1128, exact: 189, within_1pct_or_1_case: 1045 },
        pending: { compared: 1128, exact: 119, within_1pct_or_1_case: 913 },
        terminations: { compared: 1128, exact: 1128 },
        worst_filing_differences: [
          { ao: 18798, court_id: "wvsd", diff: 4866, fy: 2015, idb: 23664 },
          { ao: 252, court_id: "wyd", diff: 94, fy: 2021, idb: "346" },
        ],
      },
    },
    window: "FY2021–FY2025",
  };

  it("reads the validation, recheck and quality blocks", () => {
    const m = parseMethod({
      districts: summary,
      mdls: {
        evidence_rule: "Association comes from MDLDOCK.",
        non_numeric_mdl_values_excluded: { distinct_values: 108, records: 973 },
      },
    }) as CaseloadMethod;
    expect(m.vsAo?.terminations).toEqual({ compared: 1128, exact: 1128, withinOnePct: null });
    expect(m.vsAo?.filings).toEqual({ compared: 1128, exact: 189, withinOnePct: 1045 });
    expect(m.vsAo?.pending?.exact).toBe(119);
    expect(m.vsAo?.worst).toEqual([
      { courtId: "wvsd", fy: 2015, idb: 23664, ao: 18798, diff: 4866 },
    ]);
    expect(m.recheck).toMatchObject({ figures: 115, mismatches: 0, rawRows: 10960173 });
    expect(m.quality).toMatchObject({
      rowsLoaded: 10959535,
      rowsRejected: 1190,
      filedRange: [1901, 2026],
      terminatedRange: [1987, 2026],
      unmappedNosRows: 18755,
    });
    expect(m.countingRules).toEqual([
      "A case belongs to the statistical year of its filing or termination date.",
    ]);
    expect(m.formulas.map((f) => f.key)).toEqual(["median_days", "trial_pct"]);
    expect(m.through).toBe("2026-06-30");
    expect(m.latestCompleteFy).toBe(2025);
    expect(m.mdl).toEqual({
      evidenceRule: "Association comes from MDLDOCK.",
      nonNumeric: { distinctValues: 108, records: 973 },
    });
  });

  it("drops a comparison that cannot be right and leaves the block out when none is readable", () => {
    const bad = {
      ...summary,
      validation: {
        vs_ao: {
          filings: { compared: 10, exact: 11 },
          pending: { compared: 0, exact: 0 },
          terminations: "all",
        },
      },
    };
    const m = parseMethod({ districts: bad })!;
    expect(m.vsAo).toBeNull();
    expect(m.recheck).toBeNull();
    const odd = parseMethod({
      districts: {
        ...summary,
        validation: { vs_ao: { filings: { compared: 10, exact: 4, within_1pct_or_1_case: 3 } } },
      },
    })!;
    expect(odd.vsAo?.filings).toEqual({ compared: 10, exact: 4, withinOnePct: null });
  });

  it("reads the cut-off date only from a stated 'through' date", () => {
    expect(throughDate("filing dates through 2026-06-30")).toBe("2026-06-30");
    expect(throughDate("snapshot of 2026-06-30")).toBeNull();
    expect(throughDate("through 2026-13-45")).toBeNull();
    expect(throughDate(null)).toBeNull();
    expect(parseMethod({ districts: null })).toBeNull();
  });
});

describe("server reads", () => {
  beforeEach(() => {
    mocked.mockReset();
  });

  it("reads the national record by its id and returns null when it cannot be parsed", async () => {
    mocked.mockResolvedValueOnce({
      rows: [{ p: { latest_fy: 2025, series: [YEAR_2025] } }],
      total: null,
    });
    const national = getCaseloadNational as unknown as () => Promise<NationalCaseload | null>;
    const first = await national();
    expect(first?.latestFy).toBe(2025);
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.fjc_civil_national&id=eq.US:summary");
    // Served from the ten-minute memo: no second read.
    await national();
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("reads a district by exact id and returns null for an unreadable record", async () => {
    mocked.mockResolvedValueOnce({ rows: [{ p: null }], total: null });
    const read = getCaseloadDistrict as unknown as (a: {
      data: { id: string };
    }) => Promise<DistrictDetail | null>;
    expect(await read({ data: { id: "zzzz" } })).toBeNull();
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.fjc_civil_districts&id=eq.zzzz");
  });

  it("reads the MDL numbers and, separately, the links of only the numbers already in the JPML records", async () => {
    mocked.mockImplementation((async (path: string) => {
      if (path.includes("select=id,links"))
        return { rows: [{ id: "mdl:1358", links: [{ url: "/matters/lens/1358" }] }], total: null };
      return {
        rows: [
          { id: "mdl:1358", cells: { mdl: 1358, cases: 27, pending: 5 }, inCorpus: true },
          { id: "mdl:1", cells: { mdl: 1, cases: 6 }, inCorpus: false },
        ],
        total: 2,
      };
    }) as never);
    const read = getCaseloadMdls as unknown as () => Promise<Listed<MdlRow>>;
    const listed = await read();
    expect(listed.rows.map((r) => [r.mdl, r.inJpml, r.lensHref])).toEqual([
      [1358, true, "/matters/lens/1358"],
      [1, false, null],
    ]);
    const paths = mocked.mock.calls.map((c) => c[0]);
    expect(
      paths.some(
        (p) =>
          p.includes("dataset=eq.fjc_civil_mdls") && p.includes("in_corpus=cs.%5B%22yes%22%5D"),
      ),
    ).toBe(true);
    expect(paths.every((p) => !p.includes("dataset=eq.fjc_civil_districts"))).toBe(true);
  });

  it("reads only the dataset summaries it needs for the method tab", async () => {
    mocked.mockResolvedValueOnce({
      rows: [
        {
          id: "fjc_civil_districts",
          summary: { source: "Federal Judicial Center", snapshot: "through 2026-06-30" },
        },
        { id: "fjc_civil_mdls", summary: { evidence_rule: "rule" } },
      ],
      total: null,
    });
    const read = getCaseloadMethod as unknown as () => Promise<CaseloadMethod | null>;
    const m = await read();
    expect(m?.source).toBe("Federal Judicial Center");
    expect(m?.mdl?.evidenceRule).toBe("rule");
    expect(mocked.mock.calls[0]![0]).toContain(
      "corpus_datasets?select=id,summary:metadata->summary&id=in.(fjc_civil_districts,fjc_civil_mdls)",
    );
  });
});
