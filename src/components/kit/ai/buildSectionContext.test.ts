import { describe, expect, it } from "vitest";
import {
  MAX_SECTION_CONTEXT_BYTES,
  renderSectionContext,
  sectionContextSchema,
  serialisedBytes,
} from "@/lib/assistant/sectionContext";
import { buildSectionContext, figuresFromRows, formatFigureValue } from "./buildSectionContext";

describe("formatFigureValue", () => {
  it("prints exact digits with thousands commas, no compaction", () => {
    expect(formatFigureValue(303716)).toBe("303,716");
    expect(formatFigureValue(4.4)).toBe("4.4");
    expect(formatFigureValue(617.9)).toBe("617.9");
    expect(formatFigureValue(1234567.891)).toBe("1,234,567.89");
    expect(formatFigureValue(4.4, 2)).toBe("4.4");
    expect(formatFigureValue(0)).toBe("0");
  });
  it("reads a gap as Not recorded, never zero", () => {
    expect(formatFigureValue(null)).toBe("Not recorded");
    expect(formatFigureValue(undefined)).toBe("Not recorded");
    expect(formatFigureValue(Number.NaN)).toBe("Not recorded");
    expect(formatFigureValue("  ")).toBe("Not recorded");
  });
  it("keeps ready-made text as written", () => {
    expect(formatFigureValue("$3.94 billion")).toBe("$3.94 billion");
  });
});

describe("buildSectionContext units and text", () => {
  const ctx = buildSectionContext({
    title: "  Federal civil\n cases filed ",
    scope: "United States",
    period: "FY2025",
    source: { label: "Federal Judicial Center, Integrated Database" },
    figures: [
      { label: "Cases filed", value: 303716, unit: "cases" },
      { label: "Change on FY2024", value: 4.4, unit: "%", decimals: 1 },
      { label: "Rate", value: 617.9, unit: "per 100,000 residents", period: "FY2025" },
      { label: "Settled", value: null, unit: "cases" },
    ],
  });

  it("collapses whitespace and derives a stable id", () => {
    expect(ctx.title).toBe("Federal civil cases filed");
    expect(ctx.id).toBe("federal-civil-cases-filed");
    expect(ctx.scope).toBe("United States");
    expect(ctx.source).toBe("Federal Judicial Center, Integrated Database");
  });

  it("keeps each figure's unit and period, and drops the unit of a gap", () => {
    expect(ctx.figures[0]).toEqual({ label: "Cases filed", value: "303,716", unit: "cases" });
    expect(ctx.figures[1]).toEqual({ label: "Change on FY2024", value: "4.4", unit: "%" });
    expect(ctx.figures[2]).toMatchObject({ unit: "per 100,000 residents", period: "FY2025" });
    expect(ctx.figures[3]).toEqual({ label: "Settled", value: "Not recorded" });
  });

  it("renders units next to the number and attaches a percent sign", () => {
    expect(renderSectionContext(ctx)).toBe(
      [
        "Section: Federal civil cases filed",
        "Scope: United States",
        "Period: FY2025",
        "Source: Federal Judicial Center, Integrated Database",
        "Figures:",
        "- Cases filed: 303,716 cases",
        "- Change on FY2024: 4.4%",
        "- Rate: 617.9 per 100,000 residents (FY2025)",
        "- Settled: Not recorded",
      ].join("\n"),
    );
  });

  it("passes the shared schema", () => {
    expect(sectionContextSchema.safeParse(ctx).success).toBe(true);
  });
});

describe("buildSectionContext truncation and determinism", () => {
  const many = (n: number, label = "Figure") =>
    Array.from({ length: n }, (_, i) => ({ label: `${label} ${i + 1}`, value: i * 10 }));

  it("keeps the order given and cuts at maxFigures, recording the total", () => {
    const ctx = buildSectionContext({ title: "T", figures: many(30), maxFigures: 5 });
    expect(ctx.figures.map((f) => f.label)).toEqual([
      "Figure 1",
      "Figure 2",
      "Figure 3",
      "Figure 4",
      "Figure 5",
    ]);
    expect(ctx.total).toBe(30);
    expect(renderSectionContext(ctx)).toContain("Figures (5 of 30 shown):");
  });

  it("defaults to 24 figures and never more than 40", () => {
    expect(buildSectionContext({ title: "T", figures: many(100) }).figures).toHaveLength(24);
    expect(
      buildSectionContext({ title: "T", figures: many(100), maxFigures: 500 }).figures,
    ).toHaveLength(40);
  });

  it("does not record a total when nothing was cut", () => {
    expect(buildSectionContext({ title: "T", figures: many(3) }).total).toBeUndefined();
  });

  it("stays under 8 KB however long the labels and notes are", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      label: `Row ${i} ${"A very long label ".repeat(20)}`,
      value: "9".repeat(60),
      unit: "u".repeat(80),
      period: "p".repeat(80),
      note: "n".repeat(500),
    }));
    const ctx = buildSectionContext({
      title: "t".repeat(500),
      scope: "s".repeat(500),
      period: "p".repeat(500),
      source: "x".repeat(900),
      figures: long,
      maxFigures: 40,
    });
    expect(serialisedBytes(ctx)).toBeLessThanOrEqual(MAX_SECTION_CONTEXT_BYTES);
    expect(ctx.figures.length).toBeGreaterThan(0);
    expect(ctx.total).toBe(40);
    expect(sectionContextSchema.safeParse(ctx).success).toBe(true);
  });

  it("is deterministic: the same input gives the same bytes", () => {
    const input = { title: "T", period: "FY2025", figures: many(12) };
    expect(JSON.stringify(buildSectionContext(input))).toBe(
      JSON.stringify(buildSectionContext({ ...input, figures: [...input.figures] })),
    );
  });

  it("drops empty labels and repeated label+period pairs, strips control characters", () => {
    const ctx = buildSectionContext({
      title: "T",
      figures: [
        { label: "", value: 1 },
        { label: "A\u0000B", value: 1 },
        { label: "AB", value: 2 },
        { label: "AB", value: 3, period: "FY2024" },
      ],
    });
    expect(ctx.figures.map((f) => `${f.label}:${f.value}:${f.period ?? ""}`)).toEqual([
      "A B:1:",
      "AB:2:",
      "AB:3:FY2024",
    ]);
  });
});

describe("figuresFromRows ordering", () => {
  const rows = [
    { name: "Texas", v: 50 },
    { name: "Ohio", v: 70 },
    { name: "Utah", v: 50 },
    { name: "Iowa", v: null },
    { name: "Maine", v: 90 },
  ];
  const spec = {
    label: (r: (typeof rows)[number]) => r.name,
    value: (r: (typeof rows)[number]) => r.v,
  };

  it("ranks largest first, breaks ties by label and puts gaps last", () => {
    expect(figuresFromRows(rows, spec).map((f) => f.label)).toEqual([
      "Maine",
      "Ohio",
      "Texas",
      "Utah",
      "Iowa",
    ]);
  });
  it("ranks smallest first on request, gaps still last", () => {
    expect(figuresFromRows(rows, { ...spec, order: "asc" }).map((f) => f.label)).toEqual([
      "Texas",
      "Utah",
      "Ohio",
      "Maine",
      "Iowa",
    ]);
  });
  it("keeps the given order for none, and cuts to the limit", () => {
    expect(figuresFromRows(rows, { ...spec, order: "none", limit: 2 }).map((f) => f.label)).toEqual(
      ["Texas", "Ohio"],
    );
  });
  it("carries the unit and a per-row period to the figures", () => {
    const out = figuresFromRows(rows, {
      ...spec,
      unit: "cases",
      period: (r) => `FY${r.v}`,
      limit: 1,
    });
    expect(out[0]).toMatchObject({ label: "Maine", value: 90, unit: "cases", period: "FY90" });
  });
  it("is stable when the input order changes", () => {
    const a = figuresFromRows(rows, spec).map((f) => f.label);
    const b = figuresFromRows([...rows].reverse(), spec).map((f) => f.label);
    expect(b.slice(0, 4)).toEqual(a.slice(0, 4));
  });
});
