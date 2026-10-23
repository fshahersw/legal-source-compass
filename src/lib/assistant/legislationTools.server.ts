/**
 * Assistant tools over the legislation collections: search federal bills (congress_bills, GovInfo Bill Status, 108th-119th
 * Congress) and state bills (state_bills, Open States public data), and read one bill. Read-only corpus reads through the
 * same server functions as the pages; results are bounded and carry the in-app page and the official source to cite.
 */
import {
  readFederalBill,
  readStateBill,
  runLegislationSearch,
} from "@/lib/external/legislation.functions";
import {
  BILL_NUMBER,
  BILL_TYPES,
  CONGRESS,
  STATE,
  STATE_BILL_ID,
  parseBillCitation,
  type BillType,
} from "@/lib/external/legislation";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 12000;
const MAX_BILL = 24000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;

export const LEGISLATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_bills",
    description:
      "Search bills and resolutions. scope 'federal': every measure of the 108th-119th Congress (2003-2026) from GovInfo Bill Status, searchable by words in titles, subjects and sponsor names, by citation (e.g. 'H.R. 3935', 'S.J.Res. 12') or by the law it became ('Public Law 118-63'); filter by Congress, measure type and status (introduced, reported, passed_house, passed_senate, passed_both, to_president, vetoed, became_law). scope 'state': bills of each state legislature's current and preceding regular session (50 states, DC, Puerto Rico) from Open States, by words or bill number (e.g. 'AB 1') and filter by state and session. Returns citation, title, sponsor, latest action, status and the page to cite.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["federal", "state"] },
        query: {
          type: "string",
          description: "Words, a citation or a bill number (up to 200 characters).",
        },
        congress: { type: "integer", minimum: 108, maximum: 119 },
        type: { type: "string", enum: [...BILL_TYPES] },
        status: { type: "string", description: "A status value listed above." },
        state: { type: "string", description: "Two-letter state code (state scope)." },
        session: {
          type: "string",
          description: "Session identifier as listed in results (state scope).",
        },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["scope"],
    },
  },
  {
    name: "get_bill",
    description:
      "Read one bill in full. Federal: give a citation ('H.R. 3935') with congress, or congress + type + number; returns titles, sponsor and cosponsors, committees, every action with its code, recorded votes, the latest CRS summary (with its version and date), text versions, committee reports, related bills, the resulting law and status milestones derived from published action codes. State: give the state bill id from search_bills; returns title, sponsors, actions, milestones, versions and the legislature's own page.",
    input_schema: {
      type: "object",
      properties: {
        congress: { type: "integer", minimum: 108, maximum: 119 },
        citation: { type: "string", description: "e.g. 'H.R. 3935' or 'S. 1'." },
        type: { type: "string", enum: [...BILL_TYPES] },
        number: { type: "integer", minimum: 1, maximum: 99999 },
        state_bill_id: {
          type: "string",
          description: "Id of a state bill from search_bills (e.g. ca-20252026-ab1).",
        },
      },
    },
  },
];

const fedPage = (c: number | string, t: string, n: string) =>
  `/law/legislation/federal/${c}/${t}/${n}`;
const statePage = (id: string) => `/law/legislation/state/${id}`;

async function searchBillsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const scope = input["scope"] === "state" ? "state" : "federal";
  const q = str(input["query"], 200).trim();
  const congress = int(input["congress"], 108, 119, 0);
  const type = str(input["type"], 10);
  const status = str(input["status"], 30);
  const state = str(input["state"], 2).toUpperCase();
  const session = str(input["session"], 60);
  const r = await runLegislationSearch({
    scope,
    q,
    page: int(input["page"], 1, 20, 1),
    ...(scope === "federal"
      ? {
          ...(congress ? { congress: String(congress) } : {}),
          ...((BILL_TYPES as readonly string[]).includes(type) ? { type: type as BillType } : {}),
          ...(/^[a-z_]{2,30}$/.test(status) ? { status } : {}),
        }
      : {
          ...(STATE.test(state) ? { state } : {}),
          ...(/^[A-Za-z0-9 _.-]{1,60}$/.test(session) ? { session } : {}),
          ...(/^[a-z_]{2,30}$/.test(status) ? { status } : {}),
        }),
  });
  const rows =
    r.scope === "federal"
      ? r.rows.map((h) => ({
          citation: h.citation,
          title: h.title,
          sponsor: h.sponsor,
          introduced: h.introduced,
          latest_action: h.latestActionDate
            ? `${h.latestActionDate}: ${h.latestAction ?? ""}`
            : h.latestAction,
          status: h.statusLabel,
          law: h.law,
          page: fedPage(h.congress, h.type, h.number),
        }))
      : r.rows.map((h) => ({
          bill: `${h.identifier} (${h.state}, ${h.sessionName})`,
          state_bill_id: h.id,
          title: h.title,
          sponsor: h.sponsor,
          latest_action: h.latestActionDate
            ? `${h.latestActionDate}: ${h.latestAction ?? ""}`
            : h.latestAction,
          status: h.statusLabel,
          page: statePage(h.id),
          official_source: h.sourceUrl,
        }));
  return {
    content: clip(
      JSON.stringify({
        scope,
        match: r.mode,
        total: r.total,
        page: r.page,
        returned: rows.length,
        results: rows,
      }),
    ),
    sources: rows.slice(0, 6).map((x) => ({
      title: "citation" in x ? `${x.citation}` : `${x.bill}`,
      url: x.page,
      internal: true,
    })),
    label: scope === "federal" ? "Searched federal bills" : "Searched state bills",
    detail: `${q ? `“${q}”` : "all"} · ${rows.length} of ${r.total ?? rows.length}`,
  };
}

async function getBillTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const sid = str(input["state_bill_id"], 120);
  if (sid) {
    if (!STATE_BILL_ID.test(sid)) throw new Error("invalid state_bill_id");
    const b = await readStateBill(sid);
    if (!b)
      return {
        content: JSON.stringify({ found: false }),
        sources: [],
        label: "Read a state bill",
        detail: `${sid} · not found`,
      };
    const { actions, ...rest } = b;
    return {
      content: clip(
        JSON.stringify({ ...rest, actions: actions.slice(-60), page: statePage(b.id) }),
        MAX_BILL,
      ),
      sources: [
        { title: `${b.identifier} (${b.stateName})`, url: statePage(b.id), internal: true },
        ...(b.sourceUrl
          ? [{ title: `Legislature: ${b.identifier}`, url: b.sourceUrl, internal: false }]
          : []),
      ],
      label: "Read a state bill",
      detail: `${b.identifier} · ${b.stateName}`,
    };
  }
  const congress = int(input["congress"], 108, 119, 0);
  let type = str(input["type"], 10);
  let number = typeof input["number"] === "number" ? String(input["number"]) : "";
  const cite = str(input["citation"], 60);
  if (cite) {
    const c = parseBillCitation(cite);
    if (!c) throw new Error("citation not recognised; use e.g. 'H.R. 3935'");
    type = c.type;
    number = c.number;
  }
  if (
    !congress ||
    !CONGRESS.test(String(congress)) ||
    !(BILL_TYPES as readonly string[]).includes(type) ||
    !BILL_NUMBER.test(number)
  )
    throw new Error(
      "give congress (108-119) with a citation, or congress + type + number, or a state_bill_id",
    );
  const r = await readFederalBill({ congress: String(congress), type: type as BillType, number });
  if (!r)
    return {
      content: JSON.stringify({ found: false }),
      sources: [],
      label: "Read a federal bill",
      detail: `${type} ${number} (${congress}) · not found`,
    };
  const b = r.bill;
  const payload = {
    ...b,
    cosponsors: b.cosponsors.slice(0, 60),
    actions: b.actions.slice(0, 120),
    summary: b.summary ? { ...b.summary, blocks: b.summary.blocks.slice(0, 80) } : null,
    crs_reports: r.crs,
    page: fedPage(b.congress, b.type, b.number),
    note: "Status milestones are derived only from published Congress.gov action codes; the CRS summary describes the version named.",
  };
  return {
    content: clip(JSON.stringify(payload), MAX_BILL),
    sources: [
      { title: b.display, url: fedPage(b.congress, b.type, b.number), internal: true },
      ...(b.congressGovUrl
        ? [{ title: `Congress.gov: ${b.display}`, url: b.congressGovUrl, internal: false }]
        : []),
    ],
    label: "Read a federal bill",
    detail: b.display,
  };
}

export const LEGISLATION_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  search_bills: searchBillsTool,
  get_bill: getBillTool,
};
