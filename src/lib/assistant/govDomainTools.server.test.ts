import { afterEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const paths: string[] = [];
let entries: Record<string, Row> = {};
let summary: Row[] = [];

vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string) => {
    paths.push(path);
    if (path.includes("dataset=eq.gov_domains_summary")) return { rows: summary, total: null };
    if (path.includes("entry_kind")) return { rows: [], total: null };
    const ids = /&id=in\.\(([^)]*)\)/.exec(path)?.[1];
    if (ids)
      return {
        rows: ids
          .split(",")
          .map(decodeURIComponent)
          .flatMap((id) => (entries[id] ? [{ id, g: entries[id] }] : [])),
        total: null,
      };
    throw new Error(`unexpected read ${path}`);
  }),
}));

import {
  GOV_DOMAIN_EXECUTORS,
  GOV_DOMAIN_TOOL_DEFINITIONS,
  lookupInputs,
} from "./govDomainTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";

const lookup = GOV_DOMAIN_EXECUTORS["lookup_government_domain"]!;

const gov = (host: string, over: Row = {}): Row => ({
  schema: "gov_domain.v1",
  entry: host,
  host,
  path: null,
  registries: ["cisa"],
  lists: ["cisa_current_full"],
  group: "state",
  states: ["CA"],
  organization: "State of California",
  city: "Sacramento",
  cisa: {
    type: "State or territory",
    organization: "State of California",
    suborganization: null,
    city: "Sacramento",
    state: "CA",
    security_contact: "published",
    in_zone: true,
  },
  gsa: null,
  notUsed: null,
  conflicts: [],
  ...over,
});

const snapshot = {
  id: "all",
  s: {
    schema: "gov_domains_summary.v1",
    scope: "all",
    total: 2,
    registries: { cisa: 1, gsa: 1, both: 0 },
    groups: {},
    cisaTypes: {},
    withState: 2,
    withoutState: 0,
    conflicts: 0,
    snapshot: {
      cisa: { zoneExport: "2026-10-22 12:54:30", commit: "000237f" },
      gsa: { commit: "f843a6b", commitDate: "2025-11-14" },
    },
  },
};

afterEach(() => {
  paths.length = 0;
  entries = {};
  summary = [];
});

describe("lookup_government_domain", () => {
  it("is offered with the other tools and names no vendor or model", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("lookup_government_domain");
    expect(availableTools().map((t) => t.name)).toContain("lookup_government_domain");
    expect(JSON.stringify(GOV_DOMAIN_TOOL_DEFINITIONS)).not.toMatch(
      /anthropic|claude|openai|gpt|tavily|firecrawl/i,
    );
  });

  it("collects hosts from host, url and hosts, without duplicates", () => {
    expect(
      lookupInputs({
        host: "ca.gov",
        url: "https://ca.gov/x",
        hosts: ["ca.gov", " ", 4, "tx.gov"],
      }),
    ).toEqual(["ca.gov", "https://ca.gov/x", "tx.gov"]);
    expect(lookupInputs({})).toEqual([]);
    expect(lookupInputs({ hosts: Array.from({ length: 40 }, (_, i) => `h${i}.gov`) })).toHaveLength(
      20,
    );
  });

  it("returns the publisher's facts, the match kind and the snapshot", async () => {
    entries = { "ca.gov": gov("ca.gov") };
    summary = [snapshot];
    const out = await lookup({ url: "https://www.courts.ca.gov/forms" });
    const body = JSON.parse(out.content);
    expect(body.snapshot).toEqual({
      cisa_zone_exported_utc: "2026-10-22 12:54:30",
      gsa_list_commit_date: "2025-11-14",
    });
    expect(body.results[0]).toMatchObject({
      host: "www.courts.ca.gov",
      status: "registered",
      match: "parent_domain",
      matched_entry: "ca.gov",
      government_level: "state",
      states: ["CA"],
      cisa: {
        domain_type: "State or territory",
        organization: "State of California",
        city: "Sacramento",
        state: "CA",
      },
    });
    expect(body.results[0].evidence).toContain("Registered .gov domain");
    expect(body.how_to_read).toMatch(/Not listed is not a finding/);
    expect(out.sources).toEqual([
      {
        title: "CISA .gov registry data",
        url: "https://data.get.gov/?file=current-full.csv",
        internal: false,
      },
      {
        title: "ca.gov in the registry dataset",
        url: "/records/gov_domains/ca.gov",
        internal: true,
      },
    ]);
    expect(out.label).toBe("Checked a government domain");
    expect(out.detail).toBe("www.courts.ca.gov · registered");
  });

  it("never reproduces a security contact address, and says nothing against an unlisted host", async () => {
    entries = { "ca.gov": gov("ca.gov") };
    summary = [snapshot];
    const out = await lookup({
      hosts: ["ca.gov", "example.com", "unregistered.gov", "army.mil", "ftp://files.example.gov/"],
    });
    const body = JSON.parse(out.content);
    expect(out.content).not.toMatch(/@/);
    const by = Object.fromEntries(body.results.map((r: { input: string }) => [r.input, r]));
    expect(by["example.com"]).toMatchObject({ status: "not_listed", evidence: null, notes: [] });
    expect(by["unregistered.gov"].notes[0]).toMatch(/does not include its registered domain/);
    expect(by["army.mil"].notes[0]).toMatch(/\.mil domains are not published/);
    expect(by["ftp://files.example.gov/"]).toMatchObject({ status: "invalid" });
    expect(out.detail).toBe("5 hosts · 1 registered or listed");
  });

  it("keeps a registry disagreement and the out-of-use note visible", async () => {
    entries = {
      "x.org": gov("x.org", {
        registries: ["gsa"],
        cisa: null,
        gsa: { rows: [{ type: "Local", state_as_published: "Ohio" }], views: {} },
        notUsed: { status: "Deprecated", level_of_government: null, note: null },
        conflicts: [{ field: "group", gsa: ["quasi", "federal"] }],
        group: null,
        states: [],
      }),
    };
    const body = JSON.parse((await lookup({ host: "x.org" })).content);
    expect(body.results[0].registries_disagree).toEqual([
      { field: "group", cisa: null, gsa: ["quasi", "federal"] },
    ]);
    expect(body.results[0].also_named_out_of_use.status).toBe("Deprecated");
    expect(body.results[0].notes.join(" ")).toMatch(/out of use/);
  });

  it("needs something to look up", async () => {
    await expect(lookup({})).rejects.toThrow(/host name/);
  });
});
