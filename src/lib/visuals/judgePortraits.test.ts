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
      basis: "fjc_node_id",
      state: null,
      wikidata: "Q107938370",
      fjcSlug: "sweeney-charlotte-noelle",
      fjcNid: "12007541",
      fjcUrl: "https://www.fjc.gov/history/judges/sweeney-charlotte-noelle",
    });
  });

  it("accepts the two bases the build uses, each with its own evidence", () => {
    // A numeric node id reads the same as a string one.
    const numeric = parseJudgePortrait(row.id, portrait, { ...identity, fjc_nid: 12007541 });
    expect(numeric?.identity.fjcNid).toBe("12007541");
    // A state or special-court judge: no FJC id, a unique exact name within the recorded state.
    const byName = parseJudgePortrait("5225f03f7fba3440bf18acc9a6f8d53b", portrait, {
      wikidata: "Q131937885",
      fjc_slug: null,
      fjc_nid: null,
      fjc_url: null,
      basis: "exact_name_same_state",
      state: "Wisconsin",
    })!;
    expect(byName.identity).toEqual({
      basis: "exact_name_same_state",
      state: "Wisconsin",
      wikidata: "Q131937885",
      fjcSlug: null,
      fjcNid: null,
      fjcUrl: null,
    });
  });

  it("drops a record whose identity basis is missing, unknown or lacks its evidence", () => {
    const { basis: _basis, ...noBasis } = identity;
    expect(parseJudgePortrait(row.id, portrait, noBasis)).toBeNull();
    expect(parseJudgePortrait(row.id, portrait, undefined)).toBeNull();
    expect(parseJudgePortrait(row.id, portrait, { ...identity, basis: "fuzzy_name" })).toBeNull();
    // fjc_node_id needs the node id; exact_name_same_state needs the state.
    expect(parseJudgePortrait(row.id, portrait, { ...identity, fjc_nid: null })).toBeNull();
    expect(
      parseJudgePortrait(row.id, portrait, {
        ...identity,
        basis: "exact_name_same_state",
        fjc_nid: null,
        state: null,
      }),
    ).toBeNull();
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

  it("keeps a portrait whose recorded image date is not a short plain date, without the date", () => {
    const messy =
      "between 1965 and 1966 date QS:P,+1965-00-00T00:00:00Z/8,P1319,+1965-00-00T00:00:00Z/9,P1326";
    const p = parseJudgePortrait(row.id, { ...portrait, image_date: messy }, identity)!;
    expect(p.imageDate).toBeNull();
    expect(p.author).toBe("Noot Noots");
  });

  it("drops a bad judge id and a portrait off the allowed hosts, but filters on no licence family", () => {
    expect(parseJudgePortrait("cl:people:1250", portrait, identity)).toBeNull();
    expect(
      parseJudgePortrait(row.id, { ...portrait, license_family: "cc by-nc" }, identity)
        ?.licenseFamily,
    ).toBe("other");
    expect(
      parseJudgePortrait(
        row.id,
        { ...portrait, thumb: { url: "https://en.wikipedia.org/x.jpg", width: 330, height: 396 } },
        identity,
      ),
    ).toBeNull();
  });
});
