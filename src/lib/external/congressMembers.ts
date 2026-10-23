/**
 * Members of Congress and congressional committees: pure parsing and query shaping for congress_members and
 * congress_committees (Congress.gov API v3, Library of Congress). Corpus values are untrusted JSON: every field is
 * type-checked, external links must be http(s), in-app links must match a known shape, and anything malformed is dropped.
 * Nothing here infers a value: a field the source omits is null and is shown as "Not recorded".
 */
import {
  BILL_TYPES,
  CONGRESS,
  arr,
  cs,
  ftsQuery,
  httpUrl,
  obj,
  ordinal,
  str,
  type BillType,
} from "./legislation";

export const MEMBER_DATASET = "congress_members";
export const COMMITTEE_DATASET = "congress_committees";
export const BIOGUIDE = /^[A-Z]\d{6}$/;
/** A committee's id: a system code (hspw00) or, for older committees, a Library of Congress authority-style id (n79043123). */
export const COMMITTEE_CODE = /^(?:[hsj][a-z0-9]{3}\d{2}|no?\d{6,10})$/;
export const USPS = /^[A-Z]{2}$/;

/** First and last Congress of the stored bill collection (congress_bills). */
export const BILL_FIRST_CONGRESS = 108;
export const BILL_LAST_CONGRESS = 119;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const s = str(v, 40);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1]! : null;
};
const year = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n >= 1700 && n <= 2200 ? n : null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const enc = encodeURIComponent;

export const memberPage = (bioguide: string) => `/law/legislation/members/${bioguide}`;
export const committeePage = (code: string) => `/law/legislation/committees/${code}`;
export const MEMBER_HREF = /^\/law\/legislation\/members\/([A-Z]\d{6})$/;

/** "At large" (the API's district 0) or "District 4"; null for a senator or when no district is recorded. */
export const districtText = (district: number | null, chamber: string | null): string | null => {
  const label = districtLabel(district, chamber);
  return label === null ? null : label === "At large" ? label : `District ${label}`;
};

/** The district as the member list shows it: "At large" or the number; null for a senator or when none is recorded. */
export const districtLabel = (district: number | null, chamber: string | null): string | null =>
  chamber !== "House of Representatives" || district === null
    ? null
    : district === 0
      ? "At large"
      : String(district);

/* ---------- list rows ---------- */

export type MemberHit = {
  id: string;
  name: string;
  displayName: string | null;
  party: string | null;
  partyAbbreviation: string | null;
  state: string | null;
  stateCode: string | null;
  district: string | null;
  chamber: string | null;
  memberType: string | null;
  years: string | null;
  current: boolean | null;
  congresses: number | null;
  sponsoredReported: number | null;
  cosponsoredReported: number | null;
};

export function parseMemberHit(row: unknown): MemberHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const id = str(r?.["id"], 10);
  if (!r || !c || !id || !BIOGUIDE.test(id)) return null;
  if (str(c["bioguide"], 10) !== id) return null;
  const name = str(c["name"], 200) ?? str(r["title"], 200);
  if (!name) return null;
  const current = c["current"] === "yes" ? true : c["current"] === "no" ? false : null;
  const stateCode = str(c["state_code"], 2);
  return {
    id,
    name,
    displayName: str(c["display_name"], 200),
    party: str(c["party"], 60),
    partyAbbreviation: str(c["party_abbreviation"], 8),
    state: str(c["state"], 60),
    stateCode: stateCode && USPS.test(stateCode) ? stateCode : null,
    district: str(c["district"], 20),
    chamber: str(c["chamber"], 40),
    memberType: str(c["member_type"], 40),
    years: str(c["years"], 30),
    current,
    congresses: int(c["congresses"]),
    sponsoredReported: int(c["sponsored_reported"]),
    cosponsoredReported: int(c["cosponsored_reported"]),
  };
}

export type MemberFilters = {
  q?: string | undefined;
  status?: string | undefined;
  chamber?: string | undefined;
  state?: string | undefined;
  party?: string | undefined;
  congress?: string | undefined;
};

export const MEMBER_STATUS = ["current", "former", "all"] as const;
export type MemberStatus = (typeof MEMBER_STATUS)[number];
export const MEMBER_CHAMBERS = ["senate", "house"] as const;
const LIST_SELECT = "select=id,title,source_url,c:item->cells";
const PARTY = /^[\p{L} .'-]{2,60}$/u;
export const PARTY_PATTERN = PARTY;

/** PostgREST path for one page of members. An id-shaped query is an exact id read; words use the full-text index. */
export function memberSearchPath(f: MemberFilters): {
  path: string;
  mode: "bioguide" | "words" | "browse";
} {
  const contain: Record<string, string[]> = {};
  if (f.status === "current") contain["current"] = ["yes"];
  else if (f.status === "former") contain["current"] = ["no"];
  if (f.chamber && (MEMBER_CHAMBERS as readonly string[]).includes(f.chamber))
    contain["chamber"] = [f.chamber];
  if (f.state && USPS.test(f.state)) contain["state"] = [f.state];
  if (f.party && PARTY.test(f.party)) contain["party"] = [f.party];
  if (f.congress && /^(6[89]|[7-9]\d|1[01]\d)$/.test(f.congress))
    contain["congress"] = [f.congress];
  const q = (f.q ?? "").trim().slice(0, 200);
  const parts = [LIST_SELECT, `dataset=eq.${MEMBER_DATASET}`];
  let mode: "bioguide" | "words" | "browse" = "browse";
  const id = q.toUpperCase();
  if (BIOGUIDE.test(id)) {
    parts.push(`id=eq.${enc(id)}`);
    mode = "bioguide";
  } else if (q) {
    const fts = ftsQuery(q);
    if (fts) {
      parts.push(`search_vector=fts(simple).${enc(fts)}`);
      mode = "words";
    }
  }
  if (Object.keys(contain).length) parts.push(`filters=cs.${cs(contain)}`);
  parts.push("order=ordinal.asc");
  return { path: `corpus_records?${parts.join("&")}`, mode };
}

/** The exact-name key stored with each record: whitespace collapsed and lower-cased, nothing else folded (never fuzzy). */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Exact match on a published name (last-name-first or first-name-first), with the same optional filters as the search. */
export function memberExactPath(
  name: string,
  f: Pick<MemberFilters, "status" | "chamber" | "state"> = {},
): string {
  const contain: Record<string, string[]> = { name: [nameKey(name)] };
  if (f.status === "current") contain["current"] = ["yes"];
  else if (f.status === "former") contain["current"] = ["no"];
  if (f.chamber && (MEMBER_CHAMBERS as readonly string[]).includes(f.chamber))
    contain["chamber"] = [f.chamber];
  if (f.state && USPS.test(f.state)) contain["state"] = [f.state];
  return `corpus_records?${LIST_SELECT}&dataset=eq.${MEMBER_DATASET}&filters=cs.${cs(contain)}&order=ordinal.asc&limit=25`;
}

/** Path for the members that represent one state or territory now (the delegation panel). */
export const delegationPath = (usps: string): string =>
  `corpus_records?${LIST_SELECT}&dataset=eq.${MEMBER_DATASET}&filters=cs.${cs({ represents: [usps] })}&order=ordinal.asc&limit=100`;

/** Senators by name, then House members by district (at large first), then delegates and resident commissioners. */
export function groupDelegation(hits: MemberHit[]): {
  senators: MemberHit[];
  representatives: MemberHit[];
  delegates: MemberHit[];
} {
  const byName = (a: MemberHit, b: MemberHit) => a.name.localeCompare(b.name, "en");
  const senators = hits.filter((h) => h.chamber === "Senate").sort(byName);
  const house = hits.filter((h) => h.chamber === "House of Representatives");
  const isDelegate = (h: MemberHit) =>
    h.memberType === "Delegate" || h.memberType === "Resident Commissioner";
  const dist = (h: MemberHit) =>
    h.district === "At large"
      ? 0
      : h.district && /^\d+$/.test(h.district)
        ? Number(h.district)
        : 9999;
  return {
    senators,
    representatives: house
      .filter((h) => !isDelegate(h))
      .sort((a, b) => dist(a) - dist(b) || byName(a, b)),
    delegates: house.filter(isDelegate).sort(byName),
  };
}

/* ---------- one member ---------- */

export type MemberTerm = {
  congress: number | null;
  chamber: string | null;
  memberType: string | null;
  stateCode: string | null;
  stateName: string | null;
  district: number | null;
  startYear: number | null;
  endYear: number | null;
};
export type PartyEntry = {
  party: string;
  abbreviation: string | null;
  startYear: number | null;
  /** Only the list's single current party name was available (no detail record). */
  listOnly: boolean;
};
export type Portrait = { imageUrl: string; creditText: string | null; creditUrl: string | null };
export type MemberBills = {
  coverage: string;
  retrieved: string | null;
  sponsoredByCongress: Record<string, number>;
  cosponsoredByCongress: Record<string, number>;
  sponsoredTotal: number;
  cosponsoredTotal: number;
  withdrawn: number;
  congressesServed: number[];
  servedOnlyInCollection: boolean;
};
export type Member = {
  id: string;
  name: string;
  directName: string | null;
  honorific: string | null;
  previousNames: { name: string; from: string | null; to: string | null }[];
  birthYear: number | null;
  deathYear: number | null;
  current: boolean | null;
  state: string | null;
  stateCode: string | null;
  district: number | null;
  chamber: string | null;
  memberType: string | null;
  years: string | null;
  terms: MemberTerm[];
  partyHistory: PartyEntry[];
  leadership: { type: string; congress: number | null; current: boolean | null }[];
  website: string | null;
  portrait: Portrait | null;
  reported: { sponsored: number | null; cosponsored: number | null; retrieved: string | null };
  bills: MemberBills | null;
  source: {
    api: string | null;
    bioguide: string | null;
    updateDate: string | null;
    retrievedAt: string | null;
    detailFetched: boolean;
  };
};

const countMap = (v: unknown): Record<string, number> => {
  const o = obj(v);
  const out: Record<string, number> = {};
  if (!o) return out;
  for (const [k, val] of Object.entries(o)) {
    const n = int(val);
    if (CONGRESS.test(k) && n !== null && n >= 0) out[k] = n;
  }
  return out;
};

export function parseMember(id: string, raw: unknown): Member | null {
  const m = obj(raw);
  if (!m || !BIOGUIDE.test(id) || str(m["bioguideId"], 10) !== id) return null;
  const names = obj(m["names"]);
  const name = str(names?.["inverted"], 200) ?? str(names?.["direct"], 200);
  if (!name) return null;
  const terms: MemberTerm[] = arr(m["terms"])
    .map((t) => obj(t))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({
      congress: int(t["congress"]),
      chamber: str(t["chamber"], 40),
      memberType: str(t["memberType"], 40),
      stateCode: (() => {
        const s = str(t["stateCode"], 2);
        return s && USPS.test(s) ? s : null;
      })(),
      stateName: str(t["stateName"], 60),
      district: int(t["district"]),
      startYear: year(t["startYear"]),
      endYear: year(t["endYear"]),
    }));
  const partyHistory: PartyEntry[] = arr(m["partyHistory"])
    .map((p) => obj(p))
    .filter((p): p is NonNullable<typeof p> => !!p && !!str(p["party"], 60))
    .map((p) => ({
      party: str(p["party"], 60)!,
      abbreviation: str(p["abbreviation"], 8),
      startYear: year(p["startYear"]),
      listOnly: p["listOnly"] === true,
    }));
  const pt = obj(m["portrait"]);
  const portraitUrl = httpUrl(pt?.["imageUrl"]);
  const credit = obj(pt?.["attribution"]);
  const bills = obj(m["bills"]);
  const leg = obj(m["legislation"]);
  const src = obj(m["source"]);
  return {
    id,
    name,
    directName: str(names?.["direct"], 200),
    honorific: str(names?.["honorific"], 20),
    previousNames: arr(names?.["previous"])
      .map((p) => obj(p))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        name: str(p["inverted"], 200) ?? str(p["direct"], 200) ?? "",
        from: day(p["from"]),
        to: day(p["to"]),
      }))
      .filter((p) => p.name),
    birthYear: year(m["birthYear"]),
    deathYear: year(m["deathYear"]),
    current: bool(m["current"]),
    state: str(m["state"], 60),
    stateCode: (() => {
      const s = str(m["stateCode"], 2);
      return s && USPS.test(s) ? s : null;
    })(),
    district: int(m["district"]),
    chamber: str(m["chamber"], 40),
    memberType: str(m["memberType"], 40),
    years: str(m["years"], 30),
    terms,
    partyHistory,
    leadership: arr(m["leadership"])
      .map((l) => obj(l))
      .filter((l): l is NonNullable<typeof l> => !!l && !!str(l["type"], 120))
      .map((l) => ({
        type: str(l["type"], 120)!,
        congress: int(l["congress"]),
        current: bool(l["current"]),
      })),
    website: httpUrl(m["officialWebsite"]),
    portrait:
      portraitUrl && new URL(portraitUrl).hostname === "www.congress.gov"
        ? {
            imageUrl: portraitUrl,
            creditText: str(credit?.["text"], 300),
            creditUrl: httpUrl(credit?.["url"]),
          }
        : null,
    reported: {
      sponsored: int(leg?.["sponsored"]),
      cosponsored: int(leg?.["cosponsored"]),
      retrieved: day(leg?.["retrieved"]),
    },
    bills: bills
      ? {
          coverage: str(bills["coverage"], 60) ?? "108th-119th Congress",
          retrieved: day(bills["billsRetrieved"]),
          sponsoredByCongress: countMap(bills["sponsoredByCongress"]),
          cosponsoredByCongress: countMap(bills["cosponsoredByCongress"]),
          sponsoredTotal: int(bills["sponsoredTotal"]) ?? 0,
          cosponsoredTotal: int(bills["cosponsoredTotal"]) ?? 0,
          withdrawn: int(bills["cosponsorshipsWithdrawn"]) ?? 0,
          congressesServed: arr(bills["congressesServedInCollection"])
            .map(int)
            .filter((n): n is number => n !== null && CONGRESS.test(String(n))),
          servedOnlyInCollection: bills["servedOnlyInCollection"] === true,
        }
      : null,
    source: {
      api: httpUrl(src?.["api"]),
      bioguide: httpUrl(src?.["bioguide"]),
      updateDate: day(src?.["updateDate"]),
      retrievedAt: str(src?.["retrievedAt"], 30),
      detailFetched: src?.["detailFetched"] === true,
    },
  };
}

/* ---------- bills linked to a member ---------- */

export type BillRef = { congress: number; type: BillType; number: string };
const TYPE_ORDER = new Map<string, number>(BILL_TYPES.map((t, i) => [t, i]));

/** The cosponsored measures stored for a member, newest Congress first, then measure type, then number descending. */
export function parseCosponsored(raw: unknown, bioguide: string): BillRef[] | null {
  const o = obj(raw);
  if (!o || str(o["bioguideId"], 10) !== bioguide) return null;
  const by = obj(o["byCongress"]);
  const out: BillRef[] = [];
  for (const [c, types] of Object.entries(by ?? {})) {
    if (!CONGRESS.test(c)) continue;
    const t = obj(types);
    for (const [type, numbers] of Object.entries(t ?? {})) {
      if (!(BILL_TYPES as readonly string[]).includes(type)) continue;
      for (const n of arr(numbers)) {
        const k = int(n);
        if (k !== null && k >= 1 && k <= 99999)
          out.push({ congress: Number(c), type: type as BillType, number: String(k) });
      }
    }
  }
  return out.sort(
    (a, b) =>
      b.congress - a.congress ||
      (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0) ||
      Number(b.number) - Number(a.number),
  );
}

/** Bill record ids for one page of refs; a ref is only ever looked up by its exact id. */
export const billId = (r: BillRef) => `${r.congress}-${r.type}-${r.number}`;

/** `id=in.(…)` path reading the list cells of up to 50 stored bills. */
export const billsByIdPath = (ids: string[]) =>
  `corpus_records?select=id,title,source_url,c:item->cells&dataset=eq.congress_bills&id=in.(${ids.map((i) => enc(i)).join(",")})`;

/** Path for the measures a member sponsored (the first-listed sponsor key), newest Congress first. */
export const sponsoredPath = (bioguide: string, congress?: string) =>
  `corpus_records?select=id,title,source_url,c:item->cells&dataset=eq.congress_bills&filters=cs.${cs(
    {
      sponsor: [bioguide],
      ...(congress && CONGRESS.test(congress) ? { congress: [congress] } : {}),
    },
  )}&order=ordinal.asc`;

/** Which of the given bioguide ids have a member record (the only ones a bill page links). */
export const knownMembersPath = (ids: string[]) =>
  `corpus_records?select=id&dataset=eq.${MEMBER_DATASET}&id=in.(${ids.map((i) => enc(i)).join(",")})&limit=${ids.length}`;

/** "117th–119th" for consecutive Congresses, comma-separated runs otherwise. */
export function congressRuns(numbers: number[]): string | null {
  const ns = [...new Set(numbers)].sort((a, b) => a - b);
  if (!ns.length) return null;
  const runs: [number, number][] = [];
  for (const n of ns) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? ordinal(a) : `${ordinal(a)}–${ordinal(b)}`)).join(", ");
}

/* ---------- committees ---------- */

export type CommitteeHit = {
  id: string;
  name: string;
  chamber: string | null;
  type: string | null;
  current: boolean | null;
  parentCode: string | null;
  parentName: string | null;
  subcommittees: number | null;
  congresses: string | null;
  isSubcommittee: boolean;
};

export function parseCommitteeHit(row: unknown): CommitteeHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const id = str(r?.["id"], 12);
  if (!r || !c || !id || !COMMITTEE_CODE.test(id) || str(c["system_code"], 12) !== id) return null;
  const name = str(c["name"], 300) ?? str(r["title"], 300);
  if (!name) return null;
  const parent = str(c["parent_code"], 12);
  return {
    id,
    name,
    chamber: str(c["chamber"], 20),
    type: str(c["type"], 40),
    current: c["current"] === "yes" ? true : c["current"] === "no" ? false : null,
    parentCode: parent && COMMITTEE_CODE.test(parent) ? parent : null,
    parentName: str(c["parent_name"], 300),
    subcommittees: int(c["subcommittees"]),
    congresses: str(c["congresses"], 120),
    isSubcommittee: c["level"] === "subcommittee",
  };
}

export type CommitteeFilters = {
  q?: string | undefined;
  chamber?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  level?: string | undefined;
  congress?: string | undefined;
};
export const COMMITTEE_CHAMBERS = ["house", "senate", "joint"] as const;
const TYPE_RE = /^[A-Za-z ]{3,40}$/;

export function committeeSearchPath(f: CommitteeFilters): {
  path: string;
  mode: "code" | "words" | "browse";
} {
  const contain: Record<string, string[]> = {};
  if (f.chamber && (COMMITTEE_CHAMBERS as readonly string[]).includes(f.chamber))
    contain["chamber"] = [f.chamber];
  if (f.type && TYPE_RE.test(f.type)) contain["type"] = [f.type];
  if (f.status === "current") contain["current"] = ["yes"];
  else if (f.status === "former") contain["current"] = ["no"];
  if (f.level === "committee" || f.level === "subcommittee") contain["level"] = [f.level];
  if (f.congress && CONGRESS.test(f.congress)) contain["congress"] = [f.congress];
  const q = (f.q ?? "").trim().slice(0, 200);
  const parts = [LIST_SELECT, `dataset=eq.${COMMITTEE_DATASET}`];
  let mode: "code" | "words" | "browse" = "browse";
  const code = q.toLowerCase();
  if (COMMITTEE_CODE.test(code)) {
    parts.push(`id=eq.${enc(code)}`);
    mode = "code";
  } else if (q) {
    const fts = ftsQuery(q);
    if (fts) {
      parts.push(`search_vector=fts(simple).${enc(fts)}`);
      mode = "words";
    }
  }
  if (Object.keys(contain).length) parts.push(`filters=cs.${cs(contain)}`);
  parts.push("order=ordinal.asc");
  return { path: `corpus_records?${parts.join("&")}`, mode };
}

/** Exact match on a committee's published name. */
export function committeeExactPath(
  name: string,
  f: Pick<CommitteeFilters, "status" | "chamber" | "level"> = {},
): string {
  const contain: Record<string, string[]> = { name: [nameKey(name)] };
  if (f.status === "current") contain["current"] = ["yes"];
  else if (f.status === "former") contain["current"] = ["no"];
  if (f.chamber && (COMMITTEE_CHAMBERS as readonly string[]).includes(f.chamber))
    contain["chamber"] = [f.chamber];
  if (f.level === "committee" || f.level === "subcommittee") contain["level"] = [f.level];
  return `corpus_records?${LIST_SELECT}&dataset=eq.${COMMITTEE_DATASET}&filters=cs.${cs(contain)}&order=ordinal.asc&limit=25`;
}

export type CommitteeHistory = {
  officialName: string | null;
  shortName: string | null;
  startDate: string | null;
  endDate: string | null;
  type: string | null;
  establishingAuthority: string | null;
};
export type Committee = {
  id: string;
  name: string;
  chamber: string | null;
  type: string | null;
  level: "committee" | "subcommittee" | null;
  current: boolean | null;
  website: string | null;
  parent: { code: string; name: string | null; listed: boolean } | null;
  subcommittees: { code: string; name: string | null; listed: boolean }[];
  congresses: number[];
  history: CommitteeHistory[];
  counts: {
    reports: number | null;
    bills: number | null;
    communications: number | null;
    nominations: number | null;
  };
  source: {
    api: string | null;
    updateDate: string | null;
    retrievedAt: string | null;
    detailFetched: boolean;
  };
};

export function parseCommittee(id: string, raw: unknown): Committee | null {
  const c = obj(raw);
  if (!c || !COMMITTEE_CODE.test(id) || str(c["systemCode"], 12) !== id) return null;
  const name = str(c["name"], 300);
  if (!name) return null;
  const link = (v: unknown) => {
    const o = obj(v);
    const code = str(o?.["systemCode"], 12);
    return o && code && COMMITTEE_CODE.test(code)
      ? { code, name: str(o["name"], 300), listed: o["listed"] === true }
      : null;
  };
  const counts = obj(c["counts"]);
  const src = obj(c["source"]);
  return {
    id,
    name,
    chamber: str(c["chamber"], 20),
    type: str(c["type"], 40),
    level:
      c["level"] === "subcommittee"
        ? "subcommittee"
        : c["level"] === "committee"
          ? "committee"
          : null,
    current: bool(c["current"]),
    website: httpUrl(c["website"]),
    parent: link(c["parent"]),
    subcommittees: arr(c["subcommittees"])
      .map(link)
      .filter((s): s is NonNullable<typeof s> => !!s),
    congresses: arr(c["congresses"])
      .map(int)
      .filter((n): n is number => n !== null && n >= 1 && n <= 400),
    history: arr(c["history"])
      .map((h) => obj(h))
      .filter((h): h is NonNullable<typeof h> => !!h)
      .map((h) => ({
        officialName: str(h["officialName"], 300),
        shortName: str(h["libraryOfCongressName"], 300),
        startDate: day(h["startDate"]),
        endDate: day(h["endDate"]),
        type: str(h["committeeTypeCode"], 40),
        establishingAuthority: str(h["establishingAuthority"], 200),
      })),
    counts: {
      reports: int(counts?.["reports"]),
      bills: int(counts?.["bills"]),
      communications: int(counts?.["communications"]),
      nominations: int(counts?.["nominations"]),
    },
    source: {
      api: httpUrl(src?.["api"]),
      updateDate: day(src?.["updateDate"]),
      retrievedAt: str(src?.["retrievedAt"], 30),
      detailFetched: src?.["detailFetched"] === true,
    },
  };
}
