import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/legislation.functions", () => ({
  runLegislationSearch: vi.fn(),
  readFederalBill: vi.fn(),
  readStateBill: vi.fn(),
}));

import {
  readFederalBill,
  readStateBill,
  runLegislationSearch,
} from "@/lib/external/legislation.functions";
import { LEGISLATION_EXECUTORS, LEGISLATION_TOOL_DEFINITIONS } from "./legislationTools.server";

beforeEach(() => vi.clearAllMocks());

describe("legislation assistant tools", () => {
  it("defines exactly the executors it declares", () => {
    expect(LEGISLATION_TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(
      Object.keys(LEGISLATION_EXECUTORS).sort(),
    );
  });

  it("searches federal bills with validated filters and cites in-app pages", async () => {
    vi.mocked(runLegislationSearch).mockResolvedValueOnce({
      scope: "federal",
      mode: "words",
      rows: [
        {
          id: "118-hr-3935",
          congress: 118,
          type: "hr",
          number: "3935",
          citation: "H.R. 3935, 118th Congress",
          title: "FAA Reauthorization Act of 2024",
          sponsor: "Rep. Graves, Sam [R-MO-6]",
          introduced: "2023-06-09",
          latestActionDate: "2024-05-16",
          latestAction: "Became Public Law No: 118-63.",
          status: "became_law",
          statusLabel: "Became law",
          law: "Public Law 118-63",
          policyArea: null,
          cosponsors: 3,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      dropped: 0,
    });
    const out = await LEGISLATION_EXECUTORS["search_bills"]!({
      scope: "federal",
      query: "aviation",
      congress: 118,
      type: "zz",
    });
    expect(vi.mocked(runLegislationSearch).mock.calls[0]![0]).toEqual({
      scope: "federal",
      q: "aviation",
      page: 1,
      congress: "118",
    });
    expect(out.sources[0]!.url).toBe("/law/legislation/federal/118/hr/3935");
    expect(JSON.parse(out.content).results[0].law).toBe("Public Law 118-63");
  });

  it("reads a federal bill from a citation and rejects incomplete input", async () => {
    vi.mocked(readFederalBill).mockResolvedValueOnce(null);
    const out = await LEGISLATION_EXECUTORS["get_bill"]!({ citation: "H.R. 3935", congress: 118 });
    expect(vi.mocked(readFederalBill).mock.calls[0]![0]).toEqual({
      congress: "118",
      type: "hr",
      number: "3935",
    });
    expect(JSON.parse(out.content)).toEqual({ found: false });
    await expect(LEGISLATION_EXECUTORS["get_bill"]!({ citation: "H.R. 3935" })).rejects.toThrow();
    await expect(
      LEGISLATION_EXECUTORS["get_bill"]!({ state_bill_id: "../../etc" }),
    ).rejects.toThrow();
    expect(readStateBill).not.toHaveBeenCalled();
  });
});
