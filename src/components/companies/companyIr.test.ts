import { describe, expect, it } from "vitest";
import {
  chartSlice,
  groupsPresent,
  irFigureRows,
  parseCoverFacts,
  parseIrDocument,
  printed,
  type IrDocumentFigures,
} from "./companyIr";

const fig = (over: Record<string, unknown> = {}) => ({
  group: "segment",
  name: "Medical",
  metric: "revenue",
  period: "Q4 FY2026",
  value: 1234.5,
  unit: "USD millions",
  quote: "Medical | 1,234.5",
  page: 4,
  check: "text",
  ...over,
});

const docItem = (figures: unknown[], over: Record<string, unknown> = {}) => ({
  document: {
    url: "https://investors.bd.com/q4.pdf",
    title: "Q4 FY2026 presentation",
    kind: "presentation",
    retrieved: "2026-10-28",
    linked_from: null,
  },
  extraction: {
    status: "extracted",
    document_period: "Q4 FY2026",
    currency: "USD",
    figures,
    ...over,
  },
});

describe("cover facts", () => {
  it("reads facts newest first and drops malformed ones", () => {
    const c = parseCoverFacts(
      "cover:0000010795",
      {
        cells: { company: "BECTON DICKINSON & CO" },
        cover: {
          public_float: [
            { end: "2025-03-31", value: 50e9, form: "10-K", filed: "2025-11-20" },
            { end: "2026-03-31", value: 60e9, form: "10-K", filed: "2026-11-19" },
            { end: "bad", value: 1 },
            { end: "2024-03-31", value: "60" },
          ],
          shares_outstanding: [],
        },
      },
      "https://data.sec.gov/x.json",
    );
    expect(c?.company).toBe("BECTON DICKINSON & CO");
    expect(c?.publicFloat.map((f) => f.end)).toEqual(["2026-03-31", "2025-03-31"]);
    expect(c?.sharesOutstanding).toEqual([]);
    expect(parseCoverFacts("ir:0000010795:0123456789abcdef", {}, "")).toBeNull();
  });
});

describe("IR documents", () => {
  it("keeps valid figures and rejects documents without an http(s) URL", () => {
    const d = parseIrDocument(
      "ir:0000010795:0123456789abcdef",
      docItem([fig(), fig({ group: "other" }), fig({ value: "12" }), fig({ quote: "" })]),
    );
    expect(d?.figures).toHaveLength(1);
    expect(d?.status).toBe("extracted");
    const bad = docItem([]);
    (bad.document as Record<string, unknown>)["url"] = "javascript:alert(1)";
    expect(parseIrDocument("ir:0000010795:0123456789abcdef", bad)).toBeNull();
    expect(parseIrDocument("cover:0000010795", docItem([]))).toBeNull();
  });

  it("charts one metric, period, unit and document only", () => {
    const a = parseIrDocument(
      "ir:0000010795:aaaaaaaaaaaaaaaa",
      docItem([
        fig({ name: "Medical", value: 1234.5 }),
        fig({ name: "Life Sciences", value: 812 }),
        fig({ name: "Interventional", value: 1100 }),
        fig({ name: "Medical", metric: "operating income", value: 300 }),
        fig({ group: "geography", name: "US", value: 2000 }),
      ]),
    )!;
    const b = parseIrDocument(
      "ir:0000010795:bbbbbbbbbbbbbbbb",
      docItem([fig({ name: "Medical", period: "Q3 FY2026", value: 1200 })], {}),
    )!;
    const pending: IrDocumentFigures = {
      ...b,
      id: "ir:0000010795:cccccccccccccccc",
      status: "pending",
    };
    const rows = irFigureRows([b, a, pending]);
    expect(rows.every((r) => r.documentId !== pending.id)).toBe(true);
    expect(groupsPresent(rows)).toEqual(["segment", "geography"]);
    const s = chartSlice(rows, "segment");
    expect(s?.documentId).toBe(a.id);
    expect(s?.rows.map((r) => r.name)).toEqual(["Medical", "Interventional", "Life Sciences"]);
    expect(chartSlice(rows, "geography")).toBeNull();
  });

  it("prints values with their unit and never converts them", () => {
    expect(printed(1234.5, "USD millions")).toBe("1,234.5 USD millions");
    expect(printed(4.2, "%")).toBe("4.2%");
    expect(printed(12000, "")).toBe("12,000");
  });
});
