import { describe, expect, it } from "vitest";
import {
  filterCompanies,
  EMPTY_FILTER,
  mdlTitle,
  median,
  money,
  parseCompanySummary,
  parseLink,
  sortCompanies,
  strengthSplit,
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
