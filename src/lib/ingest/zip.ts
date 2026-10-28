/**
 * Minimal ZIP reader for ingest sources that publish zipped files (FDA, GovInfo packages): lists the central directory
 * and inflates one entry with the platform's DecompressionStream ("deflate-raw"), so no library and little CPU is
 * needed in the edge runtime. Stored (method 0) and deflated (method 8) entries only; ZIP64 is not supported.
 */

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local file header. */
  offset: number;
};

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The entries of a ZIP archive (central directory order). Throws when the archive has no end-of-directory record. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder("utf-8");
  for (let k = 0; k < count; k++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("broken ZIP central directory");
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The uncompressed bytes of one entry. */
export async function zipRead(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const p = entry.offset;
  if (u32(bytes, p) !== 0x04034b50) throw new Error(`broken local header for ${entry.name}`);
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method !== 8)
    throw new Error(`unsupported ZIP method ${entry.method} for ${entry.name}`);
  const stream = new Blob([data.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The text of the first entry whose name matches, decoded as UTF-8 (or Latin-1 when asked). */
export async function zipText(
  bytes: Uint8Array,
  match: (name: string) => boolean,
  encoding: "utf-8" | "latin1" = "utf-8",
): Promise<{ name: string; text: string } | null> {
  const entry = zipEntries(bytes).find((e) => match(e.name));
  if (!entry) return null;
  const raw = await zipRead(bytes, entry);
  return { name: entry.name, text: new TextDecoder(encoding).decode(raw) };
}
