import { describe, expect, it } from "vitest";
import {
  buildGraph,
  categorize,
  leaders,
  parseDocket,
  parseNetwork,
  rankAt,
  shortTitle,
  streamLayers,
  valueAt,
} from "./storiesModel";

const raw = {
  dates: ["2024-01-02", "2024-02-01", "2024-03-01"],
  totals: [1000, 1200, 900],
  listed: [3, 3, 2],
  mdls: [
    {
      mdl: 2885,
      title: "IN RE: 3M Combat Arms Earplug Products Liability Litigation",
      type: "Products Liability",
      district: "Florida Northern",
      peak: 700,
      values: [600, 700, null],
    },
    {
      mdl: 2738,
      title:
        "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
      type: null,
      district: null,
      peak: 500,
      values: [300, 400, 500],
    },
    { mdl: 3001, title: null, type: null, district: null, peak: 90, values: [50, 60, 90] },
    { mdl: 9, title: "bad", type: null, district: null, peak: 1, values: [1] },
  ],
};

describe("storiesModel", () => {
  it("shortens JPML titles and the panel's abbreviated captions", () => {
    expect(shortTitle("IN RE: 3M Combat Arms Earplug Products Liability Litigation")).toBe(
      "3M Combat Arms Earplug",
    );
    expect(
      shortTitle(
        "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
      ),
    ).toBe("Johnson & Johnson Talcum Powder Products");
    expect(shortTitle("Neurontin Marketing, SP & PL")).toBe("Neurontin");
    expect(shortTitle("Prempro PL")).toBe("Prempro");
    expect(shortTitle('"Factor VIII or IX Concentrate Blood Products" PL')).toBe(
      "Factor VIII or IX Concentrate Blood Products",
    );
    expect(shortTitle("IN RE: Bard Implanted Port Catheter Products Liability Litigation")).toBe(
      "Bard Implanted Port Catheter",
    );
  });

  it("categorizes by the recorded type, then the title's words", () => {
    expect(categorize("Products Liability", "x")).toBe("products");
    expect(categorize(null, "IN RE: Broiler Chicken Antitrust Litigation")).toBe("antitrust");
    expect(categorize(null, "IN RE: Capital One Customer Data Security Breach Litigation")).toBe(
      "privacy",
    );
    expect(categorize(null, "IN RE: Something Else")).toBe("other");
  });

  it("parses the docket, dropping rows whose frames do not align", () => {
    const d = parseDocket(raw);
    expect(d.mdls).toHaveLength(3);
    expect(d.dropped).toBe(1);
    expect(d.mdls[2]!.title).toBe("MDL 3001");
    expect(() => parseDocket({ ...raw, totals: [1] })).toThrow();
  });

  it("interpolates only between reports and treats an unlisted report as 0", () => {
    const v = [600, 700, null];
    expect(valueAt(v, 0)).toBe(600);
    expect(valueAt(v, 0.5)).toBe(650);
    expect(valueAt(v, 2)).toBe(0);
    expect(valueAt(v, 1.5)).toBe(350);
    expect(valueAt(v, 9)).toBe(0);
  });

  it("ranks the MDLs at a frame and finds the leader changes", () => {
    const d = parseDocket(raw);
    expect(rankAt(d.mdls, 0, 2).map((r) => r.m.mdl)).toEqual([2885, 2738]);
    expect(rankAt(d.mdls, 2, 5).map((r) => r.m.mdl)).toEqual([2738, 3001]);
    expect(leaders(d)).toEqual([
      { frame: 0, mdl: 2885 },
      { frame: 2, mdl: 2738 },
    ]);
  });

  it("stream layers always add up to each report's total", () => {
    const d = parseDocket(raw);
    const { keys, rows, named } = streamLayers(d, 2);
    expect(named.map((m) => m.mdl)).toEqual([2885, 2738]);
    rows.forEach((r, i) => {
      const sum = keys.reduce((s, k) => s + (r[k] ?? 0), 0);
      expect(sum).toBe(d.totals[i]);
    });
  });

  it("builds the company–MDL–product graph with degrees", () => {
    const net = parseNetwork({
      links: [
        {
          cik: "0000066740",
          company: "3M CO",
          mdl: 2885,
          tier: "A",
          tierLabel: "Filing cites the MDL number",
          verified: 4,
          first: "2019-07-25",
          last: "2024-02-07",
        },
        {
          cik: "0000066740",
          company: "3M CO",
          mdl: 2873,
          tier: "C",
          tierLabel: null,
          verified: null,
          first: null,
          last: null,
        },
        {
          cik: "0000200406",
          company: null,
          mdl: 2738,
          tier: "B",
          tierLabel: "Filing cites the official MDL caption",
          verified: 2,
          first: null,
          last: null,
        },
      ],
      mdls: [
        {
          mdl: 2885,
          title: "IN RE: 3M Combat Arms Earplug Products Liability Litigation",
          status: "terminated",
          type: null,
          pending: null,
          district: null,
        },
        {
          mdl: 2873,
          title: "IN RE: Aqueous Film-Forming Foams Products Liability Litigation",
          status: "pending",
          type: null,
          pending: 15264,
          district: null,
        },
        { mdl: 2738, title: null, status: "pending", type: null, pending: 69340, district: null },
      ],
      products: [
        { id: "mdl:2738", label: "Talc", kind: "drug", mdl: 2738 },
        { id: "mdl:1", label: "Orphan", kind: "drug", mdl: 1 },
      ],
    });
    expect(net.links[1]!.tierLabel).toBe("Not recorded");
    expect(net.links[2]!.company).toBe("CIK 0000200406");
    const g = buildGraph(net);
    const byId = new Map(g.nodes.map((x) => [x.id, x] as const));
    expect(byId.get("c:0000066740")!.degree).toBe(2);
    expect(byId.get("m:2738")!.degree).toBe(2);
    expect(byId.has("p:mdl:1")).toBe(false);
    expect(g.edges.filter((e) => e.kind === "product")).toHaveLength(1);
    expect(buildGraph(net, { products: false }).nodes.some((x) => x.kind === "product")).toBe(
      false,
    );
  });
});
