/** Industry payments read: Open Payments manufacturers + states (validated by openPayments.functions) and Census population. */
import { restGet } from "@/lib/external/rest.server";
import {
  parseManufacturer,
  parsePopulation,
  parseState,
  type ManufacturerPayments,
  type StatePayments,
} from "@/lib/external/openPayments.functions";
import type { PaymentsInput } from "../generators/payments";
import { memoAsync, READ_TTL_MS } from "./cache";

async function readAll<T>(dataset: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < 5000; start += 1000) {
    const page = await restGet<T[]>(
      `corpus_records?select=${select}&dataset=eq.${dataset}&order=ordinal.asc`,
      { range: [start, start + 999] },
    );
    rows.push(...page.rows);
    if (page.rows.length < 1000) break;
  }
  return rows;
}

export const readPayments = memoAsync<PaymentsInput | null>(READ_TTL_MS, async () => {
  const [makers, states, population] = await Promise.all([
    // Only the fields the insights use: name, rank, totals and the yearly series (parseManufacturer needs entityId too).
    readAll<Record<string, unknown>>(
      "company_payments_manufacturers",
      "id,name:item->payments->name,entityId:item->payments->entityId,rank:item->payments->rank,totals:item->payments->totals,years:item->payments->years",
    ),
    readAll<{ id: string; v: unknown }>("company_payments_states", "id,v:item->payments"),
    restGet<{ usps?: unknown; population?: unknown }[]>(
      "corpus_records?select=usps:item->profile->>usps,population:item->profile->series->population&dataset=eq.state_metrics_profiles&limit=100",
    )
      .then((r) => parsePopulation(r.rows))
      .catch(() => null),
  ]);
  const manufacturers: ManufacturerPayments[] = makers.flatMap((m) => {
    const parsed = parseManufacturer(String(m["id"] ?? ""), {
      name: m["name"],
      entityId: m["entityId"],
      rank: m["rank"],
      totals: m["totals"],
      years: m["years"],
    });
    return parsed ? [parsed] : [];
  });
  const parsedStates: StatePayments[] = states.flatMap((r) => {
    const parsed = parseState(r.v);
    return parsed ? [parsed] : [];
  });
  const national = parsedStates.find((s) => s.state === "US") ?? null;
  if (!national) return null;
  return {
    national,
    states: parsedStates.filter((s) => s.state !== "US"),
    manufacturers,
    population,
  };
});
