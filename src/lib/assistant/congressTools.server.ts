/**
 * Assistant tools over the members-of-Congress and committee collections (congress_members, congress_committees; the
 * Congress.gov API, Library of Congress): look up a member by Bioguide ID or by published name, and a committee by system code
 * or by published name. A name is matched exactly first (case and spacing only), then by words; more than one match is reported
 * as ambiguous and never resolved by guessing. Read-only corpus reads through the same server functions as the pages; results
 * are bounded and carry the in-app page and the official source to cite. Committee membership is not published by the API, and
 * the tools say so instead of answering from anywhere else.
 */
import {
  readCommittee,
  readCommitteesByExactName,
  readMember,
  readMembersByExactName,
  runCommitteeSearch,
  runMemberSearch,
} from "@/lib/external/congressMembers.functions";
import {
  BIOGUIDE,
  COMMITTEE_CODE,
  USPS,
  committeePage,
  congressRuns,
  districtText,
  memberPage,
  type Committee,
  type CommitteeHit,
  type Member,
  type MemberHit,
} from "@/lib/external/congressMembers";
import { ordinal } from "@/lib/external/legislation";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 14000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
const STATUS = ["current", "former", "all"] as const;
const status = (v: unknown) =>
  (STATUS as readonly string[]).includes(str(v, 10))
    ? (str(v, 10) as (typeof STATUS)[number])
    : "all";

const MEMBERSHIP_NOTE =
  "The Congress.gov API publishes no committee membership; this tool cannot say who sits on a committee and nothing should be inferred.";

export const CONGRESS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "lookup_member",
    description:
      "Look up a member of Congress (current and historical, from the Congress.gov API) by Bioguide ID (e.g. 'A000055') or by published name (last-name-first 'Aderholt, Robert B.' or first-name-first 'Robert B. Aderholt'; a surname alone is searched by words). A name that equals one member's published name returns that member in full: name, years of service, terms by Congress (chamber, state, district), party history as published, birth and death year, official website, the sponsored and cosponsored counts Congress.gov reports (with the date retrieved) and the counts held in the stored bill records (108th-119th Congress), and the member page to cite. More than one match is returned as a list and flagged ambiguous; nothing is guessed. Filter by state (two-letter code), chamber and status (current, former, all). To read the bills themselves use search_bills; committee membership is not published by the source.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: {
          type: "string",
          description: "Bioguide ID: one capital letter and six digits.",
        },
        name: {
          type: "string",
          description: "A published name, or words from one (up to 200 characters).",
        },
        state: { type: "string", description: "Two-letter state or territory code." },
        chamber: { type: "string", enum: ["senate", "house"] },
        status: { type: "string", enum: [...STATUS], description: "Default all." },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "lookup_committee",
    description:
      "Look up a congressional committee or subcommittee (House, Senate and joint; current and historical, from the Congress.gov API) by system code (e.g. 'hsju00', 'ssfi00') or by published name ('Judiciary Committee'; words are searched when no name matches exactly). A match on one committee returns it in full: chamber, type, current or historical, parent and subcommittees, official website, name history with dates and establishing authority, the Congresses whose committee lists name it, the counts of reports, bills, communications and nominations the API reports, and the committee page to cite. More than one match is returned as a list and flagged ambiguous. Committee membership is not published by the source and is never returned.",
    input_schema: {
      type: "object",
      properties: {
        system_code: { type: "string", description: "Committee system code, e.g. hsju00." },
        name: { type: "string", description: "A published committee name, or words from one." },
        chamber: { type: "string", enum: ["house", "senate", "joint"] },
        level: { type: "string", enum: ["committee", "subcommittee"] },
        status: { type: "string", enum: [...STATUS], description: "Default all." },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
];

const memberRow = (h: MemberHit) => ({
  bioguide_id: h.id,
  name: h.name,
  name_first_name_first: h.displayName,
  party_latest: h.party,
  state: h.state,
  district: h.district,
  chamber: h.chamber,
  member_type: h.memberType,
  years: h.years,
  current: h.current,
  page: memberPage(h.id),
});

function termLine(t: Member["terms"][number]): string {
  return [
    t.congress ? `${ordinal(t.congress)} Congress` : "Congress not recorded",
    t.memberType ?? t.chamber,
    t.stateName,
    districtText(t.district, t.chamber),
    t.startYear ? `${t.startYear}–${t.endYear ?? ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function memberDetail(m: Member) {
  return {
    bioguide_id: m.id,
    name_published: m.name,
    name_first_name_first: m.directName,
    current_member: m.current,
    years: m.years,
    birth_year: m.birthYear,
    death_year: m.deathYear,
    state_latest_term: m.state,
    chamber_latest_term: m.chamber,
    member_type_latest_term: m.memberType,
    district_latest_term: districtText(m.district, m.chamber),
    party_history_as_published: m.partyHistory.map((p) => ({
      party: p.party,
      from_year: p.startYear,
    })),
    party_note: "Congress.gov gives the year each party began, not when an earlier one ended.",
    terms: m.terms.slice(-60).map(termLine),
    leadership_posts: m.leadership.map((l) => ({
      post: l.type,
      congress: l.congress,
      current: l.current,
    })),
    official_website: m.website,
    congress_gov_counts: {
      sponsored: m.reported.sponsored,
      cosponsored: m.reported.cosponsored,
      retrieved: m.reported.retrieved,
      scope: "all Congresses in Congress.gov's data; cosponsored excludes withdrawn cosponsorships",
    },
    stored_bill_records: m.bills
      ? {
          coverage: m.bills.coverage,
          sponsored_first_listed_sponsor: m.bills.sponsoredTotal,
          cosponsored_not_withdrawn: m.bills.cosponsoredTotal,
          sponsored_by_congress: m.bills.sponsoredByCongress,
          cosponsored_by_congress: m.bills.cosponsoredByCongress,
          served_only_within_coverage: m.bills.servedOnlyInCollection,
          taken: m.bills.retrieved,
        }
      : null,
    committee_membership: MEMBERSHIP_NOTE,
    page: memberPage(m.id),
    official_sources: [m.source.bioguide, m.source.api].filter(Boolean),
    detail_record_stored: m.source.detailFetched,
  };
}

async function lookupMemberTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const id = str(input["bioguide_id"], 12).trim().toUpperCase();
  const name = str(input["name"], 200).trim();
  const stateIn = str(input["state"], 2).toUpperCase();
  const chamberIn = str(input["chamber"], 10);
  const f: { status: (typeof STATUS)[number]; state?: string; chamber?: "senate" | "house" } = {
    status: status(input["status"]),
  };
  if (USPS.test(stateIn)) f.state = stateIn;
  if (chamberIn === "senate" || chamberIn === "house") f.chamber = chamberIn;
  if (id) {
    if (!BIOGUIDE.test(id))
      throw new Error("a Bioguide ID is one capital letter and six digits, such as A000055");
    const m = await readMember(id);
    if (!m)
      return {
        content: JSON.stringify({
          found: false,
          bioguide_id: id,
          note: "No member with this Bioguide ID is stored.",
        }),
        sources: [],
        label: "Looked up a member of Congress",
        detail: `${id} · not found`,
      };
    return memberOutcome(m, "exact Bioguide ID");
  }
  if (!name) throw new Error("give a name or a bioguide_id");
  // an exact published name first; words only when no name matches exactly
  let hits = await readMembersByExactName(name, f);
  let match: "exact name" | "words" = "exact name";
  let total: number | null = hits.length;
  if (!hits.length) {
    const r = await runMemberSearch({ q: name, page: int(input["page"], 1, 20, 1), ...f });
    hits = r.rows;
    total = r.total;
    match = "words";
  }
  if (!hits.length)
    return {
      content: JSON.stringify({
        found: false,
        match: "none",
        note: "No stored member matches. Names are matched as Congress.gov publishes them (accents are not folded); try the surname alone or a Bioguide ID.",
      }),
      sources: [],
      label: "Looked up a member of Congress",
      detail: `“${name}” · no match`,
    };
  if (hits.length === 1) {
    const m = await readMember(hits[0]!.id);
    if (m) return memberOutcome(m, match);
  }
  const rows = hits.map(memberRow);
  return {
    content: clip(
      JSON.stringify({
        found: true,
        match,
        ambiguous: rows.length > 1,
        total,
        returned: rows.length,
        note: "More than one member matches; none was chosen. Look one up by bioguide_id.",
        results: rows,
      }),
    ),
    sources: hits
      .slice(0, 6)
      .map((h) => ({ title: h.displayName ?? h.name, url: memberPage(h.id), internal: true })),
    label: "Looked up a member of Congress",
    detail: `“${name}” · ${rows.length} of ${total ?? rows.length}`,
  };
}

function memberOutcome(m: Member, match: string): ToolOutcome {
  return {
    content: clip(
      JSON.stringify({ found: true, match, ambiguous: false, member: memberDetail(m) }),
    ),
    sources: [
      { title: m.directName ?? m.name, url: memberPage(m.id), internal: true },
      ...(m.source.bioguide
        ? [
            {
              title: `Biographical Directory: ${m.directName ?? m.name}`,
              url: m.source.bioguide,
              internal: false,
            },
          ]
        : []),
    ],
    label: "Looked up a member of Congress",
    detail: `${m.directName ?? m.name} · ${m.years ?? "years not recorded"}`,
  };
}

const committeeRow = (h: CommitteeHit) => ({
  system_code: h.id,
  name: h.name,
  chamber: h.chamber,
  level: h.isSubcommittee ? "subcommittee" : "committee",
  type: h.type,
  current: h.current,
  parent: h.parentName,
  congresses: h.congresses,
  page: committeePage(h.id),
});

export function committeeDetail(c: Committee, children: CommitteeHit[]) {
  return {
    system_code: c.id,
    name: c.name,
    chamber: c.chamber,
    level: c.level,
    type: c.type,
    current: c.current,
    parent: c.parent ? { system_code: c.parent.code, name: c.parent.name } : null,
    subcommittees: c.subcommittees.map((s) => ({ system_code: s.code, name: s.name })),
    stored_subcommittee_records: children.length,
    official_website: c.website,
    congresses_that_list_it: congressRuns(c.congresses),
    name_history: c.history.slice(0, 30).map((h) => ({
      official_name: h.officialName,
      library_of_congress_name: h.shortName,
      start: h.startDate,
      end: h.endDate,
      type: h.type,
      established_by: h.establishingAuthority,
    })),
    counts_reported_by_the_api: c.counts,
    committee_membership: MEMBERSHIP_NOTE,
    page: committeePage(c.id),
    official_sources: [c.source.api, c.website].filter(Boolean),
    detail_record_stored: c.source.detailFetched,
  };
}

async function lookupCommitteeTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const code = str(input["system_code"], 14).trim().toLowerCase();
  const name = str(input["name"], 300).trim();
  const chamberIn = str(input["chamber"], 10);
  const levelIn = str(input["level"], 14);
  const f: {
    status: (typeof STATUS)[number];
    chamber?: "house" | "senate" | "joint";
    level?: "committee" | "subcommittee";
  } = { status: status(input["status"]) };
  if (chamberIn === "house" || chamberIn === "senate" || chamberIn === "joint")
    f.chamber = chamberIn;
  if (levelIn === "committee" || levelIn === "subcommittee") f.level = levelIn;
  const outcome = async (id: string, match: string): Promise<ToolOutcome | null> => {
    const r = await readCommittee(id);
    if (!r) return null;
    return {
      content: clip(
        JSON.stringify({
          found: true,
          match,
          ambiguous: false,
          committee: committeeDetail(r.committee, r.children),
        }),
      ),
      sources: [
        { title: r.committee.name, url: committeePage(r.committee.id), internal: true },
        ...(r.committee.source.api
          ? [
              {
                title: `Congress.gov: ${r.committee.name}`,
                url: r.committee.source.api,
                internal: false,
              },
            ]
          : []),
      ],
      label: "Looked up a committee",
      detail: `${r.committee.name} · ${r.committee.id}`,
    };
  };
  if (code) {
    if (!COMMITTEE_CODE.test(code))
      throw new Error(
        "a committee system code looks like hsju00 (chamber letter, three letters, two digits)",
      );
    return (
      (await outcome(code, "exact system code")) ?? {
        content: JSON.stringify({
          found: false,
          system_code: code,
          note: "No committee with this system code is stored.",
        }),
        sources: [],
        label: "Looked up a committee",
        detail: `${code} · not found`,
      }
    );
  }
  if (!name) throw new Error("give a name or a system_code");
  let hits = await readCommitteesByExactName(name, f);
  let match: "exact name" | "words" = "exact name";
  let total: number | null = hits.length;
  if (!hits.length) {
    const r = await runCommitteeSearch({ q: name, page: int(input["page"], 1, 20, 1), ...f });
    hits = r.rows;
    total = r.total;
    match = "words";
  }
  if (!hits.length)
    return {
      content: JSON.stringify({
        found: false,
        match: "none",
        note: "No stored committee matches that name.",
      }),
      sources: [],
      label: "Looked up a committee",
      detail: `“${name}” · no match`,
    };
  if (hits.length === 1) {
    const one = await outcome(hits[0]!.id, match);
    if (one) return one;
  }
  const rows = hits.map(committeeRow);
  return {
    content: clip(
      JSON.stringify({
        found: true,
        match,
        ambiguous: rows.length > 1,
        total,
        returned: rows.length,
        note: "More than one committee matches; none was chosen. Look one up by system_code.",
        results: rows,
      }),
    ),
    sources: hits
      .slice(0, 6)
      .map((h) => ({ title: h.name, url: committeePage(h.id), internal: true })),
    label: "Looked up a committee",
    detail: `“${name}” · ${rows.length} of ${total ?? rows.length}`,
  };
}

export const CONGRESS_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  lookup_member: lookupMemberTool,
  lookup_committee: lookupCommitteeTool,
};
