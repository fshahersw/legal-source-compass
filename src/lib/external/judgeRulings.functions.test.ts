import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getJudgeExpertRulings, parseRuling } from "./judgeRulings.functions";

const ID = "01ae0370d48dce949c103689ef768d6d";
const rec = (over: Record<string, unknown> = {}, filters: Record<string, unknown> = {}) => ({
  id: "govinfo:USCOURTS-ohsd-2_18-md-02846:1",
  source_url: "https://www.govinfo.gov/app/details/USCOURTS-ohsd-2_18-md-02846",
  filters: { judge_profile: [ID], outcome: ["granted_in_part"], movant: ["defendant"], ...filters },
  item: {
    kind: "ruling",
    cells: {
      date: "2024-05-01",
      court_id: "ohsd",
      docket_number: "2:18-md-02846",
      caption: "In re Davol",
      expert: "Dr. Example",
      movant: "Defendants",
      ...over,
    },
  },
});

describe("parseRuling", () => {
  it("reads an exactly attributed ruling", () => {
    expect(parseRuling(rec(), ID)).toMatchObject({
      outcome: "granted_in_part",
      movant: "defendant",
      date: "2024-05-01",
    });
  });

  it("drops rollups and rows for another or no judge; unknown codes become not determined", () => {
    expect(parseRuling({ ...rec(), item: { kind: "judge", cells: {} } }, ID)).toBeNull();
    expect(parseRuling(rec({}, { judge_profile: [] }), ID)).toBeNull();
    expect(parseRuling(rec({}, { judge_profile: [ID, "x"] }), ID)).toBeNull();
    expect(parseRuling(rec({}, { outcome: ["struck"], movant: ["intervenor"] }), ID)).toMatchObject(
      {
        outcome: "not_determined",
        movant: "other",
      },
    );
  });
});

describe("getJudgeExpertRulings", () => {
  it("returns null while the dataset is not published", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    const handler = getJudgeExpertRulings as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    expect(await handler({ data: { id: ID } })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(String(mocked.mock.calls[0]![0])).toContain(
      "corpus_datasets?select=label,metadata&id=eq.judge_expert_rulings",
    );
  });
});
