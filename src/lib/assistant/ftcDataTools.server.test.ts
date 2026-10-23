import { afterEach, describe, expect, it, vi } from "vitest";

type Reply = { rows: unknown[]; total?: number | null };
const rules: [string, Reply][] = [];
const paths: string[] = [];
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string) => {
    paths.push(path);
    for (const [needle, reply] of rules)
      if (path.includes(needle)) return { rows: reply.rows, total: reply.total ?? null };
    return { rows: [], total: null };
  }),
}));

import {
  FTC_DATA_EXECUTORS,
  FTC_DATA_TOOL_DEFINITIONS,
  resolveState,
  safeTerm,
} from "./ftcDataTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";

const dnc = FTC_DATA_EXECUTORS["ftc_dnc_trends"]!;
const hsr = FTC_DATA_EXECUTORS["ftc_hsr_notices"]!;

afterEach(() => {
  rules.length = 0;
  paths.length = 0;
});

const nationalRow = (month: string, over: Record<string, unknown> = {}) => ({
  id: `US-${month}`,
  month,
  complete: month !== "2026-10",
  method: "records",
  first: `${month}-01`,
  last: `${month}-30`,
  days: 30,
  dim: 30,
  m: { calls: 200, robocalls: 150, not_robocalls: 40, no_flag: 10 },
  a: { robocall_share_pct: 78.95 },
  subj: { Other: 100, "Dropped call or no message": 60, Charities: 40 },
  source_url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data",
  ...over,
});
const stateRow = (usps: string, month: string) => ({
  id: `${usps}-${month}`,
  complete: true,
  first: `${month}-01`,
  last: `${month}-30`,
  m: { calls: 20, robocalls: 12, population: 1_000_000, population_year: 2025 },
  a: { per100k: 2, rank_per100k: 7, ranked_of: 52, robocall_share_pct: 60 },
  subj: { Other: 10, Charities: 10 },
  source_url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data",
});

describe("registration", () => {
  it("offers both tools with the others and names no vendor or model", () => {
    for (const name of ["ftc_dnc_trends", "ftc_hsr_notices"]) {
      expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain(name);
      expect(availableTools().map((t) => t.name)).toContain(name);
    }
    expect(JSON.stringify(FTC_DATA_TOOL_DEFINITIONS)).not.toMatch(
      /anthropic|claude|openai|gpt|tavily|firecrawl/i,
    );
  });
});

describe("resolveState and safeTerm", () => {
  it("accepts a USPS code or an exact state name in any case, and Puerto Rico", () => {
    expect(resolveState("tx")).toEqual({ usps: "TX", name: "Texas" });
    expect(resolveState("New York")).toEqual({ usps: "NY", name: "New York" });
    expect(resolveState("district of columbia")).toEqual({
      usps: "DC",
      name: "District of Columbia",
    });
    expect(resolveState("Puerto Rico")).toEqual({ usps: "PR", name: "Puerto Rico" });
  });
  it("never guesses a state from a near miss", () => {
    for (const bad of ["Texs", "T", "", "Texas, USA", null, 7])
      expect(resolveState(bad)).toBeNull();
  });
  it("removes filter syntax characters from a name and needs at least two characters", () => {
    expect(safeTerm('Acme, Inc.) or id.eq."x"')).toBe("Acme Inc. or id.eq. x");
    expect(safeTerm("a")).toBeNull();
    expect(safeTerm("***")).toBeNull();
  });
});

describe("ftc_dnc_trends", () => {
  it("returns the counted national months with their days, shares and subjects, and the FTC dashboard months", async () => {
    rules.push(["%22national%22", { rows: [nationalRow("2026-09"), nationalRow("2026-10")] }]);
    rules.push([
      "%22official%22",
      {
        rows: [
          {
            id: "official-2026-05",
            month: "2026-05",
            m: { calls: 10, robocalls: 7, live_callers: 3 },
            source_url: "https://public.tableau.com/x",
          },
        ],
      },
    ]);
    const out = await dnc({});
    const body = JSON.parse(out.content);
    expect(body.scope).toBe("United States");
    expect(body.months_returned).toBe(2);
    expect(body.months[0]).toMatchObject({
      month: "2026-09",
      complete: true,
      reports: 200,
      robocall_share_pct: 78.95,
      days_counted: "September 1 to September 30, 2026",
    });
    expect(body.months[1].complete).toBe(false);
    expect(body.months[0].subjects.named[0]).toMatchObject({
      subject: "Dropped call or no message",
      share_pct: 30,
    });
    expect(body.months[0].subjects.catch_all[0].subject).toBe("Other");
    expect(body.ftc_dashboard_months).toEqual([
      { month: "2026-05", complaints: 10, robocall: 7, live_caller: 3 },
    ]);
    expect(out.sources.map((s) => s.url)).toContain("/data/ftc_dnc_reported_calls");
    expect(JSON.stringify(body)).not.toMatch(/anthropic|claude|openai|gpt|tavily|firecrawl/i);
  });

  it("filters by month range and says nothing was counted instead of returning zero", async () => {
    rules.push(["%22national%22", { rows: [nationalRow("2026-09")] }]);
    const body = JSON.parse((await dnc({ from: "2026-11", to: "2026-12" })).content);
    expect(body.months_returned).toBe(0);
    expect(body.months).toEqual([]);
    expect(body.note).toMatch(/do not estimate/);
  });

  it("reads one state's months with per-100K, rank and the Data Book fiscal years as printed", async () => {
    rules.push(["%22national%22", { rows: [] }]);
    rules.push([
      "dataset=eq.ftc_dnc_reported_calls&state=eq.TX",
      { rows: [stateRow("TX", "2026-09"), stateRow("OH", "2026-09")] },
    ]);
    rules.push([
      "dataset=eq.ftc_dnc_states",
      {
        rows: [
          {
            id: "TX-FY2025",
            source_url: "https://www.ftc.gov/x.pdf",
            cells: { complaints: "170,483" },
            m: { complaints: 170483, complaints_per100k: 591, complaints_rank: 23 },
          },
          { id: "OH-FY2025", m: { complaints: 1 } },
        ],
      },
    ]);
    const body = JSON.parse((await dnc({ state: "texas" })).content);
    expect(body.scope).toBe("Texas (TX)");
    expect(body.months).toHaveLength(1);
    expect(body.months[0]).toMatchObject({
      month: "2026-09",
      reports: 20,
      per_100k_residents: 2,
      rank_per_100k: "7 of 52 (50 states, DC, Puerto Rico)",
    });
    expect(body.months[0].population_denominator).toBe(
      "1000000 (Census resident population, July 1, 2025)",
    );
    expect(body.data_book_fiscal_years).toEqual([
      {
        fiscal_year: 2025,
        complaints: 170483,
        complaints_per_100k: 591,
        rank_of_50_states: 23,
        as_printed: "170,483",
        source: "https://www.ftc.gov/x.pdf",
      },
    ]);
  });

  it("refuses a state it cannot identify and a malformed month", async () => {
    await expect(dnc({ state: "Texs" })).rejects.toThrow(/USPS code/);
    await expect(dnc({ from: "September" })).rejects.toThrow(/month such as/);
  });
});

describe("ftc_hsr_notices", () => {
  const notice = (txn: string, over: Record<string, unknown> = {}) => ({
    id: txn,
    t: `${txn}: A; B`,
    n: {
      transaction_number: txn,
      date: "2026-10-21",
      fiscal_year: 2027,
      acquiring_party: "Intercontinental Exchange, Inc.",
      acquired_party: "MarketAxess Holdings Inc.",
      acquired_entities: ["MarketAxess Holdings Inc."],
    },
    ...over,
  });

  it("finds notices by a name that appears in the published parties and returns them as published", async () => {
    rules.push(["dataset=eq.ftc_hsr_early_terminations", { rows: [notice("20262194")], total: 3 }]);
    const out = await hsr({ party: "Intercontinental" });
    const body = JSON.parse(out.content);
    expect(body.matched_total).toBe(3);
    expect(body.notices[0]).toMatchObject({
      transaction_number: "20262194",
      date_granted: "2026-10-21",
      acquiring_party: "Intercontinental Exchange, Inc.",
      notice_page: "https://www.ftc.gov/legal-library/browse/early-termination-notices/20262194",
    });
    expect(decodeURIComponent(paths[0]!)).toContain("text=ilike.*Intercontinental*");
    expect(body.how_to_read.join(" ")).toMatch(/never merged|not merged/);
  });

  it("exact match compares the whole acquiring or acquired name, quoted, never a part", async () => {
    rules.push(["dataset=eq.ftc_hsr_early_terminations", { rows: [], total: 0 }]);
    const out = await hsr({ party: "Apple Inc.", match: "exact" });
    const path = decodeURIComponent(paths[0]!);
    expect(path).toContain(
      'or=(item->notice->>acquiring_party.ilike."Apple Inc.",item->notice->>acquired_party.ilike."Apple Inc.")',
    );
    expect(path).not.toContain("*Apple");
    expect(JSON.parse(out.content).note).toMatch(/do not guess a spelling/);
  });

  it("keeps a hostile name from adding filter clauses", async () => {
    rules.push(["dataset=eq.ftc_hsr_early_terminations", { rows: [], total: 0 }]);
    await hsr({ party: "x),id.neq.0,(y", match: "exact" });
    const path = decodeURIComponent(paths[0]!);
    expect(path).toContain('ilike."x id.neq.0 y"');
    expect(path.match(/or=\(/g)).toHaveLength(1);
  });

  it("looks up one transaction number and bounds the date range and the page size", async () => {
    rules.push(["dataset=eq.ftc_hsr_early_terminations", { rows: [notice("20262194")], total: 1 }]);
    await hsr({
      transaction_number: "20262194",
      date_from: "2026-01-01",
      date_to: "2026-12-31",
      limit: 500,
    });
    const path = decodeURIComponent(paths[0]!);
    expect(path).toContain("item->notice->>transaction_number=eq.20262194");
    expect(path).toContain("item->notice->>date=gte.2026-01-01");
    expect(path).toContain("item->notice->>date=lte.2026-12-31");
    expect(path).toContain("limit=25");
  });

  it("requires a name or a transaction number and rejects a malformed number", async () => {
    await expect(hsr({})).rejects.toThrow(/party name or a transaction_number/);
    await expect(hsr({ transaction_number: "2026" })).rejects.toThrow(/eight-digit/);
    await expect(hsr({ party: "x" })).rejects.toThrow(/2 to 120/);
  });
});
