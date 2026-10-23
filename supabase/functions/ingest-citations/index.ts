// Nightly citation extraction for newly indexed court-filing pages (citations/2), after documents-nightly.
// Logic and tests: src/lib/citations/nightly.ts (engine: src/lib/citations/engine.ts). Deploy with --no-verify-jwt (the
// handler checks the ingest trigger secret itself); deployment and schedule: database/contracts/citations-v2-schedule.sql.
import { serveCitations } from "../../../src/lib/citations/nightly.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveCitations({
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
