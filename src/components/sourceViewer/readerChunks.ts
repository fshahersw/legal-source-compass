/**
 * Cuts a long page's markdown into pieces for progressive rendering. Cuts fall only on blank lines outside code fences, so
 * no block (paragraph, list, table, quote, fence) is ever split and each piece renders exactly as it did inside the whole.
 * A single block longer than the target stays whole.
 */
export function splitMarkdownChunks(markdown: string, target = 6000): string[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  let fenced = false;
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && !line.trim() && size >= target) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
      continue;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.some((l) => l.trim())) chunks.push(current.join("\n"));
  return chunks;
}

/** How many pieces to render in one go: the first piece at once, then a few per idle slice. */
export function nextChunkCount(rendered: number, total: number, perSlice = 3): number {
  return Math.min(total, rendered === 0 ? 1 : rendered + perSlice);
}
