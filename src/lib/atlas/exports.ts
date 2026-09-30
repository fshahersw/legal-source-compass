import type { ReviewOverlay, Source } from "./types";

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const SOURCE_EXPORT_COLUMNS = [
  "id",
  "title",
  "url",
  "domain",
  "jurisdiction",
  "heading_category",
  "source_family",
  "occurrences",
  "imported_authority_label",
  "imported_currentness_label",
  "imported_review_label",
  "local_review_action",
  "local_review_reason",
  "local_review_at",
  "local_bookmarked",
] as const;

export function toSourceRows(
  sources: Source[],
  overlays: Record<string, ReviewOverlay>,
  bookmarks: Record<string, true>,
) {
  return sources.map((s) => {
    const overlay = overlays[s.id];
    return {
      id: s.id,
      title: s.title,
      url: s.url,
      domain: s.domain,
      jurisdiction: s.jurisdiction,
      heading_category: s.heading_category,
      source_family: s.source_family,
      occurrences: s.occurrences,
      imported_authority_label: s.imported_authority_label ?? "",
      imported_currentness_label: s.imported_currentness_label ?? "",
      imported_review_label: s.imported_review_label ?? "",
      local_review_action: overlay?.action ?? "",
      local_review_reason: overlay?.reason ?? "",
      local_review_at: overlay?.at ?? "",
      local_bookmarked: bookmarks[s.id] ? "true" : "false",
    };
  });
}

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[]): string {
  const head = columns.map(csvCell).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\r\n");
  return rows.length === 0 ? head : `${head}\r\n${body}`;
}

export function sourcesToCsv(
  sources: Source[],
  overlays: Record<string, ReviewOverlay>,
  bookmarks: Record<string, true>,
): string {
  return toCsv(toSourceRows(sources, overlays, bookmarks), SOURCE_EXPORT_COLUMNS);
}

export function sourcesToJson(
  sources: Source[],
  overlays: Record<string, ReviewOverlay>,
  bookmarks: Record<string, true>,
  meta: { bundle_version: string; exported_at?: string; scope: string },
): string {
  return JSON.stringify(
    {
      export_kind: "legal-source-atlas-export",
      scope: meta.scope,
      bundle_version: meta.bundle_version,
      exported_at: meta.exported_at ?? new Date().toISOString(),
      note:
        "imported_* fields are historical curation values copied verbatim from the bundle and are not fresh verification. local_review_* and local_bookmarked come from this browser only.",
      row_count: sources.length,
      rows: toSourceRows(sources, overlays, bookmarks),
    },
    null,
    2,
  );
}

export function downloadText(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
