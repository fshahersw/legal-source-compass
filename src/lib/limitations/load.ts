import { fetchBundleSnapshot } from "@/lib/private-data/client";
import type { LimitationsSnapshot } from "./types";
import { validateLimitationsSnapshot } from "./validation";

async function json(path: string): Promise<Record<string, unknown>> {
  const response = await fetchBundleSnapshot(path);
  if (!response.ok) throw new Error(`Limitations source failed to load (${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid limitations source.");
  return value as Record<string, unknown>;
}

export async function loadLimitations(): Promise<LimitationsSnapshot> {
  const [rules, sources, coverage, cases] = await Promise.all([
    json("/data/limitations/rules.json"),
    json("/data/limitations/sources.json"),
    json("/data/limitations/coverage.json"),
    json("/data/limitations/case-references.json"),
  ]);
  return validateLimitationsSnapshot({ rules, sources, coverage, cases });
}
