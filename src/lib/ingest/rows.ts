/**
 * Row construction and change detection.
 *   corpusRecord  — port of scripts/enrichment/corpus_writer.py record() (same keys, same text join)
 *   canonical     — key-sorted JSON used to compare rows the way jsonb compares them
 *   classify      — split candidate rows into inserts / updates / unchanged against the stored rows
 */
import type { Classified, CorpusRow, Json, JsonObject, SourceAdapter, StoredRow } from "./types.ts";

/** Python `str(part)` for the values corpus_writer joins into `text`. */
function pyStr(v: unknown): string {
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  return String(v);
}

/** Python truthiness of the parts joined into `text`. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export type RecordArgs = {
  source_url: string;
  cells: JsonObject;
  facts: Json;
  text: string;
  filters: JsonObject;
  subtitle?: string;
  badges?: Json[];
  links?: Json[];
  state?: string;
  extra?: JsonObject | null;
};

/** corpus_writer.record(dataset, rid, title, *, source_url, cells, facts, text, filters, subtitle, badges, links, state, extra) */
export function corpusRecord(
  dataset: string,
  rid: string,
  title: string,
  a: RecordArgs,
): CorpusRow {
  const subtitle = a.subtitle ?? "";
  const links = [...(a.links ?? [])];
  const item: JsonObject = {
    id: rid,
    title,
    subtitle,
    cells: a.cells,
    badges: [...(a.badges ?? [])],
    links,
  };
  if (a.extra && Object.keys(a.extra).length) Object.assign(item, a.extra);
  return {
    dataset,
    id: rid,
    category: dataset,
    state: a.state || "",
    title,
    source_url: a.source_url,
    item,
    detail: { id: rid, title, subtitle, facts: a.facts, links: [...links] },
    text: [rid, title, subtitle, a.text].filter(truthy).map(pyStr).join(" "),
    filters: { _listing: ["yes"], ...a.filters },
  };
}

/** JSON with object keys sorted (array order kept): equal strings <=> equal jsonb values for our row content. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in a row");
  return JSON.stringify(v ?? null);
}

/** The stored columns compared for change detection (ordinal and search_vector are not content). */
export function rowContent(row: CorpusRow | StoredRow): JsonObject {
  return {
    category: row.category,
    state: row.state ?? "",
    county_geoids: row.county_geoids ?? [],
    title: row.title,
    source_url: row.source_url ?? "",
    item: row.item,
    detail: row.detail,
    text: row.text,
    filters: row.filters,
  };
}

/** Replace the value at `path` (keys; '*' = every array element) with a fixed marker. Returns a copy. */
export function maskPath(v: Json, path: readonly string[], marker: Json = "<masked>"): Json {
  if (path.length === 0) return marker;
  const [head, ...rest] = path;
  if (head === "*") return Array.isArray(v) ? v.map((x) => maskPath(x, rest, marker)) : v;
  if (!v || typeof v !== "object" || Array.isArray(v) || !(head! in v)) return v;
  return { ...v, [head!]: maskPath((v as JsonObject)[head!]!, rest, marker) };
}

/** Split candidates into inserts, updates and unchanged rows against the stored rows. */
export function classify(
  adapter: Pick<SourceAdapter, "mode" | "comparable">,
  candidates: CorpusRow[],
  stored: StoredRow[],
  matchBy: "id" | "source_url" = "id",
): Classified {
  const byKey = new Map<string, StoredRow>();
  for (const s of stored) byKey.set(matchBy === "id" ? s.id : (s.source_url ?? ""), s);
  const out: Classified = { inserts: [], updates: [], unchanged: 0, alreadyHeld: 0 };
  for (const row of candidates) {
    const cur = byKey.get(matchBy === "id" ? row.id : row.source_url);
    if (!cur) out.inserts.push(row);
    else if (adapter.mode === "insert_only") out.alreadyHeld++;
    else if (canonical(adapter.comparable(cur)) === canonical(adapter.comparable(row)))
      out.unchanged++;
    else out.updates.push(row);
  }
  return out;
}

/**
 * Batches in the order the upsert RPC needs them. 'append': oldest first, in order. 'prepend': rows are newest first;
 * batches are sent oldest batch first, each batch keeping newest-first order, so every batch lands below the last one.
 */
export function batchesFor(
  rows: CorpusRow[],
  policy: "prepend" | "append",
  size: number,
): CorpusRow[][] {
  const out: CorpusRow[][] = [];
  if (policy === "append") {
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  } else {
    for (let end = rows.length; end > 0; end -= size)
      out.push(rows.slice(Math.max(0, end - size), end));
  }
  return out;
}

/**
 * Split batches further so one RPC body stays under `maxBytes`. For 'prepend' the parts of a batch are sent last part
 * first (the older rows), so the newest-first order holds across the parts too.
 */
export function boundBatches(
  batches: CorpusRow[][],
  policy: "prepend" | "append",
  maxBytes = 1_500_000,
): CorpusRow[][] {
  const out: CorpusRow[][] = [];
  for (const batch of batches) {
    const parts: CorpusRow[][] = [];
    let cur: CorpusRow[] = [];
    let bytes = 2;
    for (const row of batch) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
      if (size + 2 > maxBytes) throw new Error(`row ${row.id} exceeds the batch byte bound`);
      if (cur.length && bytes + size > maxBytes) {
        parts.push(cur);
        cur = [];
        bytes = 2;
      }
      cur.push(row);
      bytes += size;
    }
    if (cur.length) parts.push(cur);
    out.push(...(policy === "prepend" ? parts.reverse() : parts));
  }
  return out;
}

/** JSON paths where two values differ (dry-run reports, tests); at most `limit` paths. */
export function diffPaths(
  a: unknown,
  b: unknown,
  limit = 12,
  path = "$",
  out: string[] = [],
): string[] {
  if (out.length >= limit || canonical(a) === canonical(b)) return out;
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const A = a as Record<string, unknown>;
    const B = b as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort())
      diffPaths(A[k], B[k], limit, `${path}.${k}`, out);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffPaths(x, b[i], limit, `${path}[${i}]`, out));
    return out;
  }
  out.push(path);
  return out;
}
