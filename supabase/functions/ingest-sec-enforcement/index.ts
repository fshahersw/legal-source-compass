// Scheduled refresh: SEC litigation releases and administrative proceedings → sec_enforcement_actions (wave 1025 api-law;
// database/contracts/api-law-v1.sql registers the source). Logic and tests: src/lib/ingest/sources/secEnforcement.ts.
// No key; sec.gov fair access is kept by the declared User-Agent and 1 s spacing. Deploy with --no-verify-jwt.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { secEnforcement } from "../../../src/lib/ingest/sources/secEnforcement.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [secEnforcement],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
