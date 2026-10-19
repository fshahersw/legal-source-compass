/**
 * A judge's financial disclosure reports in CourtListener (dataset clb_judge_disclosures, compiled by
 * scripts/enrichment/courtlistener_rest). Counts per report year and section; gifts, reimbursements and agreements as
 * CourtListener extracted them, listed only from reports whose original file name carries the person's surname, and never for a
 * person whose reports carry two numbered circuits (attribution conflict). A judge page reaches the record through the
 * judge_cl_crosswalk (linked tiers only). Stored JSON is validated here; malformed values are dropped, never repaired. Read-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { JUDGE_ID, parseCrosswalk } from "./judgeCourtListener.functions";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 320) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const year = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1970 && n <= 2100 ? n : null;
};

export const SECTIONS = [
  ["investments", "Investments"],
  ["gifts", "Gifts"],
  ["reimbursements", "Reimbursements"],
  ["agreements", "Agreements"],
  ["outside_positions", "Outside positions"],
  ["debts", "Debts"],
  ["non_investment_income", "Non-investment income"],
  ["spousal_income", "Spousal income"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
export type SectionCounts = Record<SectionKey, number>;

export type DisclosureYear = {
  year: number;
  reports: number;
  amended: number;
  pages: number | null;
  items: SectionCounts;
};
export type Gift = {
  year: number | null;
  reportId: number;
  redacted: boolean;
  source: string | null;
  description: string | null;
  valueAsFiled: string | null;
};
export type Reimbursement = {
  year: number | null;
  reportId: number;
  redacted: boolean;
  source: string | null;
  datesAsFiled: string | null;
  location: string | null;
  purpose: string | null;
  itemsPaid: string | null;
};
export type Agreement = {
  year: number | null;
  reportId: number;
  redacted: boolean;
  dateAsFiled: string | null;
  partiesAndTerms: string | null;
};
export type ReportRow = {
  id: number;
  year: number | null;
  amended: boolean;
  pages: number | null;
  /** 'match' the file name carries the surname; 'mismatch' another name; 'unchecked' unreadable. */
  fileCheck: "match" | "mismatch" | "unchecked";
  filerCode: string | null;
  /** CourtListener's copy of the report, only when its path names exactly this person id. */
  pdf: string | null;
};
export type JudgeDisclosures = {
  personId: number;
  name: string;
  reports: number;
  amended: number | null;
  firstYear: number | null;
  lastYear: number | null;
  years: DisclosureYear[];
  itemsTotal: SectionCounts;
  itemsRedacted: SectionCounts;
  itemsWithheld: { gifts: number; reimbursements: number; agreements: number };
  gifts: Gift[];
  reimbursements: Reimbursement[];
  reimbursementsListed: number;
  agreements: Agreement[];
  attribution: {
    status: "consistent" | "conflict" | "unchecked";
    circuits: { code: string; reports: number }[];
    matching: number;
    other: number;
    unchecked: number;
  };
  reportList: ReportRow[];
  statsRecord: string | null;
};

function counts(v: unknown): SectionCounts | null {
  const o = obj(v);
  if (!o) return null;
  const out = {} as SectionCounts;
  for (const [k] of SECTIONS) {
    const n = count(o[k]);
    if (n == null) return null;
    out[k] = n;
  }
  return out;
}

const reportId = (v: unknown, ids: Set<number>) => {
  const n = count(v);
  return n != null && ids.has(n) ? n : null;
};

export function parseJudgeDisclosures(raw: unknown, personId: number): JudgeDisclosures | null {
  const p = obj(raw);
  if (!p || p["person_id"] !== personId) return null;
  const name = str(p["name"], 200);
  const reports = count(p["reports"]);
  const itemsTotal = counts(p["items_total"]);
  const itemsRedacted = counts(p["items_redacted"]);
  if (!name || reports == null || reports === 0 || !itemsTotal || !itemsRedacted) return null;
  const pdfPrefix = `https://storage.courtlistener.com/us/federal/judicial/financial-disclosures/${personId}/`;
  const reportList: ReportRow[] = arr(p["report_list"]).flatMap((x) => {
    const o = obj(x);
    const id = count(o?.["id"]);
    const fc = o?.["file_check"];
    if (id == null || (fc !== "match" && fc !== "mismatch" && fc !== "unchecked")) return [];
    const pdf = str(o?.["pdf"], 400);
    return [
      {
        id,
        year: year(o?.["year"]),
        amended: o?.["amended"] === true,
        pages: count(o?.["pages"]),
        fileCheck: fc,
        filerCode: str(o?.["filer_code"], 24),
        pdf:
          pdf && pdf.startsWith(pdfPrefix) && pdf.endsWith(".pdf") && !pdf.includes("..")
            ? pdf
            : null,
      },
    ];
  });
  if (reportList.length !== reports) return null;
  const att = obj(p["attribution"]);
  const status = att?.["status"];
  if (status !== "consistent" && status !== "conflict" && status !== "unchecked") return null;
  const conflict = status === "conflict";
  // items are shown only from reports that passed the surname check, and never for a conflict
  const shown = new Set(
    conflict ? [] : reportList.filter((r) => r.fileCheck === "match").map((r) => r.id),
  );
  const gifts: Gift[] = arr(p["gifts"]).flatMap((x) => {
    const o = obj(x);
    const rid = reportId(o?.["report_id"], shown);
    if (rid == null) return [];
    const redacted = o?.["redacted"] === true;
    return [
      {
        year: year(o?.["year"]),
        reportId: rid,
        redacted,
        source: redacted ? null : str(o?.["source"]),
        description: redacted ? null : str(o?.["description"]),
        valueAsFiled: redacted ? null : str(o?.["value_as_filed"]),
      },
    ];
  });
  const reimbursements: Reimbursement[] = arr(p["reimbursements"]).flatMap((x) => {
    const o = obj(x);
    const rid = reportId(o?.["report_id"], shown);
    if (rid == null) return [];
    const redacted = o?.["redacted"] === true;
    return [
      {
        year: year(o?.["year"]),
        reportId: rid,
        redacted,
        source: redacted ? null : str(o?.["source"]),
        datesAsFiled: redacted ? null : str(o?.["dates_as_filed"]),
        location: redacted ? null : str(o?.["location"]),
        purpose: redacted ? null : str(o?.["purpose"]),
        itemsPaid: redacted ? null : str(o?.["items_paid_or_provided"]),
      },
    ];
  });
  const agreements: Agreement[] = arr(p["agreements"]).flatMap((x) => {
    const o = obj(x);
    const rid = reportId(o?.["report_id"], shown);
    if (rid == null) return [];
    const redacted = o?.["redacted"] === true;
    return [
      {
        year: year(o?.["year"]),
        reportId: rid,
        redacted,
        dateAsFiled: redacted ? null : str(o?.["date_as_filed"]),
        partiesAndTerms: redacted ? null : str(o?.["parties_and_terms"]),
      },
    ];
  });
  const years: DisclosureYear[] = arr(p["years"]).flatMap((x) => {
    const o = obj(x);
    const y = year(o?.["year"]);
    const n = count(o?.["reports"]);
    const items = counts(o?.["items"]);
    return y != null && n != null && n <= reports && items
      ? [
          {
            year: y,
            reports: n,
            amended: count(o?.["amended"]) ?? 0,
            pages: count(o?.["pages"]),
            items,
          },
        ]
      : [];
  });
  const w = obj(p["items_withheld"]);
  const statsRecord = str(p["stats_record"]);
  return {
    personId,
    name,
    reports,
    amended: count(p["amended"]),
    firstYear: year(p["first_year"]),
    lastYear: year(p["last_year"]),
    years: years.sort((a, b) => a.year - b.year),
    itemsTotal,
    itemsRedacted,
    itemsWithheld: {
      gifts: count(w?.["gifts"]) ?? 0,
      reimbursements: count(w?.["reimbursements"]) ?? 0,
      agreements: count(w?.["agreements"]) ?? 0,
    },
    gifts,
    reimbursements,
    reimbursementsListed: reimbursements.length,
    agreements,
    attribution: {
      status,
      circuits: Object.entries(obj(att?.["circuits"]) ?? {}).flatMap(([code, n]) =>
        /^\d{2}$/.test(code) && count(n) != null ? [{ code, reports: count(n)! }] : [],
      ),
      matching: count(att?.["reports_matching_surname"]) ?? 0,
      other: count(att?.["reports_other_surname"]) ?? 0,
      unchecked: count(att?.["reports_unchecked"]) ?? 0,
    },
    reportList,
    statsRecord: statsRecord === `/records/clb_judge_dockets/${personId}` ? statsRecord : null,
  };
}

export const getClbJudgeDisclosures = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgeDisclosures | null> => {
    const x = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.judge_cl_crosswalk&id=eq.${data.id}&limit=1`,
    );
    const c = x.rows.length === 1 ? parseCrosswalk(x.rows[0]!.p, data.id) : null;
    if (!c || !c.linked || c.clPersonId === null) return null;
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_judge_disclosures&id=eq.${c.clPersonId}&limit=1`,
    );
    return r.rows.length === 1 ? parseJudgeDisclosures(r.rows[0]!.p, c.clPersonId) : null;
  });
