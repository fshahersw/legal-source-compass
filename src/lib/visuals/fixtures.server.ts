/**
 * Dev-only reader for the visual-registry datasets, used by visuals.server.ts only when the Vite dev server runs with
 * VISUALS_FIXTURE=1. It reads the matching build file private/build/visual_registry/<dataset>.json (or .json.gz) when
 * present, else the small fixture in ./fixtures/rows.ts. Never imported in production: the importing branch is guarded
 * by `import.meta.env.DEV`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import * as fixtures from "./fixtures/rows";
import type { VisualDataset } from "./visuals.server";

type Item = Record<string, unknown>;
const cache = new Map<VisualDataset, Promise<Map<string, Item>>>();

async function buildFile(dataset: VisualDataset): Promise<string | null> {
  const base = path.join(process.cwd(), "private", "build", "visual_registry", `${dataset}.json`);
  try {
    return await readFile(base, "utf8");
  } catch {
    try {
      return gunzipSync(await readFile(`${base}.gz`)).toString("utf8");
    } catch {
      return null;
    }
  }
}

function index(rows: unknown): Map<string, Item> {
  const out = new Map<string, Item>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows as { id?: unknown; item?: unknown }[]) {
    if (typeof r?.id === "string" && r.item && typeof r.item === "object")
      out.set(r.id, r.item as Item);
  }
  return out;
}

async function load(dataset: VisualDataset): Promise<Map<string, Item>> {
  const text = await buildFile(dataset);
  if (text !== null) {
    try {
      return index((JSON.parse(text) as { rows?: unknown }).rows);
    } catch {
      return new Map();
    }
  }
  return index(fixtures[dataset]);
}

/** The item of one fixture row, or null when the dataset's build file or fixture has no row with this id. */
export async function readVisualFixtureItem(
  dataset: VisualDataset,
  id: string,
): Promise<Item | null> {
  let rows = cache.get(dataset);
  if (!rows) {
    rows = load(dataset);
    cache.set(dataset, rows);
  }
  return (await rows).get(id) ?? null;
}
