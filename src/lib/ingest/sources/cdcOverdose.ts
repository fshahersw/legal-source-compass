/**
 * CDC NCHS VSRR provisional drug overdose death counts (data.cdc.gov dataset xkb8-kh2a): 12-month-ending counts of
 * overdose deaths by state and drug class, monthly from 2015, as reported and as predicted (adjusted for delayed
 * reporting). One row per jurisdiction (the states, DC, Puerto Rico, New York City as "YC" and the United States) with
 * one series per indicator. A value CDC suppresses for low data quality stays empty ("Not recorded"), never zero.
 * Public domain U.S. Government (data.cdc.gov licence). Source: https://data.cdc.gov/d/xkb8-kh2a
 */
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CorpusRow,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";

export const OVERDOSE_DATASET = "cdc_overdose_states";
export const OVERDOSE_PAGE = "https://data.cdc.gov/d/xkb8-kh2a";
export const OVERDOSE_CSV =
  "https://data.cdc.gov/resource/xkb8-kh2a.csv?$select=state,state_name,year,month,indicator,data_value,predicted_value,percent_complete,footnote_symbol&$limit=200000&$order=state,indicator,year,month";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** One CSV line of quoted or empty fields. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

export type OverdosePoint = [string, number | null, number | null, number | null, string | null];
export type OverdoseState = {
  code: string;
  name: string;
  indicators: Record<string, OverdosePoint[]>;
};

const num = (v: string | undefined) => {
  const t = (v ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Jurisdictions with their series ("YYYY-MM" = 12 months ending that month: [month, reported, predicted, % complete, footnote symbol]). */
export function parseOverdose(csv: string): OverdoseState[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = csvFields(lines[0] ?? "");
  const ix = (k: string) => head.indexOf(k);
  const cols = [
    "state",
    "state_name",
    "year",
    "month",
    "indicator",
    "data_value",
    "predicted_value",
    "percent_complete",
    "footnote_symbol",
  ].map(ix);
  if (cols.some((c) => c < 0)) throw new Error("the overdose file columns changed");
  const [cS, cN, cY, cM, cI, cV, cP, cC, cF] = cols as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const states = new Map<string, OverdoseState>();
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const code = (f[cS] ?? "").trim();
    const month = MONTHS.indexOf((f[cM] ?? "").trim());
    const year = (f[cY] ?? "").trim();
    const ind = (f[cI] ?? "").trim();
    if (!/^[A-Z]{2}$/.test(code) || month < 0 || !/^\d{4}$/.test(year) || !ind) continue;
    let s = states.get(code);
    if (!s) {
      s = { code, name: (f[cN] ?? code).trim() || code, indicators: {} };
      states.set(code, s);
    }
    (s.indicators[ind] ??= []).push([
      `${year}-${String(month + 1).padStart(2, "0")}`,
      num(f[cV]),
      num(f[cP]),
      num(f[cC]),
      (f[cF] ?? "").trim() || null,
    ]);
  }
  for (const s of states.values())
    for (const k of Object.keys(s.indicators))
      s.indicators[k]!.sort((a, b) => a[0].localeCompare(b[0]));
  return [...states.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export const TOTAL = "Number of Drug Overdose Deaths";

export function overdoseRow(s: OverdoseState, retrieved: string): CorpusRow {
  const total = s.indicators[TOTAL] ?? [];
  const last = [...total].reverse().find((p) => p[1] !== null || p[2] !== null) ?? null;
  const yearBefore = last
    ? (total.find((p) => p[0] === `${Number(last[0].slice(0, 4)) - 1}${last[0].slice(4)}`) ?? null)
    : null;
  const change =
    last && yearBefore && last[1] !== null && yearBefore[1] !== null && yearBefore[1] > 0
      ? Math.round((last[1] / yearBefore[1] - 1) * 1000) / 10
      : null;
  return corpusRecord(
    OVERDOSE_DATASET,
    `od:${s.code}`,
    `${s.name}: provisional drug overdose deaths`,
    {
      source_url: OVERDOSE_PAGE,
      state: /^[A-Z]{2}$/.test(s.code) && !["US", "YC"].includes(s.code) ? s.code : "",
      subtitle: last
        ? `12 months ending ${last[0]}: ${last[1] !== null ? last[1].toLocaleString("en-US") : "Not recorded"} reported${last[2] !== null ? `, ${last[2].toLocaleString("en-US")} predicted` : ""}`
        : "Not recorded",
      cells: {
        jurisdiction: s.name,
        code: s.code,
        latest_period: last?.[0] ?? null,
        reported: last?.[1] ?? null,
        predicted: last?.[2] ?? null,
        change_vs_year_before_pct: change,
        indicators: Object.keys(s.indicators).length,
      },
      facts: [
        ["Jurisdiction", s.name],
        [
          "Measure",
          "Provisional counts of drug overdose deaths in the 12 months ending each month, by drug class (ICD-10 codes as CDC labels them)",
        ],
        ["Latest period", last ? `12 months ending ${last[0]}` : "Not recorded"],
        [
          "Reported and predicted",
          "Reported counts can be incomplete for recent months; CDC's predicted values adjust for delayed reporting. Both are shown as published.",
        ],
        [
          "Suppressed values",
          "Values CDC does not show for low data quality are left empty, not zero.",
        ],
        ["Retrieved", retrieved],
      ],
      text: `${s.name} ${s.code} drug overdose deaths opioids fentanyl synthetic heroin cocaine methamphetamine provisional CDC NCHS`,
      filters: { code: [s.code] },
      links: [{ label: "CDC NCHS VSRR provisional overdose death counts", url: OVERDOSE_PAGE }],
      extra: {
        overdose: {
          code: s.code,
          name: s.name,
          columns: ["period", "reported", "predicted", "percent_complete", "footnote_symbol"],
          indicators: s.indicators,
        } as unknown as JsonObject,
      },
    },
  );
}

export function comparableOverdose(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).filter(
    (f) => !(Array.isArray(f) && f[0] === "Retrieved"),
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

export const cdcOverdose: SourceAdapter = {
  source: "cdc_overdose_states",
  dataset: OVERDOSE_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-reference",
  limits: { maxRequests: 2, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    const res = await ctx.http.getText(OVERDOSE_CSV);
    if (res.status !== 200) throw new Error(`CDC overdose data HTTP ${res.status}`);
    const states = parseOverdose(res.text);
    if (states.length < 50) throw new Error(`only ${states.length} jurisdictions read`);
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const rows = states.map((s) => overdoseRow(s, retrieved));
    const us = states.find((s) => s.code === "US");
    const last = us?.indicators[TOTAL]?.at(-1)?.[0] ?? null;
    return {
      rows,
      fetched: states.length,
      held: [],
      cursorAfter: { latest: last },
      complete: true,
      notes: { jurisdictions: states.length, latest_period: last },
    };
  },
  comparable: comparableOverdose,
};
