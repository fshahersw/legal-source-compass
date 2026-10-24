import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));

import { restGet } from "@/lib/external/rest.server";
import { DISTRICTS_SHOWN, JUDGES_SHOWN, readMdlSeries, readNational } from "./jpmlSeries.server";

const mocked = vi.mocked(restGet);
const point = (date: string, pending: number) => ({
  date,
  mdls: 1,
  pending,
  total: pending,
  source_url: "https://www.jpml.uscourts.gov/sites/jpml/files/a.pdf",
});

function respond(map: Record<string, unknown[]>) {
  mocked.mockImplementation(async (path: string) => {
    const key = Object.keys(map).find((k) => path.includes(k));
    return { rows: (key ? map[key] : []) as never, total: null };
  });
}

describe("readNational", () => {
  beforeEach(() => {
    mocked.mockReset();
    vi.resetModules();
  });

  it("returns null when the overview row is not published", async () => {
    respond({});
    const { readNational: fresh } = await import("./jpmlSeries.server");
    expect(await fresh()).toBeNull();
  });

  it("keeps only the districts and judges largest at the latest report and counts every judge", async () => {
    const districts = Array.from({ length: DISTRICTS_SHOWN + 3 }, (_, i) => ({
      id: `district:D${i}`,
      district: `D${i}`,
      court: { court_id: `d${i}`, label: `D. ${i}` },
      series: [{ date: "2026-10-01", mdls: 1, pending: i, total: i, share_pct: null }],
    }));
    const judges = Array.from({ length: JUDGES_SHOWN + 5 }, (_, i) => ({
      id: `judge:j${i}`,
      judge: `Judge ${String(i).padStart(2, "0")}`,
      series: [{ date: "2026-10-01", mdls: 1, pending: 100 - i, total: 100 }],
    }));
    respond({
      "dataset=eq.jpml_pending_snapshots": [
        {
          item: {
            monthly: [point("2026-09-01", 9), point("2026-10-01", 10)],
            quarter_end: [],
            monthly_gaps: [],
            held_reports: [],
          },
        },
      ],
      "dataset=eq.jpml_series_index": [{ points: [{ date: "2025-09-30", value: 197118 }] }],
      "id=like.circuit": [
        {
          circuit: { slug: "3", name: "Third Circuit" },
          series: [{ date: "2026-09-30", districts: 5, mdls: 24, pending: 90251, total: 112248 }],
        },
      ],
      "id=like.district": districts,
      "id=like.judge": judges,
    });
    const { readNational: fresh } = await import("./jpmlSeries.server");
    const n = await fresh();
    expect(n?.monthly.map((p) => p.date)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(n?.fiscalYear).toEqual([{ date: "2025-09-30", value: 197118 }]);
    expect(n?.circuits[0]?.name).toBe("Third Circuit");
    expect(n?.districts).toHaveLength(DISTRICTS_SHOWN);
    expect(n?.districts[0]?.name).toBe(`D${DISTRICTS_SHOWN + 2}`);
    expect(n?.judges).toHaveLength(JUDGES_SHOWN);
    expect(n?.judges[0]?.name).toBe("Judge 00");
    expect(n?.judgesTotal).toBe(JUDGES_SHOWN + 5);
  });
});

describe("readMdlSeries", () => {
  beforeEach(() => mocked.mockReset());

  it("reads one MDL by its exact id and returns null when absent", async () => {
    respond({});
    expect(await readMdlSeries(2738)).toBeNull();
    expect(mocked.mock.calls[0]?.[0]).toContain("id=eq.mdl:2738");
  });
});
