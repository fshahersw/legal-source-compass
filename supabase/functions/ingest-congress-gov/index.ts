// Scheduled refresh: Congress.gov amendments, nominations, treaties and committee reports → congress_amendments,
// congress_nominations, congress_treaties, congress_committee_reports (wave 1025 api-law; database/contracts/api-law-v1.sql
// registers the sources). Logic and tests: src/lib/ingest/sources/congressGov.ts. Needs the function secret
// DATA_GOV_API_KEY (sent only in the X-Api-Key header, never recorded). Deploy with --no-verify-jwt.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import {
  congressAmendments,
  congressCommitteeReports,
  congressNominations,
  congressTreaties,
} from "../../../src/lib/ingest/sources/congressGov.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [congressAmendments, congressNominations, congressTreaties, congressCommitteeReports],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
