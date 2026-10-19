/**
 * The Sources directory: published corpus datasets with their record counts, last update and recorded source statement (and the
 * http(s) URLs written in it). Read-only. Datasets not marked ready (held, staged or withdrawn) are counted but never listed.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";
import { extractUrls, type SourceDataset } from "./sourcesCatalog";

type Raw = {
  id: unknown;
  label: unknown;
  ready: unknown;
  imported_records: unknown;
  updated_at: unknown;
  source: unknown;
  qualification: unknown;
};

export type SourcesDirectory = { datasets: SourceDataset[]; held: number };

const ID = /^[a-z0-9_]{1,80}$/;
const MAX_SOURCE_TEXT = 600;

/** A stored source statement as plain text: strings as written, objects as their JSON. */
function sourceText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function parseDirectory(rows: readonly Raw[]): SourcesDirectory {
  const datasets: SourceDataset[] = [];
  let held = 0;
  for (const r of rows) {
    if (typeof r.id !== "string" || !ID.test(r.id)) continue;
    if (r.ready !== true) {
      held += 1;
      continue;
    }
    const source = sourceText(r.source);
    const qualification = typeof r.qualification === "string" ? r.qualification.trim() : "";
    const text = source ?? (qualification || null);
    datasets.push({
      id: r.id,
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim() : r.id,
      records:
        typeof r.imported_records === "number" &&
        Number.isInteger(r.imported_records) &&
        r.imported_records >= 0
          ? r.imported_records
          : null,
      sourceText: text ? text.slice(0, MAX_SOURCE_TEXT) : null,
      sourceUrls: extractUrls([source ?? "", qualification].join(" ")),
      updatedAt:
        typeof r.updated_at === "string" && !Number.isNaN(Date.parse(r.updated_at))
          ? r.updated_at
          : null,
    });
  }
  return { datasets, held };
}

async function readDirectory(): Promise<SourcesDirectory> {
  const r = await restGet<Raw[]>(
    "corpus_datasets?select=id,label,ready,imported_records,updated_at,source:metadata->summary->source,qualification:metadata->listing->qualification&order=id.asc",
  );
  return parseDirectory(r.rows);
}

export const getSourcesDirectory = createServerFn({ method: "GET" }).handler(readDirectory);

export type RecordSourceSample = { urls: Record<string, string[]>; failed: number };

/** First records of each dataset, by source order; the index on (dataset, ordinal) serves each read. */
const SAMPLE = 5;
const CONCURRENCY = 8;
const SAMPLE_TTL_MS = 30 * 60 * 1000;
let cachedSample: { at: number; value: RecordSourceSample } | null = null;

export function sampleUrls(rows: readonly { source_url?: unknown }[]): string[] {
  const text = rows
    .map((r) => (typeof r.source_url === "string" ? r.source_url : ""))
    .filter(Boolean)
    .join(" ");
  return extractUrls(text, SAMPLE);
}

/**
 * http(s) source URLs on the first records of every published dataset, for the portal list. Read lazily (the Portals tab) and
 * cached on the server for half an hour; a dataset whose read fails is counted, not guessed.
 */
export const getRecordSourceSample = createServerFn({ method: "GET" }).handler(
  async (): Promise<RecordSourceSample> => {
    if (cachedSample && Date.now() - cachedSample.at < SAMPLE_TTL_MS) return cachedSample.value;
    const { datasets } = await readDirectory();
    const urls: Record<string, string[]> = {};
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < datasets.length) {
        const d = datasets[next++]!;
        try {
          const r = await restGet<{ source_url?: unknown }[]>(
            `corpus_records?select=source_url&dataset=eq.${d.id}&order=ordinal.asc&limit=${SAMPLE}`,
          );
          const found = sampleUrls(r.rows);
          if (found.length) urls[d.id] = found;
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const value = { urls, failed };
    cachedSample = { at: Date.now(), value };
    return value;
  },
);
