/**
 * Case lens: everything recorded about one MDL across datasets — JPML trajectory, transferee court caseload,
 * the transferee judge's FJC profile, the product's agency signal, automated safety flags, the Panel's
 * hearing-session record, its orders published on GovInfo, terminated-litigation entries, the transferee-court
 * page and SEC filing links.
 * Joins are by exact MDL number (record id or JSON field), never by name similarity; an ambiguous join
 * returns nothing. An MDL outside the JPML pending series still gets every other record kept for its number.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import type { CourtAnalytics, NationalDistribution } from "./courtAnalytics.functions";
import type { FjcProfile } from "./judgeProfiles.functions";
import { toSignals, type MassTortSignal } from "./massTortSignals.functions";
import { parseInsight, type SafetyInsight } from "./safetyInsights.functions";
import {
  parseCompanySummary,
  parseLink,
  type CompanyLink,
  type CompanySummary,
} from "@/components/companies/companyData";

import { parseCourtPage, parseMatter, type CourtMdl, type Matter } from "./mdlIntel.functions";

/** A docket listed on a JPML hearing-session Schedule of Matters (mdl_intel_hearing_orders). */
export type LensHearing = Matter & {
  /** The hearing-session notice (Schedule of Matters PDF) the docket is listed in. */
  noticeUrl: string | null;
  /** The evidence's own label ("Panel order (JPML)"), as recorded. */
  evidenceLabel: string | null;
  /** Verbatim text of the order, only for evidence whose stored text is a quote (evidenceQuote). */
  evidenceQuote: EvidenceQuote | null;
};
/** A quote stored with a hearing outcome: GovInfo docket text or the Panel order's operative sentence. */
export type EvidenceQuote = {
  text: string;
  /** What the quote is, e.g. "GovInfo docket text". */
  label: string;
  /** The builder stores at most a fixed length; a quote at that length was cut there. */
  clipped: boolean;
};

/**
 * Builder caps (scripts/enrichment/mdl_intel): GovInfo docket text is stored as text[:500]
 * (build_hearings.py); a Panel order's operative sentence as [:700] after whitespace is collapsed
 * (parse_jpml.parse_order_pdf_text). Other evidence text is a link label or a builder sentence, not a quote.
 */
export function evidenceQuote(source: string | null, text: string | null): EvidenceQuote | null {
  if (!text) return null;
  if (source === "govinfo")
    return { text, label: "GovInfo docket text", clipped: text.length >= 500 };
  // Without an operative sentence the builder stores the order kind (a slug), which is not a quote.
  if (source === "jpml_panel_orders_page" && /^IT IS (?:THEREFORE |FURTHER )?ORDERED\b/.test(text))
    return { text, label: "Panel order, operative sentence", clipped: text.length >= 700 };
  return null;
}

/**
 * An archive order's link text is stored twice (build_hearings.py): as label[:80] and in full as text. The full
 * link text is shown; the cut label is used, marked as cut, only when no full text is stored.
 */
export function evidenceLabel(
  source: string | null,
  label: string | null,
  text: string | null = null,
): string | null {
  if (source !== "jpml_archive_order") return label;
  if (text) return text;
  if (!label) return null;
  return label.length >= 80 ? `${label.trimEnd()} …` : label;
}

const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : null);

/** A Panel order published on GovInfo (mdl_intel_hearing_orders id order:<package>-<part>) for this MDL number. */
export type LensPanelOrder = {
  id: string;
  /** Order type as read from the start of GovInfo's docket text, e.g. "Order denying transfer". */
  kindLabel: string;
  /** Litigation title of the GovInfo package, as recorded. */
  title: string | null;
  /** Signature date, when the docket text states one. */
  signedDate: string | null;
  /** GovInfo's package date ("date issued"); for older orders it is when GovInfo published the package. */
  issued: string | null;
  natureOfSuit: string | null;
  transfereeCourt: string | null;
  transfereeJudge: string | null;
  actionsTransferred: number | null;
  /** The order rules on pleading 1, the initial motion. */
  initialMotion: boolean;
  pdfUrl: string | null;
  detailsUrl: string | null;
};

const NO_ORDER_KIND = "Order type not recorded";
/** "order_denying_transfer" -> "Order denying transfer" (the builder's own record title uses the same wording). */
export const orderKindLabel = (kind: string | null) =>
  kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ") : NO_ORDER_KIND;

/** A GovInfo order row, kept only when its recorded MDL number (item.order.mdl) is exactly `mdl`. */
export function toPanelOrder(
  row: { id?: unknown; source_url?: unknown; order?: unknown },
  mdl: number,
): LensPanelOrder | null {
  const o = obj(row.order);
  const id = str(row.id);
  if (!o || !id?.startsWith("order:") || num(o["mdl"]) !== mdl) return null;
  const pdfUrl = httpUrl(o["pdf"]);
  // source_url is GovInfo's details page, or the PDF itself when no details page is recorded.
  const details = httpUrl(row.source_url);
  return {
    id,
    kindLabel: orderKindLabel(str(o["kind"])),
    title: str(o["title"]),
    signedDate: str(o["signed_date"]),
    issued: str(o["issued"]),
    natureOfSuit: str(o["nature_of_suit"]),
    transfereeCourt: str(o["transferee_court"]),
    transfereeJudge: str(o["transferee_judge"]),
    actionsTransferred: num(o["actions_transferred"]),
    initialMotion: o["initial_motion"] === true,
    pdfUrl,
    detailsUrl: details && details !== pdfUrl ? details : null,
  };
}

/** Newest first by signature date, else GovInfo's date. */
export const byNewestOrder = (a: LensPanelOrder, b: LensPanelOrder) =>
  (b.signedDate ?? b.issued ?? "").localeCompare(a.signedDate ?? a.issued ?? "") ||
  a.id.localeCompare(b.id);

/** Orders already shown as a hearing's outcome evidence (same document URL) are not listed a second time. */
export function withoutHearingEvidence(
  orders: LensPanelOrder[],
  hearings: { evidenceUrl: string | null }[],
): LensPanelOrder[] {
  const shown = new Set(hearings.map((h) => h.evidenceUrl).filter((u): u is string => !!u));
  return orders.filter(
    (o) => !(o.pdfUrl && shown.has(o.pdfUrl)) && !(o.detailsUrl && shown.has(o.detailsUrl)),
  );
}

const BY_TYPE_REPORT = /\/Pending_MDL_Dockets_By_MDL_Type-([A-Za-z]+)-(\d{1,2})-(\d{4})\.pdf$/;
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/**
 * Names the court-page record's source when it is the JPML "Pending MDL Dockets by MDL Type" report (a different
 * publication from the monthly "Distribution of Pending MDL Dockets by Actions Pending" series); null otherwise.
 */
export function courtPageSourceLabel(url: string | null): string | null {
  const m = url ? BY_TYPE_REPORT.exec(url) : null;
  const month = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
  return m && month >= 0
    ? `the JPML “Pending MDL Dockets by MDL Type” report of ${month + 1}/${Number(m[2])}/${m[3]}`
    : null;
}

/** One transferee-district entry of the JPML terminated-litigations report (mdl_terminated_history). */
export type LensTerminated = {
  caption: string;
  districtName: string | null;
  districtCode: string | null;
  circuit: string | null;
  judge: string | null;
  year: number | null;
  transferred: number | null;
  filedInTransferee: number | null;
  closed: number | null;
  remanded: number | null;
  sourceUrl: string | null;
};
/** The JPML monthly pending-MDL report series held in mdl_analytics (summary:overview). */
export type LensSeries = {
  first: string | null;
  asOf: string | null;
  reports: number | null;
  sourceUrl: string | null;
};

export type LensCompany = {
  cik: string;
  name: string;
  link: CompanyLink;
  summary: CompanySummary | null;
};

export type LensMdl = {
  mdl: number;
  title: string;
  type: string | null;
  status: string | null;
  district: string | null;
  judge: string | null;
  pending: number | null;
  total: number | null;
  asOf: string | null;
  growth: string | null;
  rank: number | null;
  dateTransferred: string | null;
  dateFiled: string | null;
  masterDocket: string | null;
  ageYears: number | null;
  new12m: number | null;
  resolved12m: number | null;
  change12m: number | null;
  peakPending: number | null;
  series: { date: string; pending: number; total: number }[];
  badges: string[];
};
/** An openFDA adverse-event row (FAERS, MAUDE or CAERS) bound to this MDL number by its stored filters.mdl. */
export type LensFdaReport = {
  dataset: string;
  recordId: string;
  system: "FAERS" | "MAUDE" | "CAERS";
  title: string;
  /** Display strings as stored in the row's cells (already formatted, "Not recorded" when unknown). */
  reports: string;
  deaths: string | null;
  /** The row's own note when its search is broader than its label; null when it states none. */
  searchScope: string | null;
  dataThrough: string | null;
};

const FDA_SYSTEMS: Record<string, LensFdaReport["system"]> = {
  fda_faers_product_series: "FAERS",
  fda_device_event_series: "MAUDE",
  fda_caers_series: "CAERS",
};

/** A published FDA row, kept only when it records exactly this MDL number; anything else is dropped. */
export function toFdaReport(
  row: {
    dataset?: unknown;
    id?: unknown;
    title?: unknown;
    m?: unknown;
    cells?: unknown;
    facts?: unknown;
  },
  mdl: number,
): LensFdaReport | null {
  const dataset = str(row.dataset);
  const id = str(row.id);
  const system = dataset ? FDA_SYSTEMS[dataset] : undefined;
  const cells = obj(row.cells);
  const reports = str(cells?.["reports"]);
  if (!dataset || !id || !system || row.m !== String(mdl) || !str(row.title) || !reports)
    return null;
  const fact = (label: string) => {
    const hit = (Array.isArray(row.facts) ? row.facts : []).find(
      (f) => Array.isArray(f) && f[0] === label && typeof f[1] === "string",
    );
    return hit ? (hit[1] as string) : null;
  };
  return {
    dataset,
    recordId: id,
    system,
    title: str(row.title)!,
    reports,
    deaths: str(cells?.["deaths"]),
    searchScope: fact("Search scope"),
    dataThrough: fact("Data through"),
  };
}

export type MdlLens = {
  mdl: LensMdl | null;
  court: CourtAnalytics | null;
  courtDistributions: NationalDistribution | null;
  judge: FjcProfile | null;
  judgeAmbiguous: boolean;
  signal: MassTortSignal | null;
  insights: SafetyInsight[];
  /** Registrants whose own SEC filings name this MDL (company_sec_mdl_links); tier and role as recorded. */
  companies: LensCompany[];
  /** Official transferee-court MDL page facts (mdl_intel_court_pages): verbatim quotes and listed orders. */
  courtPage: CourtMdl | null;
  /** Source of the court-page record itself (the court page, or the JPML report its MDL list comes from). */
  courtPageSourceUrl: string | null;
  /** courtPageSourceLabel(courtPageSourceUrl): the JPML docket-type report it names, else null. */
  courtPageSourceLabel: string | null;
  /** Hearing-session matters for this MDL number, newest session first. */
  hearings: LensHearing[];
  /** First and last hearing session recorded in mdl_intel_hearing_orders (coverage of the schedules read). */
  hearingCoverage: { first: string | null; last: string | null };
  /** GovInfo Panel orders for this MDL number, newest first, minus any already shown as hearing evidence. */
  panelOrders: LensPanelOrder[];
  /** GovInfo Panel orders for this MDL number left out of panelOrders because a hearing cites the same document. */
  panelOrdersInHearings: number;
  /** Terminated-litigation entries for this MDL number, one per transferee district. */
  terminated: LensTerminated[];
  /** openFDA adverse-event report counts (FAERS, MAUDE, CAERS) whose stored MDL number is exactly this one. */
  fdaReports: LensFdaReport[];
  series: LensSeries;
  /** Litigation title and the record it is taken from, when the MDL is outside the pending series. */
  recordedTitle: { title: string; source: string } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const contains = (mdl: number) => encodeURIComponent(JSON.stringify([{ mdl }]));

/** A hearing-matter row, kept only when its recorded MDL number is exactly `mdl`. */
export function toHearing(
  row: { source_url?: unknown; matter?: unknown },
  mdl: number,
): LensHearing | null {
  const m = parseMatter(row.matter);
  if (!m || m.mdl !== mdl) return null;
  const ev = obj(obj(row.matter)?.["evidence"]);
  return {
    ...m,
    evidenceUrl: httpUrl(m.evidenceUrl),
    noticeUrl: httpUrl(row.source_url),
    evidenceLabel: evidenceLabel(m.evidenceSource, str(ev?.["label"]), str(ev?.["text"])),
    evidenceQuote: evidenceQuote(m.evidenceSource, str(ev?.["text"])),
  };
}

/** A terminated-history row (id `<mdl>:<district code>`), kept only when it records exactly `mdl`. */
export function toTerminated(
  row: { id?: unknown; source_url?: unknown; history?: unknown },
  mdl: number,
): LensTerminated | null {
  const h = obj(row.history);
  const id = str(row.id);
  if (!h || num(h["mdl"]) !== mdl || !id?.startsWith(`${mdl}:`)) return null;
  const source = str(row.source_url);
  return {
    caption: str(h["caption"]) ?? "Caption not recorded",
    districtName: str(h["district_name"]),
    districtCode: str(h["district_code"]),
    circuit: str(h["circuit"]),
    judge: str(h["transferee_judge"]),
    year: num(h["termination_year"]),
    transferred: num(h["actions_transferred"]),
    filedInTransferee: num(h["actions_filed_in_transferee"]),
    closed: num(h["actions_closed"]),
    remanded: num(h["actions_remanded"]),
    sourceUrl: source && /^https?:\/\//.test(source) ? source : null,
  };
}

/** Hearings newest session first; Section A (centralization) before Section B within a session. */
export const byNewestSession = (a: LensHearing, b: LensHearing) =>
  b.session.localeCompare(a.session) || a.section.localeCompare(b.section);

/**
 * The litigation title for an MDL outside the pending series, from the first record that prints one: the
 * court-page index (taken from the JPML "Pending MDL Dockets by MDL Type" report), the newest hearing schedule,
 * the terminated-litigations report, the newest GovInfo Panel order's package title, then an SEC filing link
 * whose title was not cut short. Never guessed.
 */
export function recordedTitle(parts: {
  courtPage: CourtMdl | null;
  /** courtPageSourceLabel of the court-page record, when it names the docket-type report. */
  courtPageSource?: string | null | undefined;
  hearings: LensHearing[];
  terminated: LensTerminated[];
  panelOrders?: LensPanelOrder[] | undefined;
  companies: LensCompany[];
}): { title: string; source: string } | null {
  if (parts.courtPage?.title)
    return {
      title: parts.courtPage.title,
      source: `${parts.courtPageSource ?? "the JPML “Pending MDL Dockets by MDL Type” report"} (court-page index)`,
    };
  const hearing = [...parts.hearings].sort(byNewestSession).find((h) => h.title);
  if (hearing)
    return {
      title: hearing.title,
      source: `the JPML hearing-session schedule of ${hearing.session}`,
    };
  const terminated = parts.terminated.find((t) => t.caption !== "Caption not recorded");
  if (terminated)
    return { title: terminated.caption, source: "the JPML terminated-litigations report" };
  const order = [...(parts.panelOrders ?? [])].sort(byNewestOrder).find((o) => o.title);
  if (order?.title)
    return {
      title: order.title,
      source:
        order.kindLabel === NO_ORDER_KIND
          ? "the GovInfo package of a Panel order"
          : `the GovInfo package of the Panel's ${order.kindLabel.toLowerCase()}`,
    };
  const link = parts.companies.find((c) => c.link.title && !c.link.titleTruncated);
  if (link) return { title: link.link.title, source: "an SEC filing link record" };
  return null;
}

function toMdl(item: Record<string, unknown> | undefined, mdl: number): LensMdl | null {
  if (!item) return null;
  const a = (item["analytics"] ?? {}) as Record<string, unknown>;
  const cells = (item["cells"] ?? {}) as Record<string, unknown>;
  const series = Array.isArray(a["series"]) ? a["series"] : [];
  return {
    mdl,
    title: str(item["title"]) ?? str(cells["litigation"]) ?? `MDL ${mdl}`,
    type: str(a["type"]) ?? str(cells["type"]),
    status: str(a["status"]) ?? str(cells["status"]),
    district: str(a["district"]) ?? str(cells["district"]),
    judge: str(a["judge"]) ?? str(cells["judge"]),
    pending: num(a["pending"]),
    total: num(a["total"]),
    asOf: str(a["as_of"]),
    growth: str(a["growth"]),
    rank: num(item["rank"]),
    dateTransferred: str(a["date_transferred"]),
    dateFiled: str(a["date_filed"]),
    masterDocket: str(a["master_docket"]),
    ageYears: num(a["age_years"]),
    new12m: num(a["new_12m"]),
    resolved12m: num(a["resolved_12m"]),
    change12m: num(a["change_12m"]),
    peakPending: num(a["peak_pending"]),
    series: series.flatMap((p) => {
      const point = p as Record<string, unknown>;
      const pending = num(point["pending"]);
      const total = num(point["total"]);
      return str(point["date"]) && pending != null && total != null
        ? [{ date: str(point["date"])!, pending, total }]
        : [];
    }),
    badges: Array.isArray(item["badges"])
      ? item["badges"].filter((b): b is string => typeof b === "string")
      : [],
  };
}

export const getMdlLens = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdl: z.number().int().min(1).max(99999) }).parse(d))
  .handler(async ({ data }): Promise<MdlLens> => loadMdlLens(data.mdl));

/**
 * Everything the lens reads for one MDL number (server-only; callers validate the number). Shared by getMdlLens and
 * the matter command page (src/lib/matters/command.functions.ts).
 */
export async function loadMdlLens(mdlNumber: number): Promise<MdlLens> {
  if (!Number.isInteger(mdlNumber) || mdlNumber < 1 || mdlNumber > 99999)
    throw new Error("Invalid MDL number.");
  const data = { mdl: mdlNumber };
  const id = String(data.mdl);
  const linkFilter = encodeURIComponent(JSON.stringify({ mdl: [id] }));
  const [
    mdl,
    court,
    national,
    judges,
    signal,
    insights,
    links,
    page,
    hearingRows,
    terminatedRows,
    seriesRow,
    orderRows,
    sessionRange,
    fdaRows,
  ] = await Promise.all([
    restGet<{ item: Record<string, unknown> }[]>(
      `corpus_records?select=item&dataset=eq.mdl_analytics&id=eq.${id}&limit=1`,
    ),
    restGet<{ id: string; item: { analytics?: CourtAnalytics } }[]>(
      `corpus_records?select=id,item&dataset=eq.court_analytics&item->analytics->mdls=cs.${contains(data.mdl)}&limit=3`,
    ),
    restGet<{ item: { analytics?: { distributions?: NationalDistribution } } }[]>(
      "corpus_records?select=item&dataset=eq.court_analytics&id=eq.summary:national&limit=1",
    ),
    restGet<{ id: string; item: { profile?: FjcProfile } }[]>(
      `corpus_records?select=id,item&dataset=eq.judge_profiles_fjc&item->profile->mdls=cs.${contains(data.mdl)}&limit=3`,
    ),
    restGet<{ item: Parameters<typeof toSignals>[0] }[]>(
      `corpus_records?select=item&dataset=eq.agency_safety_mass_tort_signals&id=eq.${id}&limit=1`,
    ),
    restGet<{ item: { insight?: unknown } }[]>(
      `corpus_records?select=item&dataset=eq.agency_safety_insights&item->insight->>entity=eq.${encodeURIComponent(`MDL ${id}`)}&limit=10`,
    ),
    restGet<{ id: string; link: Record<string, unknown> | null }[]>(
      `corpus_records?select=id,link:item->link&dataset=eq.company_sec_mdl_links&filters=cs.${linkFilter}&limit=50`,
    ),
    restGet<{ court: unknown; source_url: unknown }[]>(
      `corpus_records?select=court:item->court,source_url&dataset=eq.mdl_intel_court_pages&id=eq.${id}&limit=1`,
    ),
    // Matter ids are matter:<session>:<mdl>:<section>; the recorded MDL number is matched exactly.
    restGet<{ source_url: unknown; matter: unknown }[]>(
      `corpus_records?select=source_url,matter:item->matter&dataset=eq.mdl_intel_hearing_orders&id=like.matter:*&item->matter->>mdl=eq.${id}&limit=200`,
    ),
    // Terminated-history ids are <mdl>:<district code>, so the prefix "<mdl>:" never matches another number.
    restGet<{ id: unknown; source_url: unknown; history: unknown }[]>(
      `corpus_records?select=id,source_url,history:item->history&dataset=eq.mdl_terminated_history&id=like.${id}:*&limit=100`,
    ),
    restGet<{ first: unknown; as_of: unknown; reports: unknown; source_url: unknown }[]>(
      "corpus_records?select=first:item->overview->first_report,as_of:item->overview->as_of,reports:item->overview->reports,source_url&dataset=eq.mdl_analytics&id=eq.summary:overview&limit=1",
    ),
    // GovInfo Panel orders (ids order:<package>-<part>); at most two are recorded per MDL number.
    restGet<{ id: unknown; source_url: unknown; order: unknown }[]>(
      `corpus_records?select=id,source_url,order:item->order&dataset=eq.mdl_intel_hearing_orders&id=like.order:*&item->order->>mdl=eq.${id}&limit=20`,
    ),
    // Session rows are stored oldest first, so the first and last entries bound the schedules read.
    restGet<{ first: unknown; last: unknown }[]>(
      "corpus_records?select=first:item->overview->session_rows->0->>date,last:item->overview->session_rows->-1->>date&dataset=eq.mdl_intel_hearing_orders&id=eq.summary:overview&limit=1",
    ),
    // openFDA report counts (FAERS, MAUDE, CAERS) keyed by the MDL number the product list states explicitly.
    restGet<
      {
        dataset: unknown;
        id: unknown;
        title: unknown;
        m: unknown;
        cells: unknown;
        facts: unknown;
      }[]
    >(
      `corpus_records?select=dataset,id,title,m:item->>mdl,cells:item->cells,facts:detail->facts&dataset=in.(fda_faers_product_series,fda_device_event_series,fda_caers_series)&filters->mdl=cs.${encodeURIComponent(JSON.stringify([String(data.mdl)]))}&limit=10`,
    ),
  ]);
  const parsedLinks = links.rows.flatMap((row) => {
    const link = parseLink(row.link);
    const cik = typeof row.link?.["cik"] === "string" ? row.link["cik"] : null;
    const name = typeof row.link?.["company"] === "string" ? row.link["company"] : null;
    return link && cik && /^\d{10}$/.test(cik) && link.mdl === data.mdl
      ? [{ cik, name: name ?? cik, link }]
      : [];
  });
  const summaries = parsedLinks.length
    ? await restGet<{ id: string; summary: unknown }[]>(
        `corpus_records?select=id,summary:item->summary&dataset=eq.company_sec_profiles&id=in.(${parsedLinks.map((l) => l.cik).join(",")})`,
      )
    : { rows: [] as { id: string; summary: unknown }[] };
  const byCik = new Map(summaries.rows.map((r) => [r.id, parseCompanySummary(r.summary)]));
  const tierOrder = { A: 0, B: 1, C: 2 } as const;
  const companies = parsedLinks
    .map((l) => ({ ...l, summary: byCik.get(l.cik) ?? null }))
    .sort(
      (a, b) =>
        tierOrder[a.link.tier] - tierOrder[b.link.tier] ||
        b.link.verifiedCount - a.link.verifiedCount,
    );
  const parsedPage = page.rows[0] ? parseCourtPage(page.rows[0].court) : null;
  const courtPage = parsedPage && parsedPage.mdl === data.mdl ? parsedPage : null;
  const hearings = hearingRows.rows
    .map((row) => toHearing(row, data.mdl))
    .filter((h): h is LensHearing => h !== null)
    .sort(byNewestSession);
  const terminated = terminatedRows.rows
    .map((row) => toTerminated(row, data.mdl))
    .filter((t): t is LensTerminated => t !== null)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const fdaReports = fdaRows.rows
    .map((row) => toFdaReport(row, data.mdl))
    .filter((r): r is LensFdaReport => r !== null);
  const allOrders = orderRows.rows
    .map((row) => toPanelOrder(row, data.mdl))
    .filter((o): o is LensPanelOrder => o !== null)
    .sort(byNewestOrder);
  const panelOrders = withoutHearingEvidence(allOrders, hearings);
  const s = seriesRow.rows[0];
  const sourceUrl = str(s?.source_url);
  const lensMdl = toMdl(mdl.rows[0]?.item, data.mdl);
  const courtPageSourceUrl = courtPage ? httpUrl(page.rows[0]?.source_url) : null;
  const courtPageSource = courtPageSourceLabel(courtPageSourceUrl);
  return {
    mdl: lensMdl,
    // A court or judge is shown only when exactly one record lists this MDL.
    court: court.rows.length === 1 ? (court.rows[0]!.item.analytics ?? null) : null,
    courtDistributions: national.rows[0]?.item.analytics?.distributions ?? null,
    judge: judges.rows.length === 1 ? (judges.rows[0]!.item.profile ?? null) : null,
    judgeAmbiguous: judges.rows.length > 1,
    signal: signal.rows[0] ? (toSignals(signal.rows[0].item)[0] ?? null) : null,
    companies,
    courtPage,
    courtPageSourceUrl,
    courtPageSourceLabel: courtPageSource,
    insights: insights.rows.flatMap(({ item }) => {
      const parsed = parseInsight(item?.insight);
      return parsed ? [parsed] : [];
    }),
    hearings,
    hearingCoverage: {
      first: str(sessionRange.rows[0]?.first),
      last: str(sessionRange.rows[0]?.last),
    },
    panelOrders,
    panelOrdersInHearings: allOrders.length - panelOrders.length,
    terminated,
    fdaReports,
    series: {
      first: str(s?.first),
      asOf: str(s?.as_of),
      reports: num(s?.reports),
      sourceUrl: sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl : null,
    },
    recordedTitle: lensMdl
      ? null
      : recordedTitle({
          courtPage,
          courtPageSource,
          hearings,
          terminated,
          panelOrders,
          companies,
        }),
  };
}
