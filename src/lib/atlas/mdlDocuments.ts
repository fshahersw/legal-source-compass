/** Read-only MDL docket documents from the user-supplied documents.json (split per MDL / per court). */
export type MdlDocument = {
  doc_uid: string;
  mdl_number: string | null;
  court: string | null;
  case_name: string | null;
  cluster_defendant: string | null;
  entry_number: number | null;
  entry_date_filed: string | null;
  entry_description: string | null;
  document_description: string | null;
  doc_category: string | null;
  high_value: boolean | null;
  page_count: number | null;
  is_available: boolean | null;
  download_url: string | null;
  courtlistener_url: string | null;
  source: string | null;
  [key: string]: unknown;
};

export type Count = { label: string; count: number };

/** "02789" and "2789" both map to "2789"; blank → "unassigned". */
export function mdlKey(value: string | number | null | undefined): string {
  const s = String(value ?? "").replace(/^mdl:/i, "").trim();
  if (!/^\d+$/.test(s)) return s ? s.toLowerCase() : "unassigned";
  return String(Number(s));
}

export function courtKey(value: string | null | undefined): string {
  return /^[a-z0-9]{2,12}$/i.test(value ?? "") ? String(value).toLowerCase() : "unknown";
}

/** Only RECAP-available entries with a URL are downloadable; PACER-only ones are listed but never linked. */
export function isDownloadable(d: MdlDocument): boolean {
  return d.is_available === true && typeof d.download_url === "string" && d.download_url.startsWith("https://");
}

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "Uncategorized";
  return c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
}

function tally(values: string[]): Count[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarize(docs: MdlDocument[]) {
  const months = tally(docs.map((d) => (d.entry_date_filed ?? "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)));
  months.sort((a, b) => a.label.localeCompare(b.label));
  return {
    total: docs.length,
    downloadable: docs.filter(isDownloadable).length,
    highValue: docs.filter((d) => d.high_value === true).length,
    byCategory: tally(docs.map((d) => categoryLabel(d.doc_category))),
    byMonth: months,
  };
}

export function filterDocs(docs: MdlDocument[], opts: { q?: string; category?: string; onlyDownloadable?: boolean; onlyHighValue?: boolean }) {
  const q = (opts.q ?? "").trim().toLowerCase();
  return docs.filter((d) => {
    if (opts.category && categoryLabel(d.doc_category) !== opts.category) return false;
    if (opts.onlyDownloadable && !isDownloadable(d)) return false;
    if (opts.onlyHighValue && d.high_value !== true) return false;
    if (!q) return true;
    return [d.entry_description, d.document_description, d.case_name, d.cluster_defendant].some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

export async function loadDocs(kind: "mdl" | "court", key: string): Promise<MdlDocument[]> {
  const safe = kind === "mdl" ? mdlKey(key) : courtKey(key);
  const res = await fetch(`/data/mdl-documents/${kind}-${encodeURIComponent(safe)}.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Docket documents could not be loaded (${res.status}).`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) return []; // SPA fallback: no file for this key
  return JSON.parse(text) as MdlDocument[];
}
