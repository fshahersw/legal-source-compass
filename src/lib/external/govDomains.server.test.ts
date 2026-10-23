import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const paths: string[] = [];
let entries: Record<string, Row> = {};
let pathEntries: Row[] = [];
let stateRows: Row[] = [];
let summaryRows: Row[] = [];

vi.mock("./rest.server", () => ({
  restGet: vi.fn(async (path: string, opts?: { count?: boolean; range?: [number, number] }) => {
    paths.push(path);
    if (path.includes("dataset=eq.gov_domains_summary")) return { rows: summaryRows, total: null };
    if (path.includes("entry_kind")) return { rows: pathEntries, total: null };
    const ids = /&id=in\.\(([^)]*)\)/.exec(path)?.[1];
    if (ids)
      return {
        rows: ids
          .split(",")
          .map(decodeURIComponent)
          .flatMap((id) => (entries[id] ? [{ id, g: entries[id] }] : [])),
        total: null,
      };
    if (path.includes("item->row")) {
      const [a, b] = opts?.range ?? [0, 999];
      return { rows: stateRows.slice(a, b + 1), total: opts?.count ? stateRows.length : null };
    }
    throw new Error(`unexpected read ${path}`);
  }),
}));

const gov = (host: string, over: Row = {}): Row => ({
  schema: "gov_domain.v1",
  entry: host,
  host,
  path: null,
  registries: ["cisa"],
  lists: ["cisa_current_full"],
  group: "county",
  states: ["WY"],
  organization: "Laramie County",
  city: "Cheyenne",
  cisa: {
    type: "County",
    organization: "Laramie County",
    suborganization: null,
    city: "Cheyenne",
    state: "WY",
    security_contact: "not_published",
    in_zone: true,
  },
  gsa: null,
  notUsed: null,
  conflicts: [],
  ...over,
});
const summaryAll = {
  id: "all",
  s: {
    schema: "gov_domains_summary.v1",
    scope: "all",
    total: 3,
    registries: { cisa: 2, gsa: 1, both: 0 },
    groups: {},
    cisaTypes: {},
    withState: 3,
    withoutState: 0,
    conflicts: 0,
    snapshot: {
      cisa: { zoneExport: "2026-10-22 12:54:30", commit: "000237f" },
      gsa: { commit: "f843a6b", commitDate: "2025-11-14" },
    },
  },
};
const summaryWy = {
  id: "state-WY",
  s: {
    schema: "gov_domains_summary.v1",
    scope: "state",
    usps: "WY",
    total: 3,
    cisa: 2,
    gsa: 1,
    groups: { county: 3 },
    cisaTypes: { County: 2 },
  },
};

async function load() {
  vi.resetModules();
  return import("./govDomains.server");
}

beforeEach(() => {
  entries = { "laramiecounty.gov": gov("laramiecounty.gov") };
  pathEntries = [
    {
      id: "360eldorado.com/government",
      g: gov("360eldorado.com", {
        entry: "360eldorado.com/government",
        path: "Government",
        registries: ["gsa"],
        cisa: null,
        gsa: { rows: [], views: {} },
      }),
    },
  ];
  stateRows = [];
  summaryRows = [summaryAll, summaryWy];
});
afterEach(() => {
  paths.length = 0;
});

describe("lookupGovDomains", () => {
  it("fetches every candidate entry in one read and matches in memory", async () => {
    const { lookupGovDomains } = await load();
    const out = await lookupGovDomains([
      "https://www.laramiecounty.gov/a",
      "unlisted.gov",
      "mailto:x@y.gov",
    ]);
    expect(out.results.map((r) => r.status)).toEqual(["registered", "not_listed", "invalid"]);
    expect(out.results[0]).toMatchObject({
      scope: "parent_domain",
      matchedEntry: "laramiecounty.gov",
      tier: "cisa_registered",
    });
    expect(out.snapshot).toMatchObject({
      cisaZoneExport: "2026-10-22 12:54:30",
      gsaCommitDate: "2025-11-14",
    });
    const entryReads = paths.filter((p) => p.includes("&id=in."));
    expect(entryReads).toHaveLength(1);
    expect(entryReads[0]).toContain("www.laramiecounty.gov,laramiecounty.gov");
    expect(entryReads[0]).toContain("unlisted.gov");
  });
  it("matches page-only entries without reading per host", async () => {
    const { lookupGovDomains } = await load();
    const out = await lookupGovDomains([
      "https://360eldorado.com/Government/x.html",
      "360eldorado.com",
    ]);
    expect(out.results.map((r) => r.status)).toEqual(["registered", "path_listed_only"]);
    expect(paths.filter((p) => p.includes("entry_kind"))).toHaveLength(1);
  });
  it("reads nothing for inputs that are not hosts", async () => {
    const { lookupGovDomains } = await load();
    const out = await lookupGovDomains(["", "ftp://a.gov"]);
    expect(out.results.every((r) => r.status === "invalid")).toBe(true);
    expect(paths.filter((p) => p.includes("gov_domains&"))).toHaveLength(0);
  });
  it("still finds a listing when the snapshot summary is not published, and then says unavailable rather than not listed", async () => {
    summaryRows = [];
    const { lookupGovDomains } = await load();
    const out = await lookupGovDomains(["laramiecounty.gov", "unlisted.gov"]);
    expect(out.snapshot).toBeNull();
    expect(out.results.map((r) => r.status)).toEqual(["registered", "unavailable"]);
  });
  it("splits a long list of hosts across reads", async () => {
    const { lookupGovDomains } = await load();
    const hosts = Array.from({ length: 60 }, (_, i) => `a.b.host${i}.example.gov`);
    await lookupGovDomains(hosts);
    const reads = paths.filter((p) => p.includes("&id=in."));
    expect(reads.length).toBeGreaterThan(1);
    for (const p of reads) expect(p.length).toBeLessThan(4000);
  });
});

describe("readStateGovRows", () => {
  it("pages through the state's rows and drops malformed ones", async () => {
    stateRows = Array.from({ length: 1200 }, (_, i) => ({
      id: `d${i}.gov`,
      r: {
        domain: `d${i}.gov`,
        registries: ["cisa"],
        group: "city",
        states: ["WY"],
        types: [["cisa", "City"]],
      },
    }));
    stateRows.push({ id: "bad", r: { domain: "BAD DOMAIN" } });
    const { readStateGovRows } = await load();
    const out = await readStateGovRows("WY");
    expect(out.rows).toHaveLength(1200);
    expect(out.total).toBe(1201);
    expect(out.truncated).toBe(true); // one stored row failed validation and is not shown
    expect(paths.filter((p) => p.includes("item->row"))).toHaveLength(2);
    expect(paths[0]).toContain(encodeURIComponent(JSON.stringify({ state: ["WY"] })));
  });
});

describe("readGovSummary", () => {
  it("is null-safe when nothing is published", async () => {
    summaryRows = [];
    const { readGovSummary, readGovSnapshot } = await load();
    expect(await readGovSummary()).toEqual({ all: null, states: [] });
    expect(await readGovSnapshot()).toBeNull();
  });
  it("parses the snapshot and the per-state counts", async () => {
    const { readGovSummary } = await load();
    const s = await readGovSummary();
    expect(s.all!.snapshot.gsaCommit).toBe("f843a6b");
    expect(s.states).toEqual([expect.objectContaining({ usps: "WY", total: 3 })]);
  });
});
