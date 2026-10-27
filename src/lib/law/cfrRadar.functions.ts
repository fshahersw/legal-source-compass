/**
 * Server read for the CFR change radar (model: ./cfrRadar.ts): the version history of every section of the watched
 * parts, one indexed read per part (filters @> {title, part}). Memoized for 30 minutes (the eCFR history refreshes
 * at most daily); a failed read is never cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { mapLimit, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync } from "@/lib/insights/readers/cache";
import { easternToday } from "./rulemakingTracker";
import { WATCHED_PARTS, buildRadar, partKey, type CfrRadar } from "./cfrRadar";

const read = memoAsync(30 * 60 * 1000, async (): Promise<CfrRadar> => {
  const rows = await mapLimit(WATCHED_PARTS, 4, (p) =>
    readAllRows<{ id: string; title: string | null; versions: unknown }>(
      `corpus_records?select=id,title,versions:detail->versions&dataset=eq.ecfr_section_versions` +
        `&filters=cs.${encodeURIComponent(JSON.stringify({ title: [p.title], part: [p.part] }))}` +
        `&order=ordinal.asc,id.asc`,
      { max: 3_000 },
    ),
  );
  const byPart = new Map(WATCHED_PARTS.map((p, i) => [partKey(p), rows[i] ?? []]));
  return buildRadar(byPart, easternToday());
});

export const getCfrRadar = createServerFn({ method: "GET" }).handler(async (): Promise<CfrRadar> =>
  read().catch((e: unknown) => {
    console.error("cfr radar", e);
    throw new Error("The CFR change radar could not be read just now.");
  }),
);
