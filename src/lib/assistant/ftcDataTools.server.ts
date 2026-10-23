/**
 * Assistant tools over the FTC open-data datasets, read-only through the same corpus reads as the site:
 *
 *  - ftc_dnc_trends: Do Not Call reports counted by month for the United States or one state (ftc_dnc_reported_calls), with the
 *    FTC Data Book's fiscal-year figures for the state (ftc_dnc_states) beside them.
 *  - ftc_hsr_notices: HSR early termination notices (ftc_hsr_early_terminations) found by the party names the FTC publishes,
 *    exact or contains. Names are never merged, normalised across spellings or matched fuzzily: a company that appears under
 *    two spellings is two names.
 *
 * Every figure is returned as stored with the period it covers; a month that is not counted is absent, never zero.
 */
import { restGet } from "@/lib/external/rest.server";
import { STATES, stateByName, stateByUsps } from "@/lib/corpus/geo";
import {
  dayRange,
  parseDncMonths,
  parseOfficialMonths,
  parseStateCallsMonths,
  subjectShares,
} from "@/lib/external/ftcData";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const DNC_PAGE = "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data";
const NOTICE_INDEX = "https://www.ftc.gov/legal-library/browse/early-termination-notices";
const MAX_NOTICES = 25;
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const cs = (filters: Record<string, string[]>) =>
  `filters=cs.${encodeURIComponent(JSON.stringify(filters))}`;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const FTC_DATA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "ftc_dnc_trends",
    description:
      'Do Not Call reported calls (consumer reports to the FTC of unwanted calls) counted by month for the United States or one state, with the reports\' robocall share, the most reported subjects, reports per 100,000 residents (Census denominator named) and the state\'s rank, plus the FTC Data Book\'s fiscal-year complaint counts for the state. Only months the platform has counted are returned, each with the days it covers; a month not returned was not counted (do not treat it as zero). Reports are unverified. Optional "state" (USPS code such as TX or the state\'s name) and "from"/"to" months (YYYY-MM).',
    input_schema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description: "USPS code (TX) or exact state name; omit for the United States.",
        },
        from: { type: "string", description: "First month, YYYY-MM." },
        to: { type: "string", description: "Last month, YYYY-MM." },
      },
    },
  },
  {
    name: "ftc_hsr_notices",
    description:
      'Find HSR early termination notices the FTC published (Hart-Scott-Rodino Act: early termination of a premerger waiting period granted for one transaction) by the party names exactly as published: "party" with match "contains" (default; a word or phrase inside the acquiring party, the acquired party or an acquired entity) or "exact" (the whole name, any letter case), or a "transaction_number". Names are never merged across spellings or matched fuzzily. Returns the transaction number, date granted, parties, entities acquired and the notice link; a notice does not say the deal closed.',
    input_schema: {
      type: "object",
      properties: {
        party: {
          type: "string",
          description: "Company or person name as the FTC publishes it (2-120 characters).",
        },
        match: { type: "string", enum: ["contains", "exact"] },
        transaction_number: {
          type: "string",
          description: "Eight-digit HSR transaction number, e.g. 20262194.",
        },
        date_from: { type: "string", description: "Earliest date granted, YYYY-MM-DD." },
        date_to: { type: "string", description: "Latest date granted, YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: MAX_NOTICES },
      },
    },
  },
];

/** A USPS code for the input (a code or an exact state name, any case); null when it is neither. Puerto Rico is accepted. */
export function resolveState(input: unknown): { usps: string; name: string } | null {
  const s = str(input, 60).trim();
  if (!s) return null;
  const byCode = stateByUsps.get(s.toUpperCase());
  if (byCode) return { usps: byCode.usps, name: byCode.name };
  const lower = s.toLowerCase();
  const hit = STATES.find((x) => x.name.toLowerCase() === lower) ?? stateByName.get(s);
  if (hit) return { usps: hit.usps, name: hit.name };
  if (s.toUpperCase() === "PR" || lower === "puerto rico")
    return { usps: "PR", name: "Puerto Rico" };
  return null;
}

/** A term for an ilike filter with the filter syntax characters removed; null when nothing usable is left. */
export function safeTerm(input: unknown, min = 2): string | null {
  const t = str(input, 160)
    .replace(/[*,()%_\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= min ? t.slice(0, 120) : null;
}

const SELECT_MONTH =
  "id,month:item->>month,complete:item->complete,method:item->>method,first:item->>first_day,last:item->>last_day,days:item->days_covered,dim:item->days_in_month,m:item->metrics,a:item->analytics,subj:item->subjects,api:item->api_count,source_url";

function inRange(month: string, from: string | null, to: string | null) {
  return (!from || month >= from) && (!to || month <= to);
}

async function dncTrendsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const from =
    typeof input["from"] === "string" && MONTH.test(input["from"]) ? input["from"] : null;
  const to = typeof input["to"] === "string" && MONTH.test(input["to"]) ? input["to"] : null;
  if (typeof input["from"] === "string" && input["from"] && !from)
    throw new Error('"from" must be a month such as 2026-09');
  if (typeof input["to"] === "string" && input["to"] && !to)
    throw new Error('"to" must be a month such as 2026-09');
  const wanted =
    input["state"] === undefined || input["state"] === null || input["state"] === ""
      ? null
      : resolveState(input["state"]);
  if (input["state"] && !wanted)
    throw new Error(
      "state must be a USPS code such as TX or an exact state name (50 states, DC or Puerto Rico)",
    );
  const [national, official, state, bookRows] = await Promise.all([
    restGet<unknown[]>(
      `corpus_records?select=${SELECT_MONTH}&dataset=eq.ftc_dnc_reported_calls&${cs({ kind: ["national"] })}&order=id.asc&limit=400`,
    ),
    restGet<unknown[]>(
      `corpus_records?select=${SELECT_MONTH}&dataset=eq.ftc_dnc_reported_calls&${cs({ kind: ["official"] })}&order=id.asc&limit=100`,
    ),
    wanted
      ? restGet<unknown[]>(
          `corpus_records?select=${SELECT_MONTH}&dataset=eq.ftc_dnc_reported_calls&state=eq.${wanted.usps}&id=like.${wanted.usps}-2*&order=id.asc&limit=100`,
        )
      : Promise.resolve({ rows: [] as unknown[], total: null }),
    wanted
      ? restGet<unknown[]>(
          `corpus_records?select=id,source_url,cells:item->cells,m:item->metrics&dataset=eq.ftc_dnc_states&state=eq.${wanted.usps}&order=id.asc&limit=20`,
        )
      : Promise.resolve({ rows: [] as unknown[], total: null }),
  ]);
  const natMonths = parseDncMonths(national.rows).filter((m) => inRange(m.month, from, to));
  const stateMonths = wanted
    ? parseStateCallsMonths(state.rows, wanted.usps).filter((m) => inRange(m.month, from, to))
    : [];
  const dashboard = parseOfficialMonths(official.rows).filter((m) => inRange(m.month, from, to));
  const topSubjects = (subjects: { subject: string; calls: number }[]) => {
    const s = subjectShares([{ subjects }]);
    return {
      named: s.named
        .slice(0, 5)
        .map((x) => ({ subject: x.subject, reports: x.calls, share_pct: x.sharePct })),
      catch_all: s.catchAll.map((x) => ({
        subject: x.subject,
        reports: x.calls,
        share_pct: x.sharePct,
      })),
    };
  };
  const fiscal = bookRows.rows.flatMap((raw) => {
    const r = obj(raw);
    const m = /^([A-Z]{2})-FY(\d{4})$/.exec(str(r?.["id"]));
    const metrics = obj(r?.["m"]);
    const cells = obj(r?.["cells"]);
    if (!r || !m || !metrics || wanted?.usps !== m[1]) return [];
    return [
      {
        fiscal_year: Number(m[2]),
        complaints: typeof metrics["complaints"] === "number" ? metrics["complaints"] : null,
        complaints_per_100k:
          typeof metrics["complaints_per100k"] === "number" ? metrics["complaints_per100k"] : null,
        rank_of_50_states:
          typeof metrics["complaints_rank"] === "number" ? metrics["complaints_rank"] : null,
        as_printed: str(cells?.["complaints"], 40) || null,
        source: str(r["source_url"], 300) || null,
      },
    ];
  });
  const months = wanted
    ? stateMonths.map((m) => ({
        month: m.month,
        complete: m.complete,
        days_counted: m.firstDay && m.lastDay ? dayRange(m.firstDay, m.lastDay) : null,
        reports: m.calls,
        robocall_share_pct: m.robocallSharePct,
        per_100k_residents: m.per100k,
        rank_per_100k:
          m.rankPer100k && m.rankedOf
            ? `${m.rankPer100k} of ${m.rankedOf} (50 states, DC, Puerto Rico)`
            : null,
        population_denominator: m.population
          ? `${m.population} (Census resident population, July 1, ${m.populationYear ?? "year not recorded"})`
          : null,
        subjects: topSubjects(m.subjects),
      }))
    : natMonths.map((m) => ({
        month: m.month,
        complete: m.complete,
        method:
          m.method === "records"
            ? "every record counted"
            : "records counted by paging the API; subjects and states not read",
        days_counted:
          m.firstDay && m.lastDay
            ? dayRange(m.firstDay, m.lastDay)
            : m.method === "count"
              ? "whole month"
              : null,
        reports: m.calls,
        reported_as_robocall: m.robocalls,
        reported_as_not_a_recording: m.notRobocalls,
        no_answer: m.noFlag,
        robocall_share_pct: m.robocallSharePct,
        subjects: m.subjects.length ? topSubjects(m.subjects) : null,
      }));
  const scope = wanted ? `${wanted.name} (${wanted.usps})` : "United States";
  const body = {
    scope,
    period_requested:
      from || to ? `${from ?? "earliest"} to ${to ?? "latest"}` : "all counted months",
    months_returned: months.length,
    months,
    ...(wanted
      ? { data_book_fiscal_years: fiscal }
      : {
          ftc_dashboard_months: dashboard.map((d) => ({
            month: d.month,
            complaints: d.total,
            robocall: d.robocall,
            live_caller: d.live,
            ...(d.apiTotal !== null ? { ftc_api_records_for_same_month: d.apiTotal } : {}),
          })),
        }),
    how_to_read: [
      "Reports are consumers' submissions about unwanted calls; the FTC states that none of the information is verified.",
      "A partial month (complete=false) covers only the days stated and is not comparable with a whole month.",
      wanted
        ? "The state is the one the consumer reported; reports with no state are in the national counts only. Per-100,000 uses the Census denominator named on each month."
        : "Months not listed were not counted; they are not zero.",
      "Robocall share = reported as a recorded message / reported as either a recording or not; reports with no answer are left out.",
      "Dashboard months and months counted from the daily files are different counts; do not compare a dashboard month with a counted month. Where ftc_api_records_for_same_month is given, the FTC API lists that many records for the month, which differs from the dashboard figure.",
    ],
    ...(months.length
      ? {}
      : {
          note: "No counted month matches. State what the platform does not hold; do not estimate.",
        }),
  };
  const sources = [
    { title: "FTC Do Not Call reported calls data", url: DNC_PAGE, internal: false },
    {
      title: "Do Not Call reported calls in the workspace",
      url: "/data/ftc_dnc_reported_calls",
      internal: true,
    },
    ...(wanted && fiscal.length
      ? [
          {
            title: `${wanted.name} Do Not Call Data Book figures`,
            url: "/data/ftc_dnc_states",
            internal: true,
          },
        ]
      : []),
  ];
  return {
    content: JSON.stringify(body),
    sources,
    label: "Read Do Not Call report trends",
    detail: `${scope} · ${months.length} month${months.length === 1 ? "" : "s"}`,
  };
}

const NOTICE_SELECT = "id,source_url,t:title,n:item->notice,link:item->links";

async function hsrNoticesTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const txn =
    typeof input["transaction_number"] === "string" ? input["transaction_number"].trim() : "";
  if (txn && !/^\d{8}$/.test(txn))
    throw new Error("transaction_number must be the eight-digit HSR transaction number");
  const rawParty = typeof input["party"] === "string" ? input["party"] : "";
  const party = rawParty ? safeTerm(rawParty) : null;
  if (rawParty && !party) throw new Error("party must be 2 to 120 characters of a name");
  if (!txn && !party) throw new Error("give a party name or a transaction_number");
  const exact = input["match"] === "exact";
  const dateFrom =
    typeof input["date_from"] === "string" && DAY.test(input["date_from"])
      ? input["date_from"]
      : null;
  const dateTo =
    typeof input["date_to"] === "string" && DAY.test(input["date_to"]) ? input["date_to"] : null;
  const limit =
    typeof input["limit"] === "number" && Number.isInteger(input["limit"])
      ? Math.min(MAX_NOTICES, Math.max(1, input["limit"]))
      : 10;
  const filters: string[] = ["dataset=eq.ftc_hsr_early_terminations", cs({ kind: ["notice"] })];
  if (txn) filters.push(`item->notice->>transaction_number=eq.${encodeURIComponent(txn)}`);
  if (party && exact) {
    // the name is double-quoted: a dot or colon inside an or=() value is otherwise read as filter syntax
    const e = encodeURIComponent(`"${party}"`);
    filters.push(
      `or=(item->notice->>acquiring_party.ilike.${e},item->notice->>acquired_party.ilike.${e})`,
    );
  } else if (party) {
    filters.push(`text=ilike.${encodeURIComponent(`*${party}*`)}`);
  }
  if (dateFrom) filters.push(`item->notice->>date=gte.${dateFrom}`);
  if (dateTo) filters.push(`item->notice->>date=lte.${dateTo}`);
  const r = await restGet<unknown[]>(
    `corpus_records?select=${NOTICE_SELECT}&${filters.join("&")}&order=item->notice->>date.desc.nullslast,id.asc&limit=${limit}`,
    { count: true },
  );
  const notices = r.rows.flatMap((raw) => {
    const row = obj(raw);
    const n = obj(row?.["n"]);
    if (!row || !n) return [];
    const number = str(n["transaction_number"], 20);
    return [
      {
        transaction_number: number || null,
        date_granted: str(n["date"], 12) || null,
        fiscal_year: typeof n["fiscal_year"] === "number" ? n["fiscal_year"] : null,
        acquiring_party: str(n["acquiring_party"]) || null,
        acquired_party: str(n["acquired_party"]) || null,
        acquired_entities: Array.isArray(n["acquired_entities"])
          ? n["acquired_entities"].filter((e): e is string => typeof e === "string").slice(0, 8)
          : [],
        notice_page: /^\d{8}$/.test(number) ? `${NOTICE_INDEX}/${number}` : null,
        record: str(row["id"], 40),
      },
    ];
  });
  const body = {
    query: {
      party: party ?? null,
      match: party ? (exact ? "exact (whole name, any letter case)" : "contains") : null,
      transaction_number: txn || null,
      date_from: dateFrom,
      date_to: dateTo,
    },
    matched_total: r.total,
    returned: notices.length,
    notices,
    how_to_read: [
      "A notice is the FTC's record that early termination of the HSR waiting period was granted for one transaction; it does not say the deal closed or that no enforcement followed.",
      "Names are exactly as the FTC publishes them. Different spellings of one company are different names here and are not merged; absence of a notice under a name does not mean the company had none under another name.",
      "The FTC suspended early termination from February 2021 until 2025, so few notices are dated in between.",
    ],
    ...(notices.length
      ? {}
      : { note: "No published notice matches this name. Say so; do not guess a spelling." }),
  };
  return {
    content: JSON.stringify(body),
    sources: [
      { title: "FTC early termination notices", url: NOTICE_INDEX, internal: false },
      {
        title: "Early termination notices in the workspace",
        url: "/data/ftc_hsr_early_terminations",
        internal: true,
      },
    ],
    label: "Looked up HSR early termination notices",
    detail: `${party ?? txn} · ${notices.length} of ${r.total ?? "?"}`,
  };
}

export const FTC_DATA_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  ftc_dnc_trends: dncTrendsTool,
  ftc_hsr_notices: hsrNoticesTool,
};
