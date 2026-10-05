import { fetchBundleSnapshot } from "@/lib/private-data/client";

export type StateLawLink = { label: string; url: string };
export type CapturedLawSource = {
  id: string;
  title: string;
  url: string;
  textPath: string;
  capturedAt: string;
};
export type StateLawDirectoryEntry = {
  code: string;
  name: string;
  directoryUrl: string;
  directoryRetrievedAt: string;
  codeLink: StateLawLink | null;
  capturedSources: CapturedLawSource[];
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function officialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".gov") || host.endsWith(".us");
  } catch {
    return false;
  }
}

/**
 * Select a legislature-published code page when the captured DOJ directory
 * lists one. If it lists only a legislature site, retain that real official
 * entry point without implying it is a full code collection.
 */
export function stateCodeLink(links: unknown): StateLawLink | null {
  if (!Array.isArray(links)) return null;
  const seenUrls = new Set<string>();
  const candidates = links.flatMap((value) => {
    const link = object(value);
    const label = text(link?.["label"]);
    const url = text(link?.["url"]);
    if (
      !label ||
      !url ||
      !officialHost(url) ||
      seenUrls.has(url) ||
      link?.["section"] !== "Legislature and Laws"
    )
      return [];
    seenUrls.add(url);
    return [{ label, url }];
  });
  const code = candidates.find((link) =>
    /\b(code|statutes?|statutory|general laws|laws? search|laws? of|bills and laws)\b/i.test(
      link.label,
    ),
  );
  if (code) return code;
  return (
    candidates.find((link) =>
      /\b(legislature|general assembly|council|legislative branch|bills?)\b/i.test(link.label),
    ) ?? null
  );
}

function parseDirectory(value: unknown): StateLawDirectoryEntry[] {
  const root = object(value);
  if (!Array.isArray(root?.["states"])) throw new Error("State law directory is unavailable.");
  const retrievedAt = text(root["retrievedAt"]) ?? "";
  const seenCodes = new Set<string>();
  return root["states"].flatMap((value) => {
    const state = object(value);
    const code = text(state?.["code"]);
    const name = text(state?.["name"]);
    const directoryUrl = text(state?.["sourceUrl"]);
    const normalizedCode = code?.toUpperCase();
    if (!code || !name || !directoryUrl || !normalizedCode || seenCodes.has(normalizedCode))
      return [];
    seenCodes.add(normalizedCode);
    return [
      {
        code: normalizedCode,
        name,
        directoryUrl,
        directoryRetrievedAt: retrievedAt,
        codeLink: stateCodeLink(state?.["links"]),
        capturedSources: [],
      },
    ];
  });
}

function parseCapturedSources(value: unknown): Map<string, CapturedLawSource[]> {
  const root = object(value);
  const sources = Array.isArray(root?.["sources"]) ? root["sources"] : [];
  const result = new Map<string, CapturedLawSource[]>();
  for (const raw of sources) {
    const source = object(raw);
    const state = text(source?.["state"]);
    const id = text(source?.["id"]);
    const title = text(source?.["title"]);
    const url = text(source?.["url"]);
    const textPath = text(source?.["textPath"]);
    const capturedAt = text(source?.["capturedAt"]);
    if (
      !state ||
      !id ||
      !title ||
      !url ||
      !/^https?:\/\//i.test(url) ||
      !textPath ||
      !/^\/data\/limitations\/text\/[a-z0-9._-]+\.txt$/i.test(textPath) ||
      !capturedAt ||
      source?.["authorityKind"] !== "statute"
    )
      continue;
    const rows = result.get(state) ?? [];
    if (
      rows.some(
        (row) => (row.id === id && row.title === title) || (row.url === url && row.title === title),
      )
    )
      continue;
    rows.push({ id, title, url, textPath, capturedAt });
    result.set(state, rows);
  }
  return result;
}

export function buildStateLawDirectory(
  resources: unknown,
  captured: unknown,
): StateLawDirectoryEntry[] {
  const sourcesByState = parseCapturedSources(captured);
  return parseDirectory(resources).map((entry) => ({
    ...entry,
    capturedSources: sourcesByState.get(entry.code) ?? [],
  }));
}

async function snapshotJson(path: string): Promise<unknown> {
  const response = await fetchBundleSnapshot(path);
  if (!response.ok) throw new Error(`Law sources could not load (${response.status}).`);
  return response.json() as Promise<unknown>;
}

export async function loadStateLawDirectory(): Promise<StateLawDirectoryEntry[]> {
  const [resources, captured] = await Promise.all([
    snapshotJson("/data/research/state-resources.json"),
    snapshotJson("/data/limitations/sources.json"),
  ]);
  return buildStateLawDirectory(resources, captured);
}
