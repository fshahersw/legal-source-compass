// Scheduled refresh of safety/1 monthly series from openFDA (FAERS drug/event, MAUDE device/event): the latest months of
// every stored series of the planned subjects (MDL product groups, national totals, ranked products), cursor-rotated.
// One function, two sources: the scheduler posts { "source": "safety_faers_series" | "safety_maude_series" }.
// Logic and tests: src/lib/safety/ingestSafety.ts. Needs the function secret DATA_GOV_API_KEY (api.data.gov key accepted by
// openFDA). Deploy with --no-verify-jwt; deployment notes: docs/safety-signals-2026-10-25.md (RUNBOOK) and
// database/contracts/safety-signals-v1.sql section 6.
import { serveSafety } from "../../../src/lib/safety/edgeSafety.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveSafety({
    sources: ["safety_faers_series", "safety_maude_series"],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
