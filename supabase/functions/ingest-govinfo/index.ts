// Scheduled refresh: GovInfo bill text versions, hearings, committee prints and GAO reports → govinfo_bill_versions,
// govinfo_hearings, govinfo_committee_prints, govinfo_gao_reports (wave 1025 api-law; database/contracts/api-law-v1.sql
// registers the sources). Logic and tests: src/lib/ingest/sources/govinfo.ts. Needs the function secret DATA_GOV_API_KEY
// (sent only in the X-Api-Key header, never recorded). Deploy with --no-verify-jwt.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import {
  govinfoBillVersions,
  govinfoCommitteePrints,
  govinfoGaoReports,
  govinfoHearings,
} from "../../../src/lib/ingest/sources/govinfo.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [govinfoBillVersions, govinfoHearings, govinfoCommitteePrints, govinfoGaoReports],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
