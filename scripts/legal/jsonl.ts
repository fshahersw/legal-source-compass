import fs from "node:fs";

/** JSONL separates records with LF, not Unicode separators inside JSON strings.
 * Node's readline treats U+2028/U+2029 as line endings and corrupts those rows. */
export async function* parseJsonLines<T>(chunks: AsyncIterable<string>): AsyncGenerator<T> {
  let pending = "";
  for await (const chunk of chunks) {
    pending += chunk;
    let start = 0, end: number;
    while ((end = pending.indexOf("\n", start)) !== -1) {
      const line = pending.slice(start, end);
      if (line.trim()) yield JSON.parse(line) as T;
      start = end + 1;
    }
    pending = pending.slice(start);
    if (pending.length > 64 * 1024 * 1024) throw Error("JSONL record exceeds the 64 MiB review limit");
  }
  if (pending.trim()) yield JSON.parse(pending) as T;
}

export function readJsonLines<T>(file: string): AsyncGenerator<T> {
  return parseJsonLines<T>(fs.createReadStream(file, { encoding: "utf8" }) as AsyncIterable<string>);
}
