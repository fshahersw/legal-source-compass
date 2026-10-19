import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (handler: unknown) => handler }),
}));

import { restGet } from "./rest.server";
import { getSourcesDirectory, parseDirectory, sampleUrls } from "./sourcesCatalog.functions";

const row = (over: Record<string, unknown>) => ({
  id: "court_locations",
  label: "Federal courthouse addresses",
  ready: true,
  imported_records: 186,
  updated_at: "2026-10-19T04:00:00Z",
  source: "Each court's website, mapped through https://www.uscourts.gov/court-website-links",
  qualification: null,
  ...over,
});

describe("sources directory", () => {
  it("lists ready datasets and only counts held ones", () => {
    const d = parseDirectory([
      row({}),
      row({ id: "verdict_reports", ready: false }),
      row({ id: "staged_x", ready: null }),
    ]);
    expect(d.datasets.map((x) => x.id)).toEqual(["court_locations"]);
    expect(d.held).toBe(2);
    expect(d.datasets[0]!.sourceUrls).toEqual(["https://www.uscourts.gov/court-website-links"]);
  });

  it("reads object source statements and drops malformed values", () => {
    const d = parseDirectory([
      row({
        id: "fda_faers_product_series",
        source: { url: "https://open.fda.gov/apis/drug/event/", name: "FAERS" },
        imported_records: -3,
        updated_at: "yesterday",
        label: "",
      }),
      row({ id: "BAD ID" }),
    ]);
    expect(d.datasets).toHaveLength(1);
    expect(d.datasets[0]).toMatchObject({
      label: "fda_faers_product_series",
      records: null,
      updatedAt: null,
      sourceUrls: ["https://open.fda.gov/apis/drug/event/"],
    });
  });

  it("keeps only http(s) record source URLs from a sample", () => {
    expect(
      sampleUrls([
        { source_url: "https://www.nhtsa.gov/recalls?nhtsaId=10C001000" },
        { source_url: "/supplement-files/x" },
        { source_url: null },
        { source_url: "javascript:alert(1)" },
      ]),
    ).toEqual(["https://www.nhtsa.gov/recalls?nhtsaId=10C001000"]);
  });

  it("selects the summary source and listing qualification", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [row({})], total: null });
    const handler = getSourcesDirectory as unknown as () => Promise<{ datasets: unknown[] }>;
    const result = await handler();
    expect(result.datasets).toHaveLength(1);
    expect(vi.mocked(restGet).mock.calls[0]![0]).toContain("source:metadata->summary->source");
  });
});
