import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getClbOralArguments, parseOralProfile } from "./clbOralArguments.functions";

// Shape of a clb_oral_arguments profile (cut down from the ca9 record).
const PROFILE = {
  court_id: "ca9",
  name: "Court of Appeals for the Ninth Circuit",
  recordings: 100,
  dockets: 99,
  with_argued_date: 100,
  first_argued: "2003-02-14",
  last_argued: "2026-09-29",
  total_hours: 51.2,
  duration_minutes: { n: 99, p10: 15, p25: 22.2, p50: 28.9, p75: 36, p90: 45, max: 120 },
  with_transcript: 98,
  transcript_pct: 98,
  with_judges_text: 100,
  judges_text_pct: 100,
  by_year: [
    { yr: 2004, recordings: 40, median_minutes: 26.6, hours: 18, with_transcript: 40 },
    { yr: 2003, recordings: 60, median_minutes: 28.4, hours: 30, with_transcript: 58 },
    { yr: 2005, recordings: 10, with_transcript: 11 },
  ],
  names: [
    { name: "Berzon", recordings: 30, median_minutes: 29.1, first_year: 2003, last_year: 2026 },
    { name: "Too many", recordings: 101 },
    { name: "", recordings: 3 },
  ],
};

describe("parseOralProfile", () => {
  it("orders years, drops inconsistent rows and keeps names as written", () => {
    const o = parseOralProfile(PROFILE, "ca9")!;
    expect(o.byYear.map((y) => y.yr)).toEqual([2003, 2004]);
    expect(o.minutes?.p50).toBe(28.9);
    expect(o.names.map((n) => n.name)).toEqual(["Berzon"]);
    expect(o.firstArgued).toBe("2003-02-14");
  });

  it("returns null for another court or no recordings", () => {
    expect(parseOralProfile(PROFILE, "ca2")).toBeNull();
    expect(parseOralProfile({ ...PROFILE, recordings: 0 }, "ca9")).toBeNull();
  });
});

describe("getClbOralArguments", () => {
  it("reads by exact id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ p: PROFILE }], total: null });
    const handler = getClbOralArguments as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    expect(((await handler({ data: { id: "ca9" } })) as { recordings: number }).recordings).toBe(
      100,
    );
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.clb_oral_arguments&id=eq.ca9");
  });
});
