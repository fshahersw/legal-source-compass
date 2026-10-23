import { describe, expect, it } from "vitest";
import type { StateCallsMonth } from "@/lib/external/ftcData";
import type {
  ConsumerYear,
  DncYear,
  NationalYear,
  Printed,
  RefundYear,
  StateConsumerData,
} from "@/lib/external/stateConsumer.functions";
import { niceMax } from "./chartScale";
import {
  callsLatest,
  callsRows,
  callsSubjects,
  callsWindow,
  categoryBars,
  consumerTakeaways,
  definitionYears,
  dncChange,
  editionName,
  nationalMedianPoints,
  noticesBetween,
  populationBasis,
  rankCellText,
  rankChangeText,
  rankMove,
  rankText,
  refundBars,
  sentence,
  shown,
  trendPoints,
} from "./consumerView";

const p = (text: string, value: number | null): Printed => ({ text, value });
const change = {
  reportsPct: null,
  per100kPct: null,
  rankChange: null,
  identityTheftRankChange: null,
  totalLossPct: null,
  medianLossPct: null,
};
const year = (y: number, over: Partial<ConsumerYear> = {}): ConsumerYear => ({
  year: y,
  recordId: `CA-${y}`,
  sourceUrl: `https://ftc.example/${y}.pdf`,
  populationYear: y - 1,
  reports: p("100", 100),
  per100k: p("1,000", 1000),
  rank: p("17", 17),
  identityTheftReports: p("10", 10),
  identityTheftPer100k: p("50", 50),
  identityTheftRank: p("7", 7),
  fraudReports: p("60", 60),
  pctReportingLoss: 40,
  totalLoss: p("$1,678,703,608", 1678703608),
  medianLoss: p("$542", 542),
  change,
  categories: null,
  identityTheftTypes: null,
  withheld: [],
  caveats: [],
  ...over,
});
const dnc = (fy: number, over: Partial<DncYear> = {}): DncYear => ({
  fy,
  recordId: `CA-FY${fy}`,
  sourceUrl: null,
  populationYear: 2023,
  complaints: p("304,497", 304497),
  complaintsPer100k: p("776", 776),
  complaintsRank: p("22", 22),
  registrations: p("28,923,788", 28923788),
  registrationsPer100k: p("73,705", 73705),
  registrationsRank: p("38", 38),
  complaintsYoyPct: 5.76,
  complaintsRankChange: -13,
  registrationsYoyPct: 1.96,
  ...over,
});
const refund = (y: number, usd: number | null, over: Partial<RefundYear> = {}): RefundYear => ({
  year: y,
  recordId: `${y}-state-CA`,
  sourceUrl: null,
  mailed: usd == null ? null : p(`$${usd.toLocaleString("en-US")}`, usd),
  sharePct: 9.07,
  yoyPct: -2.78,
  ...over,
});
const nat = (y: number, notices: string[] = [], median = 497): NationalYear => ({
  year: y,
  recordId: `US-${y}`,
  medianLoss: p(`$${median}`, median),
  pctReportingLoss: 38,
  totalLoss: null,
  fraudReports: null,
  notices,
});
const data = (over: Partial<StateConsumerData> = {}): StateConsumerData => ({
  usps: "CA",
  years: [year(2017, { per100k: p("414", 414) }), year(2024, { per100k: p("1,291", 1291) })],
  dnc: [dnc(2025)],
  calls: [],
  refunds: [refund(2023, 25631641), refund(2024, 24919399)],
  national: [nat(2024, ["2024: categories were renamed"])],
  editions: { sentinel: {}, dnc: {}, refunds: {} },
  terms: null,
  unavailable: [],
  ...over,
});

describe("rank wording", () => {
  it("says rank N of 50, unranked for DC and PR, and Not recorded when absent", () => {
    expect(rankText(p("17", 17))).toBe("rank 17 of 50");
    expect(rankText(p("Unranked", null))).toBe("unranked by the FTC");
    expect(rankText(null)).toBe("Not recorded");
    expect(sentence(rankText(p("17", 17)))).toBe("Rank 17 of 50");
  });

  it("shows the DNC rank as printed, and Not recorded where the source leaves it blank", () => {
    expect(rankCellText(p("22", 22))).toBe("22 of 50");
    expect(rankCellText(null)).toBe("Not recorded");
    expect(rankCellText(p("Unranked", null))).toBe("Not recorded");
  });

  it("describes a rank move with the right direction and none when unknown", () => {
    expect(rankMove(2)).toBe("up 2 places");
    expect(rankMove(1)).toBe("up 1 place");
    expect(rankMove(-13)).toBe("down 13 places");
    expect(rankMove(0)).toBe("no change in rank");
    expect(rankMove(null)).toBeNull();
    expect(rankChangeText(year(2024, { change: { ...change, rankChange: 2 } }), 2023)).toBe(
      "up 2 places against the 2023 edition",
    );
    expect(rankChangeText(year(2024), 2023)).toBeNull();
  });
});

describe("shown and basis", () => {
  it("shows the printed text or Not recorded", () => {
    expect(shown(p("$542", 542))).toBe("$542");
    expect(shown(null)).toBe("Not recorded");
    expect(populationBasis({ populationYear: 2023 })).toBe("the FTC's 2023 Census estimate");
    expect(populationBasis({ populationYear: null })).toContain("Not recorded");
  });

  it("names an edition from the summary and falls back to a generic label", () => {
    expect(editionName({ 2024: { name: "Data Book 2024", url: null } }, 2024, "Data Book")).toBe(
      "Data Book 2024",
    );
    expect(editionName({}, 2023, "Data Book")).toBe("Data Book 2023");
  });
});

describe("trend points and notices", () => {
  it("keeps one point per edition and a null point (a gap) where a figure is missing", () => {
    const pts = trendPoints([year(2023), year(2024, { per100k: null })], (y) => y.per100k);
    expect(pts.map((x) => x.value)).toEqual([1000, null]);
    expect(pts[1]!.text).toBeNull();
    expect(pts[0]!.populationYear).toBe(2022);
  });

  it("finds the editions with definition notices and each notice once, in range", () => {
    const national = [
      nat(2019),
      nat(2020, ["2020 notice"]),
      nat(2023, ["2023 notice"]),
      nat(2024, ["2023 notice", "2024 notice"]),
    ];
    expect(definitionYears(national)).toEqual([2020, 2023, 2024]);
    expect(noticesBetween(national, 2023, 2024).map((n) => n.notice)).toEqual([
      "2023 notice",
      "2024 notice",
    ]);
    expect(noticesBetween(national, 2021, 2022)).toEqual([]);
  });

  it("lines up the national median with the state's editions without inventing missing years", () => {
    const pts = nationalMedianPoints([year(2023), year(2024)], [nat(2024, [], 497)]);
    expect(pts).toEqual([null, 497]);
  });
});

describe("bars", () => {
  it("scales category bars to the largest share and keeps every row", () => {
    const bars = categoryBars([
      { label: "A", sharePct: 22 },
      { label: "B", sharePct: 11 },
      { label: "C", sharePct: 0 },
    ]);
    expect(bars.map((b) => b.width)).toEqual([100, 50, 2]);
    expect(bars.map((b) => b.rank)).toEqual([1, 2, 3]);
  });

  it("scales refund bars to the largest year and leaves an unknown year without a bar", () => {
    const bars = refundBars([refund(2022, 100), refund(2023, null), refund(2024, 50)]);
    expect(bars.map((b) => b.width)).toEqual([100, null, 50]);
  });
});

describe("dncChange", () => {
  it("is not applicable for the first fiscal year and Not recorded when the change is missing", () => {
    expect(dncChange(dnc(2021), undefined)).toBeNull();
    expect(dncChange(dnc(2022, { complaintsYoyPct: null }), dnc(2021))).toBe("Not recorded");
    expect(dncChange(dnc(2022, { complaintsYoyPct: -31.5 }), dnc(2021))).toBe("−31.5%");
  });
});

describe("consumerTakeaways", () => {
  it("builds takeaways only from loaded rows, each naming its period and source", () => {
    const items = consumerTakeaways(data());
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["per100k", "loss", "span", "dnc", "refunds"]);
    expect(items[0]!.figure).toBe("1,291");
    expect(items[0]!.text).toContain("2024");
    expect(items[0]!.text).toContain("rank 17 of 50");
    expect(items[0]!.text).toContain("2023 Census estimate");
    expect(items[1]!.text).toContain("median loss $542 against $497 for the United States");
    expect(items[2]!.figure).toBe("414 → 1,291");
    expect(items[2]!.text).toContain("differ between editions");
    expect(items[3]!.text).toContain("FY2025");
    expect(items[4]!.figure).toBe("$24,919,399");
    expect(items[4]!.text).toContain("-2.8%".replace("-", "−"));
  });

  it("omits the national comparison when the national row did not load", () => {
    const items = consumerTakeaways(data({ national: [] }));
    expect(items[1]!.text).toContain("median loss $542");
    expect(items[1]!.text).not.toContain("United States");
  });

  it("shows nothing when fewer than two takeaways are usable", () => {
    expect(
      consumerTakeaways(
        data({ years: [], dnc: [], refunds: [refund(2024, 24919399)], national: [] }),
      ),
    ).toEqual([]);
  });

  it("does not claim a trend from a single edition", () => {
    const items = consumerTakeaways(data({ years: [year(2024)] }));
    expect(items.map((i) => i.id)).not.toContain("span");
  });

  it("describes DC as unranked rather than inventing a rank", () => {
    const items = consumerTakeaways(
      data({
        years: [year(2024, { rank: p("Unranked", null) })],
        dnc: [dnc(2025, { complaintsRank: null })],
      }),
    );
    expect(items[0]!.text).toContain("unranked by the FTC");
    expect(items.find((i) => i.id === "dnc")!.text).toContain("(rank Not recorded)");
  });
});

describe("niceMax", () => {
  it("rounds an axis top up to a step whose half is also round", () => {
    expect(niceMax(1291)).toBe(1600);
    expect(niceMax(1678703608)).toBe(2000000000);
    expect(niceMax(650)).toBe(800);
    expect(niceMax(37443)).toBe(40000);
    expect(niceMax(100)).toBe(100);
  });

  it("never returns a zero or invalid top", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });
});

describe("Do Not Call reports by month", () => {
  const month = (m: string, over: Partial<StateCallsMonth> = {}): StateCallsMonth => ({
    month: m,
    complete: true,
    calls: 1000,
    robocalls: 700,
    robocallSharePct: 73.7,
    per100k: 31.55,
    rankPer100k: 12,
    rankedOf: 52,
    population: 3_000_000,
    populationYear: 2025,
    firstDay: null,
    lastDay: null,
    subjects: [],
    sourceUrl: null,
    ...over,
  });
  it("lists months newest first, marks a partial month and says which days it covers", () => {
    const rows = callsRows([
      month("2026-09", {
        complete: false,
        firstDay: "2026-09-16",
        lastDay: "2026-09-30",
        calls: 11387,
      }),
      month("2026-10", { complete: false, firstDay: "2026-10-01", lastDay: "2026-10-20" }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["October 2026*", "September 2026*"]);
    expect(rows[1]).toMatchObject({
      reports: "11,387",
      per100k: "31.6",
      rank: "12 of 52",
      robocallShare: "73.7%",
      partial: true,
    });
    expect(rows[1]!.coverage).toBe("September 16 to September 30, 2026");
  });
  it("shows Not recorded for what the record leaves out, never a zero", () => {
    const [r] = callsRows([
      month("2026-08", { per100k: null, rankPer100k: null, robocallSharePct: null }),
    ]);
    expect(r).toMatchObject({
      per100k: "Not recorded",
      rank: "Not recorded",
      robocallShare: "Not recorded",
      partial: false,
      coverage: null,
    });
  });
  it("names the window of counted complaints from the first and last day recorded", () => {
    expect(
      callsWindow([
        month("2026-09", { firstDay: "2026-09-16", lastDay: "2026-09-30" }),
        month("2026-10", { firstDay: "2026-10-01", lastDay: "2026-10-20" }),
      ]),
    ).toBe("complaints created September 16 to October 20, 2026");
    expect(callsWindow([month("2026-09")])).toBeNull();
  });
  it("ranks named subjects by share of all reports and keeps the catch-all buckets out of the ranking", () => {
    const s = callsSubjects([
      month("2026-09", {
        subjects: [
          { subject: "Other", calls: 500 },
          { subject: "Charities", calls: 100 },
          { subject: "Medical & prescriptions", calls: 300 },
          { subject: "No Subject Provided", calls: 100 },
        ],
      }),
    ]);
    expect(s!.total).toBe(1000);
    expect(s!.items).toEqual([
      { label: "Medical & prescriptions", sharePct: 30 },
      { label: "Charities", sharePct: 10 },
    ]);
    expect(s!.catchAll).toBe("Other 50%, No Subject Provided 10%");
    expect(callsSubjects([month("2026-09")])).toBeNull();
  });
  it("finds the newest month", () => {
    expect(callsLatest([month("2026-08"), month("2026-10"), month("2026-09")])!.month).toBe(
      "2026-10",
    );
    expect(callsLatest([])).toBeNull();
  });
});
