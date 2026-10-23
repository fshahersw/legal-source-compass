import { describe, expect, it } from "vitest";
import {
  locateInNode,
  mergeSameIdentityGroups,
  normHeading,
  numberKey,
  orderGroupsByNumber,
  parseOutlineRoot,
  parseOutlineShard,
  releaseOutline,
  stepMatches,
  topCandidates,
  type ReleaseNode,
} from "./stateCodeOutline";

const SHA = "a".repeat(64);
const id = (n: number) => n.toString(16).padStart(16, "0");

const agriculture: ReleaseNode = {
  id: id(1),
  l: "code",
  n: "AG",
  h: "Agriculture Code",
  c: 3,
  k: [
    {
      id: id(2),
      l: "title",
      n: null,
      h: "TITLE 1. GENERAL PROVISIONS",
      c: 2,
      k: [
        {
          id: id(3),
          l: "chapter",
          n: null,
          h: "CHAPTER 1. GENERAL PROVISIONS",
          c: 2,
          s: [
            ["TX:AG:1.001", "AG:1.001", "Sec. 1.001. PURPOSE OF CODE.", null],
            ["TX:AG:1.002", "AG:1.002", "Sec. 1.002. CONSTRUCTION OF CODE.", null],
          ],
        },
      ],
    },
    {
      id: id(4),
      l: "title",
      n: null,
      h: "TITLE 2. DEPARTMENT OF AGRICULTURE",
      hv: ["TITLE 2. DEPARTMENT OF AGRICULTURE  "],
      c: 1,
      s: [["TX:AG:11.001", "AG:11.001", "Sec. 11.001. DEFINITIONS.", "Repealed."]],
    },
  ],
};
const education: ReleaseNode = {
  id: id(5),
  l: "code",
  n: "ED",
  h: "Education Code",
  c: 1,
  k: [
    {
      id: id(6),
      l: "title",
      n: null,
      h: "TITLE 1. GENERAL PROVISIONS",
      c: 1,
      s: [["TX:ED:1.001", "ED:1.001", "Sec. 1.001. APPLICABILITY.", null]],
    },
  ],
};
const top = (node: ReleaseNode, shard: string) => ({
  id: node.id,
  l: node.l,
  n: node.n,
  h: node.h,
  c: node.c,
  shard,
});
const rootData = {
  schema_version: "state-code-outline-release/1",
  jurisdiction: "TX",
  source_system: "tx-texas-legislature-code",
  projection_sections: 4,
  restorations: ["Code level from the citation prefix."],
  top: [
    top(agriculture, "state-codes/tx/outline-v1/s0.json"),
    top(education, "state-codes/tx/outline-v1/s0.json"),
  ],
  direct: [],
  shards: { "state-codes/tx/outline-v1/s0.json": { sha256: SHA, bytes: 10 } },
};
const shardData = {
  schema_version: "state-code-outline-release/1",
  jurisdiction: "TX",
  nodes: [agriculture, education],
};

describe("outline release parsing", () => {
  it("reads a root and a shard for their own state only", () => {
    expect(parseOutlineRoot(rootData, "TX")?.top.map((t) => t.n)).toEqual(["AG", "ED"]);
    expect(parseOutlineRoot(rootData, "OH")).toBeNull();
    expect(parseOutlineShard(shardData, "TX")?.size).toBe(2);
    expect(parseOutlineShard(shardData, "OH")).toBeNull();
  });
  it("rejects a root naming a shard outside the release or a malformed node", () => {
    expect(
      parseOutlineRoot(
        { ...rootData, shards: { "state-codes/oh/outline-v1/s0.json": { sha256: SHA, bytes: 1 } } },
        "TX",
      ),
    ).toBeNull();
    expect(
      parseOutlineShard({ ...shardData, nodes: [{ ...agriculture, id: "not-an-id" }] }, "TX"),
    ).toBeNull();
    expect(
      parseOutlineShard({ ...shardData, nodes: [{ ...agriculture, s: [["x"]] }] }, "TX"),
    ).toBeNull();
  });
});

describe("releaseOutline", () => {
  const root = parseOutlineRoot(rootData, "TX")!;
  const nodes = parseOutlineShard(shardData, "TX")!;
  const load = async (t: { id: string }) => nodes.get(t.id) ?? null;

  it("lists codes at the top and keeps each code's titles apart", async () => {
    const atRoot = await releaseOutline(root, [], load);
    expect(
      atRoot.available && atRoot.kind === "groups" && atRoot.groups.map((g) => g.heading),
    ).toEqual(["Agriculture Code", "Education Code"]);
    const ag = await releaseOutline(root, [{ level: "code", number: "AG", node_id: id(1) }], load);
    expect(
      ag.available && ag.kind === "groups" && ag.groups.map((g) => [g.heading, g.count]),
    ).toEqual([
      ["TITLE 1. GENERAL PROVISIONS", 2],
      ["TITLE 2. DEPARTMENT OF AGRICULTURE", 1],
    ]);
  });

  it("opens one unnumbered title by its id or its printed heading, never all of them", async () => {
    const byId = await releaseOutline(
      root,
      [
        { level: "code", number: "AG", node_id: id(1) },
        { level: "title", number: null, node_id: id(2) },
        { level: "chapter", number: null, node_id: id(3) },
      ],
      load,
    );
    expect(
      byId.available && byId.kind === "sections" && byId.sections.map((s) => s.native_id),
    ).toEqual(["TX:AG:1.001", "TX:AG:1.002"]);
    const byHeading = await releaseOutline(
      root,
      [
        { level: "code", number: "AG" },
        { level: "title", number: null, heading: "TITLE 2. DEPARTMENT OF AGRICULTURE  " },
      ],
      load,
    );
    expect(byHeading.available && byHeading.kind === "sections" && byHeading.total).toBe(1);
    const ambiguous = await releaseOutline(
      root,
      [
        { level: "code", number: "AG" },
        { level: "title", number: null },
      ],
      load,
    );
    expect(ambiguous).toEqual({ available: true, kind: "unsupported_path" });
    const stale = await releaseOutline(
      root,
      [{ level: "code", number: "AG", node_id: id(9) }],
      load,
    );
    expect(stale).toEqual({ available: true, kind: "unsupported_path" });
  });

  it("locates a section and its top-level candidates", () => {
    expect(locateInNode(agriculture, "TX:AG:11.001")?.map((s) => s.heading)).toEqual([
      "Agriculture Code",
      "TITLE 2. DEPARTMENT OF AGRICULTURE",
    ]);
    expect(locateInNode(agriculture, "TX:ED:1.001")).toBeNull();
    expect(topCandidates(root, "ED:1.001", []).map((t) => t.n)).toEqual(["ED"]);
    expect(topCandidates(root, null, [])).toEqual([]);
  });
});

describe("numeric order of projection groups", () => {
  it("orders printed numbers as numbers within a level, leaving other levels as they came", () => {
    const g = (level: string, number: string | null) => ({
      level,
      number,
      heading: null,
      count: 1,
    });
    expect(
      orderGroupsByNumber([
        g("division", "1"),
        g("division", "1.5"),
        g("division", "10"),
        g("division", "2"),
      ]).map((x) => x.number),
    ).toEqual(["1", "1.5", "2", "10"]);
    expect(
      orderGroupsByNumber([g("title", "IX"), g("title", "IV"), g("title", "V")]).map(
        (x) => x.number,
      ),
    ).toEqual(["IV", "V", "IX"]);
    expect(
      orderGroupsByNumber([g("part", "B"), g("part", null), g("part", "A")]).map((x) => x.number),
    ).toEqual(["B", null, "A"]);
    expect(numberKey("101.011")).toEqual([2, 101, "", 0, 0, ".", 1, 0, "011"]);
  });
});

describe("helpers", () => {
  it("normalises headings for matching only", () => {
    expect(normHeading("TITLE 2.  Department’s  Code.")).toBe("title 2. department's code");
    expect(
      stepMatches({ id: id(2), l: "title", n: null, h: "A" }, { level: "title", number: null }),
    ).toBe(true);
  });

  it("merges outline groups that open the same list", () => {
    const merged = mergeSameIdentityGroups([
      { level: "title", number: "XXXIII", heading: "REGULATION OF TRADE,   AND", count: 2 },
      { level: "title", number: "XXXIV", heading: "ALCOHOLIC BEVERAGES", count: 5 },
      { level: "title", number: "XXXIII", heading: "REGULATION OF TRADE, AND", count: 40 },
      { level: "part", number: null, heading: "WATER", count: 3 },
      { level: "part", number: null, heading: "HEALTH", count: 4 },
    ]);
    expect(merged).toEqual([
      {
        level: "title",
        number: "XXXIII",
        heading: "REGULATION OF TRADE, AND",
        count: 42,
        variants: ["REGULATION OF TRADE,   AND"],
      },
      { level: "title", number: "XXXIV", heading: "ALCOHOLIC BEVERAGES", count: 5 },
      { level: "part", number: null, heading: "WATER", count: 3 },
      { level: "part", number: null, heading: "HEALTH", count: 4 },
    ]);
  });
});
