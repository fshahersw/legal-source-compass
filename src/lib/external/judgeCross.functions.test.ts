import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import { getJudgeCrossProfile } from "./judgeCross.functions";

// J. Philip Calabrese: the judges id that carries FJC nid 9280736; the cross profile 9280736 has no judge_profile link.
const ID = "bdfb79ff24b4d264330e48c716cca98f";
const NID = "9280736";
const CROSS = {
  nid: NID,
  name: "J. Philip Calabrese",
  as_of: "2026-10-01",
  status: "active",
  pending_mdls: [
    {
      mdl: 3092,
      title: "IN RE: Suboxone Film Products Liability Litigation",
      pending: 2022,
      total: 2100,
      date_transferred: "2024-02-02",
    },
  ],
  pending_actions: 2022,
  historical_mdls: [],
};
const handler = getJudgeCrossProfile as unknown as (a: { data: { id: string } }) => Promise<{
  nid: string;
  pendingActions: number;
} | null>;
const empty = { rows: [], total: null };

describe("getJudgeCrossProfile nid fallback", () => {
  it("recovers a profile without judge_profile through a 1:1 crosswalk nid", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce(empty) // judge_profile filter: no profile
      .mockResolvedValueOnce(empty) // disclosures by judge_profile
      .mockResolvedValueOnce({ rows: [{ id: ID, nid: NID }], total: null }) // crosswalk row for this page
      .mockResolvedValueOnce({
        rows: [{ id: NID, filters: { judge_profile: [] }, item: CROSS }],
        total: null,
      }) // cross profile by nid (index lookup)
      .mockResolvedValueOnce({ rows: [{ id: ID }], total: null }) // every crosswalk row with that nid
      .mockResolvedValueOnce(empty); // disclosures by nid
    const p = await handler({ data: { id: ID } });
    expect(p?.nid).toBe(NID);
    expect(p?.pendingActions).toBe(2022);
    const urls = mocked.mock.calls.map((c) => String(c[0]));
    expect(urls[2]).toContain(`dataset=eq.judge_cl_crosswalk&id=eq.${ID}`);
    expect(urls[3]).toContain(`dataset=eq.judge_cross_profiles&id=eq.${NID}`);
    expect(urls[4]).toContain(`item->profile->>fjc_nid=eq.${NID}`);
    expect(decodeURIComponent(urls[5]!)).toContain(`{"judge":["${NID}"]}`);
  });

  it("returns null when the nid maps to two judges ids", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rows: [{ id: ID, nid: NID }], total: null })
      .mockResolvedValueOnce({
        rows: [{ id: NID, filters: { judge_profile: [] }, item: CROSS }],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [{ id: ID }, { id: "1e9a5fc90030d1a2cf9f028d79073ef8" }],
        total: null,
      });
    expect(await handler({ data: { id: ID } })).toBeNull();
  });

  it("skips the crosswalk scan when no unlinked cross profile exists for the nid", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rows: [{ id: ID, nid: NID }], total: null })
      .mockResolvedValueOnce(empty); // no cross profile with that nid
    expect(await handler({ data: { id: ID } })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(4);
    expect(mocked.mock.calls.some((c) => String(c[0]).includes("fjc_nid=eq."))).toBe(false);
  });

  it("returns null when the cross profile is already linked to another judge", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rows: [{ id: ID, nid: NID }], total: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: NID,
            filters: { judge_profile: ["ffffffffffffffffffffffffffffffff"] },
            item: CROSS,
          },
        ],
        total: null,
      });
    expect(await handler({ data: { id: ID } })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(4);
  });

  it("returns null when the crosswalk has no nid for the page", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rows: [{ id: ID, nid: null }], total: null });
    expect(await handler({ data: { id: ID } })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("keeps the direct link when judge_profile finds the profile", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [{ id: NID, item: CROSS }], total: null })
      .mockResolvedValueOnce(empty);
    expect((await handler({ data: { id: ID } }))?.nid).toBe(NID);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});
