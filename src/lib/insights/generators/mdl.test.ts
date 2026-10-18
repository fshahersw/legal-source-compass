import { describe, expect, it } from "vitest";
import { generateMdlInsights, mdlName, type MdlInput, type MdlRowLite } from "./mdl";

const portfolio = Array.from({ length: 25 }, (_, k) => {
  const year = 2024 + Math.floor((9 + k) / 12);
  const month = ((9 + k) % 12) + 1;
  return {
    date: `${year}-${String(month).padStart(2, "0")}-01`,
    pending: 400000 - k * 8000,
    mdls: 170 - Math.floor(k / 3),
    massTortPending: 390000 - k * 8000,
    massTortMdls: 58 + Math.floor(k / 3),
  };
});

const row = (i: number, over: Partial<MdlRowLite> = {}): MdlRowLite => ({
  mdl: 2000 + i,
  title: `IN RE: Product ${i} Products Liability Litigation`,
  type: "Products Liability",
  status: "pending",
  pending: 10_000 - i * 700,
  total: 12_000,
  change12m: i % 2 ? 50 : -50,
  ageYears: 2 + i,
  rank: i + 1,
  sharePct: null,
  ...over,
});

function input(over: Partial<MdlInput> = {}): MdlInput {
  const last = portfolio[portfolio.length - 1]!;
  return {
    asOf: last.date,
    reports: 25,
    firstReport: portfolio[0]!.date,
    pendingMdls: last.mdls,
    pendingActions: last.pending,
    massTortMdls: 68,
    massTortActions: 190_000,
    top10SharePct: 80.3,
    medianAgeYears: 4.4,
    newMdlsInSeries: 44,
    leftSeries: 52,
    portfolio,
    fastestGrowing: [
      {
        mdl: 3140,
        title:
          "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
        pending: 6412,
        change12m: 5190,
      },
      {
        mdl: 3084,
        title: "IN RE: Uber Technologies, Inc., Passenger Sexual Assault Litigation",
        pending: 4916,
        change12m: 2195,
      },
      {
        mdl: 3081,
        title: "IN RE: Bard Implanted Port Catheter Products Liability Litigation",
        pending: 4140,
        change12m: 2167,
      },
    ],
    fastestDeclining: [
      {
        mdl: 2740,
        title: "IN RE: Taxotere (Docetaxel) Products Liability Litigation",
        pending: 20,
        change12m: -3392,
      },
      {
        mdl: 2741,
        title: "IN RE: Roundup Products Liability Litigation",
        pending: 1104,
        change12m: -3368,
      },
      {
        mdl: 2924,
        title: "IN RE: Zantac (Ranitidine) Products Liability Litigation",
        pending: 847,
        change12m: -1386,
      },
    ],
    byType: [
      { key: "Products Liability", mdls: 63, pending: 192034, total: 1, change12m: 1 },
      { key: "Miscellaneous", mdls: 15, pending: 9306, total: 1, change12m: 1 },
      { key: "Antitrust", mdls: 38, pending: 1173, total: 1, change12m: 1 },
    ],
    byDistrict: [
      { key: "NJ", mdls: 12, pending: 84916, total: 1, change12m: 1417 },
      { key: "OHS", mdls: 3, pending: 25000, total: 1, change12m: 1 },
      { key: "SC", mdls: 2, pending: 16000, total: 1, change12m: 1 },
    ],
    rows: Array.from({ length: 12 }, (_, i) => row(i)),
    terminated: Array.from({ length: 120 }, (_, i) => ({
      mdl: 100 + i,
      caption: `IN RE: Old Litigation ${i}`,
      district: "D. X",
      year: 1990 + (i % 36),
      closed: 98,
      remanded: 2 + (i === 7 ? 500 : 0),
    })),
    ...over,
  };
}

const byId = (d: MdlInput) => Object.fromEntries(generateMdlInsights(d).map((i) => [i.id, i]));

describe("mdlName", () => {
  it("shortens the stored title and keeps parentheses balanced", () => {
    expect(
      mdlName(
        3140,
        "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
      ),
    ).toBe("MDL 3140 (Depo-Provera)");
    expect(mdlName(2740, "IN RE: Taxotere (Docetaxel) Products Liability Litigation")).toBe(
      "MDL 2740 (Taxotere (Docetaxel))",
    );
    expect(mdlName(1, "")).toBe("MDL 1 (title not recorded)");
    const long = mdlName(
      2738,
      "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
    );
    expect(long.length).toBeLessThan(90);
    expect((long.match(/\(/g) ?? []).length).toBe((long.match(/\)/g) ?? []).length);
  });
});

describe("generateMdlInsights", () => {
  it("reports the pending-actions trend against the first report and a year ago", () => {
    const i = byId(input())["mdl.pending-actions-trend"]!;
    // last = 400000 - 24 x 8000 = 208000; first = 400000 -> down 48%
    expect(i.headline).toBe(
      "Pending actions in federal MDLs stood at 208,000 on 2026-10-01, down 48% from 2024-10-01",
    );
    expect(i.summary[1]).toContain("down 31.6%"); // 2025-10-01: 400000 - 12 x 8000 = 304000; 208000 is 31.6% below it
    expect(i.summary[1]).toContain("304,000 on 2025-10-01");
    expect(i.summary[3]).toContain("44 MDLs entered the pending list and 52 left it");
  });

  it("skips the trend when the stored portfolio does not end at the overview total", () => {
    expect(byId(input({ pendingActions: 1 }))["mdl.pending-actions-trend"]).toBeUndefined();
    expect(byId(input({ portfolio: [] }))["mdl.pending-actions-trend"]).toBeUndefined();
  });

  it("describes the largest MDLs and the top ten share", () => {
    const i = byId(input())["mdl.docket-concentration"]!;
    expect(i.headline).toBe("The ten largest MDLs hold 80% of all pending MDL actions");
    expect(i.points[0]).toMatchObject({
      label: "MDL 2000",
      value: "10,000",
      href: "/matters/lens/2000",
    });
  });

  it("lists the fastest growing and declining MDLs from the stored overview lists", () => {
    const ids = byId(input());
    expect(ids["mdl.fastest-growing"]!.headline).toBe(
      "MDL 3140 (Depo-Provera) added the most pending actions in the last 12 months (+5,190)",
    );
    expect(ids["mdl.fastest-declining"]!.headline).toContain(
      "MDL 2740 (Taxotere (Docetaxel)) cleared the most pending actions",
    );
    expect(ids["mdl.fastest-declining"]!.points[0]!.value).toBe("-3,392");
  });

  it("does not create a growth candidate when nothing grew", () => {
    const none = input({
      fastestGrowing: input().fastestGrowing.map((m) => ({ ...m, change12m: -1 })),
    });
    expect(byId(none)["mdl.fastest-growing"]).toBeUndefined();
  });

  it("computes type and district shares from the stored groups", () => {
    const ids = byId(input());
    // 192034 / 208000 = 92.3%
    expect(ids["mdl.case-type-mix"]!.headline).toBe(
      "Products Liability MDLs hold 92% of pending MDL actions",
    );
    expect(ids["mdl.district-concentration"]!.headline).toBe(
      "Transferee district NJ holds 41% of pending MDL actions",
    );
    expect(ids["mdl.district-concentration"]!.caveat).toContain("JPML's own codes");
  });

  it("counts pending MDLs ten years or older from the row ages", () => {
    const i = byId(input())["mdl.mdl-age"]!;
    // ages 2..13: ten or older = 10, 11, 12, 13 -> 4
    expect(i.headline).toBe(
      "The median pending MDL is 4.4 years old; 4 have been pending for ten years or more",
    );
    expect(i.points[2]).toMatchObject({ label: "Oldest: MDL 2011", value: "13 years" });
  });

  it("summarizes the terminated-MDL history", () => {
    const i = byId(input())["mdl.terminated-history"]!;
    // closed = 120 x 98 = 11,760; remanded = 120 x 2 + 500 = 740; total 12,500 -> remanded 5.9%
    expect(i.headline).toBe(
      "94% of actions in terminated MDLs were closed in the MDL court and 6% remanded (1990 to 2025)",
    );
    expect(i.points[4]).toMatchObject({ label: "Largest: MDL 107", value: "600" });
  });

  it("needs a real history before it reports one", () => {
    expect(
      byId(input({ terminated: input().terminated.slice(0, 20) }))["mdl.terminated-history"],
    ).toBeUndefined();
  });

  it("drops candidates for missing inputs and never prints a placeholder", () => {
    const sparse = input({
      rows: [],
      byType: [],
      byDistrict: [],
      fastestGrowing: [],
      fastestDeclining: [],
      terminated: [],
      newMdlsInSeries: null,
      leftSeries: null,
      top10SharePct: null,
    });
    expect(Object.keys(byId(sparse))).toEqual(["mdl.pending-actions-trend"]);
    for (const i of generateMdlInsights(input()))
      expect(JSON.stringify(i)).not.toMatch(/NaN|undefined|Infinity/);
  });
});
