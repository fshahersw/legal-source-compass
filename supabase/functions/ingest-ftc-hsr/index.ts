// Scheduled refresh: FTC HSR early termination notices (api.ftc.gov) → ftc_hsr_early_terminations (ingest/1).
// Needs the function secret DATA_GOV_API_KEY (sent only as the X-Api-Key header).
// Logic and tests: src/lib/ingest/sources/ftcHsr.ts. Deploy with --no-verify-jwt; deployment notes at the top of database/contracts/ingest-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { ftcHsr } from "../../../src/lib/ingest/sources/ftcHsr.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [ftcHsr],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
