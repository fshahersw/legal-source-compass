/**
 * FDA postmarketing requirements and commitments (PMR/PMC): the studies and clinical trials FDA required of, or agreed
 * with, an applicant after approving an NDA or BLA, as FDA publishes them in its downloadable database (ZIP with a
 * tilde-delimited text file, https://www.fda.gov/media/71024/download). One row per requirement or commitment with
 * the applicant, product, application, type (e.g. FDAAA safety study, accelerated approval, PREA pediatric), the
 * description, the status FDA reports (pending, ongoing, delayed, terminated, submitted, fulfilled, released) with
 * its explanation, the original final-report due date and the last annual status report date.
 *   - Applicants are printed as FDA writes them; no company link is inferred. The application number joins exactly to
 *     Drugs@FDA rows (agency_safety_openfda_drugsfda) by NDA/BLA number.
 * Public domain (fda.gov: "in the public domain and may be republished, reprinted and otherwise used freely").
 */
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { zipText } from "../zip.ts";

export const PMR_DATASET = "fda_pmr_pmc";
export const PMR_URL = "https://www.fda.gov/media/71024/download?attachment";
export const PMR_PAGE =
  "https://www.fda.gov/drugs/guidance-compliance-regulatory-information/postmarket-requirements-and-commitments";

/** Fields of a tilde-delimited file with double-quoted values that may contain newlines and "" escapes. */
export function parseDelimited(text: string, delim = "~"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      started = false;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
      started = false;
      continue;
    }
    field += c;
    started = true;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "8/23/2021 0:00:00" → "2021-08-23"; null when not a date. */
export function usDate(v: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((v ?? "").trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type Pmr = {
  internalId: string;
  center: string;
  applicationType: string;
  applicationNumber: string;
  applicant: string;
  product: string;
  approval: string | null;
  submissionType: string | null;
  submissionNumber: string | null;
  uniqueId: string | null;
  kind: string;
  type: string | null;
  cderSet: string | null;
  number: string | null;
  description: string;
  status: string;
  statusExplanation: string | null;
  finalReportDue: string | null;
  lastAnnualReport: string | null;
};

const HEADER = [
  "Internal Identifier",
  "FDA Center",
  "Application Type",
  "Application Number",
  "Applicant Name",
  "Product Name",
  "Original Application Approval Date",
  "Submission Type",
  "Submission Number",
  "PMR/PMC Unique Identifier",
  "PMR or PMC",
  "PMR/PMC Type",
  "CDER PMR/PMC Set Number",
  "PMR/PMC Number",
  "PMR/PMC Description",
  "PMR/PMC Status",
  "PMR/PMC Status Explanation",
  "PMR/PMC Original Final Report Due Date",
  "Last Annual Status Report Received Date",
];

/** The records of the FDA file; throws when the header is not the documented one. */
export function parsePmr(text: string): { records: Pmr[]; skipped: number } {
  const rows = parseDelimited(text);
  const head = (rows[0] ?? []).map((h) => h.trim());
  if (HEADER.some((h, i) => head[i] !== h)) throw new Error("the PMR/PMC file header changed");
  const records: Pmr[] = [];
  let skipped = 0;
  const v = (r: string[], i: number) => {
    const t = (r[i] ?? "").replace(/\s+/g, " ").trim();
    return t || null;
  };
  for (const r of rows.slice(1)) {
    if (r.length < HEADER.length) {
      skipped++;
      continue;
    }
    const internalId = v(r, 0);
    const description = v(r, 14);
    const status = v(r, 15);
    const kind = v(r, 10);
    if (!internalId || !/^\d+$/.test(internalId) || !description || !status || !kind) {
      skipped++;
      continue;
    }
    const appNum = (v(r, 3) ?? "").replace(/\.0+$/, "");
    records.push({
      internalId,
      center: v(r, 1) ?? "Not recorded",
      applicationType: v(r, 2) ?? "Not recorded",
      applicationNumber: appNum,
      applicant: v(r, 4) ?? "Not recorded",
      product: v(r, 5) ?? "Not recorded",
      approval: usDate(r[6]),
      submissionType: v(r, 7),
      submissionNumber: v(r, 8),
      uniqueId: v(r, 9),
      kind,
      type: v(r, 11),
      cderSet: v(r, 12),
      number: v(r, 13),
      description,
      status,
      statusExplanation: v(r, 16),
      finalReportDue: usDate(r[17]),
      lastAnnualReport: usDate(r[18]),
    });
  }
  return { records, skipped };
}

export function pmrRow(p: Pmr, retrieved: string): CorpusRow {
  const app = `${p.applicationType} ${p.applicationNumber}`.trim();
  return corpusRecord(
    PMR_DATASET,
    `pmr:${p.internalId}`,
    `${p.product}: ${p.kind} ${p.uniqueId ?? p.number ?? ""}`.trim(),
    {
      source_url: PMR_PAGE,
      subtitle: [
        p.applicant,
        app,
        p.type,
        `status ${p.status}`,
        p.finalReportDue ? `final report due ${p.finalReportDue}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      cells: {
        product: p.product,
        applicant: p.applicant,
        application: app,
        kind: p.kind,
        type: p.type,
        status: p.status,
        final_report_due: p.finalReportDue,
        last_annual_report: p.lastAnnualReport,
        center: p.center,
      },
      facts: [
        ["Product", p.product],
        ["Applicant (as FDA prints it)", p.applicant],
        ["Application", `${app}${p.approval ? `, approved ${p.approval}` : ""}`],
        ["Requirement or commitment", `${p.kind}${p.type ? ` (${p.type})` : ""}`],
        ["Identifier", p.uniqueId ?? "Not recorded"],
        ["Description", p.description],
        ["Status", `${p.status}${p.statusExplanation ? `: ${p.statusExplanation}` : ""}`],
        ["Original final report due", p.finalReportDue ?? "Not recorded"],
        ["Last annual status report received", p.lastAnnualReport ?? "Not recorded"],
        ["Retrieved", retrieved],
      ],
      text: `${p.product} ${p.applicant} ${app} ${p.kind} ${p.type ?? ""} ${p.status} ${p.description} ${p.statusExplanation ?? ""}`.slice(
        0,
        6000,
      ),
      filters: {
        status: [p.status],
        kind: [p.kind],
        type: [p.type ?? "Not recorded"],
        center: [p.center],
        application: [p.applicationNumber],
      },
      links: [{ label: "FDA postmarketing requirements and commitments", url: PMR_PAGE }],
      extra: { pmr: p as unknown as JsonObject },
    },
  );
}

export function comparablePmr(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).filter(
    (f) => !(Array.isArray(f) && f[0] === "Retrieved"),
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

export const fdaPmrPmc: SourceAdapter = {
  source: "fda_pmr_pmc",
  dataset: PMR_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-reference",
  limits: { maxRequests: 2, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    if (!ctx.http.getBytes) throw new Error("this run's HTTP client cannot read binary files");
    const res = await ctx.http.getBytes(PMR_URL);
    if (res.status !== 200) throw new Error(`FDA PMR/PMC download HTTP ${res.status}`);
    const t = await zipText(res.bytes, (n) => /pmrpmc_commitments\.txt$/i.test(n), "latin1");
    if (!t) throw new Error("the FDA archive has no pmrpmc_commitments.txt");
    const { records, skipped } = parsePmr(t.text);
    if (records.length < 1000) throw new Error(`only ${records.length} records read`);
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const held: HeldRecord[] = [];
    const seen = new Set<string>();
    const rows: CorpusRow[] = [];
    for (const p of records) {
      if (seen.has(p.internalId)) {
        held.push({ key: p.internalId, reason: "internal identifier repeated in the file" });
        continue;
      }
      seen.add(p.internalId);
      rows.push(pmrRow(p, retrieved));
    }
    const byStatus = records.reduce<Record<string, number>>((m, p) => {
      m[p.status] = (m[p.status] ?? 0) + 1;
      return m;
    }, {});
    return {
      rows,
      fetched: records.length,
      held,
      cursorAfter: { retrieved },
      complete: true,
      notes: {
        records: records.length,
        skipped_lines: skipped,
        by_status: byStatus as unknown as Json,
      },
    };
  },
  comparable: comparablePmr,
};
