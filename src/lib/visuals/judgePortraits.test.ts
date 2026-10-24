import { describe, expect, it } from "vitest";
import { judge_portraits_open } from "./fixtures/rows";
import { parseJudgePortrait } from "./judgePortraits";

const row = judge_portraits_open[0]!;
const portrait = row.item["portrait"] as Record<string, unknown>;
const identity = row.item["identity"] as Record<string, unknown>;

describe("parseJudgePortrait", () => {
  it("keeps the fixture portrait with its exact identity chain", () => {
    const p = parseJudgePortrait(row.id, portrait, identity)!;
    expect(p.judgeId).toBe("f251088a2a884cf7e4745c1966f732b0");
    expect(p.licenseFamily).toBe("cc by-sa");
    expect(p.author).toBe("Noot Noots");
    expect(p.imageDate).toBe("2023-02-03");
    expect(p.identity).toEqual({
      wikidata: "Q107938370",
      fjcSlug: "sweeney-charlotte-noelle",
      fjcNid: "12007541",
      fjcUrl: "https://www.fjc.gov/history/judges/sweeney-charlotte-noelle",
    });
  });

  it("accepts a numeric node id and an absent identity", () => {
    expect(
      parseJudgePortrait(row.id, portrait, { ...identity, fjc_nid: 12007541 })?.identity.fjcNid,
    ).toBe("12007541");
    expect(parseJudgePortrait(row.id, portrait, undefined)?.identity.fjcNid).toBeNull();
  });

  it("drops malformed identity values instead of repairing them", () => {
    expect(
      parseJudgePortrait(row.id, portrait, { ...identity, fjc_nid: "node/12007541" }),
    ).toBeNull();
    expect(parseJudgePortrait(row.id, portrait, { ...identity, wikidata: "107938370" })).toBeNull();
    expect(
      parseJudgePortrait(row.id, portrait, { ...identity, fjc_url: "https://example.org/judge" }),
    ).toBeNull();
    expect(parseJudgePortrait(row.id, portrait, "Q107938370")).toBeNull();
  });

  it("drops a bad judge id, a non-kept licence and a portrait off the allowed hosts", () => {
    expect(parseJudgePortrait("cl:people:1250", portrait, identity)).toBeNull();
    expect(
      parseJudgePortrait(row.id, { ...portrait, license_family: "cc by-nc" }, identity),
    ).toBeNull();
    expect(
      parseJudgePortrait(
        row.id,
        { ...portrait, thumb: { url: "https://en.wikipedia.org/x.jpg", width: 330, height: 396 } },
        identity,
      ),
    ).toBeNull();
  });
});
