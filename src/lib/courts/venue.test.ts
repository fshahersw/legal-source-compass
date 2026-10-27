import { describe, expect, it } from "vitest";
import {
  hubSummary,
  hubTrendRows,
  parseHubDistrict,
  rankHubs,
  reconciliationNotes,
  valueAt,
} from "./mdlHubs";
import {
  juneRows,
  latestValue,
  median,
  medianByPeriod,
  medianDistrict,
  parseFcmsDistrict,
  rankText,
  span,
} from "./fcmsHistory";
import { aoDisplayName, buildBoard, vacantRankText, type VacancyInput } from "./vacancyMdl";
import { ageShares, districtCvap, parseCountyDistrict, parseCvapCounty } from "./venueScorecard";
import {
  dojCoverage,
  enforcementYears,
  lastCompleteYears,
  parseSecRow,
} from "./districtEnforcement";

// Shapes copied from court_jb_districts records (njd, laed; values shortened to 5 fiscal years).
const years = [2021, 2022, 2023, 2024, 2025];
const njd = {
  id: "njd",
  source_url: "https://www.uscourts.gov/sites/default/files/document/jb_c4a_0930.2025.xlsx",
  item: {
    court_id: "njd",
    title: "U.S. District Court, D. New Jersey",
    years,
    badges: ["Source total mismatch"],
    unreconciled_years: { mdl_in_cum: [2011] },
    dash: { trials_civil_jury: [2021] },
    series: {
      mdl_pending: [52606, 55266, 70165, 74276, 83463],
      mdl_pending_share_of_national_pct: [13.42, 14.09, 16.82, 22.75, 42.34],
      mdl_in_12m: [625, 79, 47, 100, 37],
    },
  },
};
const laed = {
  id: "laed",
  source_url: "https://www.uscourts.gov/sites/default/files/document/jb_c4a_0930.2025.xlsx",
  item: {
    court_id: "laed",
    title: "U.S. District Court, E.D. Louisiana",
    years,
    unreconciled_years: { mdl_pending: [2023] },
    dash: { mdl_pending: [2022] },
    series: {
      mdl_pending: [21052, 13919, 11471, 10568, 3841],
      mdl_pending_share_of_national_pct: [5.37, 3.55, 2.75, 3.24, 1.95],
    },
  },
};

describe("mdlHubs", () => {
  const a = parseHubDistrict(njd)!;
  const b = parseHubDistrict(laed)!;
  it("parses a district, strips the court prefix and keeps a printed dash as a gap", () => {
    expect(a.name).toBe("D. New Jersey");
    expect(valueAt(a, "mdl_pending", 2025)).toBe(83463);
    expect(valueAt(b, "mdl_pending", 2022)).toBeNull();
    expect(valueAt(a, "mdl_out_12m", 2025)).toBeNull();
  });
  it("writes notes only for the series a chart shows, never a record-level badge", () => {
    expect(reconciliationNotes(a, ["mdl_pending"])).toEqual({ shown: [], otherSeries: 1 });
    expect(reconciliationNotes(b, ["mdl_pending"]).shown).toEqual([
      "MDL actions pending: FY2023 did not reconcile with the published table total",
      "MDL actions pending: FY2022 printed as a dash (Not recorded)",
    ]);
  });
  it("ranks hubs and counts the districts that reach 75% only when every share is recorded", () => {
    expect(rankHubs([b, a], 2025).map((r) => r.d.courtId)).toEqual(["njd", "laed"]);
    const s = hubSummary([a, b], 2025);
    expect(s.top?.courtId).toBe("njd");
    expect(s.districtsFor75).toBeNull(); // 42.34 + 1.95 never reaches 75
    expect(s.topFiveYearsEarlier).toBeNull(); // FY2020 is not in the shortened series
    expect(hubSummary([a, b], 2024).topFiveYearsEarlier).toBeNull();
  });
  it("names the district that actually led five years earlier, not the current leader's old value", () => {
    // FY2020: flnd led with 203,336 (62.14%); njd held 36,401. FY2025: njd leads.
    const mk = (id: string, name: string, pending: number[], share: number[]) =>
      parseHubDistrict({
        id,
        source_url: "https://www.uscourts.gov/x.xlsx",
        item: {
          court_id: id,
          title: `U.S. District Court, ${name}`,
          years: [2020, 2025],
          series: { mdl_pending: pending, mdl_pending_share_of_national_pct: share },
        },
      })!;
    const s = hubSummary(
      [
        mk("njd", "D. New Jersey", [36401, 83463], [11.1, 42.34]),
        mk("flnd", "N.D. Florida", [203336, 6414], [62.14, 3.3]),
      ],
      2025,
    );
    expect(s.top?.courtId).toBe("njd");
    expect(s.leaderFiveYearsEarlier).toMatchObject({ courtId: "flnd", pending: 203336, share: 62.14 });
    expect(s.topFiveYearsEarlier).toBe(36401);
  });
  it("builds chart rows with gaps as null", () => {
    const rows = hubTrendRows([a, b]);
    expect(rows[1]).toEqual({ fy: "FY2022", njd: 55266, laed: null });
  });
});

// Shape of a latest-edition fcms_court_profiles read (history shortened to 6 periods).
const fcmsRow = (court: string, trial: (number | null)[], over3y: (number | null)[]) => ({
  court,
  name: "D. New Jersey",
  source_url:
    "https://www.uscourts.gov/sites/default/files/document/fcms_na_distprofile0630.2026.pdf#page=15",
  rank: { median_months_civil_to_trial: [5, 48], civil_over_3y_pct: [4, 94] },
  history: {
    periods: ["2024-06-30", "2024-09-30", "2025-06-30", "2025-09-30", "2026-03-31", "2026-06-30"],
    series: {
      median_months_civil_to_trial: trial,
      civil_over_3y_pct: over3y,
    },
  },
});

describe("fcmsHistory", () => {
  const d = parseFcmsDistrict(
    fcmsRow("njd", [57.8, 60.4, 63.4, 62.4, 59.2, 56.9], [59.5, 62.5, 58.1, 57, 56.3, 55.2]),
  )!;
  it("keeps only the June periods, so fiscal-year and mid-year windows never mix", () => {
    expect(d.june.median_months_civil_to_trial.map((p) => p.label)).toEqual([
      "Jun 2024",
      "Jun 2025",
      "Jun 2026",
    ]);
    expect(latestValue(d, "civil_over_3y_pct")?.value).toBe(55.2);
    expect(d.rank.median_months_civil_to_trial).toEqual({ rank: 5, of: 48 });
    expect(d.latest).toBe("2026-06-30");
  });
  it("keeps a null as Not recorded and takes the median of districts, not a pooled figure", () => {
    const mn = parseFcmsDistrict(
      fcmsRow("mnd", [null, null, null, null, null, null], [40, 41, 42, 43, 44, 43.6]),
    )!;
    expect(latestValue(mn, "median_months_civil_to_trial")?.value).toBeNull();
    expect(medianDistrict([d, mn], "median_months_civil_to_trial")).toEqual({
      value: 56.9,
      recorded: 1,
      of: 2,
    });
    expect(median([1, 3, null, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(juneRows(mn, ["civil_over_3y_pct"]).at(-1)).toEqual({
      period: "Jun 2026",
      civil_over_3y_pct: 43.6,
    });
    expect(span(d, "civil_over_3y_pct")).toMatchObject({ years: 2 });
    const byPeriod = medianByPeriod([d, mn], "civil_over_3y_pct", 2);
    expect(byPeriod.get("Jun 2026")?.recorded).toBe(2);
    expect(byPeriod.get("Jun 2026")?.value).toBeCloseTo(49.4, 9);
    expect(medianByPeriod([d, mn], "median_months_civil_to_trial", 2).get("Jun 2026")).toEqual({
      value: null,
      recorded: 1,
    });
  });
  it("states a computed rank with its ties", () => {
    const a = parseFcmsDistrict(fcmsRow("njd", [1, 1, 1, 1, 1, 50], [1, 1, 1, 1, 1, 55.2]))!;
    const b = parseFcmsDistrict(fcmsRow("nysd", [1, 1, 1, 1, 1, 50], [1, 1, 1, 1, 1, 40]))!;
    expect(rankText([a, b], a, "civil_over_3y_pct")).toBe("rank 4 of 94 districts (1 = highest)");
    expect(rankText([a, b], a, "median_months_civil_to_trial")).toBe(
      "rank 5 of 48 districts (1 = highest), tied with 1",
    );
    expect(rankText([a, b], a, "vacant_judgeship_months")).toBe("rank not recorded");
  });
  it("rejects a row without history or with a malformed court id", () => {
    expect(parseFcmsDistrict({ court: "njd" })).toBeNull();
    expect(parseFcmsDistrict({ ...fcmsRow("N J", [], []) })).toBeNull();
  });
});

describe("vacancyMdl", () => {
  const vac = (o: Partial<VacancyInput>): VacancyInput => ({
    id: "v",
    courtId: "cacd",
    courtName: "District Court, C.D. California",
    status: "open",
    incumbent: "Staton,Josephine L.",
    reason: "Senior",
    vacancyDate: "2026-01-01",
    daysOpen: 294,
    fjcNid: "1393266",
    linkBasis: "exact",
    judgeProfileId: "01758999e432d9ffc2b0521117faf99a",
    ...o,
  });
  const board = buildBoard(
    [
      vac({ id: "a" }),
      vac({
        id: "b",
        courtId: "scd",
        status: "announced",
        fjcNid: null,
        linkBasis: "missing_key",
        daysOpen: null,
      }),
      vac({ id: "c", courtId: "gand", fjcNid: "999", daysOpen: 517 }),
    ],
    [
      {
        courtId: "scd",
        name: "District of South Carolina",
        asOf: "2026-10-01",
        active: 9,
        judgeships: 10,
        pendingMdls: 2,
        pendingActions: 15290,
      },
      {
        courtId: "cacd",
        name: "Central District of California",
        asOf: "2026-10-01",
        active: 20,
        judgeships: 28,
        pendingMdls: 3,
        pendingActions: 400,
      },
      {
        courtId: "gand",
        name: "Northern District of Georgia",
        asOf: "2026-10-01",
        active: 10,
        judgeships: 11,
        pendingMdls: 2,
        pendingActions: 4271,
      },
      {
        courtId: "akd",
        name: "District of Alaska",
        asOf: "2026-10-01",
        active: 3,
        judgeships: 3,
        pendingMdls: 0,
        pendingActions: 0,
      },
    ],
    new Map([["gand", { value: 12, rank: { rank: 5, of: 94 } }]]),
    [
      {
        nid: "1393266",
        name: "Josephine L. Staton",
        pending: [{ mdl: 3181, title: "SCS", pending: 41 }],
      },
    ],
  );
  it("keeps only districts holding MDL actions and joins vacancies by court id", () => {
    expect(board.rows.map((r) => r.courtId)).toEqual(["scd", "gand", "cacd"]);
    expect(board.rows[1]).toMatchObject({
      open: 1,
      longestDaysOpen: 517,
      vacantJudgeshipMonths: 12,
    });
    expect(board.rows[0]?.vacantJudgeshipMonths).toBeNull();
  });
  it("links departing judges only through an exact FJC id; unlinked vacancies are counted, not guessed", () => {
    expect(board.departing.map((d) => d.vacancyId)).toEqual(["a"]);
    expect(board.departing[0]?.pendingActions).toBe(41);
    expect(board.unlinked).toBe(1);
    // the unlinked vacancy sits in scd, which holds MDL actions: its MDLs cannot be checked
    expect(board.unlinkedInMdlDistricts).toBe(1);
    expect(board.kpis).toMatchObject({
      mdlDistricts: 3,
      mdlDistrictsWithVacancy: 3,
      openInMdlDistricts: 2,
      announcedInMdlDistricts: 1,
      actionsInDistrictsWithVacancy: 19961,
      longestOpen: { courtId: "gand", days: 517 },
    });
  });
  it("says when a vacant-months rank is shared and does not rank a shared zero", () => {
    expect(vacantRankText({ vacantJudgeshipMonths: 12, vacantRank: { rank: 5, of: 94 }, vacantTied: 0 })).toBe(
      "5 of 94",
    );
    expect(vacantRankText({ vacantJudgeshipMonths: 12, vacantRank: { rank: 5, of: 94 }, vacantTied: 2 })).toBe(
      "5 of 94, tied with 2",
    );
    expect(
      vacantRankText({ vacantJudgeshipMonths: 0, vacantRank: { rank: 20, of: 94 }, vacantTied: 74 }),
    ).toBe("Not ranked (zero, shared)");
    expect(vacantRankText({ vacantJudgeshipMonths: null, vacantRank: null, vacantTied: null })).toBe(
      "Not recorded",
    );
  });
  it("writes AO names in reading order", () => {
    expect(aoDisplayName("Hayes,William Q.")).toBe("William Q. Hayes");
    expect(aoDisplayName(null)).toBeNull();
  });
});

describe("venueScorecard", () => {
  const counties = [
    { id: "34013", court: "njd", division: null },
    { id: "34003", court: "njd", division: "Newark" },
    { id: "51595", court: null, division: null },
    { id: "US" },
  ].flatMap((r) => {
    const c = parseCountyDistrict(r);
    return c ? [c] : [];
  });
  const cvap = [
    {
      id: "34013",
      years: {
        "2024": {
          estimate: {
            cvap: 544911,
            age_18_29: 108683,
            age_30_44: 136188,
            age_45_64: 184669,
            age_65_plus: 115371,
          },
          moe: { cvap: 4026 },
        },
      },
    },
    {
      id: "34003",
      years: {
        "2024": {
          estimate: {
            cvap: 600000,
            age_18_29: 100000,
            age_30_44: 150000,
            age_45_64: 200000,
            age_65_plus: 150000,
          },
          moe: { cvap: 3000 },
        },
      },
    },
    { id: "34", years: { "2024": { estimate: { cvap: 1 } } } },
  ].flatMap((r) => {
    const c = parseCvapCounty(r);
    return c ? [c] : [];
  });
  it("sums county CVAP into districts by the recorded court id and combines MOEs by root sum of squares", () => {
    expect(counties).toHaveLength(3);
    expect(cvap).toHaveLength(2);
    const d = districtCvap(counties, cvap).get("njd")!;
    expect(d.cvap).toBe(1144911);
    expect(d.cvapMoe).toBe(Math.round(Math.sqrt(4026 ** 2 + 3000 ** 2)));
    expect(d.divisions).toEqual([{ name: "Newark", counties: 1, cvap: 600000 }]);
    const s = ageShares(d)!;
    expect(s.age18to29 + s.age30to44 + s.age45to64 + s.age65plus).toBeCloseTo(100, 6);
  });
  it("drops the age split when a county is missing rather than under-counting", () => {
    const d = districtCvap(counties, cvap.slice(0, 1)).get("njd")!;
    expect(d.countiesMissing).toBe(1);
    expect(d.ages).toBeNull();
    expect(ageShares(d)).toBeNull();
  });
});

describe("districtEnforcement", () => {
  it("keeps thin DOJ partitions (2009-2012) out of the series", () => {
    // corpus_datasets.imported_records of doj_press_releases_YYYY
    const totals = new Map<string, number | null>([
      ["2009", 1149],
      ["2010", 1229],
      ["2011", 1501],
      ["2012", 1351],
      ["2013", 18266],
      ["2014", 18546],
      ["2015", 18666],
      ["2016", 18150],
      ["2017", 19078],
      ["2018", 21241],
      ["2019", 20274],
      ["2020", 18404],
      ["2021", 19173],
      ["2022", 20718],
      ["2023", 19519],
      ["2024", 20533],
      ["2025", 19449],
      ["2026", 2000],
    ]);
    const c = dojCoverage(totals, 2026);
    expect(c.firstFull).toBe("2013");
    expect(c.thin.map((t) => t.year)).toEqual(["2009", "2010", "2011", "2012"]);
    expect(dojCoverage(new Map([["2024", 20000], ["2025", 19000]]), 2026).thin).toEqual([]);
  });
  it("counts SEC releases per year, keeps uncovered years null and flags the partial year", () => {
    const sec = [
      { f: { year: ["2024"], type: ["litigation_release"], has_civil_action: ["yes"] } },
      { f: { year: ["2024"], type: ["administrative_proceeding"] } },
      { f: { year: ["2026"], type: ["litigation_release"] } },
    ].flatMap((r) => {
      const s = parseSecRow(r);
      return s ? [s] : [];
    });
    const rows = enforcementYears(
      sec,
      new Map([
        ["2024", 5],
        ["2025", 0],
        ["2026", 2],
      ]),
      2026,
      {
        first: 2024,
        last: 2026,
      },
    );
    expect(rows).toEqual([
      { year: "2024", sec: 2, secLitigation: 1, doj: 5, partial: false },
      { year: "2025", sec: 0, secLitigation: 0, doj: 0, partial: false },
      { year: "2026", sec: 1, secLitigation: 1, doj: 2, partial: true },
    ]);
    expect(lastCompleteYears(rows, "doj", 2)).toEqual({ total: 5, from: "2024", to: "2025" });
    expect(lastCompleteYears(rows, "doj", 3)).toBeNull();
    const gap = enforcementYears([], new Map([["2025", 3]]), 2026, null);
    expect(gap.map((r) => r.sec)).toEqual([null, null]);
    expect(gap.map((r) => r.doj)).toEqual([3, null]);
  });
});
