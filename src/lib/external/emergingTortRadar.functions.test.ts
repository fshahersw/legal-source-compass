import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@/lib/analytics/tally.server", () => ({ readAllRows: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: (v: (d: unknown) => unknown) => ({
      handler: (h: (ctx: { data: unknown }) => unknown) => (ctx: { data: unknown }) =>
        h({ data: v(ctx.data) }),
    }),
  }),
}));

import { restGet } from "./rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import { getEmergingTortRadar, getRadarCandidate } from "./emergingTortRadar.functions";

const radar = (id: string, points: number) => ({
  unit_id: id,
  kind: "vehicle",
  label: "JEEP WRANGLER — ELECTRICAL SYSTEM",
  identifiers: { make: "JEEP", model: "WRANGLER", component: "ELECTRICAL SYSTEM" },
  mdl_status: { status: "none_linked", links: [] },
  components: [
    {
      family: "A",
      metric: "NHTSA complaints",
      observed: 847,
      expected: 394.8,
      ratio: 2.145,
      ci_low: 2.003,
      ci_high: 2.29,
      points: 2,
      max_points: 2,
    },
    {
      family: "C",
      metric: "NHTSA investigations and recalls",
      observed: 6,
      points: 3,
      max_points: 3,
    },
  ],
  points,
  families_present: 2,
  families: ["A", "C"],
  excess: 452.2,
  evidence: [
    { dataset: "agency_safety_nhtsa_investigations", id: "PE25014", label: "PE25014", points: 1 },
  ],
  flags: [],
  window: { recent: "2025-10 to 2026-09" },
  rank: 9,
});

type Fn<T> = (ctx?: unknown) => Promise<T>;

describe("getEmergingTortRadar", () => {
  beforeEach(() => vi.mocked(restGet).mockReset());

  it("reports an unpublished dataset without reading records", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [], total: null });
    const out = await (
      getEmergingTortRadar as unknown as Fn<{ published: boolean; rows: unknown[] }>
    )();
    expect(out.published).toBe(false);
    expect(out.rows).toEqual([]);
    expect(readAllRows).not.toHaveBeenCalled();
  });
});

describe("getRadarCandidate", () => {
  beforeEach(() => vi.mocked(restGet).mockReset());

  it("returns a reconciling unit and null for one that does not reconcile", async () => {
    const call = getRadarCandidate as unknown as (ctx: {
      data: { id: string };
    }) => Promise<unknown>;
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [{ item: { radar: radar("vehicle:jeep-wrangler-electrical-system", 5) } }],
      total: null,
    });
    const ok = (await call({ data: { id: "vehicle:jeep-wrangler-electrical-system" } })) as {
      points: number;
    } | null;
    expect(ok?.points).toBe(5);
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [{ item: { radar: radar("vehicle:jeep-wrangler-electrical-system", 6) } }],
      total: null,
    });
    expect(await call({ data: { id: "vehicle:jeep-wrangler-electrical-system" } })).toBeNull();
    const path = vi.mocked(restGet).mock.calls[0]![0];
    expect(path).toContain("dataset=eq.agency_safety_tort_radar");
    expect(path).toContain("id=eq.vehicle%3Ajeep-wrangler-electrical-system");
  });

  it("rejects an id that is not a radar unit id", async () => {
    const call = getRadarCandidate as unknown as (ctx: {
      data: { id: string };
    }) => Promise<unknown>;
    await expect(Promise.resolve().then(() => call({ data: { id: "x;drop" } }))).rejects.toThrow();
  });
});

describe("not-published answers are not cached", () => {
  it("treats a dataset that is not ready as unpublished, then reads it once it is ready", async () => {
    vi.resetModules();
    const rest = await import("./rest.server");
    const tally = await import("@/lib/analytics/tally.server");
    vi.mocked(rest.restGet)
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ ready: false, imported_records: 850 }], total: null })
      .mockResolvedValueOnce({ rows: [{ ready: true, imported_records: 2 }], total: null });
    vi.mocked(tally.readAllRows)
      .mockReset()
      .mockResolvedValueOnce([
        { id: "summary:overview", item: { kind: "radar_summary", summary: { as_of: "2026-10-27" } } },
        { id: "a", item: { kind: "radar", radar: radar("vehicle:a", 5) } },
      ]);
    const mod = await import("./emergingTortRadar.functions");
    const call = mod.getEmergingTortRadar as unknown as Fn<{ published: boolean; rows: unknown[] }>;
    const first = await call();
    expect(first.published).toBe(false); // a publish still running (ready=false) is not read as complete
    expect(tally.readAllRows).not.toHaveBeenCalled();
    const second = await call(); // not cached: the next call sees the finished publish
    expect(second.published).toBe(true);
    expect(second.rows).toHaveLength(1);
  });
});

describe("published read", () => {
  it("drops rows that do not reconcile and keeps the overview", async () => {
    vi.resetModules();
    const rest = await import("./rest.server");
    const tally = await import("@/lib/analytics/tally.server");
    vi.mocked(rest.restGet)
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ ready: true, imported_records: 3 }], total: null });
    vi.mocked(tally.readAllRows).mockResolvedValueOnce([
      { id: "summary:overview", item: { kind: "radar_summary", summary: { as_of: "2026-10-27" } } },
      { id: "a", item: { kind: "radar", radar: radar("vehicle:a", 5) } },
      { id: "b", item: { kind: "radar", radar: radar("vehicle:b", 7) } },
    ]);
    const mod = await import("./emergingTortRadar.functions");
    const out = await (
      mod.getEmergingTortRadar as unknown as Fn<{
        published: boolean;
        rows: { unit_id: string; openInvestigations: number }[];
        dropped: number;
        summary: { as_of: string } | null;
      }>
    )();
    expect(out.published).toBe(true);
    expect(out.summary?.as_of).toBe("2026-10-27");
    expect(out.rows.map((r) => r.unit_id)).toEqual(["vehicle:a"]);
    expect(out.rows[0]!.openInvestigations).toBe(1);
    expect(out.dropped).toBe(1);
  });
});
