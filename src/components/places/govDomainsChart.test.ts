import { describe, expect, it } from "vitest";
import type { GovSummaryState } from "@/lib/external/govDomainsModel";
import { chartRows, chartSummary, placeName, seriesOf, stateBars } from "./govDomainsChart";

const st = (usps: string, total: number, groups: Record<string, number>): GovSummaryState => ({
  usps,
  total,
  cisa: total,
  gsa: 0,
  groups,
  cisaTypes: {},
});

describe("govDomainsChart", () => {
  it("counts a government level in the series of the same name, and everything else as Other", () => {
    expect(seriesOf("state")).toBe("state");
    expect(seriesOf("special_district")).toBe("special_district");
    for (const g of [
      "school_district",
      "tribal",
      "interstate",
      "regional",
      "quasi",
      "unclear",
      "unassigned",
      "x",
    ])
      expect(seriesOf(g)).toBe("other");
  });

  it("builds one bar per state, largest first, with series that add up to the state's records", () => {
    const bars = stateBars([
      st("WY", 122, {
        state: 25,
        county: 40,
        city: 50,
        special_district: 5,
        tribal: 1,
        federal: 1,
      }),
      st("NY", 1801, { city: 1500, county: 200, school_district: 60, unassigned: 41 }),
      st("DC", 1000, { federal: 990, state: 10 }),
    ]);
    expect(bars.map((b) => b.usps)).toEqual(["NY", "DC", "WY"]);
    for (const b of bars) expect(Object.values(b.series).reduce((a, n) => a + n, 0)).toBe(b.total);
    expect(bars[0]!.series).toMatchObject({ city: 1500, county: 200, other: 101, state: 0 });
    expect(bars[2]!.series.other).toBe(1);
  });

  it("breaks ties by name and caps the chart rows", () => {
    const bars = stateBars([
      st("VT", 5, { city: 5 }),
      st("AL", 5, { city: 5 }),
      st("CA", 9, { city: 9 }),
    ]);
    expect(bars.map((b) => b.usps)).toEqual(["CA", "AL", "VT"]);
    expect(chartRows(bars, 2).map((r) => r.usps)).toEqual(["CA", "AL"]);
    expect(chartRows(bars, 2)[0]).toMatchObject({ name: "California", total: 9, city: 9 });
  });

  it("names states, Puerto Rico and territories", () => {
    expect(placeName("TX")).toBe("Texas");
    expect(placeName("DC")).toBe("District of Columbia");
    expect(placeName("PR")).toBe("Puerto Rico");
    expect(placeName("GU")).toBe("Guam");
    expect(placeName("ZZ")).toBe("ZZ");
  });

  it("summarises the chart in words", () => {
    const bars = stateBars([st("NY", 1801, { city: 1801 }), st("CA", 1257, { city: 1257 })]);
    expect(chartSummary(bars, 1)).toBe(
      "Registered government domains by state, 1 largest of 2: New York 1,801.",
    );
    expect(chartSummary([], 15)).toBe("No registered government domains to chart.");
  });
});
