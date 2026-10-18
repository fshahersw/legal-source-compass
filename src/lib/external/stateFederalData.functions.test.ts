import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { parseStateFederalData } from "./stateFederalData.functions";

// Cells of the published rows for Texas (cfpb-state:TX, epa-echo-series:state:TX:all, epa-echo-programs:TX).
const TX = {
  cfpb: { complaints: 2567952, per_100k_2025: 2491.02, rate_change_pct: 764.64 },
  ranking: {
    per_100k_2025: [
      { code: "GA", name: "Georgia", value: 3777.28, rank: 1 },
      { code: "TX", name: "Texas", value: 2491.02, rank: 6 },
    ],
  },
  epa: { opened: 11799, concluded: 11645, fed_penalty: 7191534443.86 },
  programs: { facilities: 171750, formal_5y: 3406, snc_now: 1087 },
};

describe("parseStateFederalData", () => {
  it("builds the three blocks from the published cells and ranks the state by code", () => {
    const v = parseStateFederalData("TX", TX);
    expect(v.cfpb).toEqual({
      recordId: "cfpb-state:TX",
      complaints: 2567952,
      per100k2025: 2491.02,
      rank: 6,
      rateChangePct: 764.64,
    });
    expect(v.epa).toEqual({
      recordId: "epa-echo-series:state:TX:all",
      opened: 11799,
      concluded: 11645,
      fedPenalty: 7191534443.86,
    });
    expect(v.facilities).toEqual({
      recordId: "epa-echo-programs:TX",
      facilities: 171750,
      formal5y: 3406,
      sncNow: 1087,
    });
  });

  it("never takes another state's rank: an unranked state has rank null", () => {
    expect(parseStateFederalData("WY", TX).cfpb?.rank).toBeNull();
  });

  it("leaves a block out when its row is missing or incomplete, without filling it", () => {
    const v = parseStateFederalData("TX", {
      cfpb: null,
      ranking: null,
      epa: { opened: 5, concluded: "n/a", fed_penalty: 1 },
      programs: undefined,
    });
    expect(v).toEqual({ cfpb: null, epa: null, facilities: null });
  });

  it("keeps per-capita Not recorded as null, never 0", () => {
    const v = parseStateFederalData("TX", { ...TX, cfpb: { complaints: 10 } });
    expect(v.cfpb).toMatchObject({ complaints: 10, per100k2025: null, rateChangePct: null });
  });
});
