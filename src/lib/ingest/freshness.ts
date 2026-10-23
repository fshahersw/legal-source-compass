/**
 * Freshness of the self-updating sources for the site (client-safe: no server imports). The rows come from
 * public.insights_freshness_v1 (shape: Freshness in src/lib/insights/contract.ts) through getIngestFreshness in
 * freshness.functions.ts; this module validates them, names the sources and words the status. Dates are shown in UTC
 * with a fixed locale, so server and client render the same text.
 */
import { z } from "zod";
import type { Freshness } from "@/lib/insights/contract";

/**
 * The self-updating sources by ingest.sources.id: dataset, label and publisher exactly as seeded in
 * database/contracts/ingest-v1.sql (a test keeps the two in step).
 */
export const SOURCE_LABELS: Readonly<
  Record<string, { dataset: string; label: string; publisher: string }>
> = {
  federal_register: {
    dataset: "federal_register_history",
    label: "Federal Register documents",
    publisher: "Office of the Federal Register (NARA) and GPO",
  },
  openfda_drug_enforcement: {
    dataset: "agency_safety_openfda_drug_enforcement",
    label: "FDA drug enforcement reports",
    publisher: "U.S. Food and Drug Administration (openFDA)",
  },
  openfda_device_enforcement: {
    dataset: "agency_safety_openfda_device_enforcement",
    label: "FDA device enforcement reports",
    publisher: "U.S. Food and Drug Administration (openFDA)",
  },
  openfda_food_enforcement: {
    dataset: "agency_safety_openfda_food_enforcement",
    label: "FDA food enforcement reports",
    publisher: "U.S. Food and Drug Administration (openFDA)",
  },
  cpsc_recalls: {
    dataset: "agency_safety_cpsc_recalls_api",
    label: "CPSC recalls",
    publisher: "U.S. Consumer Product Safety Commission",
  },
  ftc_hsr: {
    dataset: "ftc_hsr_early_terminations",
    label: "FTC HSR early termination notices",
    publisher: "U.S. Federal Trade Commission",
  },
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const FreshnessSchema = z.object({
  source: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  dataset: z.string().regex(/^[a-z0-9_]{1,80}$/),
  lastRunAt: z.string().regex(ISO_UTC).nullable(),
  lastSuccessAt: z.string().regex(ISO_UTC).nullable(),
  newRecords: z.number().int().nonnegative().nullable(),
  status: z.enum(["ok", "failed", "never_run", "stale"]),
  message: z.string().max(400).nullable(),
});

/** A freshness row with the source's display name. */
export type FreshnessRow = Freshness & { label: string; publisher: string | null };

/**
 * What the site knows about updates: `not_installed` when the ingest SQL has not been applied yet (the RPC does not
 * exist), so no update has been recorded; otherwise every registered source's row.
 */
export type FreshnessResult =
  { ledger: "installed"; rows: FreshnessRow[] } | { ledger: "not_installed"; rows: [] };

/** Validate the RPC result (throws on any row that is not the contract's shape). */
export function parseFreshness(raw: unknown): Freshness[] {
  return z.array(FreshnessSchema).parse(raw);
}

export function withLabels(rows: Freshness[]): FreshnessRow[] {
  return rows.map((r) => {
    const known = SOURCE_LABELS[r.source];
    return { ...r, label: known?.label ?? r.dataset, publisher: known?.publisher ?? null };
  });
}

/** The ingest source that keeps `dataset` up to date, if any. */
export function sourceForDataset(dataset: string): string | null {
  for (const [source, v] of Object.entries(SOURCE_LABELS)) if (v.dataset === dataset) return source;
  return null;
}

/** "2026-10-23T09:41:05Z" -> "Oct 23, 2026" (UTC). */
export function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "2026-10-23T09:41:05Z" -> "Oct 23, 2026, 09:41 UTC". */
export function formatUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${formatUtcDate(iso)}, ${time} UTC`;
}

export type FreshnessTone = "ok" | "warning" | "error" | "muted";

/** How one source's freshness is worded: short badge text, its tone, and a fuller note for titles and tables. */
export function describeFreshness(row: Freshness): {
  text: string;
  tone: FreshnessTone;
  note: string;
} {
  const since = row.lastSuccessAt ? formatUtcDate(row.lastSuccessAt) : null;
  switch (row.status) {
    case "ok":
      return {
        text: since ? `Updated ${since}` : "Updated",
        tone: "ok",
        note: row.message ?? "Checked against the publisher on its schedule.",
      };
    case "stale":
      return {
        text: since ? `Updated ${since}` : "Update overdue",
        tone: "warning",
        note: row.message ?? "No successful update within the expected interval.",
      };
    case "failed":
      return {
        text: since ? `Updated ${since}` : "Update failed",
        tone: "error",
        note: row.message ?? "The last update failed.",
      };
    case "never_run":
      return {
        text: "Not updated yet",
        tone: "muted",
        note: row.message ?? "No update recorded yet.",
      };
  }
}
