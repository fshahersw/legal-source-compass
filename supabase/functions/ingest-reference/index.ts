// Scheduled refresh of official reference publications (ingest/1): the United States Government Manual
// (govman_agencies), the Official Congressional Directory (cdir_members, cdir_committees), FDA postmarketing
// requirements and commitments (fda_pmr_pmc) and CDC provisional overdose death counts (cdc_overdose_states).
// Logic and tests: src/lib/ingest/sources/{govman,cdir,fdaPmr,cdcOverdose}.ts. Deploy with --no-verify-jwt;
// contract and deployment notes: database/contracts/reference-v1.sql. No secrets.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { govmanAgencies } from "../../../src/lib/ingest/sources/govman.ts";
import { cdirCommittees, cdirMembers } from "../../../src/lib/ingest/sources/cdir.ts";
import { fdaPmrPmc } from "../../../src/lib/ingest/sources/fdaPmr.ts";
import { cdcOverdose } from "../../../src/lib/ingest/sources/cdcOverdose.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [govmanAgencies, cdirMembers, cdirCommittees, fdaPmrPmc, cdcOverdose],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
