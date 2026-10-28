/**
 * Streaming reader for .xlsx workbooks published by agencies (Census Government Units List): lists the sheets, reads the
 * shared-string table and yields one sheet's rows without holding the whole sheet XML in memory. Built on zip.ts and the
 * platform's DecompressionStream / TextDecoderStream, so it runs in the edge runtime. Cell values come back as the text
 * the workbook stores (numbers as their stored digits, shared and inline strings resolved, entities decoded); styles,
 * formulas and dates-as-serials are not interpreted.
 */
import { decodeEntities } from "./xmlTree.ts";
import { zipEntries, type ZipEntry } from "./zip.ts";

export type XlsxSheet = { name: string; path: string };

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The decompressed bytes of one entry as a stream of chunks. */
function entryStream(bytes: Uint8Array, entry: ZipEntry): ReadableStream<Uint8Array> {
  const p = entry.offset;
  if (u32(bytes, p) !== 0x04034b50) throw new Error(`broken local header for ${entry.name}`);
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new Blob([data.slice().buffer as ArrayBuffer]).stream();
  if (entry.method !== 8)
    throw new Error(`unsupported ZIP method ${entry.method} for ${entry.name}`);
  return new Blob([data.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
}

/** Text chunks of one entry, decoded as UTF-8. */
async function* entryText(bytes: Uint8Array, entry: ZipEntry): AsyncGenerator<string> {
  // the DOM typings give TextDecoderStream a BufferSource writable; a Uint8Array stream is what it accepts at runtime
  const decoder = new TextDecoderStream("utf-8") as unknown as ReadableWritablePair<string, Uint8Array>;
  const reader = entryStream(bytes, entry).pipeThrough(decoder).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}

/**
 * Complete `<tag ...>...</tag>` segments of an entry, in order, read chunk by chunk. Yields the segments completed by
 * each decoded chunk as one batch, so a sheet of 100,000 rows costs a few hundred awaits rather than 100,000.
 */
async function* segmentBatches(
  bytes: Uint8Array,
  entry: ZipEntry,
  tag: string,
  accept?: (buf: string, start: number, end: number) => boolean,
): AsyncGenerator<string[]> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let buf = "";
  for await (const chunk of entryText(bytes, entry)) {
    buf += chunk;
    const batch: string[] = [];
    let from = 0;
    for (;;) {
      const s = buf.indexOf(open, from);
      if (s < 0) {
        from = Math.max(from, buf.length - open.length);
        break;
      }
      // `<si` must not match `<sit...>`: the next character ends the tag name
      const after = buf.charCodeAt(s + open.length);
      if (after !== 32 && after !== 62 && after !== 47 && !Number.isNaN(after)) {
        from = s + open.length;
        continue;
      }
      const tagEnd = buf.indexOf(">", s);
      if (tagEnd < 0) {
        from = s;
        break;
      }
      if (buf.charCodeAt(tagEnd - 1) === 47) {
        if (!accept || accept(buf, s, tagEnd + 1)) batch.push(buf.slice(s, tagEnd + 1));
        from = tagEnd + 1;
        continue;
      }
      const e = buf.indexOf(close, tagEnd);
      if (e < 0) {
        from = s;
        break;
      }
      if (!accept || accept(buf, s, e + close.length)) batch.push(buf.slice(s, e + close.length));
      from = e + close.length;
    }
    buf = buf.slice(from);
    if (batch.length) yield batch;
  }
}

function entryNamed(bytes: Uint8Array, name: string): ZipEntry | null {
  return zipEntries(bytes).find((e) => e.name === name) ?? null;
}

async function entryString(bytes: Uint8Array, name: string): Promise<string | null> {
  const entry = entryNamed(bytes, name);
  if (!entry) return null;
  let out = "";
  for await (const chunk of entryText(bytes, entry)) out += chunk;
  return out;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]!) : null;
};

/** The workbook's sheets in tab order with the path of each sheet's XML inside the archive. */
export async function xlsxSheets(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const workbook = await entryString(bytes, "xl/workbook.xml");
  const rels = await entryString(bytes, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("not an xlsx workbook (no xl/workbook.xml)");
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target)
      targets.set(
        id,
        target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`,
      );
  }
  const out: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const rid = attr(m[0], "r:id");
    const path = rid ? targets.get(rid) : undefined;
    if (name && path) out.push({ name, path });
  }
  return out;
}

/** Text of every `<t>` run in a segment, skipping phonetic `<rPh>` runs. */
function runText(seg: string): string {
  const clean = seg.includes("<rPh") ? seg.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : seg;
  let out = "";
  let from = 0;
  for (;;) {
    const s = clean.indexOf("<t", from);
    if (s < 0) break;
    const next = clean.charCodeAt(s + 2);
    if (next !== 62 && next !== 32) {
      from = s + 2;
      continue;
    }
    const gt = clean.indexOf(">", s);
    if (clean.charCodeAt(gt - 1) === 47) {
      from = gt + 1;
      continue;
    }
    const e = clean.indexOf("</t>", gt);
    if (e < 0) break;
    out += clean.slice(gt + 1, e);
    from = e + 4;
  }
  return out.includes("&") ? decodeEntities(out) : out;
}

/** A workbook's shared strings, resolved on first use so a reader that keeps a slice of the rows pays only for those. */
export interface StringTable {
  readonly size: number;
  get(index: number): string | undefined;
}

/** A string table over a plain array (tests and small workbooks). */
export function stringTable(values: readonly string[]): StringTable {
  return { size: values.length, get: (i) => values[i] };
}

function lazyStrings(xml: string, starts: Int32Array, ends: Int32Array, size: number): StringTable {
  const cache: (string | undefined)[] = new Array(size);
  return {
    size,
    get(index: number): string | undefined {
      if (!(index >= 0 && index < size)) return undefined;
      let v = cache[index];
      if (v === undefined) {
        v = runText(xml.slice(starts[index]!, ends[index]!));
        cache[index] = v;
      }
      return v;
    },
  };
}

/** The shared-string table (empty when the workbook has none). */
export async function xlsxSharedStrings(bytes: Uint8Array): Promise<StringTable> {
  const entry = entryNamed(bytes, "xl/sharedStrings.xml");
  if (!entry) return stringTable([]);
  const parts: string[] = [];
  for await (const chunk of entryText(bytes, entry)) parts.push(chunk);
  const xml = parts.join("");
  const countAttr = /<sst\b[^>]*\buniqueCount="(\d+)"/.exec(xml.slice(0, 2000));
  let cap = countAttr ? Number(countAttr[1]) + 1 : 1024;
  let starts = new Int32Array(cap);
  let ends = new Int32Array(cap);
  let n = 0;
  let from = 0;
  for (;;) {
    const s = xml.indexOf("<si", from);
    if (s < 0) break;
    const after = xml.charCodeAt(s + 3);
    if (after !== 62 && after !== 32 && after !== 47) {
      from = s + 3;
      continue;
    }
    const gt = xml.indexOf(">", s);
    let e: number;
    if (xml.charCodeAt(gt - 1) === 47) e = gt + 1;
    else {
      const c = xml.indexOf("</si>", gt);
      if (c < 0) break;
      e = c + 5;
    }
    if (n === cap) {
      cap *= 2;
      const ns = new Int32Array(cap);
      ns.set(starts);
      starts = ns;
      const ne = new Int32Array(cap);
      ne.set(ends);
      ends = ne;
    }
    starts[n] = s;
    ends[n] = e;
    n++;
    from = e;
  }
  return lazyStrings(xml, starts, ends, n);
}

/** Zero-based column index of a cell reference such as "AB12". */
export function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Value of attribute `name` inside the tag text row[start..end), or null. Index scanning, no regex. */
function attrIn(row: string, start: number, end: number, name: string): string | null {
  const key = ` ${name}="`;
  const at = row.indexOf(key, start);
  if (at < 0 || at >= end) return null;
  const v = at + key.length;
  const q = row.indexOf('"', v);
  return q < 0 || q > end ? null : row.slice(v, q);
}

/** Zero-based column index from the letters at row[at..]. */
function columnAt(row: string, at: number): number {
  let n = 0;
  for (let i = at; i < row.length; i++) {
    const c = row.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** The cells of one `<row>` segment, positioned by their column letters. */
export function rowCells(row: string, strings: StringTable): (string | null)[] {
  const out: (string | null)[] = [];
  let from = 0;
  for (;;) {
    const s = row.indexOf("<c", from);
    if (s < 0) break;
    const next = row.charCodeAt(s + 2);
    if (next !== 32 && next !== 62 && next !== 47) {
      from = s + 2;
      continue;
    }
    const gt = row.indexOf(">", s);
    const refAt = row.indexOf(' r="', s);
    const col = refAt >= 0 && refAt < gt ? columnAt(row, refAt + 4) : out.length;
    if (row.charCodeAt(gt - 1) === 47) {
      from = gt + 1;
      continue;
    }
    const e = row.indexOf("</c>", gt);
    from = e + 4;
    const type = attrIn(row, s, gt, "t");
    let value: string | null;
    if (type === "inlineStr") value = runText(row.slice(gt + 1, e));
    else {
      const vs = row.indexOf("<v>", gt);
      const raw = vs >= 0 && vs < e ? row.slice(vs + 3, row.indexOf("</v>", vs)) : "";
      if (type === "s") value = strings.get(Number(raw)) ?? null;
      else value = raw.includes("&") ? decodeEntities(raw) : raw;
    }
    while (out.length < col) out.push(null);
    out[col] = value === "" ? null : value;
  }
  return out;
}

/** Column letters for a zero-based index (0 → "A", 26 → "AA"). */
export function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Value of the single cell in column `letters` of the `<row>` segment text[from..to), without parsing the other cells
 * or copying the row.
 */
export function cellValueIn(
  text: string,
  from: number,
  to: number,
  letters: string,
  strings: StringTable,
): string | null {
  const key = `<c r="${letters}`;
  let at = from;
  for (;;) {
    const s = text.indexOf(key, at);
    if (s < 0 || s >= to) return null;
    const d = text.charCodeAt(s + key.length);
    if (d < 48 || d > 57) {
      at = s + key.length;
      continue;
    }
    const gt = text.indexOf(">", s);
    if (text.charCodeAt(gt - 1) === 47) return null;
    const e = text.indexOf("</c>", gt);
    const type = attrIn(text, s, gt, "t");
    if (type === "inlineStr") return runText(text.slice(gt + 1, e)) || null;
    const vs = text.indexOf("<v>", gt);
    const raw = vs >= 0 && vs < e ? text.slice(vs + 3, text.indexOf("</v>", vs)) : "";
    const v =
      type === "s"
        ? (strings.get(Number(raw)) ?? "")
        : raw.includes("&")
          ? decodeEntities(raw)
          : raw;
    return v === "" ? null : v;
  }
}

/** Value of the single cell in column `letters` of a `<row>` segment, without parsing the other cells. */
export function cellValue(row: string, letters: string, strings: StringTable): string | null {
  return cellValueIn(row, 0, row.length, letters, strings);
}

/** Rows of one sheet in order, in batches; each row is its cells by column (null when empty). */
export async function* xlsxRowBatches(
  bytes: Uint8Array,
  sheetPath: string,
  strings: StringTable,
): AsyncGenerator<(string | null)[][]> {
  const entry = entryNamed(bytes, sheetPath);
  if (!entry) throw new Error(`the workbook has no ${sheetPath}`);
  for await (const batch of segmentBatches(bytes, entry, "row"))
    yield batch.map((row) => rowCells(row, strings));
}

/** Keep only rows whose value in the named header column passes the test; others are skipped before parsing. */
export type RowFilter = { column: string; keep: (value: string | null) => boolean };

/**
 * Every row of one sheet as a record keyed by its first row (the header); blank rows are skipped. With a filter, a row is
 * fully parsed only when its value in the filter column passes, which keeps a large sheet cheap to read in slices.
 */
export async function xlsxRecords(
  bytes: Uint8Array,
  sheetPath: string,
  strings: StringTable,
  filter?: RowFilter,
): Promise<Record<string, string | null>[]> {
  const entry = entryNamed(bytes, sheetPath);
  if (!entry) throw new Error(`the workbook has no ${sheetPath}`);
  let header: string[] | null = null;
  let letters: string | null = null;
  const out: Record<string, string | null>[] = [];
  // until the header is read every row is accepted; afterwards a filtered row is tested in place, before it is copied
  const accept = filter
    ? (buf: string, start: number, end: number) =>
        !letters || filter.keep(cellValueIn(buf, start, end, letters, strings))
    : undefined;
  for await (const batch of segmentBatches(bytes, entry, "row", accept)) {
    for (const row of batch) {
      if (!header) {
        header = rowCells(row, strings).map((c) => (c ?? "").trim());
        if (filter) {
          const at = header.indexOf(filter.column);
          if (at < 0) throw new Error(`the sheet has no "${filter.column}" column`);
          letters = columnLetters(at);
        }
        continue;
      }
      // rows of the header's own chunk were accepted before the filter column was known: test every kept row again
      if (filter && letters && !filter.keep(cellValue(row, letters, strings))) continue;
      const cells = rowCells(row, strings);
      if (cells.every((c) => c === null)) continue;
      const rec: Record<string, string | null> = {};
      for (let i = 0; i < header.length; i++) {
        const h = header[i]!;
        if (h) rec[h] = cells[i] ?? null;
      }
      out.push(rec);
    }
  }
  return out;
}
