import { describe, expect, it } from "vitest";
import {
  chartTicker,
  closeOnOrBefore,
  comparablePrice,
  companyPrices,
  listingUrl,
  parseChart,
  priceFacts,
  sameCompany,
  priceRow,
  rotation,
  type PricePoint,
} from "./companyPrices";
import type { CollectContext, JsonObject, RequestRecord, RowContent } from "../types";

const DAY = 86_400;
// 2026-10-26 09:30 New York (13:30 UTC) and the following sessions, offset -4 h
const OPEN_0 = Date.parse("2026-10-26T13:30:00Z") / 1000;

function chart(opts: {
  symbol?: string;
  days?: number;
  closes?: (number | null)[];
  instrument?: string;
  sessionEndMs?: number;
}) {
  const n = opts.closes?.length ?? opts.days ?? 3;
  const timestamp = Array.from({ length: n }, (_, i) => OPEN_0 + i * DAY);
  const close = opts.closes ?? Array.from({ length: n }, (_, i) => 100 + i);
  const lastStart = timestamp[timestamp.length - 1]!;
  const end = (opts.sessionEndMs ?? (lastStart + 6.5 * 3600) * 1000) / 1000;
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: opts.symbol ?? "JNJ",
            currency: "USD",
            fullExchangeName: "NYSE",
            instrumentType: opts.instrument ?? "EQUITY",
            gmtoffset: -14400,
            currentTradingPeriod: { regular: { start: lastStart, end } },
          },
          timestamp,
          indicators: { quote: [{ close }] },
        },
      ],
      error: null,
    },
  };
}

describe("price chart parsing", () => {
  it("keeps finished closes in exchange-local dates and drops the session still open", () => {
    const json = chart({ closes: [100.123456, null, 102] });
    // during the third session: its close is not final
    const open = parseChart(json, "JNJ", (OPEN_0 + 2 * DAY + 3600) * 1000)!;
    expect(open.points).toEqual([["2026-10-26", 100.1235]]);
    // after the close of the third session
    const closed = parseChart(json, "JNJ", (OPEN_0 + 2 * DAY + 8 * 3600) * 1000)!;
    expect(closed.points).toEqual([
      ["2026-10-26", 100.1235],
      ["2026-10-28", 102],
    ]);
  });

  it("refuses a response for another symbol or a non-equity instrument", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    expect(parseChart(chart({ symbol: "JNJX" }), "JNJ", now)).toBeNull();
    expect(parseChart(chart({ instrument: "MUTUALFUND" }), "JNJ", now)).toBeNull();
    expect(
      parseChart({ chart: { result: null, error: { code: "Not Found" } } }, "JNJ", now),
    ).toBeNull();
  });

  it("writes class shares the way the endpoint does and links the listing page", () => {
    expect(chartTicker("brk.b")).toBe("BRK-B");
    expect(listingUrl("NYSE", "BRK-B")).toBe("https://www.nyse.com/quote/XNYS:BRK.B");
    expect(listingUrl("Nasdaq", "ABT")).toBe("https://www.nasdaq.com/market-activity/stocks/abt");
    expect(listingUrl("OTC", "BAYRY")).toBe("https://www.otcmarkets.com/stock/BAYRY/overview");
    expect(listingUrl("CBOE", "X")).toBeNull();
  });
});

describe("identity checks", () => {
  it("matches the registrant's name and refuses a reused ticker", () => {
    expect(sameCompany("JOHNSON & JOHNSON", "Johnson & Johnson")).toBe(true);
    expect(sameCompany("ELI LILLY & Co", "Eli Lilly and Company")).toBe(true);
    expect(sameCompany("3M CO", "3M Company")).toBe(true);
    expect(sameCompany("BAXTER INTERNATIONAL INC", "Acme Widgets Corp")).toBe(false);
    expect(sameCompany("BAXTER INTERNATIONAL INC", null)).toBe(true);
  });
});

describe("price facts", () => {
  const points: PricePoint[] = [
    ["2025-10-27", 150],
    ["2025-10-28", 152],
    ["2026-03-02", 120],
    ["2026-07-01", 200],
    ["2026-10-27", 180],
  ];

  it("finds the close on or before a date", () => {
    expect(closeOnOrBefore(points, "2026-05-01")).toEqual(["2026-03-02", 120]);
    expect(closeOnOrBefore(points, "2025-01-01")).toBeNull();
  });

  it("restates the latest close, a year earlier and the 52-week range", () => {
    const f = priceFacts(points)!;
    expect(f.last).toEqual(["2026-10-27", 180]);
    expect(f.yearAgo).toEqual(["2025-10-27", 150]);
    expect(f.change1y).toBe(20);
    expect(f.high52).toEqual(["2026-07-01", 200]);
    expect(f.low52).toEqual(["2026-03-02", 120]);
    expect(priceFacts([])).toBeNull();
  });

  it("builds a row with the listing page as its reference and masks the retrieval date", () => {
    const parsed = parseChart(chart({ days: 25 }), "JNJ", Date.parse("2026-12-31T00:00:00Z"))!;
    const t = { cik: "0000200406", name: "JOHNSON & JOHNSON", ticker: "JNJ", exchange: "NYSE" };
    const a = priceRow(t, parsed, "2026-11-20")!;
    const b = priceRow(t, parsed, "2026-11-21")!;
    expect(a.id).toBe("px:0000200406");
    expect(a.source_url).toBe("https://www.nyse.com/quote/XNYS:JNJ");
    expect(a.filters["company"]).toEqual(["0000200406"]);
    const prices = (a.item as JsonObject)["prices"] as JsonObject;
    expect((prices["points"] as unknown[]).length).toBe(25);
    expect(JSON.stringify(a)).not.toMatch(/yahoo/i);
    const content = (r: typeof a): RowContent => ({
      id: r.id,
      category: r.category,
      state: r.state,
      county_geoids: [],
      title: r.title,
      source_url: r.source_url,
      item: r.item,
      detail: r.detail,
      text: r.text,
      filters: r.filters,
    });
    expect(comparablePrice(content(a))).toEqual(comparablePrice(content(b)));
  });
});

describe("rotation and collect", () => {
  it("visits never-visited registrants first, then the stalest", () => {
    const t = (cik: string) => ({ cik, name: cik, ticker: "X", exchange: "NYSE" });
    const order = rotation([t("0000000003"), t("0000000001"), t("0000000002")], {
      "0000000001": "2026-10-28T00:00:00Z",
      "0000000003": "2026-10-27T00:00:00Z",
    });
    expect(order.map((x) => x.cik)).toEqual(["0000000002", "0000000003", "0000000001"]);
  });

  it("collects rows, holds unknown tickers and records the visit", async () => {
    const requests: RequestRecord[] = [];
    const record = (url: string, status: number): RequestRecord => ({
      url,
      status,
      bytes: 0,
      sha256: "",
      retrieved_at: "",
    });
    const ctx: CollectContext = {
      now: new Date("2026-12-31T00:00:00Z"),
      cursor: null,
      env: () => undefined,
      corpus: {
        query: async () => [
          { id: "0000200406", n: "JOHNSON & JOHNSON", t: ["JNJ"], e: ["NYSE"] },
          { id: "0000000001", n: "GONE INC", t: ["GONE"], e: ["NYSE"] },
          { id: "0000000002", n: "NO TICKER", t: [], e: [] },
          { id: "0000000003", n: "PREFERRED ONLY", t: ["CTA-PA", "CTA-PB"], e: ["NYSE", "NYSE"] },
        ],
        rowsBy: async () => [],
        edge: async () => [],
        rpc: async () => null as never,
      },
      http: {
        requests,
        remaining: 10,
        getText: async (url: string) => {
          if (url.includes("/GONE?")) return { status: 404, text: "{}", record: record(url, 404) };
          return {
            status: 200,
            text: JSON.stringify(chart({ days: 30 })),
            record: record(url, 200),
          };
        },
      },
    };
    const out = await companyPrices.collect(ctx);
    expect(out.rows.map((r) => r.id)).toEqual(["px:0000200406"]);
    expect(out.held).toEqual([
      { key: "0000000001", reason: "ticker not found by the price endpoint" },
    ]);
    expect(out.fetched).toBe(2);
    expect(Object.keys((out.cursorAfter as { visited: object }).visited).sort()).toEqual([
      "0000000001",
      "0000200406",
    ]);
  });
});
