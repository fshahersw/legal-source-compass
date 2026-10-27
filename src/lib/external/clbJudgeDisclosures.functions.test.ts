import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getClbJudgeDisclosures, parseJudgeDisclosures } from "./clbJudgeDisclosures.functions";

const ZERO = {
  investments: 0,
  gifts: 0,
  reimbursements: 0,
  agreements: 0,
  outside_positions: 0,
  debts: 0,
  non_investment_income: 0,
  spousal_income: 0,
};
const PDF =
  "https://storage.courtlistener.com/us/federal/judicial/financial-disclosures/77/jane-doe-disclosure.2015.pdf";
// Shape of a clb_judge_disclosures profile.
const PROFILE = {
  person_id: 77,
  name: "Jane Doe",
  reports: 3,
  amended: 0,
  first_year: 2014,
  last_year: 2016,
  years: [
    {
      year: 2015,
      reports: 1,
      amended: 0,
      pages: 9,
      items: { ...ZERO, gifts: 1, reimbursements: 2 },
    },
    { year: 2014, reports: 1, amended: 0, pages: 8, items: ZERO },
    { year: null, reports: 1, amended: 0, items: ZERO },
  ],
  items_total: { ...ZERO, gifts: 2, reimbursements: 2 },
  items_redacted: ZERO,
  items_withheld: { gifts: 1, reimbursements: 0, agreements: 0 },
  gifts: [
    {
      year: 2015,
      report_id: 10,
      redacted: false,
      source: "Bar Association",
      description: "Dinner",
      value_as_filed: "$100",
    },
    {
      year: 2016,
      report_id: 12,
      redacted: false,
      source: "From a report that failed the check",
      description: "x",
    },
  ],
  reimbursements: [
    { year: 2015, report_id: 10, redacted: true, source: "Trust (partly redacted)" },
    {
      year: 2015,
      report_id: 10,
      redacted: false,
      source: "Law School",
      purpose: "Teaching",
      location: "Boston, MA",
      items_paid_or_provided: "Travel",
    },
  ],
  agreements: [],
  attribution: {
    status: "consistent",
    circuits: { "01": 2 },
    reports_matching_surname: 2,
    reports_other_surname: 1,
    reports_unchecked: 0,
  },
  report_list: [
    {
      id: 10,
      year: 2015,
      amended: false,
      pages: 9,
      file_check: "match",
      filer_code: "J3 01 MA",
      pdf: PDF,
    },
    {
      id: 11,
      year: 2014,
      amended: false,
      pages: 8,
      file_check: "match",
      filer_code: null,
      pdf: "https://storage.courtlistener.com/us/federal/judicial/financial-disclosures/78/other.pdf",
    },
    {
      id: 12,
      year: 2016,
      amended: false,
      pages: 5,
      file_check: "mismatch",
      filer_code: null,
      pdf: null,
    },
  ],
  stats_record: "/records/clb_judge_dockets/77",
};

describe("parseJudgeDisclosures", () => {
  it("lists items from reports that passed the surname check and keeps redacted lines' published text", () => {
    const d = parseJudgeDisclosures(PROFILE, 77)!;
    expect(d.gifts.map((g) => g.reportId)).toEqual([10]); // report 12: file name carries another surname
    expect(d.gifts[0]!.attribution).toBe("checked");
    expect(d.reimbursements).toHaveLength(2);
    expect(d.reimbursements[0]!.redacted).toBe(true);
    expect(d.reimbursements[0]!.source).toBe("Trust (partly redacted)");
    expect(d.reimbursements[1]!.source).toBe("Law School");
    expect(d.itemsWithheldByReason).toBeNull(); // record built before the split was stored
    expect(d.reportList[0]!.pdf).toBe(PDF);
    expect(d.reportList[1]!.pdf).toBeNull(); // another person's path
    expect(d.years.map((y) => y.year)).toEqual([2014, 2015]);
    expect(d.statsRecord).toBe("/records/clb_judge_dockets/77");
  });

  it("lists items of a report whose file name could not be read, labelled not_checked", () => {
    const d = parseJudgeDisclosures(
      {
        ...PROFILE,
        gifts: [
          ...PROFILE.gifts,
          { year: 2014, report_id: 11, redacted: false, source: "Unread file" },
        ],
        report_list: PROFILE.report_list.map((r) =>
          r.id === 11 ? { ...r, file_check: "unchecked" } : r,
        ),
        items_withheld_by_reason: {
          other_surname: { gifts: 1, reimbursements: 0, agreements: 0 },
          attribution_conflict: { gifts: 0, reimbursements: 0, agreements: 0 },
        },
      },
      77,
    )!;
    expect(d.gifts.map((g) => [g.reportId, g.attribution])).toEqual([
      [10, "checked"],
      [11, "not_checked"],
    ]);
    expect(d.itemsWithheldByReason!.otherSurname.gifts).toBe(1);
  });

  it("does not trust a stored label: an item of a mismatch report stays out", () => {
    const d = parseJudgeDisclosures(
      {
        ...PROFILE,
        gifts: [
          { year: 2016, report_id: 12, redacted: false, source: "x", attribution: "checked" },
        ],
      },
      77,
    )!;
    expect(d.gifts).toEqual([]);
  });

  it("lists no items for an attribution conflict", () => {
    const d = parseJudgeDisclosures(
      {
        ...PROFILE,
        attribution: { ...PROFILE.attribution, status: "conflict", circuits: { "04": 2, "05": 1 } },
      },
      77,
    )!;
    expect(d.gifts).toEqual([]);
    expect(d.reimbursements).toEqual([]);
    expect(d.attribution.circuits).toEqual([
      { code: "04", reports: 2 },
      { code: "05", reports: 1 },
    ]);
  });

  it("rejects another person, a report list that does not match the count, or an unknown status", () => {
    expect(parseJudgeDisclosures(PROFILE, 78)).toBeNull();
    expect(parseJudgeDisclosures({ ...PROFILE, reports: 4 }, 77)).toBeNull();
    expect(parseJudgeDisclosures({ ...PROFILE, attribution: { status: "maybe" } }, 77)).toBeNull();
  });
});

describe("getClbJudgeDisclosures", () => {
  it("goes through the crosswalk and reads the person's record by exact id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    const xw = {
      judges_id: "abcdef0123456789",
      tier: "exact_name_same_court",
      cl_person_id: 77,
      matched_positions: [],
      candidates: [],
      unresolved_courts: [],
    };
    mocked
      .mockResolvedValueOnce({ rows: [{ p: xw }], total: null })
      .mockResolvedValueOnce({ rows: [{ p: PROFILE }], total: null });
    const handler = getClbJudgeDisclosures as unknown as (a: {
      data: { id: string };
    }) => Promise<{ personId: number } | null>;
    expect((await handler({ data: { id: "abcdef0123456789" } }))!.personId).toBe(77);
    expect(mocked.mock.calls[1]![0]).toContain("dataset=eq.clb_judge_disclosures&id=eq.77");
  });
});
