// Scheduled refresh: Federal Register documents → federal_register_history (ingest/1).
// Logic and tests: src/lib/ingest/sources/federalRegister.ts. Deploy with --no-verify-jwt (the handler checks
// the trigger secret itself); deployment notes at the top of database/contracts/ingest-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { federalRegister } from "../../../src/lib/ingest/sources/federalRegister.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [federalRegister],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
