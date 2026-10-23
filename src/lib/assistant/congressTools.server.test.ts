import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/congressMembers.functions", () => ({
  readMember: vi.fn(),
  readMembersByExactName: vi.fn(),
  runMemberSearch: vi.fn(),
  readCommittee: vi.fn(),
  readCommitteesByExactName: vi.fn(),
  runCommitteeSearch: vi.fn(),
}));

import {
  readCommittee,
  readCommitteesByExactName,
  readMember,
  readMembersByExactName,
  runCommitteeSearch,
  runMemberSearch,
} from "@/lib/external/congressMembers.functions";
import type { CommitteeHit, MemberHit } from "@/lib/external/congressMembers";
import { parseCommittee, parseMember } from "@/lib/external/congressMembers";
import { CONGRESS_EXECUTORS, CONGRESS_TOOL_DEFINITIONS } from "./congressTools.server";

beforeEach(() => vi.clearAllMocks());

const hit = (id: string, name: string, over: Partial<MemberHit> = {}): MemberHit => ({
  id,
  name,
  displayName: null,
  party: "Republican",
  partyAbbreviation: "R",
  state: "Alabama",
  stateCode: "AL",
  district: "4",
  chamber: "House of Representatives",
  memberType: "Representative",
  years: "1997–present",
  current: true,
  congresses: 15,
  sponsoredReported: 104,
  cosponsoredReported: 2311,
  ...over,
});

const member = parseMember("A000055", {
  bioguideId: "A000055",
  names: { inverted: "Aderholt, Robert B.", direct: "Robert B. Aderholt" },
  current: true,
  state: "Alabama",
  stateCode: "AL",
  district: 4,
  chamber: "House of Representatives",
  memberType: "Representative",
  years: "1997–present",
  terms: [
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
  officialWebsite: "https://aderholt.house.gov/",
  legislation: { sponsored: 104, cosponsored: 2311, retrieved: "2026-10-23" },
  source: { bioguide: "https://bioguide.congress.gov/search/bio/A000055", detailFetched: true },
})!;

describe("congress assistant tools", () => {
  it("defines exactly the executors it declares and names no vendor or model", () => {
    expect(CONGRESS_TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(
      Object.keys(CONGRESS_EXECUTORS).sort(),
    );
    const text = CONGRESS_TOOL_DEFINITIONS.map((t) => t.description)
      .join(" ")
      .toLowerCase();
    for (const bad of ["claude", "anthropic", "openai", "gpt", "tavily", "firecrawl"])
      expect(text).not.toContain(bad);
  });

  it("reads a member by Bioguide ID with the page and official sources to cite", async () => {
    vi.mocked(readMember).mockResolvedValueOnce(member);
    const out = await CONGRESS_EXECUTORS["lookup_member"]!({ bioguide_id: "a000055" });
    expect(vi.mocked(readMember).mock.calls[0]![0]).toBe("A000055");
    const body = JSON.parse(out.content);
    expect(body.member).toMatchObject({
      bioguide_id: "A000055",
      name_published: "Aderholt, Robert B.",
      district_latest_term: "District 4",
      party_history_as_published: [{ party: "Republican", from_year: 1997 }],
      page: "/law/legislation/members/A000055",
    });
    expect(body.member.congress_gov_counts).toMatchObject({
      sponsored: 104,
      cosponsored: 2311,
      retrieved: "2026-10-23",
    });
    expect(body.member.committee_membership).toContain("publishes no committee membership");
    expect(out.sources.map((s) => s.url)).toEqual([
      "/law/legislation/members/A000055",
      "https://bioguide.congress.gov/search/bio/A000055",
    ]);
  });

  it("rejects a malformed Bioguide ID and requires a name or an id", async () => {
    await expect(CONGRESS_EXECUTORS["lookup_member"]!({ bioguide_id: "../x" })).rejects.toThrow();
    await expect(CONGRESS_EXECUTORS["lookup_member"]!({})).rejects.toThrow();
  });

  it("returns an exact published name in full and never falls back to words after an exact match", async () => {
    vi.mocked(readMembersByExactName).mockResolvedValueOnce([
      hit("A000055", "Aderholt, Robert B."),
    ]);
    vi.mocked(readMember).mockResolvedValueOnce(member);
    const out = await CONGRESS_EXECUTORS["lookup_member"]!({
      name: "Robert B. Aderholt",
      status: "current",
      state: "al",
      chamber: "house",
    });
    expect(vi.mocked(readMembersByExactName).mock.calls[0]).toEqual([
      "Robert B. Aderholt",
      { status: "current", state: "AL", chamber: "house" },
    ]);
    expect(runMemberSearch).not.toHaveBeenCalled();
    expect(JSON.parse(out.content)).toMatchObject({
      found: true,
      match: "exact name",
      ambiguous: false,
    });
  });

  it("falls back to words when no name matches exactly and flags several matches as ambiguous without choosing", async () => {
    vi.mocked(readMembersByExactName).mockResolvedValueOnce([]);
    vi.mocked(runMemberSearch).mockResolvedValueOnce({
      mode: "words",
      rows: [
        hit("S000001", "Smith, Adam", { stateCode: "WA" }),
        hit("S000002", "Smith, Adrian", { stateCode: "NE" }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
      dropped: 0,
    });
    const out = await CONGRESS_EXECUTORS["lookup_member"]!({ name: "Smith" });
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({ found: true, match: "words", ambiguous: true, total: 2 });
    expect(body.results.map((r: { bioguide_id: string }) => r.bioguide_id)).toEqual([
      "S000001",
      "S000002",
    ]);
    expect(readMember).not.toHaveBeenCalled();
    expect(out.sources.map((s) => s.url)).toEqual([
      "/law/legislation/members/S000001",
      "/law/legislation/members/S000002",
    ]);
  });

  it("says when nothing matches instead of guessing", async () => {
    vi.mocked(readMembersByExactName).mockResolvedValueOnce([]);
    vi.mocked(runMemberSearch).mockResolvedValueOnce({
      mode: "words",
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
      dropped: 0,
    });
    const out = await CONGRESS_EXECUTORS["lookup_member"]!({ name: "Nobody Atall" });
    expect(JSON.parse(out.content)).toMatchObject({ found: false, match: "none" });
    expect(out.sources).toEqual([]);
  });

  const committee = parseCommittee("hspw00", {
    systemCode: "hspw00",
    name: "Transportation and Infrastructure Committee",
    chamber: "House",
    type: "Standing",
    level: "committee",
    current: true,
    website: "https://transportation.house.gov/",
    subcommittees: [{ systemCode: "hspw05", name: "Aviation Subcommittee", listed: true }],
    congresses: [117, 118, 119],
    history: [
      { officialName: "Committee on Transportation and Infrastructure", startDate: "1995-01-04" },
    ],
    counts: { reports: 1373 },
    source: { api: "https://api.congress.gov/v3/committee/house/hspw00", detailFetched: true },
  })!;

  it("reads a committee by system code and states that membership is not published", async () => {
    vi.mocked(readCommittee).mockResolvedValueOnce({ committee, children: [] });
    const out = await CONGRESS_EXECUTORS["lookup_committee"]!({ system_code: "HSPW00" });
    expect(vi.mocked(readCommittee).mock.calls[0]![0]).toBe("hspw00");
    const body = JSON.parse(out.content);
    expect(body.committee).toMatchObject({
      system_code: "hspw00",
      congresses_that_list_it: "117th–119th",
      page: "/law/legislation/committees/hspw00",
    });
    expect(body.committee.committee_membership).toContain("publishes no committee membership");
    await expect(
      CONGRESS_EXECUTORS["lookup_committee"]!({ system_code: "../x" }),
    ).rejects.toThrow();
    await expect(CONGRESS_EXECUTORS["lookup_committee"]!({})).rejects.toThrow();
  });

  it("matches a committee name exactly first, then by words, and flags several as ambiguous", async () => {
    const h = (id: string, name: string): CommitteeHit => ({
      id,
      name,
      chamber: "House",
      type: "Standing",
      current: true,
      parentCode: null,
      parentName: null,
      subcommittees: null,
      congresses: "119th",
      isSubcommittee: false,
    });
    vi.mocked(readCommitteesByExactName).mockResolvedValueOnce([]);
    vi.mocked(runCommitteeSearch).mockResolvedValueOnce({
      mode: "words",
      rows: [h("hsju00", "Judiciary Committee"), h("ssju00", "Judiciary Committee")],
      total: 2,
      page: 1,
      pageSize: 25,
      dropped: 0,
    });
    const out = await CONGRESS_EXECUTORS["lookup_committee"]!({
      name: "Judiciary",
      level: "committee",
    });
    expect(vi.mocked(runCommitteeSearch).mock.calls[0]![0]).toMatchObject({
      q: "Judiciary",
      level: "committee",
      status: "all",
    });
    expect(JSON.parse(out.content)).toMatchObject({ ambiguous: true, total: 2 });
    expect(readCommittee).not.toHaveBeenCalled();
  });
});
