import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  readCommittee,
  readCommitteesByExactName,
  readCosponsored,
  readKnownMembers,
  readMember,
  readMembersByExactName,
  readSponsored,
  readStateDelegation,
  runCommitteeSearch,
  runMemberSearch,
} from "./congressMembers.functions";

const mocked = vi.mocked(restGet);
const dec = (s: unknown) => decodeURIComponent(String(s));

const memberRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  source_url: "https://api.congress.gov/v3/member/" + id,
  c: {
    bioguide: id,
    name: `Name ${id}`,
    current: "yes",
    chamber: "Senate",
    member_type: "Senator",
    state_code: "CA",
    ...over,
  },
});
const billRow = (congress: number, type: string, n: string) => ({
  id: `${congress}-${type}-${n}`,
  title: "x",
  source_url: "https://www.congress.gov/bill/x",
  c: { congress, type, number: n, title: `Bill ${n}`, status: "introduced" },
});

beforeEach(() => mocked.mockReset());

describe("runMemberSearch", () => {
  it("pages results, drops malformed rows and defaults to current members", async () => {
    mocked.mockResolvedValueOnce({
      rows: [memberRow("A000001"), { id: "bad" }, memberRow("B000002")],
      total: 540,
    });
    const r = await runMemberSearch({ q: "smith", page: 3 });
    expect(r.rows.map((x) => x.id)).toEqual(["A000001", "B000002"]);
    expect(r.dropped).toBe(1);
    expect(r.total).toBe(540);
    const [path, opts] = mocked.mock.calls[0]!;
    expect(dec(path)).toContain('"current":["yes"]');
    expect(dec(path)).toContain("fts(simple).smith:*");
    expect(opts).toEqual({ count: true, range: [50, 74] });
  });

  it("rejects malformed input", async () => {
    await expect(runMemberSearch({ state: "California" } as never)).rejects.toThrow();
    await expect(runMemberSearch({ chamber: "both" } as never)).rejects.toThrow();
    await expect(runMemberSearch({ page: 0 } as never)).rejects.toThrow();
  });

  it("reads members by an exact published name, across statuses by default", async () => {
    mocked.mockResolvedValueOnce({ rows: [memberRow("A000001")], total: null });
    const hits = await readMembersByExactName("Robert  B. Aderholt");
    expect(hits).toHaveLength(1);
    expect(dec(mocked.mock.calls[0]![0])).toContain('{"name":["robert b. aderholt"]}');
  });
});

describe("readMember", () => {
  it("returns null unless exactly one record with the same id is stored", async () => {
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    expect(await readMember("A000055")).toBeNull();
    mocked.mockResolvedValueOnce({
      rows: [{ id: "A000055", m: { bioguideId: "B000001", names: { inverted: "X" } } }],
      total: null,
    });
    expect(await readMember("A000055")).toBeNull();
    mocked.mockResolvedValueOnce({
      rows: [
        { id: "A000055", m: { bioguideId: "A000055", names: { inverted: "Aderholt, Robert B." } } },
      ],
      total: null,
    });
    expect((await readMember("A000055"))!.name).toBe("Aderholt, Robert B.");
  });
});

describe("sponsored and cosponsored measures", () => {
  it("reads sponsored measures by the indexed sponsor key", async () => {
    mocked.mockResolvedValueOnce({ rows: [billRow(118, "hr", "1"), { id: "x" }], total: 12 });
    const r = await readSponsored({ bioguide: "A000055", congress: "118", page: 2 });
    expect(r.rows.map((x) => x.id)).toEqual(["118-hr-1"]);
    expect(r.dropped).toBe(1);
    expect(dec(mocked.mock.calls[0]![0])).toContain('{"sponsor":["A000055"],"congress":["118"]}');
    expect(mocked.mock.calls[0]![1]).toEqual({ count: true, range: [25, 49] });
  });

  it("resolves one page of the stored cosponsored list to bill records by exact id and reports missing bills", async () => {
    mocked
      .mockResolvedValueOnce({
        rows: [
          { id: "A000055", c: { bioguideId: "A000055", byCongress: { "118": { hr: [1, 2, 3] } } } },
        ],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [billRow(118, "hr", "3"), billRow(118, "hr", "1")],
        total: null,
      });
    const r = (await readCosponsored({ bioguide: "A000055" }))!;
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.id)).toEqual(["118-hr-3", "118-hr-1"]); // page order, not the response order
    expect(r.missing.map((x) => `${x.congress}-${x.type}-${x.number}`)).toEqual(["118-hr-2"]);
    expect(dec(mocked.mock.calls[1]![0])).toContain("id=in.(118-hr-3,118-hr-2,118-hr-1)");
  });

  it("filters the cosponsored list by Congress and pages it", async () => {
    mocked.mockResolvedValueOnce({
      rows: [
        {
          id: "A000055",
          c: { bioguideId: "A000055", byCongress: { "118": { hr: [1] }, "117": { hr: [9] } } },
        },
      ],
      total: null,
    });
    const r = (await readCosponsored({ bioguide: "A000055", congress: "118", page: 2 }))!;
    expect(r.total).toBe(1);
    expect(r.rows).toEqual([]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("returns null when the member or the list is not stored", async () => {
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    expect(await readCosponsored({ bioguide: "A000055" })).toBeNull();
    mocked.mockResolvedValueOnce({
      rows: [{ id: "A000055", c: { bioguideId: "B000001", byCongress: {} } }],
      total: null,
    });
    expect(await readCosponsored({ bioguide: "A000055" })).toBeNull();
  });
});

describe("readKnownMembers", () => {
  it("returns only ids that have a member record, de-duplicated and batched", async () => {
    mocked.mockResolvedValueOnce({ rows: [{ id: "A000001" }, { id: "not-an-id" }], total: null });
    const ids = ["A000001", "A000001", "B000002"];
    expect(await readKnownMembers(ids)).toEqual(["A000001"]);
    expect(dec(mocked.mock.calls[0]![0])).toContain("id=in.(A000001,B000002)");
    mocked.mockReset();
    expect(await readKnownMembers([])).toEqual([]);
    expect(mocked).not.toHaveBeenCalled();
    const many = Array.from({ length: 250 }, (_, i) => `A${String(i).padStart(6, "0")}`);
    mocked.mockResolvedValue({ rows: [], total: null });
    await readKnownMembers(many);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});

describe("readStateDelegation", () => {
  it("groups the members that currently represent the state", async () => {
    mocked.mockResolvedValueOnce({
      rows: [
        memberRow("S000001", { name: "Senator, B" }),
        memberRow("H000001", {
          chamber: "House of Representatives",
          member_type: "Representative",
          district: "2",
        }),
        memberRow("D000001", {
          chamber: "House of Representatives",
          member_type: "Delegate",
          district: "At large",
        }),
      ],
      total: null,
    });
    const d = await readStateDelegation("CA");
    expect(dec(mocked.mock.calls[0]![0])).toContain('{"represents":["CA"]}');
    expect([d.senators.length, d.representatives.length, d.delegates.length, d.total]).toEqual([
      1, 1, 1, 3,
    ]);
  });
});

describe("committees", () => {
  const cRow = (id: string) => ({
    id,
    title: id,
    source_url: "https://api.congress.gov/v3/committee/house/" + id,
    c: {
      system_code: id,
      name: `Committee ${id}`,
      chamber: "House",
      level: "committee",
      current: "yes",
    },
  });

  it("searches with a current-only default", async () => {
    mocked.mockResolvedValueOnce({ rows: [cRow("hspw00"), { id: "x" }], total: 30 });
    const r = await runCommitteeSearch({ q: "transportation" });
    expect(r.rows.map((x) => x.id)).toEqual(["hspw00"]);
    expect(r.dropped).toBe(1);
    expect(dec(mocked.mock.calls[0]![0])).toContain('"current":["yes"]');
  });

  it("reads exact committee names and one committee with its stored subcommittees", async () => {
    mocked.mockResolvedValueOnce({ rows: [cRow("hspw00")], total: null });
    expect(await readCommitteesByExactName("Transportation  Committee")).toHaveLength(1);
    expect(dec(mocked.mock.calls[0]![0])).toContain('{"name":["transportation committee"]}');
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hspw00",
            c: {
              systemCode: "hspw00",
              name: "Transportation and Infrastructure Committee",
              level: "committee",
            },
          },
        ],
        total: null,
      })
      .mockResolvedValueOnce({ rows: [cRow("hspw05")], total: null });
    const r = (await readCommittee("hspw00"))!;
    expect(r.committee.name).toBe("Transportation and Infrastructure Committee");
    expect(r.children.map((c) => c.id)).toEqual(["hspw05"]);
    expect(dec(mocked.mock.calls[1]![0])).toContain('{"parent":["hspw00"]}');
  });

  it("still returns the committee when the subcommittee lookup fails", async () => {
    mocked
      .mockResolvedValueOnce({
        rows: [{ id: "hspw00", c: { systemCode: "hspw00", name: "T" } }],
        total: null,
      })
      .mockRejectedValueOnce(new Error("503"));
    const r = (await readCommittee("hspw00"))!;
    expect(r.children).toEqual([]);
  });
});
