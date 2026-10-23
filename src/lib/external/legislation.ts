/**
 * Federal and state legislation: pure parsing and query shaping for congress_bills (GovInfo Bill Status), state_bills
 * (Open States public data) and crs_reports (Congress.gov). Corpus values are untrusted JSON: every field is type-checked,
 * external links must be http(s), in-app links must match a known shape, and anything malformed is dropped.
 */

export const FEDERAL_DATASET = "congress_bills";
export const STATE_DATASET = "state_bills";
export const CRS_DATASET = "crs_reports";

export const BILL_TYPES = [
  "hr",
  "s",
  "hjres",
  "sjres",
  "hconres",
  "sconres",
  "hres",
  "sres",
] as const;
export type BillType = (typeof BILL_TYPES)[number];
export const TYPE_CITE: Record<BillType, string> = {
  hr: "H.R.",
  s: "S.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
  hres: "H.Res.",
  sres: "S.Res.",
};
export const TYPE_LABEL: Record<BillType, string> = {
  hr: "House bill",
  s: "Senate bill",
  hjres: "House joint resolution",
  sjres: "Senate joint resolution",
  hconres: "House concurrent resolution",
  sconres: "Senate concurrent resolution",
  hres: "House simple resolution",
  sres: "Senate simple resolution",
};
export const FEDERAL_STATUS: Record<string, string> = {
  became_law: "Became law",
  vetoed: "Vetoed",
  to_president: "Presented to the President",
  passed_both: "Passed / agreed to in both chambers",
  passed_house: "Passed / agreed to in House",
  passed_senate: "Passed / agreed to in Senate",
  reported: "Reported by committee",
  introduced: "Introduced",
  not_recorded: "Not recorded",
};
export const STATE_STATUS: Record<string, string> = {
  became_law: "Became law",
  signed: "Signed by the executive",
  vetoed: "Vetoed",
  passed_both: "Passed both chambers",
  passed_legislature: "Passed the legislature",
  passed_lower: "Passed lower chamber",
  passed_upper: "Passed upper chamber",
  introduced: "Introduced",
  not_recorded: "Not recorded",
};
export const FEDERAL_MILESTONES: { key: string; label: string }[] = [
  { key: "introduced", label: "Introduced" },
  { key: "reported", label: "Reported by committee" },
  { key: "passed_house", label: "Passed / agreed to in House" },
  { key: "passed_senate", label: "Passed / agreed to in Senate" },
  { key: "to_president", label: "Presented to the President" },
  { key: "vetoed", label: "Vetoed" },
  { key: "became_law", label: "Became law" },
];
export const STATE_MILESTONES: { key: string; label: string }[] = [
  { key: "introduced", label: "Introduced" },
  { key: "passed_lower", label: "Passed lower chamber" },
  { key: "passed_upper", label: "Passed upper chamber" },
  { key: "passed_legislature", label: "Passed the legislature" },
  { key: "executive_veto", label: "Executive veto" },
  { key: "executive_signature", label: "Executive signature" },
  { key: "became_law", label: "Became law" },
];

export const CONGRESS = /^(10[89]|11[0-9])$/;
export const BILL_NUMBER = /^[1-9]\d{0,4}$/;
export const STATE = /^[A-Z]{2}$/;
export const STATE_BILL_ID = /^[a-z]{2}-[a-z0-9-]{1,60}-[a-z0-9]{1,40}(-[0-9a-f]{8})?$/;
export const SESSION = /^[A-Za-z0-9 _.-]{1,60}$/;
export const LAW_NUMBER = /^(\d{2,3})-(\d{1,4})$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isBillType = (v: unknown): v is BillType =>
  typeof v === "string" && (BILL_TYPES as readonly string[]).includes(v);

export const ordinal = (n: number) => {
  const m = n % 100;
  if (m >= 10 && m <= 20) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};
export const citation = (type: BillType, number: string) => `${TYPE_CITE[type]} ${number}`;
export const displayCitation = (type: BillType, number: string, congress: number) =>
  `${citation(type, number)}, ${ordinal(congress)} Congress`;
export const federalId = (congress: number | string, type: BillType, number: string) =>
  `${congress}-${type}-${number}`;

/* ---------- untrusted JSON helpers ---------- */

type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, max = 2000): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;
const day = (v: unknown): string | null => {
  const s = str(v, 40);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1]! : null;
};
/** External links: http(s) only. */
export const httpUrl = (v: unknown): string | null => {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};
const FED_HREF =
  /^\/law\/legislation\/federal\/(1[01]\d|10[89])\/(hr|s|hjres|sjres|hconres|sconres|hres|sres)\/([1-9]\d{0,4})$/;
const LAW_HREF = /^\/records\/public_laws_enacted\/([A-Za-z0-9._-]{1,80})$/;
export type BillRef = { congress: string; type: BillType; number: string };
/** An in-app federal bill link of the one known shape -> its route params; anything else -> null. */
export const federalTarget = (v: unknown): BillRef | null => {
  const m = FED_HREF.exec(str(v, 120) ?? "");
  return m ? { congress: m[1]!, type: m[2] as BillType, number: m[3]! } : null;
};
/** An in-app public law record link (/records/public_laws_enacted/<id>) -> the record id; anything else -> null. */
export const lawRecordId = (v: unknown): string | null => {
  const m = LAW_HREF.exec(str(v, 140) ?? "");
  return m ? m[1]! : null;
};

/* ---------- search query shaping ---------- */

const enc = encodeURIComponent;
export const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** Prefix terms for the simple full-text configuration: letters and digits only, at most 8 terms. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.slice(0, 8).map((w) => w.slice(0, 40));
  return terms.length ? terms.map((t) => `${t}:*`).join("&") : null;
}

const CITE_PATTERNS: [RegExp, BillType][] = [
  [/^h\.?\s*j\.?\s*res\.?$/i, "hjres"],
  [/^s\.?\s*j\.?\s*res\.?$/i, "sjres"],
  [/^h\.?\s*con\.?\s*res\.?$/i, "hconres"],
  [/^s\.?\s*con\.?\s*res\.?$/i, "sconres"],
  [/^h\.?\s*res\.?$/i, "hres"],
  [/^s\.?\s*res\.?$/i, "sres"],
  [/^h\.?\s*r\.?$/i, "hr"],
  [/^s\.?$/i, "s"],
];

/** "H.R. 3935", "hr3935", "S.J.Res. 12" -> type and number; anything else -> null. */
export function parseBillCitation(q: string): { type: BillType; number: string } | null {
  const m = /^\s*([A-Za-z][A-Za-z.\s]{0,14}?)\s*\.?\s*(\d{1,5})\s*$/.exec(q);
  if (!m) return null;
  const prefix = m[1]!.trim();
  const number = String(Number(m[2]!));
  if (!BILL_NUMBER.test(number)) return null;
  for (const [re, type] of CITE_PATTERNS) if (re.test(prefix)) return { type, number };
  return null;
}

/** "Public Law 118-63", "Pub. L. 118-63", "P.L. 118-63" -> "118-63". */
export function parseLawCitation(q: string): string | null {
  const m =
    /^\s*(?:public\s+law|pub\.?\s*l\.?|p\.?\s*l\.?)\s*(?:no\.?\s*)?(\d{2,3})\s*[-–—]\s*(\d{1,4})\s*$/i.exec(
      q,
    );
  return m ? `${Number(m[1])}-${Number(m[2])}` : null;
}

/** State bill identifier ("AB 1", "HB-1001", "LB 5") -> "AB1"; null when the query is not identifier-shaped. */
export function parseStateIdentifier(q: string): string | null {
  const m = /^\s*([A-Za-z]{1,5})\s*[-.]?\s*(\d{1,6}[A-Za-z]?)\s*$/.exec(q);
  return m ? `${m[1]!.toUpperCase()}${m[2]!.toUpperCase()}` : null;
}

export type FederalFilters = {
  q?: string | undefined;
  congress?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  policyArea?: string | undefined;
};
export type StateFilters = {
  q?: string | undefined;
  state?: string | undefined;
  session?: string | undefined;
  status?: string | undefined;
  outcome?: string | undefined;
  sessionRole?: string | undefined;
};

const LIST_SELECT = "select=id,title,source_url,c:item->cells";

/** PostgREST path for one page of federal results; `mode` picks the exact-citation or the word search. */
export function federalSearchPath(f: FederalFilters): {
  path: string;
  mode: "citation" | "law" | "words" | "browse";
} {
  const contain: Record<string, string[]> = {};
  if (f.congress && CONGRESS.test(f.congress)) contain["congress"] = [f.congress];
  if (f.type && isBillType(f.type)) contain["type"] = [f.type];
  if (f.status && f.status in FEDERAL_STATUS) contain["status"] = [f.status];
  if (f.policyArea && f.policyArea.length <= 120) contain["policy_area"] = [f.policyArea];
  const q = (f.q ?? "").trim().slice(0, 200);
  let mode: "citation" | "law" | "words" | "browse" = "browse";
  let fts: string | null = null;
  const cite = q ? parseBillCitation(q) : null;
  const law = q && !cite ? parseLawCitation(q) : null;
  if (cite) {
    contain["type"] = [cite.type];
    contain["number"] = [cite.number];
    mode = "citation";
  } else if (law) {
    contain["law"] = [law];
    mode = "law";
  } else if (q) {
    fts = ftsQuery(q);
    if (fts) mode = "words";
  }
  const parts = [LIST_SELECT, `dataset=eq.${FEDERAL_DATASET}`];
  if (Object.keys(contain).length) parts.push(`filters=cs.${cs(contain)}`);
  if (fts) parts.push(`search_vector=fts(simple).${enc(fts)}`);
  parts.push("order=ordinal.asc");
  return { path: `corpus_records?${parts.join("&")}`, mode };
}

export function stateSearchPath(
  f: StateFilters,
  useIdentifier = true,
): { path: string; mode: "identifier" | "words" | "browse" } {
  const contain: Record<string, string[]> = {};
  if (f.state && STATE.test(f.state)) contain["state"] = [f.state];
  if (f.session && SESSION.test(f.session)) contain["session"] = [f.session];
  if (f.status && f.status in STATE_STATUS) contain["status"] = [f.status];
  if (f.outcome && ["enacted", "vetoed", "none"].includes(f.outcome))
    contain["outcome"] = [f.outcome];
  if (f.sessionRole && ["current", "preceding"].includes(f.sessionRole))
    contain["session_role"] = [f.sessionRole];
  const q = (f.q ?? "").trim().slice(0, 200);
  let mode: "identifier" | "words" | "browse" = "browse";
  let fts: string | null = null;
  const ident = q && useIdentifier ? parseStateIdentifier(q) : null;
  if (ident) {
    contain["ident"] = [ident];
    mode = "identifier";
  } else if (q) {
    fts = ftsQuery(q);
    if (fts) mode = "words";
  }
  const parts = [LIST_SELECT, `dataset=eq.${STATE_DATASET}`];
  if (Object.keys(contain).length) parts.push(`filters=cs.${cs(contain)}`);
  if (fts) parts.push(`search_vector=fts(simple).${enc(fts)}`);
  parts.push("order=ordinal.asc");
  return { path: `corpus_records?${parts.join("&")}`, mode };
}

/* ---------- list rows ---------- */

export type FederalHit = {
  id: string;
  congress: number;
  type: BillType;
  number: string;
  citation: string;
  title: string;
  sponsor: string | null;
  introduced: string | null;
  latestActionDate: string | null;
  latestAction: string | null;
  status: string;
  statusLabel: string;
  law: string | null;
  policyArea: string | null;
  cosponsors: number | null;
};

export function parseFederalHit(row: unknown): FederalHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  if (!r || !c) return null;
  const congress = num(c["congress"]);
  const type = c["type"];
  const number = str(c["number"], 8);
  if (
    !congress ||
    !CONGRESS.test(String(congress)) ||
    !isBillType(type) ||
    !number ||
    !BILL_NUMBER.test(number)
  )
    return null;
  const id = str(r["id"], 40);
  if (id !== federalId(congress, type, number)) return null;
  const status = str(c["status"], 40) ?? "not_recorded";
  return {
    id,
    congress,
    type,
    number,
    citation: displayCitation(type, number, congress),
    title: str(c["title"], 1200) ?? "Title not recorded",
    sponsor: str(c["sponsor"], 200),
    introduced: day(c["introduced"]),
    latestActionDate: day(c["latest_action_date"]),
    latestAction: str(c["latest_action"], 600),
    status: status in FEDERAL_STATUS ? status : "not_recorded",
    statusLabel: str(c["status_label"], 80) ?? FEDERAL_STATUS[status] ?? "Not recorded",
    law: str(c["law"], 200),
    policyArea: str(c["policy_area"], 120),
    cosponsors: num(c["cosponsors"]),
  };
}

export type StateHit = {
  id: string;
  state: string;
  session: string;
  sessionName: string;
  identifier: string;
  title: string;
  sponsor: string | null;
  firstActionDate: string | null;
  latestActionDate: string | null;
  latestAction: string | null;
  status: string;
  statusLabel: string;
  sourceUrl: string | null;
};

export function parseStateHit(row: unknown): StateHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  if (!r || !c) return null;
  const id = str(r["id"], 120);
  const state = str(c["state"], 2);
  const identifier = str(c["identifier"], 60);
  const session = str(c["session"], 60);
  if (!id || !STATE_BILL_ID.test(id) || !state || !STATE.test(state) || !identifier || !session)
    return null;
  const status = str(c["status"], 40) ?? "not_recorded";
  return {
    id,
    state,
    session,
    sessionName: str(c["session_name"], 120) ?? session,
    identifier,
    title: str(c["title"], 1200) ?? "Title not recorded",
    sponsor: str(c["sponsor"], 200),
    firstActionDate: day(c["first_action_date"]),
    latestActionDate: day(c["latest_action_date"]),
    latestAction: str(c["latest_action"], 600),
    status: status in STATE_STATUS ? status : "not_recorded",
    statusLabel: str(c["status_label"], 80) ?? STATE_STATUS[status] ?? "Not recorded",
    sourceUrl: httpUrl(r["source_url"]),
  };
}

/* ---------- federal bill detail ---------- */

export type Person = {
  name: string;
  bioguide: string | null;
  party: string | null;
  state: string | null;
  district: string | null;
  date: string | null;
  original: boolean;
  withdrawn: string | null;
  byRequest: boolean;
};
export type BillAction = {
  date: string | null;
  text: string;
  code: string | null;
  chamber: string | null;
  source: string | null;
  votes: number[];
};
export type BillVote = {
  chamber: string | null;
  date: string | null;
  roll: string | null;
  session: string | null;
  url: string | null;
  action: string | null;
};
export type Milestone = {
  key: string;
  label: string;
  date: string | null;
  evidence: string | null;
  vitiated: string | null;
};
export type RelatedBill = {
  citation: string;
  title: string | null;
  relationships: string[];
  latestAction: string | null;
  target: BillRef | null;
};
export type CommitteeReport = { citation: string; url: string | null; suffix: string | null };
export type TextVersion = {
  type: string;
  date: string | null;
  url: string | null;
  details: string | null;
};
export type ResultingLaw = {
  label: string;
  number: string;
  type: string | null;
  govinfo: string | null;
  resolution: "resolved" | "ambiguous" | "not_found" | "not_checked";
  recordId: string | null;
  note: string | null;
};
export type SummaryBlock = { kind: "p" | "li" | "h"; text: string };
export type Committee = {
  name: string;
  chamber: string | null;
  activities: { name: string; date: string | null }[];
  subcommittees: { name: string; activities: { name: string; date: string | null }[] }[];
};
export type FederalBill = {
  id: string;
  congress: number;
  type: BillType;
  number: string;
  citation: string;
  display: string;
  typeLabel: string;
  title: string;
  officialTitles: { type: string; title: string }[];
  shortTitles: { type: string; title: string }[];
  otherTitles: { type: string; title: string }[];
  originChamber: string | null;
  introduced: string | null;
  policyArea: string | null;
  subjects: string[];
  sponsors: Person[];
  cosponsors: Person[];
  cosponsorCount: number;
  originalCosponsorCount: number;
  withdrawnCosponsorCount: number;
  committees: Committee[];
  latestAction: { date: string | null; text: string } | null;
  actions: BillAction[];
  actionsPublished: number | null;
  actionsDroppedIdentical: number;
  votes: BillVote[];
  related: RelatedBill[];
  cbo: { title: string; url: string | null; date: string | null; description: string | null }[];
  reports: CommitteeReport[];
  texts: TextVersion[];
  laws: ResultingLaw[];
  summary: { version: string | null; date: string | null; blocks: SummaryBlock[] } | null;
  summaryCount: number;
  milestones: Milestone[];
  status: string;
  statusLabel: string;
  congressGovUrl: string | null;
  billStatusUrl: string | null;
  updateDate: string | null;
  retrievedAt: string | null;
};

const vitiatedOf = (m: Obj | null) => (m ? day(m["vitiated"]) : null);

function people(v: unknown, cos: boolean): Person[] {
  const out: Person[] = [];
  for (const raw of arr(v)) {
    const p = obj(raw);
    const name = str(p?.["name"], 200);
    if (!p || !name) continue;
    out.push({
      name,
      bioguide: str(p["bioguide"], 12),
      party: str(p["party"], 8),
      state: str(p["state"], 4),
      district: str(p["district"], 6),
      date: cos ? day(p["date"]) : null,
      original: p["original"] === true,
      withdrawn: day(p["withdrawn"]),
      byRequest: p["byRequest"] === true,
    });
  }
  return out;
}

const activities = (v: unknown) =>
  arr(v)
    .map((a) => obj(a))
    .filter((a): a is Obj => !!a && !!str(a["name"], 120))
    .map((a) => ({ name: str(a["name"], 120)!, date: day(a["date"]) }));

export function parseFederalBill(id: string, raw: unknown): FederalBill | null {
  const b = obj(raw);
  if (!b) return null;
  const congress = num(b["congress"]);
  const type = b["type"];
  const number = str(b["number"], 8);
  if (
    !congress ||
    !CONGRESS.test(String(congress)) ||
    !isBillType(type) ||
    !number ||
    !BILL_NUMBER.test(number)
  )
    return null;
  if (id !== federalId(congress, type, number)) return null;
  const titles = obj(b["titles"]);
  const titleList = (v: unknown) =>
    arr(v)
      .map((t) => obj(t))
      .filter((t): t is Obj => !!t && !!str(t["title"], 2000))
      .map((t) => ({ type: str(t["type"], 200) ?? "Title", title: str(t["title"], 2000)! }));
  const officialTitles = titleList(titles?.["official"]);
  const ms = obj(b["milestones"]);
  const milestones: Milestone[] = FEDERAL_MILESTONES.map(({ key, label }) => {
    const m = obj(ms?.[key]);
    return {
      key,
      label,
      date: m ? day(m["date"]) : null,
      evidence: m ? str(m["evidence"], 80) : null,
      vitiated: vitiatedOf(m),
    };
  });
  const actions: BillAction[] = arr(b["actions"])
    .map((a) => obj(a))
    .filter((a): a is Obj => !!a && !!str(a["x"], 4000))
    .map((a) => ({
      date: day(a["d"]),
      text: str(a["x"], 4000)!,
      code: str(a["c"], 20),
      chamber: str(a["ch"], 10),
      source: str(a["s"], 60),
      votes: arr(a["v"]).filter(
        (i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0,
      ),
    }));
  const votes: BillVote[] = arr(b["votes"]).map((v) => {
    const o = obj(v) ?? {};
    return {
      chamber: str(o["chamber"], 20),
      date: day(o["date"]),
      roll: str(o["roll"], 10),
      session: str(o["session"], 4),
      url: httpUrl(o["url"]),
      action: str(o["action"], 1000),
    };
  });
  const related: RelatedBill[] = arr(b["related"])
    .map((r) => obj(r))
    .filter((r): r is Obj => !!r)
    .map((r) => {
      const t = r["type"];
      const n = str(r["number"], 8);
      const c = num(r["congress"]);
      const cite =
        str(r["citation"], 80) ??
        (isBillType(t) && n && c
          ? displayCitation(t, n, c)
          : `${String(t ?? "")} ${n ?? ""}`.trim());
      const la = obj(r["latestAction"]);
      return {
        citation: cite,
        title: str(r["title"], 1000),
        relationships: arr(r["relationships"])
          .map((x) => obj(x))
          .filter((x): x is Obj => !!x && !!str(x["type"], 80))
          .map(
            (x) =>
              `${str(x["type"], 80)}${str(x["by"], 60) ? ` (identified by ${str(x["by"], 60)})` : ""}`,
          ),
        latestAction: la
          ? [day(la["actionDate"]), str(la["text"], 600)].filter(Boolean).join(": ") || null
          : null,
        target: federalTarget(r["href"]),
      };
    })
    .filter((r) => r.citation);
  const laws: ResultingLaw[] = arr(b["laws"])
    .map((l) => obj(l))
    .filter((l): l is Obj => !!l && !!str(l["number"], 20))
    .map((l) => {
      const res = obj(l["resolution"]);
      const status = str(res?.["status"], 20);
      const resolution =
        status === "resolved" || status === "ambiguous" || status === "not_found"
          ? status
          : "not_checked";
      return {
        label: str(l["label"], 60) ?? str(l["number"], 20)!,
        number: str(l["number"], 20)!,
        type: str(l["type"], 30),
        govinfo: httpUrl(l["govinfo"]),
        resolution,
        recordId: resolution === "resolved" ? lawRecordId(res?.["href"]) : null,
        note: str(res?.["reason"], 200),
      };
    });
  const sum = obj(b["summary"]);
  const blocks: SummaryBlock[] = arr(sum?.["blocks"])
    .map((x) => obj(x))
    .filter((x): x is Obj => !!x && !!str(x["x"], 20000))
    .map((x) => ({
      kind: x["k"] === "li" ? "li" : x["k"] === "h" ? "h" : "p",
      text: str(x["x"], 20000)!,
    }));
  const src = obj(b["source"]);
  const latest = obj(b["latestAction"]);
  const committees: Committee[] = arr(b["committees"])
    .map((c) => obj(c))
    .filter((c): c is Obj => !!c && !!str(c["name"], 200))
    .map((c) => ({
      name: str(c["name"], 200)!,
      chamber: str(c["chamber"], 20),
      activities: activities(c["activities"]),
      subcommittees: arr(c["subcommittees"])
        .map((s) => obj(s))
        .filter((s): s is Obj => !!s && !!str(s["name"], 200))
        .map((s) => ({ name: str(s["name"], 200)!, activities: activities(s["activities"]) })),
    }));
  const status = str(b["status"], 40) ?? "not_recorded";
  return {
    id,
    congress,
    type,
    number,
    citation: citation(type, number),
    display: displayCitation(type, number, congress),
    typeLabel: TYPE_LABEL[type],
    title: str(titles?.["display"], 2000) ?? officialTitles[0]?.title ?? "Title not recorded",
    officialTitles,
    shortTitles: titleList(titles?.["short"]),
    otherTitles: titleList(titles?.["other"]),
    originChamber: str(b["originChamber"], 20),
    introduced: day(b["introduced"]),
    policyArea: str(b["policyArea"], 120),
    subjects: arr(b["subjects"])
      .map((s) => str(s, 200))
      .filter((s): s is string => !!s),
    sponsors: people(b["sponsors"], false),
    cosponsors: people(b["cosponsors"], true),
    cosponsorCount: num(b["cosponsorCount"]) ?? 0,
    originalCosponsorCount: num(b["originalCosponsorCount"]) ?? 0,
    withdrawnCosponsorCount: num(b["withdrawnCosponsorCount"]) ?? 0,
    committees,
    latestAction:
      latest && str(latest["text"], 4000)
        ? { date: day(latest["actionDate"]), text: str(latest["text"], 4000)! }
        : null,
    actions,
    actionsPublished: num(b["actionsPublished"]),
    actionsDroppedIdentical: num(b["actionsDroppedIdentical"]) ?? 0,
    votes,
    related,
    cbo: arr(b["cbo"])
      .map((c) => obj(c))
      .filter((c): c is Obj => !!c && !!str(c["title"], 600))
      .map((c) => ({
        title: str(c["title"], 600)!,
        url: httpUrl(c["url"]),
        date: day(c["pubDate"]),
        description: str(c["description"], 600),
      })),
    reports: arr(b["reports"])
      .map((r) => obj(r))
      .filter((r): r is Obj => !!r && !!str(r["citation"], 120))
      .map((r) => ({
        citation: str(r["citation"], 120)!,
        url: httpUrl(r["url"]),
        suffix: str(r["suffix"], 60),
      })),
    texts: arr(b["texts"])
      .map((t) => obj(t))
      .filter((t): t is Obj => !!t)
      .map((t) => ({
        type: str(t["type"], 120) ?? "Text version",
        date: day(t["date"]),
        url: httpUrl(t["url"]),
        details: httpUrl(t["details"]),
      })),
    laws,
    summary: blocks.length
      ? { version: str(sum?.["version"], 200), date: day(sum?.["date"]), blocks }
      : null,
    summaryCount: num(b["summaryCount"]) ?? 0,
    milestones,
    status: status in FEDERAL_STATUS ? status : "not_recorded",
    statusLabel: str(b["statusLabel"], 80) ?? FEDERAL_STATUS[status] ?? "Not recorded",
    congressGovUrl: httpUrl(src?.["congressGov"]),
    billStatusUrl: httpUrl(src?.["billStatusXml"]),
    updateDate: day(src?.["updateDate"]),
    retrievedAt: day(src?.["retrievedAt"]),
  };
}

/* ---------- state bill detail ---------- */

export type StateBill = {
  id: string;
  state: string;
  stateName: string;
  identifier: string;
  title: string;
  session: { id: string; name: string; role: string | null };
  classification: string[];
  subjects: string[];
  chamber: string | null;
  firstActionDate: string | null;
  latestAction: {
    date: string | null;
    description: string | null;
    classification: string[];
  } | null;
  actionCount: number;
  actions: { date: string | null; text: string; classification: string[]; org: string | null }[];
  milestones: Milestone[];
  status: string;
  statusLabel: string;
  outcome: string | null;
  sponsors: { name: string; primary: boolean; classification: string | null }[];
  versions: {
    note: string | null;
    date: string | null;
    links: { url: string; mediaType: string | null }[];
  }[];
  documents: {
    note: string | null;
    date: string | null;
    links: { url: string; mediaType: string | null }[];
  }[];
  officialSources: { url: string; note: string | null; kind: "page" | "search" | "data" | null }[];
  openStatesUrl: string | null;
  sourceUrl: string | null;
};

const strList = (v: unknown, max = 200) =>
  arr(v)
    .map((x) => str(x, max))
    .filter((x): x is string => !!x);
const linkList = (v: unknown) =>
  arr(v)
    .map((l) => obj(l))
    .filter((l): l is Obj => !!l && !!httpUrl(l["url"]))
    .map((l) => ({ url: httpUrl(l["url"])!, mediaType: str(l["mediaType"], 80) }));

export function parseStateBill(id: string, raw: unknown, sourceUrl: unknown): StateBill | null {
  const b = obj(raw);
  if (!b || !STATE_BILL_ID.test(id)) return null;
  const state = str(b["state"], 2);
  const identifier = str(b["identifier"], 60);
  const s = obj(b["session"]);
  if (!state || !STATE.test(state) || !identifier || !s || !str(s["id"], 60)) return null;
  if (!id.startsWith(`${state.toLowerCase()}-`)) return null;
  const ms = obj(b["milestones"]);
  const la = obj(b["latestAction"]);
  const status = str(b["status"], 40) ?? "not_recorded";
  const docs = (v: unknown) =>
    arr(v)
      .map((d) => obj(d))
      .filter((d): d is Obj => !!d)
      .map((d) => ({
        note: str(d["note"], 300),
        date: day(d["date"]),
        links: linkList(d["links"]),
      }))
      .filter((d) => d.links.length || d.note);
  return {
    id,
    state,
    stateName: str(b["stateName"], 60) ?? state,
    identifier,
    title: str(b["title"], 4000) ?? "Title not recorded",
    session: {
      id: str(s["id"], 60)!,
      name: str(s["name"], 160) ?? str(s["id"], 60)!,
      role: str(s["role"], 20),
    },
    classification: strList(b["classification"], 60),
    subjects: strList(b["subjects"], 200),
    chamber: str(b["chamber"], 120),
    firstActionDate: day(b["firstActionDate"]),
    latestAction: la
      ? {
          date: day(la["date"]),
          description: str(la["description"], 2000),
          classification: strList(la["classification"], 60),
        }
      : null,
    actionCount: num(b["actionCount"]) ?? 0,
    actions: arr(b["actions"])
      .map((a) => obj(a))
      .filter((a): a is Obj => !!a && !!str(a["x"], 2000))
      .map((a) => ({
        date: day(a["d"]),
        text: str(a["x"], 2000)!,
        classification: strList(a["c"], 60),
        org: str(a["o"], 120),
      })),
    milestones: STATE_MILESTONES.map(({ key, label }) => {
      const m = obj(ms?.[key]);
      return {
        key,
        label,
        date: m ? day(m["date"]) : null,
        evidence: m ? str(m["description"], 400) : null,
        vitiated: null,
      };
    }),
    status: status in STATE_STATUS ? status : "not_recorded",
    statusLabel: str(b["statusLabel"], 80) ?? STATE_STATUS[status] ?? "Not recorded",
    outcome: str(b["outcome"], 20),
    sponsors: arr(b["sponsors"])
      .map((p) => obj(p))
      .filter((p): p is Obj => !!p && !!str(p["name"], 200))
      .map((p) => ({
        name: str(p["name"], 200)!,
        primary: p["primary"] === true,
        classification: str(p["classification"], 60),
      })),
    versions: docs(b["versions"]),
    documents: docs(b["documents"]),
    officialSources: arr(b["officialSources"])
      .map((o) => obj(o))
      .filter((o): o is Obj => !!o && !!httpUrl(o["url"]))
      .map((o) => ({
        url: httpUrl(o["url"])!,
        note: str(o["note"], 200),
        kind:
          o["kind"] === "page" || o["kind"] === "search" || o["kind"] === "data" ? o["kind"] : null,
      })),
    openStatesUrl: httpUrl(b["openStatesUrl"]),
    sourceUrl: httpUrl(sourceUrl),
  };
}

/* ---------- CRS reports and facets ---------- */

export type CrsHit = {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  updated: string | null;
  authors: string | null;
  url: string | null;
};

export function parseCrsHit(row: unknown): CrsHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const id = str(r?.["id"], 20);
  if (!r || !c || !id || !/^[A-Z]{1,6}\d{1,6}$/.test(id)) return null;
  return {
    id,
    title: str(c["title"], 600) ?? id,
    type: str(c["type"], 40),
    status: str(c["status"], 20),
    updated: day(c["updated"]),
    authors: str(c["authors"], 400),
    url: httpUrl(r["source_url"]),
  };
}

export type FacetOption = {
  value: string;
  label: string;
  count: number | null;
  state?: string;
  role?: string;
};

export function parseFacetOptions(listing: unknown, name: string): FacetOption[] {
  const filters = arr(obj(listing)?.["filters"]);
  const f = filters.map((x) => obj(x)).find((x) => x?.["name"] === name);
  return arr(f?.["options"])
    .map((o) => obj(o))
    .filter((o): o is Obj => !!o && !!str(o["value"], 120) && !!str(o["label"], 200))
    .map((o) => {
      const opt: FacetOption = {
        value: str(o["value"], 120)!,
        label: str(o["label"], 200)!,
        count: num(o["count"]),
      };
      const st = str(o["state"], 2);
      const role = str(o["role"], 20);
      if (st) opt.state = st;
      if (role) opt.role = role;
      return opt;
    });
}
