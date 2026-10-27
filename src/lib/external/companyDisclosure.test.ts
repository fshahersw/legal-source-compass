import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
}));
vi.mock("@/lib/analytics/tally.server", () => ({ readAllRows: vi.fn() }));

import { disclosureRadar, excerptAround, TORT_TERMS, type FilingText } from "./companyDisclosure";
import { parseFilingText } from "./companyDisclosure.functions";

const filing = (cik: string, fy: string, text: string, mdls: number[] = []): FilingText => ({
  cik,
  company: `Company ${cik}`,
  accession: `${cik}-${fy}`,
  fy,
  filed: `${fy}-12-01`,
  url: null,
  text,
  mdls,
});

describe("tort terms", () => {
  const match = (id: string, text: string) => TORT_TERMS.find((t) => t.id === id)!.re.test(text);
  it("match whole words only", () => {
    expect(match("nec", "it is necessary to defend")).toBe(false);
    expect(match("nec", "claims alleging NEC in preterm infants fed formula")).toBe(true);
    expect(match("nec", "NEC Corporation, a supplier.")).toBe(false);
    expect(match("depo", "lawsuits about Depo-Provera")).toBe(true);
    expect(match("pfas", "PFAS-containing products")).toBe(true);
    expect(match("talc", "talcum powder")).toBe(true);
    expect(match("talc", "Talcott Resolution")).toBe(false);
  });
});

describe("disclosureRadar", () => {
  // Pfizer and Viatris named Depo-Provera first in FY2024 (measured in the corpus 2026-10-27); shapes simplified.
  const filings = [
    filing("0000078003", "2023", "Item 3. Product liability: Zantac (ranitidine) claims."),
    filing("0000078003", "2024", "Depo-Provera claims were filed. Zantac claims continue.", [3140]),
    filing("0001792044", "2024", "We are named in Depo-Provera lawsuits."),
    filing("0001792044", "2025", "Depo-Provera lawsuits continue."),
    filing("0000000003", "2025", "PFAS claims, our first 10-K here."),
  ];
  const out = disclosureRadar(filings, { minFilings: 1 });

  it("counts companies naming each term per fiscal year", () => {
    const c = (term: string, fy: string) => out.cells.find((x) => x.term === term && x.fy === fy)!;
    expect(c("depo", "2024").companies).toBe(2);
    expect(c("depo", "2025").companies).toBe(1);
    expect(c("ranitidine", "2024").companies).toBe(1);
  });

  it("flags a first disclosure only against an earlier 10-K of the same company", () => {
    expect(out.firsts.map((f) => [f.cik, f.term, f.fy])).toEqual([["0000078003", "depo", "2024"]]);
    expect(out.firsts[0]!.excerpt).toContain("Depo-Provera claims were filed");
    expect(out.cells.find((x) => x.term === "depo" && x.fy === "2024")!.firsts).toBe(1);
  });

  it("flags MDL numbers a company cites for the first time", () => {
    expect(out.newMdls).toEqual([
      {
        cik: "0000078003",
        company: "Company 0000078003",
        fy: "2024",
        mdl: 3140,
        accession: "0000078003-2024",
      },
    ]);
  });

  it("leaves thin fiscal years out of the heatmap columns", () => {
    expect(disclosureRadar(filings, { minFilings: 2 }).years).toEqual(["2024", "2025"]);
  });
});

describe("excerptAround", () => {
  it("keeps the verbatim words around the first match", () => {
    expect(excerptAround("a b c talc d e f", /\btalc\b/i, 2)).toBe("… c talc d …");
    expect(excerptAround("nothing", /\btalc\b/i)).toBe("");
  });
});

describe("parseFilingText", () => {
  it("joins Item 3 and note texts and reads MDL numbers from the mentions", () => {
    const f = parseFilingText({
      id: "10k:x",
      source_url: "https://www.sec.gov/Archives/edgar/data/1/x.htm",
      f: {
        cik: "0000104169",
        accession: "0000104169-26-000055",
        period: "2026-01-31",
        company: "Walmart Inc.",
        filed: "2026-03-13",
      },
      t3: "ITEM 3. LEGAL PROCEEDINGS MDL No. 2804",
      n: [{ text: "Note 9. Contingencies" }, { heading: "no text" }],
      m: [{ mdl_number: 2804 }, { mdl_number: "x" }],
    })!;
    expect(f.fy).toBe("2026");
    expect(f.text).toBe("ITEM 3. LEGAL PROCEEDINGS MDL No. 2804\nNote 9. Contingencies");
    expect(f.mdls).toEqual([2804]);
    expect(f.url).toBe("https://www.sec.gov/Archives/edgar/data/1/x.htm");
    expect(
      parseFilingText({ id: 1, source_url: null, f: { cik: "1" }, t3: null, n: null, m: null }),
    ).toBeNull();
  });
});
