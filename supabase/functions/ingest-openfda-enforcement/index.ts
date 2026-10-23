// Scheduled refresh: openFDA enforcement reports → agency_safety_openfda_{drug,device,food}_enforcement (ingest/1).
// One function, three sources: the scheduler posts { "source": "openfda_drug_enforcement" | ... }.
// Logic and tests: src/lib/ingest/sources/openfdaEnforcement.ts. Deploy with --no-verify-jwt; deployment notes at the top of database/contracts/ingest-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import {
  openfdaDeviceEnforcement,
  openfdaDrugEnforcement,
  openfdaFoodEnforcement,
} from "../../../src/lib/ingest/sources/openfdaEnforcement.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [openfdaDrugEnforcement, openfdaDeviceEnforcement, openfdaFoodEnforcement],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
