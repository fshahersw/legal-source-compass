import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));
// Fixture mode must not depend on whether a build file happens to exist in private/build/visual_registry/.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(() => Promise.reject(new Error("ENOENT"))),
}));

import { restGet } from "@/lib/external/rest.server";
import * as rows from "./fixtures/rows";
import {
  readAgencyImages,
  readCommitteeMark,
  readCourtBuildings,
  readOpenCompanyLogo,
  readOpenJudgePortrait,
  readStateCapitol,
  readVisualFields,
} from "./visuals.server";

const item = (list: rows.FixtureRow[], id: string) => list.find((r) => r.id === id)!.item;

beforeEach(() => {
  vi.mocked(restGet).mockReset();
  delete process.env["VISUALS_FIXTURE"];
});
afterEach(() => {
  delete process.env["VISUALS_FIXTURE"];
});

describe("server reads", () => {
  it("selects only the named item fields of one exact id", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [{ id: "ilnd", ...item(rows.court_buildings, "ilnd") }],
      total: null,
    });
    const d = await readCourtBuildings("ilnd");
    expect(d?.buildings).toHaveLength(2);
    expect(vi.mocked(restGet).mock.calls[0]![0]).toBe(
      "corpus_records?select=id,buildings:item->buildings,counts:item->counts&dataset=eq.court_buildings&id=eq.ilnd&limit=1",
    );
  });

  it("returns null when the dataset has no record (unpublished) or the row is for another id", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [], total: null });
    expect(await readStateCapitol("AL")).toBeNull();
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [{ id: "AK", photo: item(rows.state_capitol_images, "AL")["photo"] }],
      total: null,
    });
    expect(await readStateCapitol("AL")).toBeNull();
  });

  it("does not query for an id of the wrong shape", async () => {
    expect(await readCourtBuildings("ilnd;drop")).toBeNull();
    expect(await readOpenJudgePortrait("cl:people:1250")).toBeNull();
    expect(await readAgencyImages("fbi")).toBeNull();
    expect(await readCommitteeMark("HSRU00")).toBeNull();
    expect(await readOpenCompanyLogo("66740")).toBeNull();
    expect(await readStateCapitol("al")).toBeNull();
    expect(vi.mocked(restGet)).not.toHaveBeenCalled();
  });

  it("drops a record that fails validation", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [
        {
          id: "hsru00",
          mark: { ...(item(rows.committee_marks, "hsru00")["mark"] as object), url: "http://x" },
        },
      ],
      total: null,
    });
    expect(await readCommitteeMark("hsru00")).toBeNull();
  });

  it("propagates a failed read so the page can offer a retry", async () => {
    vi.mocked(restGet).mockRejectedValueOnce(new Error("External corpus read failed (500)."));
    await expect(readAgencyImages("160")).rejects.toThrow("500");
  });
});

describe("dev fixture", () => {
  it("serves every fixture row through the parsers when VISUALS_FIXTURE=1, without querying", async () => {
    process.env["VISUALS_FIXTURE"] = "1";
    expect((await readCourtBuildings("ilnd"))?.buildings).toHaveLength(2);
    expect((await readCourtBuildings("ca10"))?.buildings[0]!.photo.origin).toBe("loc");
    expect((await readOpenJudgePortrait("f251088a2a884cf7e4745c1966f732b0"))?.author).toBe(
      "Noot Noots",
    );
    expect((await readAgencyImages("160"))?.photos[0]!.building).toBe("J. Edgar Hoover Building");
    expect((await readAgencyImages("5"))?.marks).toHaveLength(1);
    expect((await readCommitteeMark("hsru00"))?.mime).toBe("image/png");
    expect((await readOpenCompanyLogo("0000066740"))?.wikidata).toBe("Q159433");
    expect((await readStateCapitol("AL"))?.building).toBe("Alabama State Capitol");
    expect(await readCourtBuildings("cand")).toBeNull();
    expect(await readVisualFields("court_buildings", "ilnd", ["counts"])).toEqual({
      counts: { buildings_listed: 2, buildings_shown: 2 },
    });
    expect(vi.mocked(restGet)).not.toHaveBeenCalled();
  });
});
