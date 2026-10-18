/**
 * Server function behind every insight card: `getDailyInsights({ data: { section? } })`.
 * Reads only what the requested section needs (sources run in parallel, each memoized for 10 minutes), builds the
 * section's candidate pool, and returns today's pick for the UTC day the server clock is in. The day key is part
 * of the result, so the client never reads a clock and a reload on the same UTC day shows the same insight.
 * Deterministic and number-backed: no model is called and nothing is estimated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildPool,
  failedSection,
  sectionForDay,
  type SectionPool,
  type SourceOutcome,
} from "./pipeline";
import { READ_TTL_MS } from "./readers/cache";
import { SECTIONS, type SectionDef } from "./registry";
import { utcDayKey } from "./rotation";
import type { DailyInsights } from "./types";

const poolCache = new Map<string, { at: number; value: SectionPool }>();

async function poolFor(def: SectionDef): Promise<SectionPool> {
  const hit = poolCache.get(def.id);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value;
  const settled = await Promise.allSettled(def.sources.map((s) => s.run()));
  const outcomes: SourceOutcome[] = settled.map((r, i) => {
    const id = def.sources[i]!.id;
    if (r.status === "fulfilled") return { id, ok: true, insights: r.value };
    console.error(
      `Insight source ${id} failed: ${r.reason instanceof Error ? r.reason.message : "unknown error"}`,
    );
    return { id, ok: false, error: "read failed" };
  });
  const value = buildPool(def.id, outcomes);
  // A partial pool is not cached, so the next request retries the failed source.
  if (!value.partial) poolCache.set(def.id, { at: Date.now(), value });
  return value;
}

export const getDailyInsights = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        section: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,31}$/)
          .optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<DailyInsights> => {
    const dayKey = utcDayKey(new Date());
    if (data.section) {
      const def = SECTIONS.find((s) => s.id === data.section);
      if (!def) throw new Error("Unknown insight section.");
      return { dayKey, sections: [sectionForDay(def, await poolFor(def), dayKey)] };
    }
    const sections = await Promise.all(
      SECTIONS.map(async (def) => {
        try {
          return sectionForDay(def, await poolFor(def), dayKey);
        } catch {
          return failedSection(def);
        }
      }),
    );
    return { dayKey, sections };
  });
