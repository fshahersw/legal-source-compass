import { describe, expect, it } from "vitest";
import {
  filterCompanies,
  EMPTY_FILTER,
  mdlRecordRefs,
  mdlRecordView,
  mdlTitle,
  median,
  money,
  parseCompanySummary,
  parseFinancials,
  parseLink,
  sortCompanies,
  strengthSplit,
  xbrlSourceUrl,
} from "./companyData";

const summary = (cik: string, name: string, pending: number | null, accrual?: number) => ({
  company: {
    cik,
    name,
    tickers: ["TCK"],
    sic: "2834",
    sic_description: "Pharmaceutical Preparations",
  },
  has_financials: true,
  mdls: [
    {
      mdl: 2924,
      mdl_title: "IN RE: Zantac (Ranitidine) Products Liability Litigation",
      mdl_status: "pending",
      tier: "A",
      role: "defendant",
      pending,
      counts_toward_exposure: true,
    },
  ],
  exposure: { linked_mdls: 1, pending_mdls: 1, pending_actions: pending, strongest_tier: "A" },
  latest:
    accrual === undefined
      ? {}
      : {
          litigation_accrual: {
            fy: 2025,
            end: "2025-12-31",
            value: accrual,
            unit: "USD",
            concept: "LossContingencyAccrualAtCarryingValue",
            accn: "x",
            form: "10-K",
            filed: "2026-02-01",
          },
        },
  spark: {
    litigation_accrual: [
      { fy: 2024, v: 1 },
      { fy: "bad", v: 2 },
    ],
  },
  flags: ["accrual_heavy", "not_a_flag"],
});

describe("parseCompanySummary", () => {
  it("keeps valid fields and drops malformed ones", () => {
    const s = parseCompanySummary(summary("0000078003", "PFIZER INC", 120, 5e8))!;
    expect(s.profile.name).toBe("PFIZER INC");
    expect(s.latest.litigation_accrual?.value).toBe(5e8);
    expect(s.spark.litigation_accrual).toEqual([{ fy: 2024, v: 1 }]);
    expect(s.flags).toEqual(["accrual_heavy"]);
    expect(s.accrualPctRevenue).toBeNull();
  });

  it("rejects rows without a valid CIK or any MDL", () => {
    expect(parseCompanySummary(summary("78003", "X", 1))).toBeNull();
    expect(parseCompanySummary({ ...summary("0000078003", "X", 1), mdls: [] })).toBeNull();
    expect(parseCompanySummary(null)).toBeNull();
  });
});

describe("parseLink", () => {
  it("requires at least one evidence filing on sec.gov", () => {
    const base = { mdl: 2924, tier: "C", mdl_title: "Zantac", verified: [] as unknown[] };
    expect(parseLink(base)).toBeNull();
    const evil = {
      ...base,
      verified: [{ adsh: "1", file_date: "2024-01-01", url: "https://example.com/x" }],
    };
    expect(parseLink(evil)).toBeNull();
    const ok = {
      ...base,
      verified: [
        {
          adsh: "1",
          file_date: "2024-01-01",
          url: "https://www.sec.gov/Archives/x.htm",
          role: "weird",
        },
      ],
    };
    const link = parseLink(ok)!;
    expect(link.verified[0]!.role).toBe("unclear");
    expect(link.tierLabel).toMatch(/requires review/);
  });
});

describe("sorting and filtering", () => {
  const rows = [
    parseCompanySummary(summary("0000000001", "Alpha", null))!,
    parseCompanySummary(summary("0000000002", "Beta", 50, 10))!,
    parseCompanySummary(summary("0000000003", "Gamma", 900, 20))!,
  ];
  it("puts Not recorded values last in both directions", () => {
    expect(sortCompanies(rows, "pending", "desc").map((r) => r.profile.name)).toEqual([
      "Gamma",
      "Beta",
      "Alpha",
    ]);
    expect(sortCompanies(rows, "pending", "asc").map((r) => r.profile.name)).toEqual([
      "Beta",
      "Gamma",
      "Alpha",
    ]);
  });
  it("filters by text, ticker and MDL number", () => {
    expect(filterCompanies(rows, { ...EMPTY_FILTER, q: "gam" })).toHaveLength(1);
    expect(filterCompanies(rows, { ...EMPTY_FILTER, q: "2924" })).toHaveLength(3);
    expect(filterCompanies(rows, { ...EMPTY_FILTER, flag: "accrual_surge" })).toHaveLength(0);
  });
});

describe("formatting", () => {
  it("formats money with units and never guesses", () => {
    expect(money(1_234_000_000, "USD")).toBe("$1.2B");
    expect(money(-50_000_000, "USD")).toBe("-$50.0M");
    expect(money(2_500_000_000, "EUR")).toBe("2.5B EUR");
    expect(money(null, "USD")).toBe("Not recorded");
  });
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("evidence strength and recency", () => {
  it("splits counted totals by evidence strength", () => {
    expect(strengthSplit(15266, 8424)).toBe("A/B 15,266 · C 8,424");
    expect(strengthSplit(null, null)).toBeNull();
  });
  it("labels captions truncated in the JPML source instead of completing them", () => {
    expect(mdlTitle("IN RE: Zantac Products Liability Litigation", false, 2924)).toBe(
      "Zantac Products Liability Litigation",
    );
    expect(mdlTitle("Products Liability Litigation", true, 2627)).toMatch(/caption truncated/);
  });
  it("only reports accrual % of revenue for current accruals", () => {
    const stale = parseCompanySummary({
      ...summary("0000066740", "3M CO", 10, 3e8),
      accrual_pct_revenue: 1.02,
      accrual_current: false,
    })!;
    expect(stale.accrualPctRevenue).toBeNull();
    expect(stale.accrualCurrent).toBe(false);
    const fresh = parseCompanySummary({
      ...summary("0001627223", "Chemours", 10, 4.84e8),
      accrual_pct_revenue: 8.33,
      accrual_current: true,
    })!;
    expect(fresh.accrualPctRevenue).toBe(8.33);
  });
});

describe("links to sources that exist", () => {
  it("offers the XBRL companyfacts link only when financials are on file for the CIK", () => {
    const fin = parseFinancials({ annual: {} })!;
    const stored = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000001800.json";
    expect(xbrlSourceUrl("0000001800", fin, stored)).toBe(stored);
    expect(xbrlSourceUrl("0000001800", fin, null)).toBe(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000001800.json",
    );
    // No company_sec_financials row (e.g. CIK 0000929987 GUIDANT CORP): the SEC URL would be a 404.
    expect(xbrlSourceUrl("0000929987", null, null)).toBeNull();
    // A recorded source that is not a companyfacts file is not presented as one.
    expect(xbrlSourceUrl("0000001800", null, "javascript:alert(1)")).toBeNull();
  });

  it("links an MDL number only to a record that exists, by exact number", () => {
    const refs = mdlRecordRefs(
      [2924, 875, 1203, 4242, 999, 875],
      ["2924", "1871"],
      [
        { id: "875:313", mdl: 875 },
        { id: "1203:313", mdl: 1203 },
        // Two terminated rows for one number: ambiguous, so no link.
        { id: "999:314", mdl: 999 },
        { id: "999:315", mdl: 999 },
        // Only the recorded numeric MDL number counts; the id prefix or a string value is not evidence.
        { id: "4242:100", mdl: "4242" },
        { id: "1203:999", mdl: 1230 },
      ],
    );
    expect(refs).toEqual({
      "2924": { kind: "record", ref: { dataset: "mdl_analytics", id: "2924" } },
      "875": { kind: "record", ref: { dataset: "mdl_terminated_history", id: "875:313" } },
      "1203": { kind: "record", ref: { dataset: "mdl_terminated_history", id: "1203:313" } },
      "4242": { kind: "none" },
      "999": { kind: "ambiguous", rows: 2 },
    });
    // The same row returned twice is still one row, not an ambiguity.
    expect(
      mdlRecordRefs(
        [875],
        [],
        [
          { id: "875:313", mdl: 875 },
          { id: "875:313", mdl: 875 },
        ],
      ),
    ).toEqual({
      "875": { kind: "record", ref: { dataset: "mdl_terminated_history", id: "875:313" } },
    });
  });

  it("resolves nothing from a terminated-history read that may be incomplete", () => {
    const refs = mdlRecordRefs([2924, 875, 4242], ["2924"], [{ id: "875:313", mdl: 875 }], false);
    expect(refs).toEqual({
      // The analytics read is by id and complete, so it still resolves.
      "2924": { kind: "record", ref: { dataset: "mdl_analytics", id: "2924" } },
      // One row in a truncated response may hide a second; zero rows may hide one.
      "875": { kind: "unknown" },
      "4242": { kind: "unknown" },
    });
  });

  it("words an unlinked MDL number by why it is not linked", () => {
    const refs = mdlRecordRefs(
      [2924, 999, 4242],
      ["2924"],
      [
        { id: "999:314", mdl: 999 },
        { id: "999:315", mdl: 999 },
      ],
    );
    expect(mdlRecordView(refs, 2924)).toEqual({
      ref: { dataset: "mdl_analytics", id: "2924" },
      note: null,
    });
    expect(mdlRecordView(refs, 999)).toEqual({
      ref: null,
      note: "2 terminated-history records carry MDL 999; not linked",
    });
    expect(mdlRecordView(refs, 4242)).toEqual({
      ref: null,
      note: "No MDL record for this number in the corpus",
    });
    expect(mdlRecordView({ "875": { kind: "unknown" } }, 875)).toEqual({
      ref: null,
      note: "MDL record lookup incomplete; not linked",
    });
    // The lookup failed (null) or never covered the number: never reported as "no record".
    expect(mdlRecordView(null, 2924)).toEqual({ ref: null, note: "MDL record lookup unavailable" });
    expect(mdlRecordView(refs, 1)).toEqual({ ref: null, note: "MDL record lookup unavailable" });
  });
});
