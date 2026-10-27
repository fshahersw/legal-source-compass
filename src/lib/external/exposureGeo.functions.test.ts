import { describe, expect, it, vi, type Mock } from "vitest";
import type { CountyExposure, MdlExposure, StateExposure } from "./exposureGeo.functions";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
}));

type Handler<I, O> = (arg: { data: I }) => Promise<O>;

/** Fresh modules per test: the reads are memoised for ten minutes. */
async function load(table: Record<string, unknown[]> | Error) {
  vi.resetModules();
  const rest = await import("./rest.server");
  const restGet = rest.restGet as unknown as Mock;
  if (table instanceof Error) restGet.mockRejectedValue(table);
  else
    restGet.mockImplementation(async (path: string) => {
      for (const [needle, rows] of Object.entries(table))
        if (path.includes(needle)) return { rows, total: rows.length };
      return { rows: [], total: 0 };
    });
  const mod = await import("./exposureGeo.functions");
  return {
    restGet,
    state: mod.getStateExposure as unknown as Handler<{ usps: string }, StateExposure>,
    county: mod.getCountyExposure as unknown as Handler<{ fips: string }, CountyExposure | null>,
    mdl: mod.getMdlExposure as unknown as Handler<{ mdl: string }, MdlExposure | null>,
  };
}

const ready = (ids: string[]) => ids.map((id) => ({ id, ready: true, imported_records: 10 }));
const partdRow = (usps: string) => ({
  id: `partd:2973:${usps}`,
  e: {
    kind: "partd_mdl_drug",
    mdl: "2973",
    mdl_title: "IN RE: Elmiron (Pentosan Polysulfate Sodium) Products Liability Litigation",
    scope: "ingredient",
    generic_names: ["Pentosan Polysulfate Sodium"],
    geo: { level: usps === "US" ? "national" : "state", usps, name: usps },
    series: [{ year: 2024, claims: 100, lower_bound: false, products: [] }],
    latest_rank: null,
  },
});
const paths = (restGet: Mock) => restGet.mock.calls.map(([p]) => String(p));

describe("exposure geography reads", () => {
  it("returns null parts and reads no records when the datasets are not published", async () => {
    const { restGet, state, county, mdl } = await load({ corpus_datasets: [] });
    expect(await state({ data: { usps: "NJ" } })).toMatchObject({
      partd: null,
      places: null,
      pfas: null,
    });
    expect(await county({ data: { fips: "34023" } })).toBeNull();
    expect(await mdl({ data: { mdl: "2973" } })).toBeNull();
    expect(paths(restGet).every((p) => p.startsWith("corpus_datasets"))).toBe(true);
  });

  it("ignores a dataset that exists but is not ready", async () => {
    const { state } = await load({
      corpus_datasets: [{ id: "exposure_partd_mdl_drugs", ready: false, imported_records: 932 }],
    });
    expect((await state({ data: { usps: "NJ" } })).partd).toBeNull();
  });

  it("reads Part D by exact state and national filters, always within the dataset", async () => {
    const { restGet, state } = await load({
      corpus_datasets: ready(["exposure_partd_mdl_drugs"]),
      [encodeURIComponent('{"state":["NJ"]}')]: [partdRow("NJ")],
      [encodeURIComponent('{"state":["US"]}')]: [partdRow("US")],
    });
    const out = await state({ data: { usps: "NJ" } });
    expect(out.partd?.state.map((e) => e.geo.usps)).toEqual(["NJ"]);
    expect(out.partd?.national.map((e) => e.geo.usps)).toEqual(["US"]);
    const recordReads = paths(restGet).filter((p) => p.startsWith("corpus_records"));
    expect(recordReads).toHaveLength(2);
    expect(recordReads.every((p) => p.includes("dataset=eq.exposure_partd_mdl_drugs"))).toBe(true);
  });

  it("returns the MDL's states and no PFAS part for a drug MDL", async () => {
    const { restGet, mdl } = await load({
      corpus_datasets: ready(["exposure_partd_mdl_drugs", "exposure_ucmr5_pfas_states"]),
      [encodeURIComponent('{"mdl":["2973"]}')]: [partdRow("NJ"), partdRow("US")],
    });
    const out = await mdl({ data: { mdl: "2973" } });
    expect(out?.partd).toHaveLength(2);
    expect(out?.pfas).toBeNull();
    expect(paths(restGet).some((p) => p.includes("dataset=eq.exposure_ucmr5"))).toBe(false);
  });

  it("surfaces a read failure as a plain message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state } = await load(new Error("boom"));
    await expect(state({ data: { usps: "NJ" } })).rejects.toThrow(
      "Exposure figures could not be read just now.",
    );
    spy.mockRestore();
  });
});
