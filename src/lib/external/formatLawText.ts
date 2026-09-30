/** Split stored law text into paragraphs at subsection markers like (a), (1), (A), (iv). Never drops text. */
export function formatLawText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Break before a marker that follows sentence end or another marker: "... end. (b) Next" / "(a) Title (1) Item".
  const parts = clean.split(/(?<=[.;:)\]]|^)\s+(?=\((?:[a-z]{1,2}|[0-9]{1,3}|[A-Z]{1,2}|[ivxlc]{1,5})\)\s)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Indent depth for a paragraph by its leading marker: (a)=0, (1)=1, (A)=2, roman=3. */
export function markerDepth(p: string): number {
  const m = /^\(([^)]+)\)/.exec(p);
  if (!m) return 0;
  const k = m[1]!;
  if (/^[ivxlc]{2,5}$/.test(k)) return 3;
  if (/^[0-9]+$/.test(k)) return 1;
  if (/^[A-Z]+$/.test(k)) return 2;
  return 0;
}
