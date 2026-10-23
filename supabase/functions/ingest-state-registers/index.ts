// Scheduled refresh: state register (rulemaking bulletin) issue listings → state_register_issues (ingest/1, weekly).
// No secrets. Logic and tests: src/lib/ingest/sources/stateRegisters.ts. Source row and dataset: database/contracts/state-regs-v1.sql.
// Deploy with --no-verify-jwt; deployment notes at the top of database/contracts/ingest-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { stateRegisters } from "../../../src/lib/ingest/sources/stateRegisters.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [stateRegisters],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
