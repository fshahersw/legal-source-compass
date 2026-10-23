// Scheduled refresh of the semantic index (search by meaning): new, changed and removed records of the eight indexed
// collections are re-chunked exactly as the batch build did, only passages whose embed string is not stored yet are
// embedded (within the daily and global token caps), and the index is updated through the semantic_refresh_* RPCs.
// Function secret: VOYAGE_API_KEY (embedding key). Logic: ./refresh.ts, ./sources.ts, ./embed.ts and
// src/lib/semantic/chunking.ts; tests: src/lib/semantic/*.test.ts, scripts/semantic/semantic-refresh-sql.test.mjs.
// Deploy with --no-verify-jwt; runbook: docs/semantic-refresh-2026-10-25.md; database: database/contracts/semantic-refresh-v1.sql.
import { serveRefresh } from "./serve.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveRefresh({
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
