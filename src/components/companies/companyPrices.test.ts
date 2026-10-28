import { describe, expect, it } from "vitest";
import {
  eventsInRange,
  firstOnOrAfter,
  mdlEvents,
  parsePriceRow,
  presetWindow,
  PRESETS,
  reaction,
  shortMdlTitle,
  signedPct,
  windowChange,
  windowPoints,
  type PricePoint,
} from "./companyPrices";

const pts: PricePoint[] = [
  ["2026-10-19", 100],
  ["2026-10-20", 102],
  ["2026-10-21", 99],
  ["2026-10-22", 101],
  ["2026-10-23", 103],
  ["2026-10-26", 104],
  ["2026-10-27", 110],
];

describe("stored price rows", () => {
  it("keeps dated, positive, ascending points and requires a listing link", () => {
    const s = parsePriceRow(
      "px:0000200406",
      {
        prices: {
          ticker: "JNJ",
          exchange: "NYSE",
          currency: "USD",
          points: [
            ["2026-10-20", 1],
            ["2026-10-19", 2],
            ["bad", 3],
            ["2026-10-21", -1],
            ["2026-10-22", 4],
          ],
          splits: [
            { date: "2020-01-02", ratio: "2:1" },
            { date: "x", ratio: "1:1" },
          ],
        },
      },
      "https://www.nyse.com/quote/XNYS:JNJ",
    )!;
    expect(s.points).toEqual([
      ["2026-10-20", 1],
      ["2026-10-22", 4],
    ]);
    expect(s.splits).toEqual([{ date: "2020-01-02", ratio: "2:1" }]);
    expect(
      parsePriceRow(
        "px:0000200406",
        { prices: { ticker: "JNJ", exchange: "NYSE", points: [] } },
        "javascript:x",
      ),
    ).toBeNull();
    expect(parsePriceRow("cover:0000200406", {}, "https://x.test")).toBeNull();
  });
});

describe("windows and moves", () => {
  it("finds windows and the change across them", () => {
    expect(firstOnOrAfter(pts, "2026-10-24")).toBe(5);
    expect(windowPoints(pts, "2026-10-21", "2026-10-23").map((p) => p[0])).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(windowChange(pts)).toBeCloseTo(0.1);
    expect(windowChange([pts[0]!])).toBeNull();
  });

  it("measures an event against the close before it (weekend events use the next session)", () => {
    const r = reaction(pts, "2026-10-24")!; // Saturday
    expect(r.base).toEqual(["2026-10-23", 103]);
    expect(r.day1).toEqual(["2026-10-26", 104]);
    expect(r.change1).toBeCloseTo(104 / 103 - 1);
    expect(r.day5).toBeNull();
    const early = reaction(pts, "2026-10-20")!;
    expect(early.day5).toEqual(["2026-10-26", 104]);
    expect(reaction(pts, "2026-10-19")).toBeNull();
    expect(reaction(pts, "2026-11-01")).toBeNull();
  });

  it("windows presets end at the latest close and never start before the first", () => {
    const s = parsePriceRow(
      "px:0000000001",
      { prices: { ticker: "X", exchange: "NYSE", points: pts } },
      "https://x.test/",
    )!;
    expect(presetWindow(s, PRESETS[1]!)).toEqual(["2026-10-19", "2026-10-27"]);
  });
});

describe("events", () => {
  it("dates MDLs from their JPML records, drops dismissed links and labels subject-only links", () => {
    const ev = mdlEvents([
      {
        mdl: 2738,
        tier: "C",
        role: "defendant",
        dismissed: false,
        title:
          "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
        dateTransferred: "2016-10-04",
        dateClosed: null,
      },
      {
        mdl: 1,
        tier: "A",
        role: "defendant",
        dismissed: true,
        title: null,
        dateTransferred: "2020-01-01",
        dateClosed: null,
      },
      {
        mdl: 2197,
        tier: "A",
        role: "defendant",
        dismissed: false,
        title: null,
        dateTransferred: "2010-12-07",
        dateClosed: "2024-03-01",
      },
    ]);
    expect(ev.map((e) => [e.kind, e.date, e.tier])).toEqual([
      ["mdl_centralized", "2010-12-07", "A"],
      ["mdl_centralized", "2016-10-04", "C"],
      ["mdl_closed", "2024-03-01", "A"],
    ]);
    expect(ev[1]!.label).toBe("MDL 2738 centralized: Johnson & Johnson Talcum Powder Products");
  });

  it("keeps events inside the price history once", () => {
    const e = (id: string, date: string) => ({ id, date, kind: "sec" as const, label: "SEC x" });
    expect(
      eventsInRange(
        [e("a", "2026-10-20"), e("b", "2026-10-20"), e("c", "2027-01-01")],
        "2026-10-19",
        "2026-10-27",
      ).map((x) => x.id),
    ).toEqual(["a"]);
    expect(
      shortMdlTitle(
        "IN RE: Abbott Laboratories, et al., Preterm Infant Nutrition Products Liability Litigation",
      ),
    ).toBe("Abbott Laboratories, et al., Preterm Infant Nutrition");
    expect(signedPct(-0.0234)).toBe("−2.3%");
  });
});
