// Scheduled refresh: Regulations.gov documents and dockets of twelve agencies → regulations_gov_documents and
// regulations_gov_dockets (wave 1025 api-law; database/contracts/api-law-v1.sql registers the two sources).
// Logic and tests: src/lib/ingest/sources/regulationsGov.ts. Needs the function secret DATA_GOV_API_KEY (sent only in the
// X-Api-Key header, never recorded). Deploy with --no-verify-jwt (the handler checks the trigger secret itself).
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import {
  regulationsGovDockets,
  regulationsGovDocuments,
} from "../../../src/lib/ingest/sources/regulationsGov.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [regulationsGovDocuments, regulationsGovDockets],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
