// Scheduled refresh: GAO legal decisions from GAO's Legal Products RSS feed → gao_legal_decisions (wave 1025 api-law;
// database/contracts/api-law-v1.sql registers the source). One request a run (gao.gov asks for 420 s between requests).
// Logic and tests: src/lib/ingest/sources/gaoLegal.ts. No key. Deploy with --no-verify-jwt.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { gaoLegalDecisions } from "../../../src/lib/ingest/sources/gaoLegal.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [gaoLegalDecisions],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
