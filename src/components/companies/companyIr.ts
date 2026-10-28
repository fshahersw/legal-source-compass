/**
 * Readers of the two investor-relations datasets of a registrant (ingest/1 sources in src/lib/ingest/sources/companyIr.ts):
 *   company_sec_cover_facts  dei:EntityPublicFloat and dei:EntityCommonStockSharesOutstanding from the SEC
 *   company_ir_kpis          documents on the company's own IR site with the figures they print
 * Pure and defensive: malformed facts and figures are dropped, nothing is computed beyond grouping and sorting.
 */

export type CoverFact = { end: string; value: number; form: string; filed: string };
export type CoverFacts = {
  cik: string;
  company: string;
  publicFloat: CoverFact[];
  sharesOutstanding: CoverFact[];
  sourceUrl: string;
};

export type IrFigure = {
  group: "segment" | "product" | "geography" | "operating" | "guidance";
  name: string;
  metric: string;
  period: string;
  value: number;
  unit: string;
  quote: string;
  page: number | null;
  check: "text" | "image";
};

export type IrDocumentFigures = {
  id: string;
  url: string;
  title: string;
  kind: string;
  period: string | null;
  currency: string | null;
  retrieved: string;
  status: "pending" | "submitted" | "extracted" | "failed";
  linkedFrom: string | null;
  figures: IrFigure[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = new Set(["segment", "product", "geography", "operating", "guidance"]);
const STATUSES = new Set(["pending", "submitted", "extracted", "failed"]);

function facts(v: unknown): CoverFact[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((f) => ({
      end: str(f["end"]) ?? "",
      value: f["value"],
      form: str(f["form"]) ?? "",
      filed: str(f["filed"]) ?? "",
    }))
    .filter((f): f is CoverFact => DATE.test(f.end) && finite(f.value))
    .sort((a, b) => b.end.localeCompare(a.end));
}

/** A company_sec_cover_facts row (id `cover:{cik}`) → its facts, newest first; null when the row is not one. */
export function parseCoverFacts(id: string, item: unknown, sourceUrl: string): CoverFacts | null {
  const m = /^cover:(\d{10})$/.exec(id);
  if (!m || !isObj(item) || !isObj(item["cover"])) return null;
  const cover = item["cover"];
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  return {
    cik: m[1]!,
    company: str(cells["company"]) ?? m[1]!,
    publicFloat: facts(cover["public_float"]),
    sharesOutstanding: facts(cover["shares_outstanding"]),
    sourceUrl,
  };
}

function figure(v: unknown): IrFigure | null {
  if (!isObj(v)) return null;
  const group = str(v["group"]);
  const name = str(v["name"]);
  const quote = str(v["quote"]);
  if (!group || !GROUPS.has(group) || !name || !quote || !finite(v["value"])) return null;
  return {
    group: group as IrFigure["group"],
    name,
    metric: str(v["metric"]) ?? "value",
    period: str(v["period"]) ?? "",
    value: v["value"],
    unit: str(v["unit"]) ?? "",
    quote,
    page: typeof v["page"] === "number" && Number.isInteger(v["page"]) ? v["page"] : null,
    check: v["check"] === "text" ? "text" : "image",
  };
}

/** A company_ir_kpis row (id `ir:{cik}:{hash}`) → the document and its figures; null when malformed. */
export function parseIrDocument(id: string, item: unknown): IrDocumentFigures | null {
  if (!/^ir:\d{10}:[0-9a-f]{16}$/.test(id) || !isObj(item)) return null;
  const doc = item["document"];
  const ex = item["extraction"];
  if (!isObj(doc) || !isObj(ex)) return null;
  const url = str(doc["url"]);
  if (!url || !/^https?:\/\//.test(url)) return null;
  const status = str(ex["status"]);
  return {
    id,
    url,
    title: str(doc["title"]) ?? url,
    kind: str(doc["kind"]) ?? "other",
    period: str(ex["document_period"]),
    currency: str(ex["currency"]),
    retrieved: str(doc["retrieved"]) ?? "",
    status: status && STATUSES.has(status) ? (status as IrDocumentFigures["status"]) : "pending",
    linkedFrom: str(doc["linked_from"]),
    figures: (Array.isArray(ex["figures"]) ? ex["figures"] : [])
      .map(figure)
      .filter((f): f is IrFigure => f !== null),
  };
}

export const GROUP_LABEL: Record<IrFigure["group"], string> = {
  segment: "Segments",
  product: "Products and franchises",
  geography: "Regions",
  operating: "Operating KPIs",
  guidance: "Guidance",
};

export type IrFigureRow = IrFigure & { documentId: string; url: string; documentTitle: string };

/** Every figure of the extracted documents, newest document first, each tagged with the document it came from. */
export function irFigureRows(docs: readonly IrDocumentFigures[]): IrFigureRow[] {
  return [...docs]
    .filter((d) => d.status === "extracted")
    .sort((a, b) => b.retrieved.localeCompare(a.retrieved) || a.id.localeCompare(b.id))
    .flatMap((d) =>
      d.figures.map((f) => ({ ...f, documentId: d.id, url: d.url, documentTitle: d.title })),
    );
}

/**
 * The figures to chart: one group and one metric in one period from one document (the document holding the most
 * figures of that group), so bars never mix periods, units or documents. Null when fewer than two figures qualify.
 */
export function chartSlice(
  rows: readonly IrFigureRow[],
  group: IrFigure["group"],
): {
  metric: string;
  period: string;
  unit: string;
  documentId: string;
  rows: IrFigureRow[];
} | null {
  const buckets = new Map<string, IrFigureRow[]>();
  for (const r of rows) {
    if (r.group !== group) continue;
    const key = [r.documentId, r.metric.toLowerCase(), r.period, r.unit].join("|");
    const list = buckets.get(key) ?? [];
    if (!list.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) list.push(r);
    buckets.set(key, list);
  }
  let best: IrFigureRow[] | null = null;
  for (const list of buckets.values()) if (!best || list.length > best.length) best = list;
  if (!best || best.length < 2) return null;
  const first = best[0]!;
  return {
    metric: first.metric,
    period: first.period,
    unit: first.unit,
    documentId: first.documentId,
    rows: [...best].sort((a, b) => b.value - a.value),
  };
}

/** Counts of the groups present, in the fixed order of GROUP_LABEL. */
export function groupsPresent(rows: readonly IrFigureRow[]): IrFigure["group"][] {
  const have = new Set(rows.map((r) => r.group));
  return (Object.keys(GROUP_LABEL) as IrFigure["group"][]).filter((g) => have.has(g));
}

/** A figure exactly as printed with its unit ("1,234.5 USD millions", "4.2 %"). */
export function printed(value: number, unit: string): string {
  const v = value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (!unit) return v;
  if (unit === "%") return `${v}%`;
  return `${v} ${unit}`;
}
