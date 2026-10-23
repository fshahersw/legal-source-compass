// Scheduled refresh: DOJ press releases (justice.gov News API) → doj_press_releases_<year> (wave 1025 api-law;
// database/contracts/api-law-v1.sql registers one source per yearly partition). Logic and tests:
// src/lib/ingest/sources/dojPressReleases.ts. No key. Deploy with --no-verify-jwt.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { dojPressReleases2026, dojPressReleases2027 } from "../../../src/lib/ingest/sources/dojPressReleases.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [dojPressReleases2026, dojPressReleases2027],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
