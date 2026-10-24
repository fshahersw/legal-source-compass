import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { judge_portraits_open } from "@/lib/visuals/fixtures/rows";
import { parseJudgePortrait } from "@/lib/visuals/judgePortraits";

const state = vi.hoisted(() => ({
  crosswalk: { data: null as unknown, isLoading: false },
  open: { data: null as unknown, isLoading: false },
  enabled: [] as { key: string; enabled: boolean | undefined }[],
}));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (o: unknown) => o,
  useQuery: (o: { queryKey: string[]; enabled?: boolean }) => {
    state.enabled.push({ key: o.queryKey[0]!, enabled: o.enabled });
    return o.queryKey[0] === "judge-portrait" ? state.crosswalk : state.open;
  },
}));
vi.mock("@/lib/external/judgePortrait.functions", () => ({ getJudgePortrait: vi.fn() }));
vi.mock("@/lib/visuals/visuals.functions", () => ({
  getAgencyImages: vi.fn(),
  getCommitteeMark: vi.fn(),
  getCourtBuildings: vi.fn(),
  getOpenCompanyLogo: vi.fn(),
  getOpenJudgePortrait: vi.fn(),
  getStateCapitol: vi.fn(),
}));

import { JudgeHeadshot } from "./JudgeHeadshot";

const row = judge_portraits_open[0]!;
const portrait = row.item["portrait"] as Record<string, unknown>;
const identity = row.item["identity"] as Record<string, unknown>;
const html = (props: { recorded: string | null }) =>
  renderToStaticMarkup(
    createElement(JudgeHeadshot, { judgeId: row.id, name: "Judge Sample", ...props }),
  );

beforeEach(() => {
  state.crosswalk = { data: null, isLoading: false };
  state.open = { data: null, isLoading: false };
  state.enabled = [];
});

describe("JudgeHeadshot", () => {
  it("shows the open portrait, credited, when the page has no recorded or crosswalk portrait", () => {
    state.open = { data: parseJudgePortrait(row.id, portrait, identity), isLoading: false };
    const out = html({ recorded: null });
    expect(out).toContain("Judge Sample, portrait");
    expect(out).toContain("Portrait: Noot Noots");
    expect(out).toContain("CC BY-SA 4.0");
    expect(out).toContain("Wikimedia Commons");
    // Bound by an FJC node id: no name-match note.
    expect(out).not.toContain("About this image");
  });

  it("says when a portrait was bound by an exact name within a state", () => {
    state.open = {
      data: parseJudgePortrait(row.id, portrait, {
        ...identity,
        fjc_nid: null,
        fjc_url: null,
        fjc_slug: null,
        basis: "exact_name_same_state",
        state: "Wisconsin",
      }),
      isLoading: false,
    };
    expect(html({ recorded: null })).toContain('aria-label="About this image"');
  });

  it("leaves a recorded portrait and a crosswalk portrait to win, and reads nothing when absent", () => {
    state.open = { data: parseJudgePortrait(row.id, portrait, identity), isLoading: false };
    const recorded = html({ recorded: "https://example.org/recorded.jpg" });
    expect(recorded).toContain("portrait from the recorded profile");
    expect(recorded).not.toContain("Noot Noots");
    expect(state.enabled.filter((e) => e.enabled === false).map((e) => e.key)).toEqual([
      "judge-portrait",
      "visual",
    ]);
    state.crosswalk = {
      data: {
        assetPath: "/judge-portraits/1.jpeg",
        width: 100,
        height: 120,
        license: "Work of Federal Government",
        artist: null,
        dateCreated: null,
        sourceLabel: "Wikipedia",
        sourceUrl: null,
      },
      isLoading: false,
    };
    expect(html({ recorded: null })).toContain("/judge-portraits/1.jpeg");
    expect(html({ recorded: null })).not.toContain("Noot Noots");
    state.crosswalk = { data: null, isLoading: false };
    state.open = { data: null, isLoading: false };
    expect(html({ recorded: null })).toBe("");
  });
});
