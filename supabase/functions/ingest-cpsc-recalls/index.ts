// Scheduled refresh: CPSC Recall REST API → agency_safety_cpsc_recalls_api (ingest/1).
// Logic and tests: src/lib/ingest/sources/cpscRecalls.ts. Deploy with --no-verify-jwt; deployment notes at the top of database/contracts/ingest-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { cpscRecalls } from "../../../src/lib/ingest/sources/cpscRecalls.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [cpscRecalls],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
