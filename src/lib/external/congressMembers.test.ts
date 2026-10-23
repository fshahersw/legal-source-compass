import { describe, expect, it } from "vitest";
import {
  billId,
  billsByIdPath,
  committeeExactPath,
  committeeSearchPath,
  congressRuns,
  delegationPath,
  districtText,
  groupDelegation,
  knownMembersPath,
  memberExactPath,
  memberSearchPath,
  nameKey,
  parseCommittee,
  parseCommitteeHit,
  parseCosponsored,
  parseMember,
  parseMemberHit,
  sponsoredPath,
  type MemberHit,
} from "./congressMembers";

const dec = (p: string) => decodeURIComponent(p);

const hitRow = (over: Record<string, unknown> = {}, id = "A000055") => ({
  id,
  title: "Robert B. Aderholt",
  source_url: "https://api.congress.gov/v3/member/A000055",
  c: {
    bioguide: id,
    name: "Aderholt, Robert B.",
    display_name: "Robert B. Aderholt",
    party: "Republican",
    party_abbreviation: "R",
    state: "Alabama",
    state_code: "AL",
    district: "4",
    chamber: "House of Representatives",
    member_type: "Representative",
    years: "1997–present",
    current: "yes",
    congresses: 15,
    sponsored_reported: 104,
    cosponsored_reported: 2311,
    ...over,
  },
});

describe("parseMemberHit", () => {
  it("reads a list row as published", () => {
    const h = parseMemberHit(hitRow())!;
    expect(h).toMatchObject({
      id: "A000055",
      name: "Aderholt, Robert B.",
      party: "Republican",
      stateCode: "AL",
      district: "4",
      current: true,
      sponsoredReported: 104,
    });
  });

  it("rejects a row whose id is not a Bioguide ID or differs from its own bioguide cell", () => {
    expect(parseMemberHit(hitRow({}, "a000055"))).toBeNull();
    expect(parseMemberHit(hitRow({ bioguide: "B000001" }))).toBeNull();
    expect(parseMemberHit({ id: "A000055" })).toBeNull();
    expect(parseMemberHit(null)).toBeNull();
  });

  it("keeps unknown values unknown (null), never a default", () => {
    const h = parseMemberHit(
      hitRow({
        current: null,
        party: null,
        years: null,
        state_code: "Alabama",
        sponsored_reported: null,
      }),
    )!;
    expect([h.current, h.party, h.years, h.stateCode, h.sponsoredReported]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(parseMemberHit(hitRow({ current: "no" }))!.current).toBe(false);
  });
});

describe("member search paths", () => {
  it("is a plain browse with the status filter by default shape", () => {
    const { path, mode } = memberSearchPath({ status: "current" });
    expect(mode).toBe("browse");
    expect(path).toContain("dataset=eq.congress_members");
    expect(dec(path)).toContain('filters=cs.{"current":["yes"]}');
    expect(path).toContain("order=ordinal.asc");
  });

  it("filters by chamber, state, party and Congress and ignores malformed values", () => {
    const { path } = memberSearchPath({
      status: "former",
      chamber: "senate",
      state: "VT",
      party: "Democratic",
      congress: "118",
    });
    expect(dec(path)).toContain('"current":["no"]');
    expect(dec(path)).toContain('"chamber":["senate"]');
    expect(dec(path)).toContain('"state":["VT"]');
    expect(dec(path)).toContain('"party":["Democratic"]');
    expect(dec(path)).toContain('"congress":["118"]');
    const bad = memberSearchPath({
      chamber: "both",
      state: "Vermont",
      party: "x'; drop",
      congress: "5",
    });
    expect(bad.path).not.toContain("filters=");
  });

  it("reads a Bioguide-shaped query as an exact id, in either case", () => {
    const a = memberSearchPath({ q: "a000055" });
    expect(a.mode).toBe("bioguide");
    expect(a.path).toContain("id=eq.A000055");
    expect(a.path).not.toContain("search_vector");
  });

  it("searches words with prefix terms on the full-text index", () => {
    const { path, mode } = memberSearchPath({ q: "Sanders Bernie" });
    expect(mode).toBe("words");
    expect(dec(path)).toContain("search_vector=fts(simple).sanders:*&bernie:*");
  });

  it("matches a name exactly after case and spacing only", () => {
    expect(nameKey("  Aderholt,   Robert B. ")).toBe("aderholt, robert b.");
    expect(nameKey("Aderholt, Robert B.")).not.toBe(nameKey("Aderholt, Robert"));
    const p = dec(
      memberExactPath("Robert  B. Aderholt", { status: "current", state: "AL", chamber: "house" }),
    );
    expect(p).toContain('"name":["robert b. aderholt"]');
    expect(p).toContain('"current":["yes"]');
    expect(p).toContain('"state":["AL"]');
    expect(dec(memberExactPath("x", { state: "Alabama" }))).not.toContain('"state"');
  });

  it("reads the current delegation by the represents key", () => {
    expect(dec(delegationPath("CA"))).toContain('{"represents":["CA"]}');
  });

  it("builds the sponsor, id-list and membership-existence reads from exact ids", () => {
    expect(dec(sponsoredPath("A000055"))).toContain('{"sponsor":["A000055"]}');
    expect(dec(sponsoredPath("A000055", "118"))).toContain('"congress":["118"]');
    expect(dec(sponsoredPath("A000055", "7"))).not.toContain('"congress"');
    expect(billsByIdPath(["118-hr-1", "118-s-2"])).toContain("id=in.(118-hr-1,118-s-2)");
    expect(knownMembersPath(["A000055", "B000001"])).toContain("id=in.(A000055,B000001)");
  });
});

describe("delegation grouping", () => {
  const mk = (
    id: string,
    name: string,
    chamber: string,
    district: string | null,
    memberType: string,
  ): MemberHit => ({
    id,
    name,
    displayName: null,
    party: null,
    partyAbbreviation: null,
    state: "X",
    stateCode: "CA",
    district,
    chamber,
    memberType,
    years: null,
    current: true,
    congresses: null,
    sponsoredReported: null,
    cosponsoredReported: null,
  });
  it("orders senators by name, representatives by district and sets delegates apart", () => {
    const g = groupDelegation([
      mk("A000001", "Padilla, Alex", "Senate", null, "Senator"),
      mk("B000001", "Boyle, B.", "House of Representatives", "10", "Representative"),
      mk("C000001", "Calvert, C.", "House of Representatives", "2", "Representative"),
      mk("D000001", "Brown, D.", "Senate", null, "Senator"),
      mk("E000001", "Norton, E.", "House of Representatives", "At large", "Delegate"),
      mk("F000001", "Zeta, F.", "House of Representatives", "At large", "Representative"),
    ]);
    expect(g.senators.map((m) => m.id)).toEqual(["D000001", "A000001"]);
    expect(g.representatives.map((m) => m.id)).toEqual(["F000001", "C000001", "B000001"]);
    expect(g.delegates.map((m) => m.id)).toEqual(["E000001"]);
  });
});

const memberRaw = (over: Record<string, unknown> = {}) => ({
  bioguideId: "A000055",
  names: {
    inverted: "Aderholt, Robert B.",
    direct: "Robert B. Aderholt",
    honorific: "Mr.",
    previous: [{ inverted: "Aderholt, Robert B.", from: "1997-01-03", to: "2024-02-27" }],
  },
  birthYear: 1965,
  deathYear: null,
  current: true,
  state: "Alabama",
  stateCode: "AL",
  district: 4,
  chamber: "House of Representatives",
  memberType: "Representative",
  years: "1997–present",
  terms: [
    {
      congress: 118,
      chamber: "House of Representatives",
      memberType: "Representative",
      stateCode: "AL",
      stateName: "Alabama",
      district: 4,
      startYear: 2023,
      endYear: 2025,
    },
    {
      congress: 119,
      chamber: "House of Representatives",
      memberType: "Representative",
      stateCode: "AL",
      stateName: "Alabama",
      district: 4,
      startYear: 2025,
    },
  ],
  partyHistory: [{ party: "Republican", abbreviation: "R", startYear: 1997 }],
  leadership: [{ type: "Chair", congress: 118, current: false }],
  officialWebsite: "https://aderholt.house.gov/",
  portrait: {
    imageUrl: "https://www.congress.gov/img/member/a000055_200.jpg",
    attribution: {
      raw: "Image courtesy of the Member",
      text: "Image courtesy of the Member",
      url: null,
    },
  },
  legislation: { sponsored: 104, cosponsored: 2311, retrieved: "2026-10-23" },
  bills: {
    coverage: "108th-119th Congress",
    billsRetrieved: "2026-10-23",
    sponsoredByCongress: { "118": 12, "119": 3, "99": 4, x: 1 },
    cosponsoredByCongress: { "118": 400 },
    sponsoredTotal: 15,
    cosponsoredTotal: 400,
    cosponsorshipsWithdrawn: 1,
    congressesServedInCollection: [108, 118, 119, 5],
    servedOnlyInCollection: false,
  },
  source: {
    api: "https://api.congress.gov/v3/member/A000055",
    bioguide: "https://bioguide.congress.gov/search/bio/A000055",
    updateDate: "2026-10-22T07:40:21Z",
    retrievedAt: "2026-10-23T07:41:00Z",
    detailFetched: true,
  },
  ...over,
});

describe("parseMember", () => {
  it("reads a stored member and keeps absent values null", () => {
    const m = parseMember("A000055", memberRaw())!;
    expect(m.name).toBe("Aderholt, Robert B.");
    expect(m.terms[1]).toMatchObject({ congress: 119, startYear: 2025, endYear: null });
    expect(m.partyHistory).toEqual([
      { party: "Republican", abbreviation: "R", startYear: 1997, listOnly: false },
    ]);
    expect(m.deathYear).toBeNull();
    expect(m.reported).toEqual({ sponsored: 104, cosponsored: 2311, retrieved: "2026-10-23" });
    expect(m.source.updateDate).toBe("2026-10-22");
    expect(m.previousNames[0]).toEqual({
      name: "Aderholt, Robert B.",
      from: "1997-01-03",
      to: "2024-02-27",
    });
  });

  it("drops counts for a Congress outside 108-119 or a non-numeric key", () => {
    const m = parseMember("A000055", memberRaw())!;
    expect(m.bills!.sponsoredByCongress).toEqual({ "118": 12, "119": 3 });
    expect(m.bills!.congressesServed).toEqual([108, 118, 119]);
  });

  it("refuses a record whose stored id differs from the requested one", () => {
    expect(parseMember("B000001", memberRaw())).toBeNull();
    expect(parseMember("a000055", memberRaw())).toBeNull();
    expect(parseMember("A000055", null)).toBeNull();
    expect(parseMember("A000055", memberRaw({ names: {} }))).toBeNull();
  });

  it("shows a portrait only from the Congress.gov image host and a website only over http(s)", () => {
    expect(
      parseMember("A000055", memberRaw({ portrait: { imageUrl: "https://evil.example/p.jpg" } }))!
        .portrait,
    ).toBeNull();
    expect(
      parseMember("A000055", memberRaw({ portrait: { imageUrl: "javascript:alert(1)" } }))!
        .portrait,
    ).toBeNull();
    expect(
      parseMember("A000055", memberRaw({ officialWebsite: "javascript:alert(1)" }))!.website,
    ).toBeNull();
    expect(parseMember("A000055", memberRaw())!.portrait!.creditText).toBe(
      "Image courtesy of the Member",
    );
  });

  it("marks a party that only the member list gave", () => {
    const m = parseMember(
      "A000055",
      memberRaw({ partyHistory: [{ party: "Republican", listOnly: true }] }),
    )!;
    expect(m.partyHistory[0]!.listOnly).toBe(true);
    expect(m.partyHistory[0]!.startYear).toBeNull();
  });
});

describe("parseCosponsored", () => {
  const raw = {
    bioguideId: "A000055",
    byCongress: {
      "118": { hr: [10, 3935], s: [7], zz: [1], sres: [0, 100000, "x", 5] },
      "119": { hr: [2] },
      "99": { hr: [1] },
    },
  };
  it("lists newest Congress first, then type, then number descending, dropping invalid numbers", () => {
    const list = parseCosponsored(raw, "A000055")!;
    expect(list.map(billId)).toEqual([
      "119-hr-2",
      "118-hr-3935",
      "118-hr-10",
      "118-s-7",
      "118-sres-5",
    ]);
  });
  it("refuses a list that belongs to another member", () => {
    expect(parseCosponsored(raw, "B000001")).toBeNull();
    expect(parseCosponsored(null, "A000055")).toBeNull();
  });
});

describe("congressRuns and districtText", () => {
  it("writes consecutive Congresses as a range and gaps as separate runs", () => {
    expect(congressRuns([117, 118, 119])).toBe("117th–119th");
    expect(congressRuns([119, 117])).toBe("117th, 119th");
    expect(congressRuns([101, 102, 103, 105])).toBe("101st–103rd, 105th");
    expect(congressRuns([])).toBeNull();
  });
  it("reads district 0 as at large and shows no district for a senator", () => {
    expect(districtText(0, "House of Representatives")).toBe("At large");
    expect(districtText(4, "House of Representatives")).toBe("District 4");
    expect(districtText(4, "Senate")).toBeNull();
    expect(districtText(null, "House of Representatives")).toBeNull();
  });
});

const committeeHitRow = (over: Record<string, unknown> = {}, id = "hspw05") => ({
  id,
  title: "Aviation Subcommittee",
  source_url: "https://api.congress.gov/v3/committee/house/hspw05",
  c: {
    system_code: id,
    name: "Aviation Subcommittee",
    chamber: "House",
    type: "Standing",
    level: "subcommittee",
    current: "yes",
    parent_code: "hspw00",
    parent_name: "Transportation and Infrastructure Committee",
    subcommittees: 0,
    congresses: "117th–119th",
    ...over,
  },
});

describe("committees", () => {
  it("reads a list row; the level comes from the stored cell, not from the code", () => {
    const h = parseCommitteeHit(committeeHitRow())!;
    expect(h).toMatchObject({
      id: "hspw05",
      isSubcommittee: true,
      parentCode: "hspw00",
      current: true,
      congresses: "117th–119th",
    });
    const old = parseCommitteeHit(
      committeeHitRow(
        { system_code: "n2005025889", level: "committee", parent_code: null },
        "n2005025889",
      ),
    )!;
    expect(old.id).toBe("n2005025889"); // an authority-style id is kept whole, never cut short
    expect(old.isSubcommittee).toBe(false);
    expect(old.parentCode).toBeNull();
  });

  it("rejects a bad id or a cell code that differs from the id", () => {
    expect(parseCommitteeHit(committeeHitRow({}, "../x"))).toBeNull();
    expect(parseCommitteeHit(committeeHitRow({ system_code: "hspw00" }))).toBeNull();
  });

  it("builds search paths: exact system code, words, filters", () => {
    const c = committeeSearchPath({ q: "HSPW05" });
    expect(c.mode).toBe("code");
    expect(c.path).toContain("id=eq.hspw05");
    const w = committeeSearchPath({
      q: "judiciary",
      chamber: "senate",
      level: "subcommittee",
      status: "current",
      type: "Standing",
      congress: "118",
    });
    expect(w.mode).toBe("words");
    expect(dec(w.path)).toContain("fts(simple).judiciary:*");
    expect(dec(w.path)).toContain('"chamber":["senate"]');
    expect(dec(w.path)).toContain('"level":["subcommittee"]');
    expect(dec(w.path)).toContain('"current":["yes"]');
    expect(
      dec(committeeSearchPath({ chamber: "x", level: "y", congress: "999" }).path),
    ).not.toContain("filters=");
    expect(dec(committeeExactPath("Judiciary  Committee", { chamber: "house" }))).toContain(
      '"name":["judiciary committee"]',
    );
  });

  const raw = (over: Record<string, unknown> = {}) => ({
    systemCode: "hspw00",
    name: "Transportation and Infrastructure Committee",
    chamber: "House",
    type: "Standing",
    level: "committee",
    current: true,
    website: "https://transportation.house.gov/",
    parent: null,
    subcommittees: [
      { systemCode: "hspw05", name: "Aviation Subcommittee", listed: true },
      { systemCode: "../etc", name: "x" },
    ],
    congresses: [117, 118, 119],
    history: [
      { officialName: "Committee on Transportation and Infrastructure", startDate: "1995-01-04" },
    ],
    counts: { reports: 1373, bills: 0 },
    source: {
      api: "https://api.congress.gov/v3/committee/house/hspw00",
      updateDate: "2026-01-01T00:00:00Z",
      detailFetched: true,
    },
    ...over,
  });

  it("reads a committee, dropping subcommittee links whose code is malformed and keeping a published zero", () => {
    const c = parseCommittee("hspw00", raw())!;
    expect(c.subcommittees).toEqual([
      { code: "hspw05", name: "Aviation Subcommittee", listed: true },
    ]);
    expect(c.counts).toEqual({ reports: 1373, bills: 0, communications: null, nominations: null });
    expect(c.history[0]).toMatchObject({
      officialName: "Committee on Transportation and Infrastructure",
      endDate: null,
    });
    expect(c.level).toBe("committee");
  });

  it("reads a committee whose id is an authority-style number in full", () => {
    const c = parseCommittee(
      "n79043123",
      raw({ systemCode: "n79043123", name: "Mines and Mining" }),
    )!;
    expect(c.id).toBe("n79043123");
    const k = parseCommittee(
      "n2005025889",
      raw({
        systemCode: "n2005025889",
        parent: { systemCode: "no94026591", name: "P", listed: true },
      }),
    )!;
    expect(k.id).toBe("n2005025889");
    expect(k.parent).toEqual({ code: "no94026591", name: "P", listed: true });
  });

  it("refuses a record that names another code", () => {
    expect(parseCommittee("hspw05", raw())).toBeNull();
    expect(parseCommittee("hspw00", raw({ name: null }))).toBeNull();
  });
});
