import { describe, expect, it } from "vitest";
import {
  codeRange,
  courtPositions,
  daysBetween,
  firstConfirmation,
  lawDegree,
  otherPositions,
  parseDisclosureItems,
  parseJudgePeople,
  serviceLanes,
  usedCodes,
  voteText,
} from "./judgePeople";

// Shaped like a clb_judge_people profile as the builder writes it (compacted: absent keys mean "not recorded").
const PEOPLE = {
  person_id: 45,
  name: "Ronnie Abrams",
  fjc_id: 3419,
  born: "1968",
  positions_total: 3,
  aba_ratings: [
    {
      id: 2,
      rating: "Qualified",
      rating_code: "q",
      year: 2011,
      retrieved_at: "2026-10-24T01:33:57Z",
    },
  ],
  education: [
    {
      id: 3,
      degree: "Bachelor's (e.g. B.A.)",
      degree_detail: "B.A.",
      degree_level: "ba",
      school: { id: 2624, name: "Cornell University" },
      year: 1990,
    },
    {
      id: 4,
      degree: "Juris Doctor (J.D.)",
      degree_detail: "J.D.",
      degree_level: "jd",
      school: { id: 3832, name: "Yale University" },
      year: 1993,
    },
  ],
  positions: [
    {
      id: 52,
      job_title: "Law clerk, Hon. Thomas P. Griesa",
      organization: "U.S. District Court, Southern District of New York",
      dates: { start: "1993", termination: "1994" },
    },
    {
      id: 51,
      position: "Judge",
      position_type: "jud",
      court: "District Court, S.D. New York",
      court_id: "nysd",
      court_link: "/courts/nysd",
      how_selected: "Appointment (President)",
      appointer: {
        id: 43,
        name: "Barack Hussein Obama II",
        position: "President of the United States",
        position_id: 44,
      },
      dates: {
        nominated: "2011-07-28",
        hearing: "2011-10-04",
        confirmation: "2012-03-22",
        start: "2012-03-23",
      },
      votes: { type: "Senate", yes: 96, no: 2 },
    },
  ],
};

describe("parseJudgePeople", () => {
  it("reads positions, education and ABA ratings as recorded", () => {
    const j = parseJudgePeople(PEOPLE, 45)!;
    expect(j.name).toBe("Ronnie Abrams");
    expect(courtPositions(j).map((p) => p.courtId)).toEqual(["nysd"]);
    expect(otherPositions(j)).toHaveLength(1);
    expect(courtPositions(j)[0]!.courtLink).toBe("/courts/nysd");
    expect(courtPositions(j)[0]!.appointer?.name).toBe("Barack Hussein Obama II");
    expect(lawDegree(j)?.school).toBe("Yale University");
    expect(firstConfirmation(j)?.dates.confirmation).toBe("2012-03-22");
    expect(j.aba).toEqual([
      { id: 2, code: "q", rating: "Qualified", year: 2011, retrievedAt: "2026-10-24T01:33:57Z" },
    ]);
    expect(j.born).toBe("1968");
  });

  it("rejects a record for another person id", () => {
    expect(parseJudgePeople(PEOPLE, 46)).toBeNull();
  });

  it("drops a court link that does not name exactly that court, and malformed dates", () => {
    const bad = structuredClone(PEOPLE);
    bad.positions[1]!.court_link = "/courts/cand";
    (bad.positions[1]!.dates as Record<string, string>)["start"] = "2012-13-40";
    const p = courtPositions(parseJudgePeople(bad, 45)!)[0]!;
    expect(p.courtLink).toBeNull();
    expect(p.dates.start).toBeNull();
    expect(p.court).toBe("District Court, S.D. New York");
  });

  it("drops ABA rows whose code is not in CourtListener's legend", () => {
    const bad = structuredClone(PEOPLE);
    bad.aba_ratings.push({
      id: 9,
      rating: "Excellent",
      rating_code: "x",
      year: 2012,
      retrieved_at: "2026-10-24T01:33:57Z",
    });
    expect(parseJudgePeople(bad, 45)!.aba.map((a) => a.id)).toEqual([2]);
  });
});

describe("lower-court appeals", () => {
  it("keeps the block only when its parts add up to the assigned count", () => {
    const ok = {
      ...PEOPLE,
      lower_court_appeals: {
        assigned: 5,
        ordering: 1,
        by_notice_year: [
          [2019, 2],
          [2020, 1],
        ],
        notice_after_export: 1,
        no_notice_date: 1,
      },
    };
    expect(parseJudgePeople(ok, 45)!.lowerCourtAppeals).toEqual({
      assigned: 5,
      ordering: 1,
      byNoticeYear: [
        { year: 2019, n: 2 },
        { year: 2020, n: 1 },
      ],
      noticeAfterExport: 1,
      noNoticeDate: 1,
    });
    const bad = { ...PEOPLE, lower_court_appeals: { assigned: 9, by_notice_year: [[2019, 2]] } };
    expect(parseJudgePeople(bad, 45)!.lowerCourtAppeals).toBeNull();
    expect(parseJudgePeople(PEOPLE, 45)!.lowerCourtAppeals).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days between two dates recorded to the day", () => {
    expect(daysBetween("2011-07-28", "2012-03-22")).toBe(238);
  });
  it("gives nothing for a coarser date or a reversed pair", () => {
    expect(daysBetween("2011", "2012-03-22")).toBeNull();
    expect(daysBetween("2012-03-22", "2011-07-28")).toBeNull();
    expect(daysBetween(null, "2012-03-22")).toBeNull();
  });
});

describe("voteText", () => {
  it("writes the recorded tally, a voice vote or a percentage", () => {
    expect(
      voteText({
        type: "Senate",
        voiceVote: null,
        yes: 96,
        no: 2,
        yesPercent: null,
        noPercent: null,
      }),
    ).toBe("96–2 (Senate)");
    expect(
      voteText({
        type: "Senate",
        voiceVote: true,
        yes: null,
        no: null,
        yesPercent: null,
        noPercent: null,
      }),
    ).toBe("Voice vote (Senate)");
    expect(
      voteText({
        type: null,
        voiceVote: null,
        yes: null,
        no: null,
        yesPercent: 71.25,
        noPercent: null,
      }),
    ).toBe("71.25% yes");
    expect(voteText(null)).toBeNull();
  });
});

describe("serviceLanes", () => {
  const j = parseJudgePeople(PEOPLE, 45)!;
  it("draws an open position to the export year", () => {
    const tl = serviceLanes(courtPositions(j), null)!;
    expect(tl.lanes[0]).toMatchObject({ from: 2012, to: 2026, open: true });
    expect([tl.lo, tl.hi]).toEqual([2012, 2026]);
  });
  it("stops an open position at the recorded year of death", () => {
    expect(serviceLanes(courtPositions(j), "2020-09-08")!.lanes[0]).toMatchObject({
      to: 2020,
      open: true,
    });
  });
  it("leaves out a position without a recorded start", () => {
    const p = { ...courtPositions(j)[0]!, dates: { ...courtPositions(j)[0]!.dates, start: null } };
    expect(serviceLanes([p], null)).toBeNull();
  });
});

const ITEMS = {
  person_id: 45,
  name: "Ronnie Abrams",
  reports: 2,
  attribution: { status: "consistent" },
  items_total: {
    investments: 5,
    gifts: 0,
    reimbursements: 1,
    agreements: 0,
    outside_positions: 1,
    debts: 1,
    non_investment_income: 1,
    spousal_income: 0,
  },
  years: [
    {
      year: 2013,
      reports: 1,
      amended: 0,
      report_types: [["2", "Annual Report", 1]],
      items: {
        investments: 3,
        gifts: 0,
        reimbursements: 1,
        agreements: 0,
        outside_positions: 1,
        debts: 1,
        non_investment_income: 1,
        spousal_income: 0,
      },
      investments: {
        gross_value: [
          ["J", 1],
          ["K", 1],
          ["none", 1],
        ],
        transactions: 1,
      },
      debts: { value: [["L", 1]] },
    },
    {
      year: 2012,
      reports: 1,
      report_types: [["1", "Initial Report", 1]],
      items: {
        investments: 2,
        gifts: 0,
        reimbursements: 0,
        agreements: 0,
        outside_positions: 0,
        debts: 0,
        non_investment_income: 0,
        spousal_income: 0,
      },
      investments: { gross_value: [["P1", 2]] },
    },
  ],
  listed: {
    outside_positions: [
      { year: 2013, report_id: 7, position: "Trustee", organization: "Trust #1" },
    ],
    non_investment_income: [
      {
        year: 2013,
        report_id: 7,
        source_as_filed: "Columbia Law School - teaching",
        amount_as_filed: "$10,000.00",
        date_as_filed: "2013",
      },
    ],
    debts: [
      {
        year: 2013,
        report_id: 7,
        creditor_as_filed: "Citibank",
        description_as_filed: "Line of credit",
        value_code: "L",
        value_range: "50,001 - 100,000",
      },
    ],
    spousal_income: [{ year: 2013, report_id: 7, redacted: true }],
  },
  listed_total: { outside_positions: 1, non_investment_income: 1, debts: 1, spousal_income: 1 },
};

describe("parseDisclosureItems", () => {
  it("reads years in order with code counts and listed items as filed", () => {
    const d = parseDisclosureItems(ITEMS, 45)!;
    expect(d.years.map((y) => y.year)).toEqual([2012, 2013]);
    expect(d.years[1]!.grossValue).toEqual([
      { code: "J", n: 1 },
      { code: "K", n: 1 },
      { code: "none", n: 1 },
    ]);
    expect(d.years[1]!.reportTypes).toEqual([{ code: "2", label: "Annual Report", n: 1 }]);
    expect(d.listed.debts[0]).toMatchObject({ creditor: "Citibank", code: "L" });
    expect(d.listed.nonInvestmentIncome[0]!.amount).toBe("$10,000.00");
    expect(d.listed.spousalIncome[0]).toMatchObject({ redacted: true, source: null });
  });

  it("drops a year whose value-code counts do not add up to its investment lines", () => {
    const bad = structuredClone(ITEMS);
    bad.years[0]!.investments.gross_value = [
      ["J", 2],
      ["K", 1],
      ["none", 1],
    ];
    expect(parseDisclosureItems(bad, 45)!.years.map((y) => y.year)).toEqual([2012]);
  });

  it("lists nothing for a person with an attribution conflict", () => {
    const c = structuredClone(ITEMS);
    c.attribution.status = "conflict";
    const d = parseDisclosureItems(c, 45)!;
    expect(d.conflict).toBe(true);
    expect(d.listed.debts).toEqual([]);
    expect(d.listedTotal.debts).toBe(0);
    expect(d.years).toHaveLength(2);
  });

  it("ignores codes outside the form's legend", () => {
    const bad = structuredClone(ITEMS);
    bad.listed.debts[0]!.value_code = "Z9";
    expect(parseDisclosureItems(bad, 45)!.listed.debts[0]!.code).toBeNull();
  });
});

describe("value codes", () => {
  it("keeps form order and only the codes that occur", () => {
    const d = parseDisclosureItems(ITEMS, 45)!;
    expect(usedCodes(d.years, (y) => y.grossValue)).toEqual(["J", "K", "P1", "none"]);
  });
  it("gives the form's range for a code", () => {
    expect(codeRange("J")).toBe("1 - 15,000");
    expect(codeRange("P4")).toBe("50,000,001 - ");
    expect(codeRange("-1")).toBe("Failed Extraction");
  });
});
