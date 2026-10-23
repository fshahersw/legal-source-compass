import { describe, expect, it } from "vitest";
import {
  buildLookupResult,
  candidateEntries,
  countByGroup,
  countByType,
  evidenceLabel,
  filterGovRows,
  groupGovRows,
  jurisdictionState,
  matchCountyRows,
  matchRegistry,
  parseCensusArea,
  parseGovFacts,
  parseGovRow,
  parseHostInput,
  parseSummaryAll,
  parseSummaryState,
  typeLine,
  type GovFacts,
  type GovRow,
  type GovSnapshot,
  type ParsedHost,
} from "./govDomainsModel";

const SNAP: GovSnapshot = {
  cisaZoneExport: "2026-10-22 12:54:30",
  cisaCommit: "000237f",
  gsaCommit: "f843a6b",
  gsaCommitDate: "2025-11-14",
};

/** A stored item.gov payload as the builder writes it. */
function gov(over: Record<string, unknown> = {}) {
  return {
    schema: "gov_domain.v1",
    entry: "ca.gov",
    host: "ca.gov",
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
  };
}
const facts = (id: string, over: Record<string, unknown> = {}): GovFacts =>
  parseGovFacts(id, gov({ entry: id, host: id.split("/")[0], ...over }))!;

const ca = facts("ca.gov");
const gsaOnly = facts("ncleg.net", {
  registries: ["gsa"],
  lists: ["gsa_full", "gsa_state"],
  group: "state",
  states: ["NC"],
  organization: null,
  city: null,
  cisa: null,
  gsa: {
    rows: [
      {
        type: "State",
        agency: null,
        state_as_published: "North Carolina",
        note: "NC General Assembly",
        link: "http://www.ncleg.net/",
        date_added: "6/6/13 18:08",
      },
    ],
    views: {
      gsa_state: [
        {
          level_of_government: "State Government",
          location_as_published: "North Carolina",
          status: "accepted term",
        },
      ],
    },
  },
});
const eldorado = facts("360eldorado.com/government", {
  host: "360eldorado.com",
  path: "Government",
  registries: ["gsa"],
  lists: ["gsa_full"],
  group: "city",
  states: ["KS"],
  cisa: null,
  gsa: {
    rows: [{ type: "Local", state_as_published: "Kansas", note: "City of El Dorado, KS" }],
    views: {},
  },
});
const ipEntry = facts("174.132.145.94/~hope", {
  host: "174.132.145.94",
  path: "~hope",
  registries: ["gsa"],
  lists: ["gsa_full"],
  group: "city",
  states: ["NC"],
  cisa: null,
  gsa: { rows: [{ type: "Local" }], views: {} },
});

const byId = new Map([ca, gsaOnly].map((f) => [f.id, f]));
const paths = [eldorado, ipEntry];
const ok = (s: string) => {
  const p = parseHostInput(s);
  if (!p.ok) throw new Error(`not parsed: ${s}`);
  return p;
};
const look = (s: string) => {
  const parsed: ParsedHost = parseHostInput(s);
  const match = parsed.ok ? matchRegistry(parsed, byId, paths) : { hit: null, pathScoped: [] };
  return buildLookupResult(s, parsed, match, SNAP);
};

describe("parseHostInput", () => {
  it("reads hosts and http(s) addresses", () => {
    expect(ok("WWW.Courts.CA.gov")).toMatchObject({
      host: "www.courts.ca.gov",
      path: null,
      ip: false,
    });
    expect(ok("https://courts.ca.gov/Self-Help/Forms?x=1#top")).toMatchObject({
      host: "courts.ca.gov",
      path: "self-help/forms",
    });
    expect(ok("ca.gov:8443/a")).toMatchObject({ host: "ca.gov", path: "a" });
    expect(ok("ca.gov.")).toMatchObject({ host: "ca.gov" });
    expect(ok("http://174.132.145.94/~hope/page")).toMatchObject({ ip: true, path: "~hope/page" });
  });
  it("normalises an international name to punycode", () => {
    expect(ok("https://bücher.gov/")).toMatchObject({ host: "xn--bcher-kva.gov" });
  });
  it("rejects what is not a plain host, without repairing it", () => {
    expect(parseHostInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseHostInput("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseHostInput("ftp://ca.gov/")).toEqual({ ok: false, reason: "not_http" });
    expect(parseHostInput("mailto:a@ca.gov")).toEqual({ ok: false, reason: "not_http" });
    expect(parseHostInput("javascript:alert(1)")).toEqual({ ok: false, reason: "not_http" });
    for (const bad of [
      "localhost",
      "a b.gov",
      "foo..gov",
      "[::1]",
      "http://[::1]/",
      "-bad-.gov",
      "x".repeat(300) + ".gov",
    ])
      expect(parseHostInput(bad)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("candidateEntries", () => {
  it("walks parent domains down to two labels", () => {
    expect(candidateEntries("www.courts.ca.gov")).toEqual([
      "www.courts.ca.gov",
      "courts.ca.gov",
      "ca.gov",
    ]);
    expect(candidateEntries("ca.gov")).toEqual(["ca.gov"]);
    expect(candidateEntries("ci.austin.tx.us")).toEqual([
      "ci.austin.tx.us",
      "austin.tx.us",
      "tx.us",
    ]);
  });
  it("gives an IP address only itself", () => {
    expect(candidateEntries("174.132.145.94", true)).toEqual(["174.132.145.94"]);
  });
});

describe("matchRegistry", () => {
  it("matches the exact host and its parent domains only", () => {
    expect(look("ca.gov")).toMatchObject({
      status: "registered",
      scope: "exact_host",
      matchedEntry: "ca.gov",
      tier: "cisa_registered",
    });
    expect(look("https://www.courts.ca.gov/forms")).toMatchObject({
      status: "registered",
      scope: "parent_domain",
      matchedEntry: "ca.gov",
    });
    expect(look("senate.ncleg.net")).toMatchObject({
      status: "registered",
      scope: "parent_domain",
      tier: "gsa_listed",
    });
  });
  it("never matches on a substring, a prefix or a similar name", () => {
    for (const host of [
      "notca.gov",
      "ca.gov.evil.com",
      "xca.gov",
      "ca-gov.com",
      "cagov.org",
      "ncleg.net.evil.io",
      "ncleg.org",
    ])
      expect(look(host).status).toBe("not_listed");
  });
  it("prefers the most specific listed domain", () => {
    const deeper = facts("courts.ca.gov", { states: ["CA"] });
    const m = new Map([ca, deeper].map((f) => [f.id, f]));
    const hit = matchRegistry(ok("a.courts.ca.gov"), m, []).hit!;
    expect(hit.facts.id).toBe("courts.ca.gov");
  });
  it("matches a page-only entry on exactly its host and path", () => {
    expect(look("https://360eldorado.com/Government/CityofElDorado.html")).toMatchObject({
      status: "registered",
      scope: "path",
      matchedEntry: "360eldorado.com/government",
    });
    expect(look("360eldorado.com/government")).toMatchObject({
      status: "registered",
      scope: "path",
    });
    // another section of the same host, the bare host and a sibling host are not covered
    expect(look("https://360eldorado.com/Governmentx/a")).toMatchObject({
      status: "path_listed_only",
      pathScopedEntries: ["360eldorado.com/government"],
    });
    expect(look("https://360eldorado.com/news")).toMatchObject({ status: "path_listed_only" });
    expect(look("360eldorado.com")).toMatchObject({ status: "path_listed_only" });
    expect(look("www.360eldorado.com/government")).toMatchObject({ status: "not_listed" });
  });
  it("matches an IP address only exactly, with its path", () => {
    expect(look("http://174.132.145.94/~hope/x")).toMatchObject({
      status: "registered",
      scope: "path",
    });
    expect(look("http://174.132.145.95/~hope")).toMatchObject({ status: "not_listed" });
  });
});

describe("lookup result", () => {
  it("explains a .gov host the registry does not list, and says nothing against other hosts", () => {
    const r = look("example-unregistered.gov");
    expect(r.status).toBe("not_listed");
    expect(r.tldNote).toContain("2026-10-22");
    expect(look("example.com").tldNote).toBeNull();
  });
  it("cannot judge .mil hosts", () => {
    expect(look("army.mil").tldNote).toMatch(/\.mil domains are not published/);
  });
  it("reports invalid input with a reason", () => {
    expect(look("mailto:x@ca.gov")).toMatchObject({
      status: "invalid",
      invalidReason: expect.stringContaining("http(s)"),
    });
  });
  it("carries cautions for a domain GSA also lists as out of use, a conflict and a page-only listing", () => {
    const risky = facts("old.example.org", {
      registries: ["gsa"],
      cisa: null,
      gsa: { rows: [{ type: "Local" }], views: {} },
      notUsed: { status: "Deprecated", level_of_government: null, note: null },
      conflicts: [{ field: "group", gsa: ["quasi", "federal"] }],
      group: null,
    });
    const parsed = ok("old.example.org");
    const r = buildLookupResult(
      "old.example.org",
      parsed,
      matchRegistry(parsed, new Map([[risky.id, risky]]), []),
      SNAP,
    );
    expect(r.cautions).toHaveLength(2);
    expect(r.cautions[0]).toContain("Deprecated");
    expect(look("360eldorado.com/government/x").cautions).toContain(
      "Only the listed pages of this host are covered, not the whole host.",
    );
  });
});

describe("evidenceLabel", () => {
  it("labels only listed hosts", () => {
    expect(evidenceLabel(look("ca.gov"))).toEqual({
      label: "Registered .gov domain",
      detail: "CISA .gov registry: State or territory, State of California; snapshot 2026-10-22",
    });
    expect(evidenceLabel(look("www.ncleg.net"))).toMatchObject({
      label: "Listed government domain",
    });
    expect(evidenceLabel(look("www.ncleg.net"))!.detail).toContain("subdomain of ncleg.net");
    expect(evidenceLabel(look("example.com"))).toBeNull();
    expect(evidenceLabel(look("unregistered.gov"))).toBeNull();
  });
});

describe("jurisdictionState", () => {
  it("attributes a state only for bodies that govern within one state", () => {
    expect(jurisdictionState(look("ca.gov"))).toBe("CA");
    expect(jurisdictionState(look("www.ncleg.net"))).toBe("NC");
    expect(jurisdictionState(look("360eldorado.com/government"))).toBeNull(); // page-only listing
    const fed = facts("psup.gov", { group: "federal", states: ["VA"] });
    const parsed = ok("psup.gov");
    expect(
      jurisdictionState(
        buildLookupResult(
          "psup.gov",
          parsed,
          matchRegistry(parsed, new Map([[fed.id, fed]]), []),
          SNAP,
        ),
      ),
    ).toBeNull();
    const disputed = facts("x.gov", {
      states: ["OR"],
      conflicts: [{ field: "state", cisa: "OR", gsa: ["WA"] }],
    });
    const p2 = ok("x.gov");
    expect(
      jurisdictionState(
        buildLookupResult(
          "x.gov",
          p2,
          matchRegistry(p2, new Map([[disputed.id, disputed]]), []),
          SNAP,
        ),
      ),
    ).toBeNull();
    const multi = facts("m.gov", { states: ["OH", "PA"] });
    const p3 = ok("m.gov");
    expect(
      jurisdictionState(
        buildLookupResult("m.gov", p3, matchRegistry(p3, new Map([[multi.id, multi]]), []), SNAP),
      ),
    ).toBeNull();
  });
});

describe("stored JSON is untrusted", () => {
  it("drops malformed rows and facts", () => {
    expect(parseGovFacts("ca.gov", { ...gov(), schema: "other" })).toBeNull();
    expect(parseGovFacts("ca.gov", { ...gov(), registries: ["nope"] })).toBeNull();
    expect(parseGovFacts("bad id", gov())).toBeNull();
    expect(parseGovFacts("ca.gov", null)).toBeNull();
    expect(parseGovRow("ca.gov", { domain: "ca.gov", registries: [] })).toBeNull();
    expect(parseGovRow("ca.gov", { domain: "CA.GOV/x", registries: ["cisa"] })).toBeNull();
    expect(parseGovRow(7, { domain: "ca.gov", registries: ["cisa"] })).toBeNull();
  });
  it("keeps only http(s) links and known groups and 2-letter states", () => {
    const row = parseGovRow("a.gov", {
      domain: "a.gov",
      registries: ["cisa", "bogus"],
      group: "made_up",
      states: ["OH", "ohio", "Q"],
      link: "javascript:alert(1)",
      types: [
        ["cisa", "City"],
        ["gsa", ""],
        ["other", "x"],
      ],
    })!;
    expect(row).toMatchObject({
      group: null,
      states: ["OH"],
      link: null,
      registries: ["cisa"],
      types: [{ registry: "cisa", type: "City" }],
    });
    expect(
      parseGovRow("a.gov", { domain: "a.gov", registries: ["cisa"], link: "https://a.gov/" })!.link,
    ).toBe("https://a.gov/");
  });
  it("parses the full record the builder writes", () => {
    expect(ca).toMatchObject({
      id: "ca.gov",
      group: "state",
      states: ["CA"],
      cisa: { type: "State or territory", securityContact: "published", inZone: true },
    });
    expect(gsaOnly.gsa!.rows[0]).toMatchObject({
      type: "State",
      stateAsPublished: "North Carolina",
      link: "http://www.ncleg.net/",
    });
    expect(gsaOnly.gsa!.views[0]).toMatchObject({ list: "gsa_state", status: "accepted term" });
  });
});

function row(id: string, over: Partial<GovRow> = {}): GovRow {
  return {
    id,
    domain: id.split("/")[0]!,
    path: null,
    group: "city",
    types: [{ registry: "cisa", type: "City" }],
    organization: null,
    city: null,
    states: ["WY"],
    registries: ["cisa"],
    securityContact: null,
    link: null,
    note: null,
    notUsed: false,
    conflict: false,
    ...over,
  };
}

describe("list views", () => {
  const rows = [
    row("laramiecounty.gov", {
      group: "county",
      organization: "Laramie County",
      types: [{ registry: "cisa", type: "County" }],
    }),
    row("cheyenne.gov", { organization: "City of Cheyenne", city: "Cheyenne" }),
    row("wyo.gov", {
      group: "state",
      organization: "State of Wyoming",
      types: [{ registry: "cisa", type: "State or territory" }],
    }),
    row("odd.org", { group: null, types: [], registries: ["gsa"] }),
  ];
  it("groups in a fixed order with a last group for an unrecorded level", () => {
    expect(groupGovRows(rows).map((g) => [g.group, g.rows.length])).toEqual([
      ["state", 1],
      ["county", 1],
      ["city", 1],
      ["unassigned", 1],
    ]);
    expect(groupGovRows(rows).at(-1)!.label).toBe("Level not recorded");
  });
  it("filters by every word, case-insensitively, within the row's own fields", () => {
    expect(filterGovRows(rows, "laramie county").map((r) => r.id)).toEqual(["laramiecounty.gov"]);
    expect(filterGovRows(rows, "CHEYENNE city").map((r) => r.id)).toEqual(["cheyenne.gov"]);
    expect(filterGovRows(rows, "cheyenne county")).toEqual([]);
    expect(filterGovRows(rows, "", "county").map((r) => r.id)).toEqual(["laramiecounty.gov"]);
    expect(filterGovRows(rows, "", "unassigned").map((r) => r.id)).toEqual(["odd.org"]);
    expect(filterGovRows(rows, "state of wyoming").map((r) => r.id)).toEqual(["wyo.gov"]);
  });
  it("counts by group and by published type", () => {
    expect([...countByGroup(rows)]).toEqual([
      ["county", 1],
      ["city", 1],
      ["state", 1],
      ["unassigned", 1],
    ]);
    expect(countByType(rows)).toEqual([
      { type: "City", count: 1 },
      { type: "County", count: 1 },
      { type: "State or territory", count: 1 },
    ]);
  });
  it("shows both registries' wording when both list an entry", () => {
    expect(
      typeLine(
        row("a.gov", {
          types: [
            { registry: "cisa", type: "City" },
            { registry: "gsa", type: "Local" },
          ],
        }),
      ),
    ).toBe("City (CISA); Local (GSA)");
    expect(typeLine(row("a.gov"))).toBe("City");
    expect(typeLine(row("a.gov", { types: [] }))).toBe("Type not recorded");
  });
});

describe("parseCensusArea", () => {
  it("splits the Census name into base and suffix", () => {
    expect(parseCensusArea("Laramie County, Wyoming")).toEqual({
      full: "Laramie County",
      base: "Laramie",
      suffix: "County",
    });
    expect(parseCensusArea("Acadia Parish, Louisiana")).toMatchObject({
      base: "Acadia",
      suffix: "Parish",
    });
    expect(parseCensusArea("Juneau City and Borough, Alaska")).toMatchObject({
      base: "Juneau",
      suffix: "City and Borough",
    });
    expect(parseCensusArea("Alexandria city, Virginia")).toMatchObject({
      base: "Alexandria",
      suffix: "city",
    });
    expect(parseCensusArea("District of Columbia, District of Columbia")).toMatchObject({
      suffix: null,
    });
    expect(parseCensusArea("")).toBeNull();
  });
});

describe("matchCountyRows", () => {
  const laramie = parseCensusArea("Laramie County, Wyoming")!;
  const rows = [
    row("laramiecounty.gov", { group: "county", organization: "Laramie County" }),
    row("laramiecountywy.gov", { group: "county", organization: "COUNTY OF  LARAMIE" }),
    row("laramiecosheriff.gov", {
      group: "county",
      organization: "Laramie County Sheriff's Office",
    }),
    row("albany.gov", { group: "county", organization: "Albany County" }),
    row("laramie.gov", { group: "city", organization: "City of Laramie" }),
    row("otherstate.gov", { group: "county", organization: "Laramie County", states: ["NE"] }),
    row("gsa-laramie.org", {
      group: "county",
      registries: ["gsa"],
      organization: null,
      note: "Laramie County, wy",
    }),
    row("gsa-form.org", {
      group: "county",
      registries: ["gsa"],
      organization: null,
      note: "County of Laramie, WY",
    }),
    row("gsa-loose.org", {
      group: "county",
      registries: ["gsa"],
      organization: null,
      note: "Laramie County Library, WY",
    }),
  ];
  it("matches only an organization or note that equals the Census name", () => {
    const m = matchCountyRows(rows, laramie, "WY");
    expect(m.map((x) => [x.row.id, x.method])).toEqual([
      ["gsa-form.org", "gsa_note"],
      ["gsa-laramie.org", "gsa_note"],
      ["laramiecounty.gov", "organization_name"],
      ["laramiecountywy.gov", "organization_name_form_of"],
    ]);
    expect(m[2]!.detail).toContain("“Laramie County”");
  });
  it("never matches a similar name, another state or another level", () => {
    const ids = matchCountyRows(rows, laramie, "WY").map((x) => x.row.id);
    for (const no of [
      "laramiecosheriff.gov",
      "albany.gov",
      "laramie.gov",
      "otherstate.gov",
      "gsa-loose.org",
    ])
      expect(ids).not.toContain(no);
    expect(matchCountyRows(rows, laramie, "NE").map((x) => x.row.id)).toEqual(["otherstate.gov"]);
  });
  it("uses the area's own suffix and treats an independent city as a city-level entry", () => {
    const parish = parseCensusArea("Acadia Parish, Louisiana")!;
    const lrows = [
      row("acadiaparish.gov", {
        group: "county",
        states: ["LA"],
        organization: "Parish of Acadia",
      }),
      row("a.gov", { group: "county", states: ["LA"], organization: "County of Acadia" }),
    ];
    expect(matchCountyRows(lrows, parish, "LA").map((x) => x.row.id)).toEqual(["acadiaparish.gov"]);
    const alex = parseCensusArea("Alexandria city, Virginia")!;
    const vrows = [
      row("alexandriava.gov", { states: ["VA"], organization: "City of Alexandria" }),
      row("alexandriaky.gov", { states: ["KY"], organization: "City of Alexandria" }),
    ];
    expect(matchCountyRows(vrows, alex, "VA").map((x) => x.row.id)).toEqual(["alexandriava.gov"]);
  });
  it("returns nothing when no entry names the area exactly", () => {
    expect(matchCountyRows(rows, parseCensusArea("Sublette County, Wyoming")!, "WY")).toEqual([]);
    expect(
      matchCountyRows(rows, parseCensusArea("Capitol Planning Region, Connecticut")!, "CT"),
    ).toEqual([]);
  });
});

describe("summaries", () => {
  it("parse the stored payloads and drop malformed ones", () => {
    const all = parseSummaryAll({
      schema: "gov_domains_summary.v1",
      scope: "all",
      total: 26171,
      registries: { cisa: 16935, gsa: 9239, both: 3 },
      groups: { city: 5, bad: -1, worse: "x" },
      cisaTypes: { City: 9223 },
      withState: 25593,
      withoutState: 578,
      conflicts: 1,
      snapshot: {
        cisa: { zoneExport: "2026-10-22 12:54:30", commit: "abc" },
        gsa: { commit: "def", commitDate: "2025-11-14" },
      },
    })!;
    expect(all).toMatchObject({
      total: 26171,
      groups: { city: 5 },
      snapshot: { cisaZoneExport: "2026-10-22 12:54:30", gsaCommitDate: "2025-11-14" },
    });
    expect(parseSummaryAll({ schema: "x" })).toBeNull();
    expect(
      parseSummaryState({
        schema: "gov_domains_summary.v1",
        scope: "state",
        usps: "WY",
        total: 122,
        cisa: 100,
        gsa: 22,
        groups: { county: 30 },
        cisaTypes: {},
      }),
    ).toMatchObject({ usps: "WY", total: 122 });
    expect(
      parseSummaryState({ schema: "gov_domains_summary.v1", scope: "state", usps: "wyoming" }),
    ).toBeNull();
  });
});
