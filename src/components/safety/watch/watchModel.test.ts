import { describe, expect, it } from "vitest";
import {
  buildWatch,
  cardFor,
  foldDuplicates,
  isUptake,
  mdlStatus,
  nationalFactors,
  parseWatchPayload,
  peakMonth,
  poissonLimits,
  rate,
  scoreRow,
  tailMonths,
} from "./watchModel";

const tail = (recent: number, prior: number) => [
  ...Array.from({ length: 12 }, () => prior / 12),
  ...Array.from({ length: 12 }, () => prior / 12),
  ...Array.from({ length: 12 }, () => recent / 12),
];

function raw(rows: unknown[][], national: Record<string, unknown[]> = {}) {
  return {
    asOf: { faers: "2026-06", maude: "2026-09" },
    national: {
      "faers:faers_reports": [1100, 1000, "2026-06"],
      "faers:faers_death": [100, 100, "2026-06"],
      "faers:faers_serious": [500, 500, "2026-06"],
      ...national,
    },
    rows,
  };
}

const row = (
  id: string,
  recent: number,
  prior: number,
  patch: Partial<{
    label: string;
    type: string;
    source: string;
    deaths: number;
    deathsPrior: number;
    mdls: number[];
    pending: number[];
    radar: unknown;
    tail: number[];
  }> = {},
) => [
  id,
  patch.label ?? id.toUpperCase(),
  patch.type ?? "product",
  "drug",
  patch.source ?? "faers",
  "2026-06",
  recent,
  prior,
  patch.deaths ?? 0,
  patch.deathsPrior ?? 0,
  Math.round(recent / 2),
  Math.round(prior / 2),
  patch.mdls ?? [],
  patch.pending ?? [],
  null,
  patch.tail ?? tail(recent, prior),
  patch.radar ?? null,
];

describe("product watch model", () => {
  it("brackets a Poisson count close to the exact limits", () => {
    // exact 95% limits for 100: 81.36 to 121.63
    const { lower, upper } = poissonLimits(100);
    expect(lower).toBeCloseTo(81.36, 0);
    expect(upper).toBeCloseTo(121.63, 0);
    expect(poissonLimits(0).lower).toBe(0);
  });

  it("rates against the source-wide change and needs enough reports", () => {
    // all reports +10%: 1,000 prior -> 1,100 expected
    expect(rate(1100, 1000, 1.1).signal).toBe("steady");
    expect(rate(1300, 1000, 1.1).signal).toBe("rising");
    expect(rate(2000, 1000, 1.1).signal).toBe("sharp");
    expect(rate(800, 1000, 1.1).signal).toBe("falling");
    expect(rate(40, 10, 1).signal).toBe("low");
    expect(rate(300, 5, 1).signal).toBe("new");
    expect(rate(null, 10, 1).signal).toBe("low");
    const r = rate(2000, 1000, 1.1);
    expect(r.expected).toBeCloseTo(1100);
    expect(r.ratio).toBeCloseTo(2000 / 1100);
  });

  it("reads MDL status from recorded links only and never calls a device code unlinked", () => {
    expect(mdlStatus({ type: "product", mdls: [], pending: [], radar: null }).status).toBe("none");
    expect(mdlStatus({ type: "device_code", mdls: [], pending: [], radar: null }).status).toBe(
      "unkeyed",
    );
    expect(mdlStatus({ type: "product", mdls: [2452], pending: [], radar: null }).status).toBe(
      "closed",
    );
    const viaRadar = mdlStatus({
      type: "product",
      mdls: [],
      pending: [],
      radar: {
        unit: "drug:faers:x",
        status: "pending_mdl",
        links: [{ mdl: 3094, title: "GLP-1", status: "pending", basis: "epc_class" }],
        brands: [],
        sponsors: [],
        points: 2,
        rank: 1,
        terms: [],
      },
    });
    expect(viaRadar.status).toBe("pending");
    expect(viaRadar.links.map((l) => l.mdl)).toEqual([3094]);
  });

  it("parses rows, drops malformed ones and keeps the radar's links, brands and terms", () => {
    const p = parseWatchPayload(
      raw([
        row("faers:a", 300, 100, {
          radar: {
            unit: "drug:faers:a",
            status: "none_linked",
            links: [],
            brands: ["ALPHA", "ALPHA"],
            sponsors: ["Maker"],
            points: 3,
            rank: 2,
            terms: [{ term: "NAUSEA", prior: 10, recent: 40 }],
          },
        }),
        ["broken"],
      ]),
    );
    expect(p.rows).toHaveLength(1);
    expect(p.dropped).toBe(1);
    expect(p.rows[0]?.radar?.brands).toEqual(["ALPHA"]);
    expect(p.rows[0]?.radar?.terms[0]).toEqual({ term: "NAUSEA", prior: 10, recent: 40 });
    expect(nationalFactors(p.national).faers.reports).toBeCloseTo(1.1);
  });

  it("flags rapid uptake and a year concentrated in one month", () => {
    expect(isUptake({ recent: 500, prior: 50 })).toBe(true);
    expect(isUptake({ recent: 500, prior: 200 })).toBe(false);
    const spiky = [
      ...Array.from({ length: 24 }, () => 5),
      ...Array.from({ length: 11 }, () => 5),
      200,
    ];
    expect(peakMonth(spiky, "2026-06")).toEqual({ month: "2026-06", share: (100 * 200) / 255 });
    expect(peakMonth(tail(1200, 1000), "2026-06")).toBeNull();
    expect(tailMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("folds subjects with identical counts and prefers the MDL group's name", () => {
    const p = parseWatchPayload(
      raw([
        row("faers:copper", 500, 200, { label: "COPPER", mdls: [2974], pending: [2974] }),
        row("mdl:2974", 500, 200, {
          label: "Paragard IUD",
          type: "mdl_group",
          mdls: [2974],
          pending: [2974],
        }),
        row("faers:other", 900, 200),
      ]),
    );
    const f = nationalFactors(p.national);
    const folded = foldDuplicates(p.rows.map((r) => scoreRow(r, f)));
    expect(folded).toHaveLength(2);
    const paragard = folded.find((r) => r.id === "mdl:2974");
    expect(paragard?.aliases).toEqual(["COPPER"]);
    expect(paragard?.status).toBe("pending");
  });

  it("builds the lists: no-MDL risers, litigated risers and rising death reports", () => {
    const p = parseWatchPayload(
      raw([
        row("faers:quiet", 1000, 1000),
        row("faers:riser", 3000, 1000, { deaths: 80, deathsPrior: 20 }),
        row("faers:litigated", 2500, 1000, { mdls: [3180], pending: [3180] }),
        row("faers:launch", 900, 20),
        row("maude:ABC", 4000, 1000, { type: "device_code", source: "maude" }),
      ]),
    );
    const v = buildWatch(p);
    expect(v.emerging.map((c) => c.id)).toEqual(["faers:riser", "faers:launch"]);
    expect(v.emerging[1]?.uptake).toBe(true);
    expect(v.litigated.map((c) => c.id)).toEqual(["faers:litigated"]);
    expect(v.deaths.map((c) => c.id)).toEqual(["faers:riser"]);
    expect(v.devices.map((c) => c.id)).toEqual(["maude:ABC"]);
    expect(v.counts.pendingMdls).toBe(1);
    expect(v.points.find((pt) => pt.id === "faers:quiet")?.signal).toBe("falling");
    const one = cardFor(p, "faers:riser");
    expect(one?.ratio).toBeCloseTo(3000 / 1100);
    expect(cardFor(p, "faers:none")).toBeNull();
  });
});
