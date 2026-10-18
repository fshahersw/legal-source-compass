import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  daysBetween,
  parseEnforcementSources,
  parseSettlementNotices,
} from "./settlementNotices.functions";

const NOTICE = {
  id: "notice:american-international-college-data-breach",
  title: "American International College - Data Breach",
  source_url: "https://aicdatasettlement.com/",
  cells: {
    settlement: "American International College - Data Breach",
    type: "Other consumer compensation",
    status: "Claim window closed",
    deadline: "2026-07-22",
    states: "Nationwide (as published)",
    official_source: "aicdatasettlement.com",
    verification: "Verified",
  },
};

describe("parseSettlementNotices", () => {
  it("reads a compiled notice with its verification status and official page", () => {
    expect(parseSettlementNotices([NOTICE])).toEqual([
      {
        id: NOTICE.id,
        title: NOTICE.title,
        type: "Other consumer compensation",
        status: "Claim window closed",
        deadline: "2026-07-22",
        states: "Nationwide (as published)",
        officialSource: "aicdatasettlement.com",
        verification: "Verified",
        sourceUrl: "https://aicdatasettlement.com/",
      },
    ]);
  });

  it("keeps a missing or non-ISO deadline as null instead of guessing a date", () => {
    const rows = parseSettlementNotices([
      { ...NOTICE, id: "a", cells: { ...NOTICE.cells, deadline: "" } },
      { ...NOTICE, id: "b", cells: { ...NOTICE.cells, deadline: "July 22, 2026" } },
    ]);
    expect(rows.map((r) => r.deadline)).toEqual([null, null]);
  });

  it("drops rows with an unknown verification status, no official page, or no title", () => {
    expect(
      parseSettlementNotices([
        { ...NOTICE, id: "a", cells: { ...NOTICE.cells, verification: "Probably fine" } },
        { ...NOTICE, id: "b", source_url: "" },
        { ...NOTICE, id: "c", title: "  " },
        { ...NOTICE, id: "d", cells: null },
        { ...NOTICE, id: "e" },
      ]).map((r) => r.id),
    ).toEqual(["e"]);
  });
});

describe("parseEnforcementSources", () => {
  const SOURCE = {
    id: "src:wa:washington-attorney-general",
    source_url: "https://www.atg.wa.gov/pressrelease.aspx",
    cells: {
      agency: "Washington Attorney General",
      jurisdiction: "Washington",
      level: "State agency",
      covers: "settlements and verdicts announced in press releases",
      source_type: "Press releases / announcements",
      official_url: "atg.wa.gov",
      url_check: "OK",
      corpus_datasets: "1",
    },
  };

  it("reads an entry and turns the stored dataset count into a number", () => {
    expect(parseEnforcementSources([SOURCE])[0]).toMatchObject({
      agency: "Washington Attorney General",
      host: "atg.wa.gov",
      urlCheck: "OK",
      datasetCount: 1,
    });
    expect(
      parseEnforcementSources([{ ...SOURCE, cells: { ...SOURCE.cells, corpus_datasets: "0" } }])[0]
        ?.datasetCount,
    ).toBe(0);
  });

  it("keeps an unreadable dataset count as null and drops entries without an agency or page", () => {
    const rows = parseEnforcementSources([
      { ...SOURCE, id: "a", cells: { ...SOURCE.cells, corpus_datasets: "many" } },
      { ...SOURCE, id: "b", cells: { ...SOURCE.cells, agency: "" } },
      { ...SOURCE, id: "c", source_url: null },
    ]);
    expect(rows.map((r) => [r.id, r.datasetCount])).toEqual([["a", null]]);
  });
});

describe("daysBetween", () => {
  it("counts calendar days across month and year ends and is negative for past dates", () => {
    expect(daysBetween("2026-10-18", "2026-10-18")).toBe(0);
    expect(daysBetween("2026-10-18", "2026-11-17")).toBe(30);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-18", "2026-10-17")).toBe(-1);
  });
});
