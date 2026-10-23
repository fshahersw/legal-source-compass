import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  readBillForLaw,
  readFederalBill,
  readStateBill,
  runLegislationSearch,
} from "./legislation.functions";

const mocked = vi.mocked(restGet);

const fedRow = (n: string) => ({
  id: `118-hr-${n}`,
  title: "x",
  source_url: "https://www.congress.gov/bill/118th-congress/house-bill/" + n,
  c: { congress: 118, type: "hr", number: n, title: `Bill ${n}`, status: "introduced" },
});

beforeEach(() => mocked.mockReset());

describe("runLegislationSearch", () => {
  it("pages federal results and drops malformed rows", async () => {
    mocked.mockResolvedValueOnce({ rows: [fedRow("1"), { id: "bad" }, fedRow("2")], total: 3 });
    const r = await runLegislationSearch({ scope: "federal", q: "highway", page: 2 });
    expect(r.rows.map((x) => x.id)).toEqual(["118-hr-1", "118-hr-2"]);
    expect(r.dropped).toBe(1);
    expect(r.total).toBe(3);
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toContain("dataset=eq.congress_bills");
    expect(opts).toEqual({ count: true, range: [25, 49] });
  });

  it("falls back from an identifier-shaped state query to words when nothing matches", async () => {
    mocked
      .mockResolvedValueOnce({ rows: [], total: 0 })
      .mockResolvedValueOnce({ rows: [], total: 0 });
    const r = await runLegislationSearch({ scope: "state", q: "tax 2026", state: "CA" });
    expect(r.mode).toBe("words");
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(mocked.mock.calls[0]![0])).toContain('"ident":["TAX2026"]');
    expect(decodeURIComponent(mocked.mock.calls[1]![0])).toContain("fts(simple).tax:*&2026:*");
  });

  it("rejects malformed input", async () => {
    await expect(
      runLegislationSearch({ scope: "federal", congress: "1" } as never),
    ).rejects.toThrow();
    await expect(
      runLegislationSearch({ scope: "state", state: "California" } as never),
    ).rejects.toThrow();
  });
});

describe("readFederalBill", () => {
  it("returns null unless exactly one valid row is stored", async () => {
    mocked
      .mockResolvedValueOnce({ rows: [], total: null })
      .mockResolvedValueOnce({ rows: [], total: null });
    expect(await readFederalBill({ congress: "118", type: "hr", number: "1" })).toBeNull();
  });

  it("joins the CRS reports that cite the bill", async () => {
    mocked
      .mockResolvedValueOnce({
        rows: [
          {
            id: "118-hr-1",
            b: { congress: 118, type: "hr", number: "1", titles: { display: "T" } },
          },
        ],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "R1",
            source_url: "https://www.congress.gov/crs-product/R1",
            c: { title: "Report" },
          },
        ],
        total: null,
      });
    const r = await readFederalBill({ congress: "118", type: "hr", number: "1" });
    expect(r!.bill.title).toBe("T");
    expect(r!.crs.map((c) => c.id)).toEqual(["R1"]);
    expect(r!.crsFailed).toBe(false);
    expect(decodeURIComponent(mocked.mock.calls[1]![0])).toContain('{"related_bill":["118-hr-1"]}');
  });

  it("reports a failed CRS lookup instead of an empty list", async () => {
    mocked
      .mockResolvedValueOnce({
        rows: [{ id: "118-hr-1", b: { congress: 118, type: "hr", number: "1" } }],
        total: null,
      })
      .mockRejectedValueOnce(new Error("upstream 503"));
    const r = await readFederalBill({ congress: "118", type: "hr", number: "1" });
    expect(r!.crs).toEqual([]);
    expect(r!.crsFailed).toBe(true);
  });
});

describe("readStateBill and readBillForLaw", () => {
  it("reads a state bill by id", async () => {
    mocked.mockResolvedValueOnce({
      rows: [
        {
          id: "ca-20252026-ab1",
          source_url: "https://leginfo.legislature.ca.gov/x",
          b: { state: "CA", identifier: "AB 1", session: { id: "20252026" } },
        },
      ],
      total: null,
    });
    const b = await readStateBill("ca-20252026-ab1");
    expect(b!.sourceUrl).toBe("https://leginfo.legislature.ca.gov/x");
  });

  it("finds the bill behind a public law by the exact law key", async () => {
    mocked.mockResolvedValueOnce({ rows: [fedRow("3935")], total: null });
    const r = await readBillForLaw({ congress: "118", number: "63" });
    expect(r.law).toBe("118-63");
    expect(r.bills[0]!.id).toBe("118-hr-3935");
    expect(decodeURIComponent(mocked.mock.calls[0]![0])).toContain('{"law":["118-63"]}');
  });
});
