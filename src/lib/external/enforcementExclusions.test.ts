import { describe, expect, it } from "vitest";
import { parseExclusionTrends, parseNpdbNational } from "./enforcementExclusions";

describe("parseExclusionTrends", () => {
  // shape of public.exclusions_trends_v1 (database/contracts/exclusions-trends-v1.sql); counts measured 2026-10-27
  const raw = {
    as_of: "2026-10-27",
    leie: [
      { year: "2024", group: "1128a1", n: 1138 },
      { year: "2024", group: "1128b4", n: 1014 },
      { year: "2024", group: "1128b7", n: 968 },
      { year: "2026", group: "1128a1", n: 924 },
      { year: "x", group: "1128a1", n: 5 },
    ],
    leie_total: 84093,
    leie_undated: 0,
    leie_future: 0,
    sam: [
      { year: "2025", group: "Firm", n: 363 },
      { year: "2025", group: "Mystery", n: 1 },
    ],
    sam_total: 169031,
    sam_undated: 11015,
    sam_future: 2,
  };
  const t = parseExclusionTrends(raw)!;

  it("groups other authorities, zero-fills missing years and flags the current year", () => {
    expect(t.leie.map((r) => r.year)).toEqual(["2024", "2025", "2026"]);
    expect(t.leie[0]).toMatchObject({ "1128a1": 1138, "1128b4": 1014, other: 968, total: 3120, partial: false });
    expect(t.leie[1]!.total).toBe(0);
    expect(t.leie[2]!.partial).toBe(true);
  });

  it("keeps SAM future-dated and undated counts as published and maps unknown classes", () => {
    expect(t.samFuture).toBe(2);
    expect(t.samUndated).toBe(11015);
    expect(t.sam[0]).toMatchObject({ Firm: 363, other: 1, total: 364, partial: false });
  });

  it("rejects a payload without a valid as-of date", () => {
    expect(parseExclusionTrends({ leie: [] })).toBeNull();
    expect(parseExclusionTrends(null)).toBeNull();
  });
});

describe("parseNpdbNational", () => {
  const rows = [
    { id: "npdb-mmpr-us:1991", c: { year: 1991, reports: 17961, median_payment: 42500, median_payment_2025usd: 100459.45, delay_median_years: 4, judgment_share: 0.0312, total_paid: 2320690200 }, source_url: "https://www.npdb.hrsa.gov/resources/publicData.jsp" },
    { id: "npdb-mmpr-us:1990", c: { year: 1990, reports: 2856, median_payment: 37500, median_payment_2025usd: 92370.79 } },
    { id: "npdb-mmpr-us:2026", c: { year: 2026, reports: 5798, median_payment: 245000, median_payment_2025usd: null } },
    { id: "npdb-mmpr-us:all", c: { year: "All years", reports: 535578 } },
    { id: "npdb-mmpr-us:allegation:50", c: { label: "Obstetrics Related", reports: 35230, median_payment: 245000 } },
    { id: "npdb-mmpr-us:allegation:1", c: { label: "Diagnosis Related", reports: 148843, median_payment: 175000 } },
  ];
  const n = parseNpdbNational(rows, "2026-10-27");

  it("marks 1990 (opening year) and the current year partial and keeps a missing median null", () => {
    expect(n.years.map((y) => [y.year, y.partial])).toEqual([
      ["1990", true],
      ["1991", false],
      ["2026", true],
    ]);
    expect(n.years[2]!.median2025).toBeNull();
    expect(n.years[1]).toMatchObject({ reports: 17961, judgmentShare: 0.0312 });
  });

  it("reads allegation groups and ignores the all-years row", () => {
    expect(n.allegations.map((a) => a.label)).toEqual(["Diagnosis Related", "Obstetrics Related"]);
    expect(n.sourceUrl).toBe("https://www.npdb.hrsa.gov/resources/publicData.jsp");
  });
});
