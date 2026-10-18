/** Enforcement reads: CFPB and EPA come from ./shared (also used by State); rulemaking is read here. */
import { restGet } from "@/lib/external/rest.server";
import { parseActivity, type AgencyActivity } from "@/lib/external/rulemaking.functions";
import type { EpaNationalInput, RulemakingInput } from "../generators/enforcement";
import { memoAsync, READ_TTL_MS } from "./cache";
import { readEpa } from "./shared";

export { readCfpb } from "./shared";

export async function readEpaNational(): Promise<EpaNationalInput | null> {
  const epa = await readEpa();
  return epa ? { fileDate: epa.fileDate, national: epa.national } : null;
}

export const readRulemaking = memoAsync<RulemakingInput | null>(READ_TTL_MS, async () => {
  const [records, catalog] = await Promise.all([
    restGet<{ activity: unknown }[]>(
      "corpus_records?select=activity:item->activity&dataset=eq.regulatory_federal_register_activity&order=ordinal.asc&limit=100",
    ),
    restGet<{ metadata: { summary?: { as_of?: unknown } } | null }[]>(
      "corpus_datasets?select=metadata&id=eq.regulatory_federal_register_activity&limit=1",
    ),
  ]);
  const agencies: AgencyActivity[] = records.rows.flatMap(({ activity }) => {
    const parsed = parseActivity(activity);
    return parsed ? [parsed] : [];
  });
  if (!agencies.length) return null;
  const asOf = catalog.rows[0]?.metadata?.summary?.as_of;
  return { asOf: typeof asOf === "string" ? asOf : null, agencies };
});
