/**
 * Congress.gov API v3 beyond bills (wave 1025, api-law): amendments, nominations, treaties and committee reports, as
 * corpus rows, built by the same functions for the full load (scripts/api_law/congress/*.mjs) and the scheduled refresh
 * (supabase/functions/ingest-congress-gov).
 *
 * Exact links only: an amendment links to the bill it amends when Congress.gov's amendedBill names it (congress, type,
 * number) and that bill is held in congress_bills; a sponsor links to congress_members by bioguide id; a nomination links
 * to judicial_nominations when a record with the same Congress and PN citation is held (its judge link is that record's
 * own exact FJC match); a committee report links to its associated bills and to congress_committees by system code, and
 * to its GovInfo package when GovInfo lists that package id.
 * Status words come only from the published latest-action text (patterns below); nothing is inferred about a person.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { clip, htmlToText } from "./enforcementText.ts";

export const CG_API = "https://api.congress.gov/v3";
export const CG_SITE = "https://www.congress.gov";
export const CG_DOCS = "https://api.congress.gov/";
export const NOT_RECORDED = "Not recorded";
export const DATASETS = {
  amendments: "congress_amendments",
  nominations: "congress_nominations",
  treaties: "congress_treaties",
  reports: "congress_committee_reports",
} as const;

/* ------------------------------------------------------------------ small helpers */

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const obj = (v: unknown): JsonObject | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
const arr = (v: unknown): JsonObject[] =>
  Array.isArray(v) ? (v.filter((x) => obj(x)) as JsonObject[]) : [];
/** An API URL as recorded: the format parameter dropped (no key is ever in these URLs). */
export const apiRecordUrl = (u: string | null): string | null =>
  u ? u.replace(/[?&]format=json/, "").replace(/\?$/, "") : null;

export const BILL_TYPES: Record<string, { code: string; label: string; site: string }> = {
  HR: { code: "hr", label: "H.R.", site: "house-bill" },
  S: { code: "s", label: "S.", site: "senate-bill" },
  HJRES: { code: "hjres", label: "H.J.Res.", site: "house-joint-resolution" },
  SJRES: { code: "sjres", label: "S.J.Res.", site: "senate-joint-resolution" },
  HCONRES: { code: "hconres", label: "H.Con.Res.", site: "house-concurrent-resolution" },
  SCONRES: { code: "sconres", label: "S.Con.Res.", site: "senate-concurrent-resolution" },
  HRES: { code: "hres", label: "H.Res.", site: "house-resolution" },
  SRES: { code: "sres", label: "S.Res.", site: "senate-resolution" },
};

export type BillRef = { congress: number; type: string; number: string; title: string | null };
/** congress_bills record id of a bill reference ("118-hr-3746"), or null when the type is not a bill type. */
export function billId(b: BillRef): string | null {
  const t = BILL_TYPES[b.type.toUpperCase()];
  return t && /^\d{1,5}$/.test(b.number) ? `${b.congress}-${t.code}-${Number(b.number)}` : null;
}
export function billCitation(b: BillRef): string {
  const t = BILL_TYPES[b.type.toUpperCase()];
  return `${t ? t.label : b.type} ${b.number}`;
}
export const billPage = (b: BillRef) => {
  const t = BILL_TYPES[b.type.toUpperCase()]!;
  return `/law/legislation/federal/${b.congress}/${t.code}/${Number(b.number)}`;
};
function billRef(v: unknown): BillRef | null {
  const o = obj(v);
  if (!o) return null;
  const congress = num(o["congress"]);
  const type = str(o["type"]);
  const number = o["number"] === undefined || o["number"] === null ? null : String(o["number"]);
  return congress && type && number
    ? { congress, type: type.toUpperCase(), number, title: str(o["title"]) }
    : null;
}

/** Which held records exact links may point to (filled by the caller: full build from id lists, runs from the corpus). */
export type Known = {
  bills: Set<string>;
  members: Set<string>;
  committees: Set<string>;
  judicial: Set<string>;
  /** GovInfo CRPT package ids by report key "<congress>-<type>-<number>-<part>" (parsed from GovInfo's own listing) */
  govinfoReports: Map<string, string>;
  /** false when GovInfo's listing was not read (scheduled runs): the package is then Not recorded, never "not listed" */
  govinfoChecked: boolean;
};
export const emptyKnown = (): Known => ({
  bills: new Set(),
  members: new Set(),
  committees: new Set(),
  judicial: new Set(),
  govinfoReports: new Map(),
  govinfoChecked: false,
});

export type Prov = {
  api_url: string | null;
  retrieved_at: string;
  detail_url?: string | null;
  detail_retrieved_at?: string | null;
};

type Action = { date: string | null; time: string | null; text: string | null };
const action = (v: unknown): Action | null => {
  const o = obj(v);
  return o
    ? { date: day(o["actionDate"]), time: str(o["actionTime"]), text: str(o["text"]) }
    : null;
};

/* ------------------------------------------------------------------ amendments */

export const AMDT_TYPES: Record<string, { label: string; site: string | null; chamber: string }> = {
  HAMDT: { label: "H.Amdt.", site: "house-amendment", chamber: "House" },
  SAMDT: { label: "S.Amdt.", site: "senate-amendment", chamber: "Senate" },
  SUAMDT: { label: "S.Up.Amdt.", site: null, chamber: "Senate" },
};

export type Amendment = {
  congress: number;
  type: string;
  number: string;
  description: string | null;
  purpose: string | null;
  latestAction: Action | null;
  updateDate: string | null;
  // detail
  detail: boolean;
  chamber: string | null;
  submittedDate: string | null;
  proposedDate: string | null;
  sponsors: {
    bioguideId: string | null;
    fullName: string | null;
    party: string | null;
    state: string | null;
  }[];
  amendedBill: BillRef | null;
  amendedAmendment: { congress: number | null; type: string | null; number: string | null } | null;
  amendedTreaty: { congress: number | null; number: string | null } | null;
  actionsCount: number | null;
  textVersionsCount: number | null;
};

/** A list item, optionally merged with its detail (values exactly as published). */
export function normalizeAmendment(list: JsonObject, detail: JsonObject | null): Amendment | null {
  const d = obj(detail?.["amendment"]) ?? null;
  const src = d ?? list;
  const congress = num(src["congress"] ?? list["congress"]);
  const type = str(src["type"] ?? list["type"])?.toUpperCase() ?? null;
  const number = src["number"] ?? list["number"];
  if (
    !congress ||
    !type ||
    number === undefined ||
    number === null ||
    !/^\d{1,6}$/.test(String(number))
  )
    return null;
  const amAmdt = obj(d?.["amendedAmendment"]);
  const amTreaty = obj(d?.["amendedTreaty"]);
  return {
    congress,
    type,
    number: String(Number(number)),
    description: str(list["description"]) ?? str(d?.["description"]),
    purpose: str(list["purpose"]) ?? str(d?.["purpose"]),
    latestAction: action(list["latestAction"] ?? d?.["latestAction"]),
    updateDate: str(d?.["updateDate"]) ?? str(list["updateDate"]),
    detail: Boolean(d),
    chamber: str(d?.["chamber"]),
    submittedDate: day(d?.["submittedDate"]),
    proposedDate: day(d?.["proposedDate"]),
    sponsors: arr(d?.["sponsors"]).map((s) => ({
      bioguideId: str(s["bioguideId"]),
      fullName: str(s["fullName"]),
      party: str(s["party"]),
      state: str(s["state"]),
    })),
    amendedBill: billRef(d?.["amendedBill"]),
    amendedAmendment: amAmdt
      ? {
          congress: num(amAmdt["congress"]),
          type: str(amAmdt["type"]),
          number: amAmdt["number"] == null ? null : String(amAmdt["number"]),
        }
      : null,
    amendedTreaty: amTreaty
      ? {
          congress: num(amTreaty["congress"]),
          number:
            amTreaty["treatyNumber"] == null
              ? amTreaty["number"] == null
                ? null
                : String(amTreaty["number"])
              : String(amTreaty["treatyNumber"]),
        }
      : null,
    actionsCount: num(obj(d?.["actions"])?.["count"]),
    textVersionsCount: num(obj(d?.["textVersions"])?.["count"]),
  };
}

export const amendmentId = (a: Pick<Amendment, "congress" | "type" | "number">) =>
  `amdt:${a.congress}-${a.type.toLowerCase()}-${a.number}`;
export const amendmentApi = (a: Pick<Amendment, "congress" | "type" | "number">) =>
  `${CG_API}/amendment/${a.congress}/${a.type.toLowerCase()}/${a.number}`;
export function amendmentSite(a: Pick<Amendment, "congress" | "type" | "number">): string | null {
  const t = AMDT_TYPES[a.type];
  return t?.site
    ? `${CG_SITE}/amendment/${ordinal(a.congress)}-congress/${t.site}/${a.number}`
    : null;
}

export function amendmentRow(a: Amendment, known: Known, prov: Prov): CorpusRow {
  const t = AMDT_TYPES[a.type];
  const cite = `${t?.label ?? a.type} ${a.number}`;
  const bill = a.amendedBill;
  const bid = bill ? billId(bill) : null;
  const billHeld = Boolean(bid && known.bills.has(bid));
  const title = `${cite}${bill ? ` to ${billCitation(bill)}` : ""} (${ordinal(a.congress)} Congress)`;
  const sponsor = a.sponsors[0] ?? null;
  const links: Json[] = [];
  const site = amendmentSite(a);
  if (site) links.push({ url: site, label: "Amendment on Congress.gov" });
  if (bill && billHeld)
    links.push({ url: billPage(bill), label: `Amended bill: ${billCitation(bill)}` });
  for (const s of a.sponsors)
    if (s.bioguideId && known.members.has(s.bioguideId))
      links.push({
        url: `/law/legislation/members/${s.bioguideId}`,
        label: `Sponsor: ${s.fullName ?? s.bioguideId}`,
      });
  const year = (a.submittedDate ?? a.latestAction?.date ?? "").slice(0, 4);
  return corpusRecord(DATASETS.amendments, amendmentId(a), title, {
    source_url: site ?? amendmentApi(a),
    subtitle: [
      a.purpose ?? a.description,
      a.latestAction?.date ? `latest action ${a.latestAction.date}` : null,
    ]
      .filter(Boolean)
      .map((x) => clip(x!, 220)[0])
      .join(" · "),
    cells: {
      congress: String(a.congress),
      type: t?.label ?? a.type,
      amends: bill ? billCitation(bill) : a.detail ? "No bill named" : NOT_RECORDED,
      sponsor: sponsor?.fullName ?? NOT_RECORDED,
      latest_action_date: a.latestAction?.date ?? NOT_RECORDED,
      latest_action: a.latestAction?.text ?? NOT_RECORDED,
    },
    facts: [
      ["Amendment", `${cite}, ${ordinal(a.congress)} Congress`],
      ["Chamber", a.chamber ?? t?.chamber ?? NOT_RECORDED],
      ["Purpose (as published)", a.purpose ?? NOT_RECORDED],
      ["Description (as published)", a.description ?? NOT_RECORDED],
      [
        "Sponsor",
        a.sponsors.length
          ? a.sponsors.map((s) => s.fullName ?? s.bioguideId ?? "").join("; ")
          : a.detail
            ? "None listed"
            : NOT_RECORDED,
      ],
      ["Submitted", a.submittedDate ?? NOT_RECORDED],
      ["Proposed", a.proposedDate ?? NOT_RECORDED],
      [
        "Amends",
        bill
          ? `${billCitation(bill)}, ${ordinal(bill.congress)} Congress${bill.title ? `: ${bill.title}` : ""}${billHeld ? "" : " (not held in this atlas)"}`
          : a.amendedAmendment
            ? `Amendment ${a.amendedAmendment.type ?? ""} ${a.amendedAmendment.number ?? ""}`.trim()
            : a.amendedTreaty
              ? `Treaty ${a.amendedTreaty.congress ?? ""}-${a.amendedTreaty.number ?? ""}`
              : a.detail
                ? "Not stated"
                : NOT_RECORDED,
      ],
      [
        "Latest action",
        a.latestAction
          ? `${a.latestAction.date ?? ""} ${a.latestAction.text ?? ""}`.trim()
          : NOT_RECORDED,
      ],
      ["Actions recorded", a.actionsCount === null ? NOT_RECORDED : String(a.actionsCount)],
      [
        "Detail read",
        a.detail ? "yes" : "no (list entry only; sponsor and amended bill not read yet)",
      ],
      ["Source", `Congress.gov API v3, ${amendmentApi(a)}`],
    ] as unknown as Json,
    badges: [t?.label ?? a.type],
    links,
    text: [
      a.purpose,
      a.description,
      sponsor?.fullName,
      bill ? billCitation(bill) : null,
      a.latestAction?.text,
    ]
      .filter(Boolean)
      .join(" "),
    filters: {
      congress: [String(a.congress)],
      type: [a.type.toLowerCase()],
      chamber: [a.chamber ?? t?.chamber ?? "unknown"],
      year: /^\d{4}$/.test(year) ? [year] : [],
      amended_bill: bid ? [bid] : [],
      sponsor: a.sponsors.map((s) => s.bioguideId).filter((x): x is string => Boolean(x)),
      detail: [a.detail ? "yes" : "no"],
    },
    extra: {
      kind: "amendment",
      amendment: a as unknown as JsonObject,
      provenance: prov as unknown as JsonObject,
    },
  });
}

/* ------------------------------------------------------------------ nominations */

export type Nomination = {
  congress: number;
  citation: string;
  number: number | null;
  partNumber: string | null;
  description: string | null;
  organization: string | null;
  receivedDate: string | null;
  kind: "civilian" | "military" | "not recorded";
  latestAction: Action | null;
  updateDate: string | null;
};

export function normalizeNomination(rec: JsonObject): Nomination | null {
  const congress = num(rec["congress"]);
  const citation = str(rec["citation"]);
  if (!congress || !citation || !/^PN\d{1,6}(-\d{1,4})?$/.test(citation)) return null;
  const nt = obj(rec["nominationType"]) ?? {};
  return {
    congress,
    citation,
    number: num(rec["number"]),
    partNumber: str(rec["partNumber"]),
    description: str(rec["description"]),
    organization: str(rec["organization"]),
    receivedDate: day(rec["receivedDate"]),
    kind:
      nt["isCivilian"] === true
        ? "civilian"
        : nt["isMilitary"] === true
          ? "military"
          : "not recorded",
    latestAction: action(rec["latestAction"]),
    updateDate: str(rec["updateDate"]),
  };
}

export const nominationId = (n: Pick<Nomination, "congress" | "citation">) =>
  `nom:${n.congress}-${n.citation}`;

/** Status words read only from the latest action text as Congress.gov publishes it. */
export function nominationStatus(text: string | null): string {
  if (!text) return "not_recorded";
  if (/^Confirmed by the Senate/i.test(text)) return "confirmed";
  if (/^Received message of withdrawal|withdrawn/i.test(text)) return "withdrawn";
  if (/^Returned to the President/i.test(text)) return "returned";
  if (/rejected|failed of confirmation|disapproved/i.test(text)) return "rejected";
  return "other";
}
export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed (latest action)",
  withdrawn: "Withdrawn (latest action)",
  returned: "Returned to the President (latest action)",
  rejected: "Rejected or failed (latest action)",
  other: "Other latest action",
  not_recorded: "Not recorded",
};

export function nominationRow(n: Nomination, known: Known, prov: Prov): CorpusRow {
  const id = nominationId(n);
  const judicial = known.judicial.has(id);
  const part = n.citation.includes("-") ? n.citation.split("-")[1] : null;
  const site = `${CG_SITE}/nomination/${ordinal(n.congress)}-congress/${n.number ?? n.citation.slice(2).split("-")[0]}${part ? `/${Number(part)}` : ""}`;
  const status = nominationStatus(n.latestAction?.text ?? null);
  const links: Json[] = [{ url: site, label: "Nomination on Congress.gov" }];
  if (judicial)
    links.push({
      url: `/records/judicial_nominations/${encodeURIComponent(id)}`,
      label: "Judicial nomination record (judge link by exact FJC match)",
    });
  return corpusRecord(
    DATASETS.nominations,
    id,
    `${n.citation} (${ordinal(n.congress)} Congress): ${n.organization ?? "Nomination"}`,
    {
      source_url: site,
      subtitle: [
        n.receivedDate ? `received ${n.receivedDate}` : null,
        n.kind === "not recorded" ? null : n.kind,
        STATUS_LABEL[status],
      ]
        .filter(Boolean)
        .join(" · "),
      cells: {
        citation: n.citation,
        congress: String(n.congress),
        organization: n.organization ?? NOT_RECORDED,
        kind: n.kind,
        received: n.receivedDate ?? NOT_RECORDED,
        latest_action: n.latestAction?.text ?? NOT_RECORDED,
      },
      facts: [
        ["Citation", `${n.citation}, ${ordinal(n.congress)} Congress`],
        ["Organization", n.organization ?? NOT_RECORDED],
        ["Description (as published)", n.description ?? NOT_RECORDED],
        ["Civilian or military", n.kind === "not recorded" ? NOT_RECORDED : n.kind],
        ["Received in the Senate", n.receivedDate ?? NOT_RECORDED],
        [
          "Latest action",
          n.latestAction
            ? `${n.latestAction.date ?? ""} ${n.latestAction.text ?? ""}`.trim()
            : NOT_RECORDED,
        ],
        ["Status (from the latest action text)", STATUS_LABEL[status]!],
        [
          "Judicial nomination record",
          judicial ? `Yes, ${id} (same Congress and PN citation)` : "No",
        ],
        ["Source", `Congress.gov API v3, ${CG_API}/nomination/${n.congress}/${n.number ?? ""}`],
      ] as unknown as Json,
      badges: [
        n.kind === "not recorded" ? "Nomination" : n.kind === "civilian" ? "Civilian" : "Military",
      ],
      links,
      text: [n.description, n.organization, n.latestAction?.text].filter(Boolean).join(" "),
      filters: {
        congress: [String(n.congress)],
        kind: [n.kind === "not recorded" ? "not_recorded" : n.kind],
        status: [status],
        year: n.receivedDate ? [n.receivedDate.slice(0, 4)] : [],
        judicial: [judicial ? "yes" : "no"],
      },
      extra: {
        kind: "nomination",
        nomination: n as unknown as JsonObject,
        provenance: prov as unknown as JsonObject,
      },
    },
  );
}

/* ------------------------------------------------------------------ treaties */

export type Treaty = {
  congressReceived: number;
  congressConsidered: number | null;
  number: number;
  suffix: string;
  topic: string | null;
  transmittedDate: string | null;
  inForceDate: string | null;
  updateDate: string | null;
  titles: { title: string; titleType: string | null }[];
  countriesParties: string[];
  indexTerms: string[];
  resolutionText: string | null;
  actionsCount: number | null;
  detail: boolean;
};

export function normalizeTreaty(list: JsonObject, detail: JsonObject | null): Treaty | null {
  const d = Array.isArray(detail?.["treaty"])
    ? obj((detail!["treaty"] as Json[])[0])
    : obj(detail?.["treaty"]);
  const src = d ?? list;
  const congressReceived = num(src["congressReceived"] ?? list["congressReceived"]);
  const number = num(src["number"] ?? list["number"]);
  if (!congressReceived || number === null) return null;
  const resolution = str(d?.["resolutionText"]);
  return {
    congressReceived,
    congressConsidered: num(src["congressConsidered"]),
    number,
    suffix: str(src["suffix"]) ?? "",
    topic: str(src["topic"]),
    transmittedDate: day(src["transmittedDate"]),
    inForceDate: day(src["inForceDate"]),
    updateDate: str(src["updateDate"]),
    titles: arr(d?.["titles"])
      .map((t) => ({ title: str(t["title"]) ?? "", titleType: str(t["titleType"]) }))
      .filter((t) => t.title),
    countriesParties: arr(d?.["countriesParties"])
      .map((c) => str(c["name"]) ?? "")
      .filter(Boolean),
    indexTerms: arr(d?.["indexTerms"])
      .map((c) => str(c["name"]) ?? "")
      .filter(Boolean),
    resolutionText: resolution ? clip(htmlToText(resolution), 2000)[0] : null,
    actionsCount: num(obj(d?.["actions"])?.["count"]),
    detail: Boolean(d),
  };
}

export const treatyId = (t: Pick<Treaty, "congressReceived" | "number" | "suffix">) =>
  `treaty:${t.congressReceived}-${t.number}${t.suffix}`;

export function treatyRow(t: Treaty, prov: Prov): CorpusRow {
  const doc = `Treaty Doc. ${t.congressReceived}-${t.number}${t.suffix}`;
  const formal = t.titles.find((x) => /Formal/i.test(x.titleType ?? ""))?.title;
  const short = t.titles.find((x) => /Short/i.test(x.titleType ?? ""))?.title;
  const site = `${CG_SITE}/treaty-document/${ordinal(t.congressReceived)}-congress/${t.number}${t.suffix ? `/${t.suffix}` : ""}`;
  return corpusRecord(
    DATASETS.treaties,
    treatyId(t),
    `${doc}: ${short ?? formal ?? t.topic ?? "Treaty document"}`,
    {
      source_url: site,
      subtitle: [
        t.topic,
        t.transmittedDate ? `transmitted ${t.transmittedDate}` : null,
        t.inForceDate ? `in force ${t.inForceDate}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      cells: {
        document: doc,
        topic: t.topic ?? NOT_RECORDED,
        transmitted: t.transmittedDate ?? NOT_RECORDED,
        considered: t.congressConsidered
          ? `${ordinal(t.congressConsidered)} Congress`
          : NOT_RECORDED,
        in_force: t.inForceDate ?? NOT_RECORDED,
      },
      facts: [
        ["Treaty document", doc],
        ["Formal title", formal ?? NOT_RECORDED],
        ["Short title", short ?? NOT_RECORDED],
        ["Topic", t.topic ?? NOT_RECORDED],
        ["Transmitted to the Senate", t.transmittedDate ?? NOT_RECORDED],
        [
          "Congress considered",
          t.congressConsidered ? `${ordinal(t.congressConsidered)} Congress` : NOT_RECORDED,
        ],
        ["Entered into force", t.inForceDate ?? NOT_RECORDED],
        [
          "Countries or parties",
          t.countriesParties.length ? t.countriesParties.join("; ") : NOT_RECORDED,
        ],
        ["Index terms", t.indexTerms.length ? t.indexTerms.join("; ") : NOT_RECORDED],
        [
          "Resolution of advice and consent (first 2,000 characters, as published)",
          t.resolutionText ?? NOT_RECORDED,
        ],
        ["Actions recorded", t.actionsCount === null ? NOT_RECORDED : String(t.actionsCount)],
        ["Source", `Congress.gov API v3, ${CG_API}/treaty/${t.congressReceived}/${t.number}`],
      ] as unknown as Json,
      badges: t.topic ? [t.topic] : [],
      links: [{ url: site, label: "Treaty document on Congress.gov" }],
      text: [formal, short, t.topic, t.countriesParties.join(" "), t.indexTerms.join(" ")]
        .filter(Boolean)
        .join(" "),
      filters: {
        congress: [String(t.congressReceived)],
        topic: t.topic ? [t.topic] : [],
        in_force: [t.inForceDate ? "yes" : "no"],
        year: t.transmittedDate ? [t.transmittedDate.slice(0, 4)] : [],
      },
      extra: {
        kind: "treaty",
        treaty: t as unknown as JsonObject,
        provenance: prov as unknown as JsonObject,
      },
    },
  );
}

/* ------------------------------------------------------------------ committee reports */

export const REPORT_TYPES: Record<string, { label: string; site: string; govinfo: string }> = {
  HRPT: { label: "H. Rept.", site: "house-report", govinfo: "hrpt" },
  SRPT: { label: "S. Rept.", site: "senate-report", govinfo: "srpt" },
  ERPT: { label: "S. Exec. Rept.", site: "executive-report", govinfo: "erpt" },
};

export type CommitteeReport = {
  congress: number;
  type: string;
  number: number;
  part: number;
  citation: string | null;
  title: string | null;
  chamber: string | null;
  session: number | null;
  issueDate: string | null;
  isConferenceReport: boolean | null;
  reportType: string | null;
  associatedBills: BillRef[];
  committees: { name: string | null; systemCode: string | null }[];
  textCount: number | null;
  updateDate: string | null;
  detail: boolean;
};

export function normalizeReport(
  list: JsonObject,
  detail: JsonObject | null,
): CommitteeReport | null {
  const d = Array.isArray(detail?.["committeeReports"])
    ? obj((detail!["committeeReports"] as Json[])[0])
    : null;
  const src = d ?? list;
  const congress = num(src["congress"]);
  const type = str(src["type"])?.toUpperCase();
  const number = num(src["number"]);
  if (!congress || !type || number === null) return null;
  return {
    congress,
    type,
    number,
    part: num(src["part"]) ?? 1,
    citation: str(src["citation"]),
    title: str(d?.["title"]),
    chamber: str(src["chamber"]),
    session: num(d?.["sessionNumber"]),
    issueDate: day(d?.["issueDate"]),
    isConferenceReport:
      typeof d?.["isConferenceReport"] === "boolean" ? (d["isConferenceReport"] as boolean) : null,
    reportType: str(d?.["reportType"]),
    associatedBills: arr(d?.["associatedBill"])
      .map(billRef)
      .filter((b): b is BillRef => Boolean(b)),
    committees: arr(d?.["committees"]).map((c) => ({
      name: str(c["name"]),
      systemCode: str(c["systemCode"]),
    })),
    textCount: num(obj(d?.["text"])?.["count"]),
    updateDate: str(src["updateDate"]),
    detail: Boolean(d),
  };
}

export const reportId = (r: Pick<CommitteeReport, "congress" | "type" | "number" | "part">) =>
  `crpt:${r.congress}-${r.type.toLowerCase()}-${r.number}-${r.part}`;
export const reportKey = (r: Pick<CommitteeReport, "congress" | "type" | "number" | "part">) =>
  `${r.congress}-${r.type.toLowerCase()}-${r.number}-${r.part}`;
/** Report key of a GovInfo CRPT package id (CRPT-118hrpt1, CRPT-115hrpt1050-pt2, ...); null for other ids. */
export function reportKeyOfPackage(packageId: string): string | null {
  const m = /^CRPT-(\d{2,3})(hrpt|srpt|erpt)(\d{1,5})(?:-?pt?(\d{1,2}))?$/.exec(packageId);
  return m ? `${Number(m[1])}-${m[2]}-${Number(m[3])}-${m[4] ? Number(m[4]) : 1}` : null;
}

export function reportRow(r: CommitteeReport, known: Known, prov: Prov): CorpusRow {
  const t = REPORT_TYPES[r.type];
  const cite = r.citation ?? `${t?.label ?? r.type} ${r.congress}-${r.number}`;
  const site = `${CG_SITE}/congressional-report/${ordinal(r.congress)}-congress/${t?.site ?? "report"}/${r.number}/${r.part}`;
  const pkg = known.govinfoReports.get(reportKey(r)) ?? null;
  const pkgHeld = pkg !== null;
  const links: Json[] = [{ url: site, label: "Report on Congress.gov" }];
  if (pkgHeld) {
    links.push({ url: `https://www.govinfo.gov/app/details/${pkg}`, label: "Report on GovInfo" });
    links.push({
      url: `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}.pdf`,
      label: "PDF (GovInfo)",
    });
  }
  const bills = r.associatedBills.map((b) => ({ b, id: billId(b) }));
  for (const { b, id } of bills)
    if (id && known.bills.has(id))
      links.push({ url: billPage(b), label: `Associated bill: ${billCitation(b)}` });
  for (const c of r.committees)
    if (c.systemCode && known.committees.has(c.systemCode))
      links.push({
        url: `/law/legislation/committees/${c.systemCode}`,
        label: `Committee: ${c.name ?? c.systemCode}`,
      });
  return corpusRecord(
    DATASETS.reports,
    reportId(r),
    `${cite}${r.part > 1 ? `, part ${r.part}` : ""}: ${r.title ?? "Committee report"}`,
    {
      source_url: site,
      subtitle: [
        r.issueDate ? `issued ${r.issueDate}` : null,
        r.committees
          .map((c) => c.name)
          .filter(Boolean)
          .join("; ") || null,
        r.isConferenceReport ? "conference report" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      cells: {
        citation: cite,
        congress: String(r.congress),
        chamber: r.chamber ?? NOT_RECORDED,
        issued: r.issueDate ?? NOT_RECORDED,
        bills: r.associatedBills.length
          ? r.associatedBills.map(billCitation).join("; ")
          : r.detail
            ? "None associated"
            : NOT_RECORDED,
        committees: r.committees.length
          ? r.committees.map((c) => c.name ?? c.systemCode).join("; ")
          : NOT_RECORDED,
      },
      facts: [
        ["Citation", cite],
        ["Part", String(r.part)],
        ["Title (as published)", r.title ?? NOT_RECORDED],
        ["Report type", r.reportType ?? t?.label ?? r.type],
        [
          "Conference report",
          r.isConferenceReport === null ? NOT_RECORDED : r.isConferenceReport ? "Yes" : "No",
        ],
        [
          "Congress and session",
          `${ordinal(r.congress)} Congress${r.session ? `, session ${r.session}` : ""}`,
        ],
        ["Issued", r.issueDate ?? NOT_RECORDED],
        [
          "Committees",
          r.committees.length
            ? r.committees
                .map((c) => `${c.name ?? ""}${c.systemCode ? ` (${c.systemCode})` : ""}`)
                .join("; ")
            : NOT_RECORDED,
        ],
        [
          "Associated bills (Congress.gov)",
          r.associatedBills.length
            ? r.associatedBills
                .map((b) => `${billCitation(b)}, ${ordinal(b.congress)} Congress`)
                .join("; ")
            : r.detail
              ? "None"
              : NOT_RECORDED,
        ],
        [
          "GovInfo package",
          pkg ??
            (known.govinfoChecked
              ? "Not in GovInfo's Congressional Reports listing"
              : NOT_RECORDED),
        ],
        [
          "Source",
          `Congress.gov API v3, ${CG_API}/committee-report/${r.congress}/${r.type.toLowerCase()}/${r.number}`,
        ],
      ] as unknown as Json,
      badges: [t?.label ?? r.type, ...(r.isConferenceReport ? ["Conference"] : [])],
      links,
      text: [
        r.title,
        r.committees.map((c) => c.name).join(" "),
        r.associatedBills.map(billCitation).join(" "),
      ]
        .filter(Boolean)
        .join(" "),
      filters: {
        congress: [String(r.congress)],
        type: [r.type.toLowerCase()],
        chamber: r.chamber ? [r.chamber] : [],
        year: r.issueDate ? [r.issueDate.slice(0, 4)] : [],
        committee: r.committees.map((c) => c.systemCode).filter((x): x is string => Boolean(x)),
        bill: bills.map((x) => x.id).filter((x): x is string => Boolean(x)),
        conference: [r.isConferenceReport ? "yes" : "no"],
      },
      extra: {
        kind: "committee_report",
        report: r as unknown as JsonObject,
        govinfo_package: pkgHeld ? pkg : null,
        provenance: prov as unknown as JsonObject,
      },
    },
  );
}

/* ------------------------------------------------------------------ scheduled runs */

const KEY = "X-Api-Key";
async function cg(
  ctx: CollectContext,
  url: string,
): Promise<{ body: JsonObject; url: string; at: string }> {
  const sep = url.includes("?") ? "&" : "?";
  const res = await ctx.http.getText(`${url}${sep}format=json`, {
    headers: { [KEY]: ctx.env("DATA_GOV_API_KEY") ?? "" },
  });
  if (res.status === 404) return { body: {}, url: res.record.url, at: res.record.retrieved_at };
  if (res.status !== 200) throw new Error(`Congress.gov HTTP ${res.status}`);
  return {
    body: JSON.parse(res.text) as JsonObject,
    url: apiRecordUrl(res.record.url)!,
    at: res.record.retrieved_at,
  };
}

/** Which held records exact links may point to, for the candidate ids of one run. */
async function knownFor(
  ctx: CollectContext,
  want: { bills?: string[]; members?: string[]; committees?: string[]; judicial?: string[] },
): Promise<Known> {
  const k = emptyKnown();
  const load = async (dataset: string, ids: string[] | undefined, into: Set<string>) => {
    if (ids?.length)
      for (const r of await ctx.corpus.rowsBy(dataset, "id", ids, "id")) into.add(r.id);
  };
  await load("congress_bills", want.bills, k.bills);
  await load("congress_members", want.members, k.members);
  await load("congress_committees", want.committees, k.committees);
  await load("judicial_nominations", want.judicial, k.judicial);
  return k;
}

type Cursor = { from?: string };
const isoFloor = (iso: string, ms: number) =>
  new Date(Date.parse(iso) - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A Congress.gov collection read by update date: everything updated since the cursor (a day of overlap), newest first,
 * 250 a page, at most `pages`; details for the items that need them within the request budget.
 */
function cgAdapter<T>(o: {
  source: string;
  dataset: string;
  path: string;
  listKey: string;
  pages: number;
  details: number;
  normalize: (list: JsonObject, detail: JsonObject | null) => T | null;
  detailUrl: ((list: JsonObject) => string | null) | null;
  want: (items: T[]) => {
    bills?: string[];
    members?: string[];
    committees?: string[];
    judicial?: string[];
  };
  row: (item: T, known: Known, prov: Prov) => CorpusRow;
  order: (a: CorpusRow, b: CorpusRow) => number;
  firstFrom: string;
}): SourceAdapter {
  return {
    source: o.source,
    dataset: o.dataset,
    mode: "upsert",
    ordinalPolicy: "prepend",
    functionName: "ingest-congress-gov",
    limits: { maxRequests: o.pages + o.details, minIntervalMs: 800 },
    secrets: ["DATA_GOV_API_KEY"],
    async collect(ctx: CollectContext): Promise<Collected> {
      const cursor = (ctx.cursor ?? {}) as Cursor;
      const from = isoFloor(cursor.from ?? o.firstFrom, 86400_000);
      const to = ctx.now.toISOString().replace(/\.\d{3}Z$/, "Z");
      const items: { list: JsonObject; url: string; at: string }[] = [];
      const held: HeldRecord[] = [];
      const notes: JsonObject = { from, to };
      let complete = true;
      try {
        for (let page = 0; page < o.pages; page++) {
          const r = await cg(
            ctx,
            `${CG_API}/${o.path}?fromDateTime=${from}&toDateTime=${to}&sort=updateDate+desc&limit=250&offset=${page * 250}`,
          );
          const list = arr(r.body[o.listKey]);
          for (const l of list) items.push({ list: l, url: r.url, at: r.at });
          if (list.length < 250) break;
          if (page === o.pages - 1) complete = false;
        }
        const built: { item: T; prov: Prov }[] = [];
        let details = 0;
        for (const it of items) {
          let detail: JsonObject | null = null;
          let prov: Prov = { api_url: it.url, retrieved_at: it.at };
          const du = o.detailUrl ? o.detailUrl(it.list) : null;
          if (du && details < o.details && ctx.http.remaining > 0) {
            const d = await cg(ctx, du);
            details++;
            detail = d.body;
            prov = { ...prov, detail_url: d.url, detail_retrieved_at: d.at };
          } else if (du) complete = false;
          const n = o.normalize(it.list, detail);
          if (!n) {
            held.push({
              key: String(it.list["url"] ?? "?"),
              reason: "record without the identifiers the dataset needs",
            });
            continue;
          }
          built.push({ item: n, prov });
        }
        notes["read"] = items.length;
        notes["details"] = details;
        const known = await knownFor(ctx, o.want(built.map((b) => b.item)));
        const rows = new Map<string, CorpusRow>();
        for (const b of built) {
          const row = o.row(b.item, known, b.prov);
          rows.set(row.id, row);
        }
        return {
          rows: [...rows.values()].sort(o.order),
          fetched: items.length,
          held,
          cursorAfter: complete ? { from: to } : ctx.cursor,
          complete,
          notes,
        };
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited)
          return {
            rows: [],
            fetched: items.length,
            held,
            cursorAfter: ctx.cursor,
            complete: false,
            notes: { ...notes, stopped: error.message },
          };
        throw error;
      }
    },
    comparable: (c: RowContent) => {
      const item = { ...(c.item as JsonObject) };
      delete item["provenance"];
      return { ...(c as unknown as JsonObject), item } as Json;
    },
  };
}

const byDateDesc = (path: (r: CorpusRow) => string) => (a: CorpusRow, b: CorpusRow) => {
  const x = path(a);
  const y = path(b);
  return x !== y ? (x < y ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};
const inner = (r: CorpusRow, key: string, field: string) =>
  String(((r.item[key] ?? {}) as JsonObject)[field] ?? "");

/** Dataset order of amendments: newest latest action first. */
export const amendmentOrder = byDateDesc((r) =>
  String(
    (((r.item["amendment"] ?? {}) as JsonObject)["latestAction"] as JsonObject | null)?.["date"] ??
      "",
  ),
);
export const nominationOrder = byDateDesc((r) => inner(r, "nomination", "receivedDate"));
export const treatyOrder = byDateDesc((r) => inner(r, "treaty", "transmittedDate"));
export const reportOrder = byDateDesc((r) => inner(r, "report", "issueDate"));

export const congressAmendments = cgAdapter<Amendment>({
  source: "congress_amendments",
  dataset: DATASETS.amendments,
  path: "amendment",
  listKey: "amendments",
  pages: 4,
  details: 60,
  normalize: normalizeAmendment,
  detailUrl: (l) =>
    typeof l["url"] === "string" ? String(l["url"]).replace(/\?format=json$/, "") : null,
  want: (xs) => ({
    bills: xs
      .map((a) => (a.amendedBill ? billId(a.amendedBill) : null))
      .filter((x): x is string => Boolean(x)),
    members: xs.flatMap((a) =>
      a.sponsors.map((s) => s.bioguideId).filter((x): x is string => Boolean(x)),
    ),
  }),
  row: amendmentRow,
  order: amendmentOrder,
  firstFrom: "2026-10-20T00:00:00Z",
});

export const congressNominations = cgAdapter<Nomination>({
  source: "congress_nominations",
  dataset: DATASETS.nominations,
  path: "nomination",
  listKey: "nominations",
  pages: 4,
  details: 0,
  normalize: (l) => normalizeNomination(l),
  detailUrl: null,
  want: (xs) => ({ judicial: xs.map(nominationId) }),
  row: (n, k, p) => nominationRow(n, k, p),
  order: nominationOrder,
  firstFrom: "2026-10-20T00:00:00Z",
});

export const congressTreaties = cgAdapter<Treaty>({
  source: "congress_treaties",
  dataset: DATASETS.treaties,
  path: "treaty",
  listKey: "treaties",
  pages: 1,
  details: 20,
  normalize: normalizeTreaty,
  detailUrl: (l) =>
    typeof l["url"] === "string" ? String(l["url"]).replace(/\?format=json$/, "") : null,
  want: () => ({}),
  row: (t, _k, p) => treatyRow(t, p),
  order: treatyOrder,
  firstFrom: "2026-10-20T00:00:00Z",
});

export const congressCommitteeReports = cgAdapter<CommitteeReport>({
  source: "congress_committee_reports",
  dataset: DATASETS.reports,
  path: "committee-report",
  listKey: "reports",
  pages: 2,
  details: 60,
  normalize: normalizeReport,
  detailUrl: (l) =>
    typeof l["url"] === "string" ? String(l["url"]).replace(/\?format=json$/, "") : null,
  want: (xs) => ({
    bills: xs.flatMap((r) => r.associatedBills.map(billId).filter((x): x is string => Boolean(x))),
    committees: xs.flatMap((r) =>
      r.committees.map((c) => c.systemCode).filter((x): x is string => Boolean(x)),
    ),
  }),
  row: reportRow,
  order: reportOrder,
  firstFrom: "2026-10-20T00:00:00Z",
});
