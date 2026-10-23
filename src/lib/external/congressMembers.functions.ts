/**
 * Members and committees server functions (read-only corpus reads through restGet): search and read congress_members and
 * congress_committees, a member's sponsored and cosponsored measures from congress_bills, a state's current delegation and
 * the bioguide ids that have a member page. Exact keys use the GIN-indexed record filters; words use the full-text index;
 * nothing scans record text in the app.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BIOGUIDE,
  COMMITTEE_CODE,
  COMMITTEE_DATASET,
  MEMBER_CHAMBERS,
  MEMBER_DATASET,
  MEMBER_STATUS,
  PARTY_PATTERN,
  USPS,
  billId,
  billsByIdPath,
  committeeExactPath,
  committeeSearchPath,
  delegationPath,
  groupDelegation,
  knownMembersPath,
  memberExactPath,
  memberSearchPath,
  parseCommittee,
  parseCommitteeHit,
  parseCosponsored,
  parseMember,
  parseMemberHit,
  sponsoredPath,
  type BillRef,
  type Committee,
  type CommitteeHit,
  type Member,
  type MemberHit,
} from "./congressMembers";
import {
  CONGRESS,
  obj,
  parseFacetOptions,
  parseFederalHit,
  str,
  type FacetOption,
  type FederalHit,
} from "./legislation";
import { restGet } from "./rest.server";

export const MEMBER_PAGE_SIZE = 25;
const MAX_PAGE = 200;

/* ---------- members ---------- */

const searchInput = z.object({
  q: z.string().max(200).default(""),
  status: z.enum(MEMBER_STATUS).default("current"),
  chamber: z.enum(MEMBER_CHAMBERS).optional(),
  state: z.string().regex(USPS).optional(),
  party: z.string().regex(PARTY_PATTERN).optional(),
  congress: z
    .string()
    .regex(/^(6[89]|[7-9]\d|1[01]\d)$/)
    .optional(),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});
export type MemberSearchInput = z.input<typeof searchInput>;
export type MemberSearchResult = {
  mode: string;
  rows: MemberHit[];
  total: number | null;
  page: number;
  pageSize: number;
  dropped: number;
};

export async function runMemberSearch(input: MemberSearchInput): Promise<MemberSearchResult> {
  const d = searchInput.parse(input);
  const { path, mode } = memberSearchPath(d);
  const start = (d.page - 1) * MEMBER_PAGE_SIZE;
  const r = await restGet<unknown[]>(path, {
    count: true,
    range: [start, start + MEMBER_PAGE_SIZE - 1],
  });
  const rows = r.rows.map(parseMemberHit).filter((x): x is MemberHit => !!x);
  return {
    mode,
    rows,
    total: r.total,
    page: d.page,
    pageSize: MEMBER_PAGE_SIZE,
    dropped: r.rows.length - rows.length,
  };
}

/** Members whose published name (either order) equals `name` after case and whitespace normalisation; never fuzzy. */
export async function readMembersByExactName(
  name: string,
  f: Pick<MemberSearchInput, "status" | "chamber" | "state"> = {},
): Promise<MemberHit[]> {
  const d = searchInput
    .pick({ status: true, chamber: true, state: true })
    .parse({ status: "all", ...f });
  const r = await restGet<unknown[]>(memberExactPath(name.slice(0, 200), d));
  return r.rows.map(parseMemberHit).filter((x): x is MemberHit => !!x);
}

export const searchMembers = createServerFn({ method: "GET" })
  .inputValidator((d: MemberSearchInput) => searchInput.parse(d))
  .handler(async ({ data }): Promise<MemberSearchResult> => runMemberSearch(data));

export type MemberFacets = {
  ready: boolean | null;
  records: number | null;
  states: FacetOption[];
  parties: FacetOption[];
  congresses: FacetOption[];
  retrieved: string | null;
} | null;

/** Filter options and counts from the dataset's catalog listing (null when the dataset is not published). */
export const getMemberFacets = createServerFn({ method: "GET" }).handler(
  async (): Promise<MemberFacets> => {
    const r = await restGet<
      { ready: unknown; imported_records: unknown; listing: unknown; summary: unknown }[]
    >(
      `corpus_datasets?select=ready,imported_records,listing:metadata->listing,summary:metadata->summary&id=eq.${MEMBER_DATASET}&limit=1`,
    );
    const d = r.rows[0];
    if (!d) return null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      ready: typeof d.ready === "boolean" ? d.ready : null,
      records: n(d.imported_records),
      states: parseFacetOptions(d.listing, "state"),
      parties: parseFacetOptions(d.listing, "party"),
      congresses: parseFacetOptions(d.listing, "congress"),
      retrieved: str(obj(d.summary)?.["retrieved"], 20),
    };
  },
);

const memberInput = z.object({ bioguide: z.string().regex(BIOGUIDE) });

export async function readMember(bioguide: string): Promise<Member | null> {
  const r = await restGet<{ id: unknown; m: unknown }[]>(
    `corpus_records?select=id,m:detail->member&dataset=eq.${MEMBER_DATASET}&id=eq.${encodeURIComponent(bioguide)}&limit=2`,
  );
  if (r.rows.length !== 1) return null;
  return parseMember(bioguide, r.rows[0]!.m);
}

export const getMember = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof memberInput>) => memberInput.parse(d))
  .handler(async ({ data }): Promise<Member | null> => readMember(data.bioguide));

const billsInput = z.object({
  bioguide: z.string().regex(BIOGUIDE),
  congress: z.string().regex(CONGRESS).optional(),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});
export type MemberBillsInput = z.input<typeof billsInput>;
export type MemberBillsResult = {
  /** Stored measures in page order. */
  rows: FederalHit[];
  /** Cosponsored references with no stored bill record (listed by citation only; never linked). */
  missing: BillRef[];
  total: number | null;
  page: number;
  pageSize: number;
  dropped: number;
};

/** Measures this member sponsored (first-listed sponsor), newest Congress first, read by the indexed sponsor key. */
export async function readSponsored(input: MemberBillsInput): Promise<MemberBillsResult> {
  const d = billsInput.parse(input);
  const start = (d.page - 1) * MEMBER_PAGE_SIZE;
  const r = await restGet<unknown[]>(sponsoredPath(d.bioguide, d.congress), {
    count: true,
    range: [start, start + MEMBER_PAGE_SIZE - 1],
  });
  const rows = r.rows.map(parseFederalHit).filter((x): x is FederalHit => !!x);
  return {
    rows,
    missing: [],
    total: r.total,
    page: d.page,
    pageSize: MEMBER_PAGE_SIZE,
    dropped: r.rows.length - rows.length,
  };
}

export const getMemberSponsored = createServerFn({ method: "GET" })
  .inputValidator((d: MemberBillsInput) => billsInput.parse(d))
  .handler(async ({ data }): Promise<MemberBillsResult> => readSponsored(data));

/**
 * Measures this member cosponsored. The member record holds the list (numbers per Congress and type, from the stored bill
 * records); one page of it is resolved to bill records by exact id. A reference whose bill is not stored is returned in
 * `missing` and is never linked or replaced by another bill.
 */
export async function readCosponsored(input: MemberBillsInput): Promise<MemberBillsResult | null> {
  const d = billsInput.parse(input);
  const r = await restGet<{ id: unknown; c: unknown }[]>(
    `corpus_records?select=id,c:detail->cosponsored&dataset=eq.${MEMBER_DATASET}&id=eq.${encodeURIComponent(d.bioguide)}&limit=2`,
  );
  if (r.rows.length !== 1) return null;
  const all = parseCosponsored(r.rows[0]!.c, d.bioguide);
  if (!all) return null;
  const refs = d.congress ? all.filter((x) => String(x.congress) === d.congress) : all;
  const start = (d.page - 1) * MEMBER_PAGE_SIZE;
  const slice = refs.slice(start, start + MEMBER_PAGE_SIZE);
  let rows: FederalHit[] = [];
  let dropped = 0;
  if (slice.length) {
    const found = await restGet<unknown[]>(billsByIdPath(slice.map(billId)), {});
    const hits = new Map<string, FederalHit>();
    for (const raw of found.rows) {
      const h = parseFederalHit(raw);
      if (h) hits.set(h.id, h);
      else dropped += 1;
    }
    rows = slice.map((s) => hits.get(billId(s))).filter((h): h is FederalHit => !!h);
    const missing = slice.filter((s) => !hits.has(billId(s)));
    return { rows, missing, total: refs.length, page: d.page, pageSize: MEMBER_PAGE_SIZE, dropped };
  }
  return {
    rows,
    missing: [],
    total: refs.length,
    page: d.page,
    pageSize: MEMBER_PAGE_SIZE,
    dropped,
  };
}

export const getMemberCosponsored = createServerFn({ method: "GET" })
  .inputValidator((d: MemberBillsInput) => billsInput.parse(d))
  .handler(async ({ data }): Promise<MemberBillsResult | null> => readCosponsored(data));

const idsInput = z.object({ ids: z.array(z.string().regex(BIOGUIDE)).max(600) });

/** The subset of the given bioguide ids that have a member record: the only people a bill page links. */
export async function readKnownMembers(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const known: string[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const r = await restGet<{ id: unknown }[]>(knownMembersPath(unique.slice(i, i + 200)));
    for (const row of r.rows) {
      const id = str(row.id, 10);
      if (id && BIOGUIDE.test(id)) known.push(id);
    }
  }
  return known;
}

export const getKnownMembers = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof idsInput>) => idsInput.parse(d))
  .handler(async ({ data }): Promise<string[]> => readKnownMembers(data.ids));

const delegationInput = z.object({ state: z.string().regex(USPS) });
export type StateDelegation = {
  state: string;
  senators: MemberHit[];
  representatives: MemberHit[];
  delegates: MemberHit[];
  total: number;
};

/** The members who currently represent a state or territory (the API's currentMember flag and latest term's state). */
export async function readStateDelegation(usps: string): Promise<StateDelegation> {
  const r = await restGet<unknown[]>(delegationPath(usps));
  const hits = r.rows.map(parseMemberHit).filter((x): x is MemberHit => !!x);
  return { state: usps, ...groupDelegation(hits), total: hits.length };
}

export const getStateDelegation = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof delegationInput>) => delegationInput.parse(d))
  .handler(async ({ data }): Promise<StateDelegation> => readStateDelegation(data.state));

/* ---------- committees ---------- */

const committeeSearchInput = z.object({
  q: z.string().max(200).default(""),
  chamber: z.enum(["house", "senate", "joint"]).optional(),
  type: z
    .string()
    .regex(/^[A-Za-z ]{3,40}$/)
    .optional(),
  status: z.enum(["current", "former", "all"]).default("current"),
  level: z.enum(["committee", "subcommittee"]).optional(),
  congress: z.string().regex(CONGRESS).optional(),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});
export type CommitteeSearchInput = z.input<typeof committeeSearchInput>;
export type CommitteeSearchResult = {
  mode: string;
  rows: CommitteeHit[];
  total: number | null;
  page: number;
  pageSize: number;
  dropped: number;
};

export async function runCommitteeSearch(
  input: CommitteeSearchInput,
): Promise<CommitteeSearchResult> {
  const d = committeeSearchInput.parse(input);
  const { path, mode } = committeeSearchPath(d);
  const start = (d.page - 1) * MEMBER_PAGE_SIZE;
  const r = await restGet<unknown[]>(path, {
    count: true,
    range: [start, start + MEMBER_PAGE_SIZE - 1],
  });
  const rows = r.rows.map(parseCommitteeHit).filter((x): x is CommitteeHit => !!x);
  return {
    mode,
    rows,
    total: r.total,
    page: d.page,
    pageSize: MEMBER_PAGE_SIZE,
    dropped: r.rows.length - rows.length,
  };
}

/** Committees whose published name equals `name` after case and whitespace normalisation; never fuzzy. */
export async function readCommitteesByExactName(
  name: string,
  f: Pick<CommitteeSearchInput, "status" | "chamber" | "level"> = {},
): Promise<CommitteeHit[]> {
  const d = committeeSearchInput
    .pick({ status: true, chamber: true, level: true })
    .parse({ status: "all", ...f });
  const r = await restGet<unknown[]>(committeeExactPath(name.slice(0, 300), d));
  return r.rows.map(parseCommitteeHit).filter((x): x is CommitteeHit => !!x);
}

export const searchCommittees = createServerFn({ method: "GET" })
  .inputValidator((d: CommitteeSearchInput) => committeeSearchInput.parse(d))
  .handler(async ({ data }): Promise<CommitteeSearchResult> => runCommitteeSearch(data));

export type CommitteeFacets = {
  ready: boolean | null;
  records: number | null;
  types: FacetOption[];
  congresses: FacetOption[];
  retrieved: string | null;
} | null;

export const getCommitteeFacets = createServerFn({ method: "GET" }).handler(
  async (): Promise<CommitteeFacets> => {
    const r = await restGet<
      { ready: unknown; imported_records: unknown; listing: unknown; summary: unknown }[]
    >(
      `corpus_datasets?select=ready,imported_records,listing:metadata->listing,summary:metadata->summary&id=eq.${COMMITTEE_DATASET}&limit=1`,
    );
    const d = r.rows[0];
    if (!d) return null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      ready: typeof d.ready === "boolean" ? d.ready : null,
      records: n(d.imported_records),
      types: parseFacetOptions(d.listing, "type"),
      congresses: parseFacetOptions(d.listing, "congress"),
      retrieved: str(obj(d.summary)?.["retrieved"], 20),
    };
  },
);

const committeeInput = z.object({ code: z.string().regex(COMMITTEE_CODE) });
export type CommitteeResult = { committee: Committee; children: CommitteeHit[] } | null;

export async function readCommittee(code: string): Promise<CommitteeResult> {
  const [r, kids] = await Promise.all([
    restGet<{ id: unknown; c: unknown }[]>(
      `corpus_records?select=id,c:detail->committee&dataset=eq.${COMMITTEE_DATASET}&id=eq.${encodeURIComponent(code)}&limit=2`,
    ),
    // a committee's subcommittees as stored records (their cells), by the parent code the API names
    restGet<unknown[]>(
      `corpus_records?select=id,title,source_url,c:item->cells&dataset=eq.${COMMITTEE_DATASET}&filters=cs.${encodeURIComponent(JSON.stringify({ parent: [code] }))}&order=ordinal.asc&limit=100`,
    ).catch(() => null),
  ]);
  if (r.rows.length !== 1) return null;
  const committee = parseCommittee(code, r.rows[0]!.c);
  if (!committee) return null;
  return {
    committee,
    children: kids ? kids.rows.map(parseCommitteeHit).filter((x): x is CommitteeHit => !!x) : [],
  };
}

export const getCommittee = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof committeeInput>) => committeeInput.parse(d))
  .handler(async ({ data }): Promise<CommitteeResult> => readCommittee(data.code));
