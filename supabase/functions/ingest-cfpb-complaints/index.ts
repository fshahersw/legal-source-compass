// Scheduled refresh of safety/1 CFPB complaints (record level): complaints received in the last 7 days for the products
// already held in safety.cfpb_complaints, from the public CFPB complaint search API (no key), upserted by complaint id.
// Logic and tests: src/lib/safety/ingestSafety.ts. Deploy with --no-verify-jwt; deployment notes:
// docs/safety-signals-2026-10-25.md (RUNBOOK) and database/contracts/safety-signals-v1.sql section 6.
import { serveSafety } from "../../../src/lib/safety/edgeSafety.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveSafety({
    sources: ["safety_cfpb_complaints"],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
