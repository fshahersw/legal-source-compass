import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/massTortSignals.functions", () => ({ getMassTortSignals: vi.fn() }));

import { yearly } from "./MassTortSignals";

describe("yearly", () => {
  it("flags the current year as partial (year to date) and only that year", () => {
    const out = yearly({ eventsByYear: { "2025": 127, "2026": 627 } }, new Date("2026-10-27T00:00:00Z"));
    expect(out[0]).toEqual({ year: "2010", reports: 0, partial: false });
    expect(out.at(-2)).toEqual({ year: "2025", reports: 127, partial: false });
    expect(out.at(-1)).toEqual({ year: "2026", reports: 627, partial: true });
    expect(out.filter((d) => d.partial)).toHaveLength(1);
  });
});
