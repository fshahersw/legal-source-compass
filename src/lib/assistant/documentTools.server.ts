/**
 * Assistant tool over the document layer (documents/1): full-text search of the court filings the published matter pages
 * list, with page-numbered passages, filters by court, MDL, type and filing date. Read-only; the same RPC and parsers as
 * the /litigation/documents page. Passages come only from text the display rule allows; every result names the page to
 * open, so a quotation can be checked at its page.
 */
import {
  DOC_TYPES,
  documentPdfUrl,
  documentTitle,
  typeLabel,
  type DocType,
} from "@/lib/documents/documents";
import { runDocumentSearch, searchInput } from "@/lib/documents/documents.functions";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 12000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n).trim() : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const DOCUMENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_documents",
    description:
      'Search the text of the court filings stored for the MDLs and matters in this workspace (orders, opinions, motions, briefs, transcripts listed on the matter pages and court MDL pages). English word forms; "quoted phrase", or, -word. Optional filters: court id (e.g. njd, cand), MDL number, document type, filed_from / filed_to (YYYY-MM-DD) and sort (relevance, newest, oldest). Leave query empty to list filings by date. Returns each filing\'s title, type, court, MDL, docket number, filing date and the best matching passages with their page numbers, plus the link that opens the PDF at that page. Filings on a docket entry the source flags as sealed, and filings whose docket text carries contact or hearing-access details, are never searched or quoted; scanned filings without text are not searched.',
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Words or a quoted phrase to find in the filings' text.",
        },
        court: { type: "string", description: "Court id, e.g. njd." },
        mdl: { type: "string", description: "MDL number, e.g. 2738." },
        type: { type: "string", enum: [...DOC_TYPES] },
        filed_from: { type: "string", description: "YYYY-MM-DD" },
        filed_to: { type: "string", description: "YYYY-MM-DD" },
        sort: { type: "string", enum: ["relevance", "newest", "oldest"] },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
];

async function searchDocumentsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = str(input["query"]);
  const court = str(input["court"], 40).toLowerCase();
  const mdl = str(input["mdl"], 12).replace(/^mdl\s*(no\.?)?\s*/i, "");
  const type = (DOC_TYPES as readonly string[]).includes(str(input["type"], 40))
    ? (str(input["type"], 40) as DocType)
    : null;
  const from = DAY.test(str(input["filed_from"], 10)) ? str(input["filed_from"], 10) : null;
  const to = DAY.test(str(input["filed_to"], 10)) ? str(input["filed_to"], 10) : null;
  const sortIn = str(input["sort"], 10);
  const parsed = searchInput.safeParse({
    q: query,
    court: court || null,
    mdl: mdl || null,
    type,
    from,
    to,
    sort: sortIn === "relevance" || sortIn === "newest" || sortIn === "oldest" ? sortIn : null,
    page:
      typeof input["page"] === "number" && Number.isInteger(input["page"])
        ? Math.min(20, Math.max(1, input["page"]))
        : 1,
    limit: 8,
  });
  if (!parsed.success)
    throw new Error(
      "check the filters: court is a court id such as njd, mdl a number such as 2738, dates YYYY-MM-DD",
    );
  const res = await runDocumentSearch(parsed.data);
  const label = query ? "Searched court filings" : "Listed court filings";
  if (!res.available)
    return {
      content: JSON.stringify({
        available: false,
        note: "The court-filing index is not built yet. Use the matter pages or search_court_filings; do not quote filings from memory.",
      }),
      sources: [],
      label,
      detail: "index not built yet",
    };
  const rows = res.rows.map((r) => ({
    id: r.id,
    title: documentTitle(r),
    type: typeLabel(r.docType),
    court: r.courtId ? (res.courtNames[r.courtId] ?? r.courtId) : null,
    mdl: r.mdl,
    mdl_name: res.mdlNames[r.mdl] ?? null,
    docket_number: r.docketNumber,
    entry_number: r.entryNumber,
    filed: r.filedDate,
    date_basis: r.dateBasis,
    text_status: r.textStatus,
    matching_pages: r.matchedPages,
    passages: r.snippets.map((s) => ({
      page: s.page,
      text: s.parts.map((p) => (p.hit ? `«${p.text}»` : p.text)).join(""),
      open: documentPdfUrl(r, s.page),
    })),
    open: documentPdfUrl(r, r.snippets[0]?.page ?? null),
    published_source: r.sourceUrl,
  }));
  const where = [
    court && `court ${court}`,
    mdl && `MDL ${mdl}`,
    type && typeLabel(type),
    from && `from ${from}`,
    to && `to ${to}`,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    content: clip(
      JSON.stringify({
        available: true,
        mode: res.mode,
        query: query || null,
        total: res.total,
        total_is_lower_bound: res.capped,
        page: res.page,
        has_more: res.hasMore,
        note: "Passages are the stored text of the page named; matched words are marked «». Quote a passage only with its page, and open the link to check it. Filings on entries the docket source flags as sealed, filings whose docket text carries contact or hearing-access details, and scanned filings without text are not searched, so absence here is not proof a filing does not exist.",
        results: rows,
      }),
    ),
    sources: res.rows.slice(0, 8).map((r) => ({
      title: `${documentTitle(r)}${r.filedDate ? ` (${r.filedDate})` : ""}`,
      url: documentPdfUrl(r, r.snippets[0]?.page ?? null),
      internal: true,
    })),
    label,
    detail: `${res.total.toLocaleString("en-US")}${res.capped ? "+" : ""} filing${res.total === 1 ? "" : "s"}${query ? ` for “${query.slice(0, 60)}”` : ""}${where ? ` · ${where}` : ""}`,
  };
}

export const DOCUMENT_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  search_documents: searchDocumentsTool,
};
