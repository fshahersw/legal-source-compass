import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getCompanyDetail } from "./companies.functions";
import type { CompanyDetail } from "@/components/companies/companyData";

const detail = getCompanyDetail as unknown as (a: {
  data: { cik: string };
}) => Promise<CompanyDetail | null>;
const mocked = vi.mocked(restGet);

const summary = (cik: string, mdls: number[]) => ({
  company: { cik, name: `Company ${cik}` },
  mdls: mdls.map((mdl) => ({ mdl, tier: "A", mdl_title: `MDL ${mdl} title` })),
});
const link = (mdl: number) => ({
  mdl,
  tier: "A",
  mdl_title: `MDL ${mdl} title`,
  verified: [{ adsh: "1", file_date: "2024-01-01", url: "https://www.sec.gov/Archives/x.htm" }],
});

type Reads = {
  analytics?: () => { id: string }[];
  terminated?: () => { rows: { id: string; mdl: unknown }[]; total: number | null };
};

/** Answer each corpus read by dataset; the MDL lookup reads can be made to fail or come back truncated. */
function serve(cik: string, mdls: number[], reads: Reads) {
  const paths: string[] = [];
  const answer = (path: string): { rows: unknown[]; total: number | null } => {
    if (path.includes("dataset=eq.company_sec_profiles"))
      return {
        rows: [{ id: cik, source_url: null, item: { summary: summary(cik, mdls) } }],
        total: null,
      };
    if (path.includes("dataset=eq.company_sec_financials")) return { rows: [], total: null };
    if (path.includes("dataset=eq.company_sec_mdl_links"))
      return {
        rows: mdls.map((m) => ({ id: `${cik}:${m}`, source_url: null, item: link(m) })),
        total: null,
      };
    if (path.includes("dataset=eq.mdl_analytics"))
      return { rows: reads.analytics ? reads.analytics() : [], total: null };
    if (path.includes("dataset=eq.mdl_terminated_history"))
      return reads.terminated ? reads.terminated() : { rows: [], total: 0 };
    throw new Error(`unexpected read ${path}`);
  };
  mocked.mockImplementation(async (path: string) => {
    paths.push(path);
    const { rows, total } = answer(path);
    return { rows: rows as never, total };
  });
  return paths;
}

beforeEach(() => {
  mocked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getCompanyDetail MDL record lookup", () => {
  it("still loads the profile when the lookup fails, and does not keep that for the full TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    let fail = true;
    serve("0000000101", [875, 2924], {
      analytics: () => {
        if (fail) throw new Error("External corpus read failed (503).");
        return [{ id: "2924" }];
      },
      terminated: () => ({ rows: [{ id: "875:313", mdl: 875 }], total: 1 }),
    });
    const first = await detail({ data: { cik: "0000000101" } });
    expect(first?.summary.profile.name).toBe("Company 0000000101");
    expect(first?.links.map((l) => l.mdl)).toEqual([875, 2924]);
    expect(first?.mdlRecords).toBeNull();
    // Within the short degraded window the cached profile is served.
    vi.setSystemTime(new Date("2026-10-18T12:00:10Z"));
    expect((await detail({ data: { cik: "0000000101" } }))?.mdlRecords).toBeNull();
    // After it, the lookup is retried and the links come back.
    fail = false;
    vi.setSystemTime(new Date("2026-10-18T12:01:00Z"));
    expect((await detail({ data: { cik: "0000000101" } }))?.mdlRecords).toEqual({
      "875": { kind: "record", ref: { dataset: "mdl_terminated_history", id: "875:313" } },
      "2924": { kind: "record", ref: { dataset: "mdl_analytics", id: "2924" } },
    });
  });

  it("orders the reads and resolves from a complete terminated-history response", async () => {
    const paths = serve("0000000102", [875, 999], {
      terminated: () => ({
        rows: [
          { id: "875:313", mdl: 875 },
          { id: "999:314", mdl: 999 },
          { id: "999:315", mdl: 999 },
        ],
        total: 3,
      }),
    });
    const d = await detail({ data: { cik: "0000000102" } });
    expect(d?.mdlRecords).toEqual({
      "875": { kind: "record", ref: { dataset: "mdl_terminated_history", id: "875:313" } },
      "999": { kind: "ambiguous", rows: 2 },
    });
    const lookups = paths.filter((p) => /mdl_analytics|mdl_terminated_history/.test(p));
    expect(lookups).toHaveLength(2);
    for (const p of lookups) expect(p).toContain("order=id.asc");
  });

  it("treats a terminated-history response that fills its limit as unknown", async () => {
    // Two numbers: limit 20. A full page may hide rows, so nothing is resolved from it.
    serve("0000000103", [875, 1203], {
      analytics: () => [{ id: "1203" }],
      terminated: () => ({
        rows: Array.from({ length: 20 }, (_, i) => ({ id: `875:${i}`, mdl: i ? 0 : 875 })),
        total: null,
      }),
    });
    const d = await detail({ data: { cik: "0000000103" } });
    expect(d?.mdlRecords).toEqual({
      "875": { kind: "unknown" },
      "1203": { kind: "record", ref: { dataset: "mdl_analytics", id: "1203" } },
    });
  });

  it("treats a response reporting more matching rows than it returned as unknown", async () => {
    serve("0000000104", [875], {
      terminated: () => ({ rows: [{ id: "875:313", mdl: 875 }], total: 2 }),
    });
    const d = await detail({ data: { cik: "0000000104" } });
    expect(d?.mdlRecords).toEqual({ "875": { kind: "unknown" } });
  });
});
