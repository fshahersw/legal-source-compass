// Scheduled refresh of Census Bureau sources (ingest/1): the Government Units List (census_gov_units, read in eight
// parts on consecutive runs), the Business Trends and Outlook Survey (census_btos_states), and the model-based county
// estimates SAIPE (census_saipe, two parts) and SAHIE (census_sahie).
// Logic and tests: src/lib/ingest/sources/{censusGovUnits,censusBtos,censusModeled}.ts and src/lib/ingest/xlsx.ts.
// Deploy with --no-verify-jwt; contract and deployment notes: database/contracts/census-v1.sql.
// Secrets: CENSUS_API_KEY (SAIPE and SAHIE only; never printed, and the request ledger drops the key parameter).
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { censusGovUnits } from "../../../src/lib/ingest/sources/censusGovUnits.ts";
import { censusBtos } from "../../../src/lib/ingest/sources/censusBtos.ts";
import { censusSahie, censusSaipe } from "../../../src/lib/ingest/sources/censusModeled.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [censusGovUnits, censusBtos, censusSaipe, censusSahie],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
