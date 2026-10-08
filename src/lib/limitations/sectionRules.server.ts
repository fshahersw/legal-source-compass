import { readPrivateSnapshot } from "@/lib/private-data/snapshot.server";
import type { LimitationsSnapshot } from "./types";
import { validateLimitationsSnapshot } from "./validation";

let cached: Promise<LimitationsSnapshot> | null = null;

async function json(file: string): Promise<Record<string, unknown>> {
  const bytes = await readPrivateSnapshot(file);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid limitations file ${file}`);
  return value as Record<string, unknown>;
}

/** The live limitations release, hash-verified from private storage and validated once per worker. */
export function loadLimitationsServer(): Promise<LimitationsSnapshot> {
  if (!cached) {
    cached = (async () => {
      const [rules, sources, coverage, cases] = await Promise.all([
        json("limitations/rules.json"),
        json("limitations/sources.json"),
        json("limitations/coverage.json"),
        json("limitations/case-references.json"),
      ]);
      return validateLimitationsSnapshot({ rules, sources, coverage, cases });
    })().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}
