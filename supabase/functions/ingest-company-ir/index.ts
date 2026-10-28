// Scheduled refresh: company investor-relations documents (company_ir_kpis), SEC cover-page facts
// (company_sec_cover_facts) and daily share prices (company_price_history) of the company_sec_statements registrants
// (ingest/1). Logic and tests: src/lib/ingest/sources/companyIr.ts and companyPrices.ts. Deploy with --no-verify-jwt; deployment notes at the top of
// database/contracts/company-ir-v1.sql. Secrets: FIRECRAWL_API_KEY and ANTHROPIC_API_KEY (company_ir_kpis only),
// TAVILY_API_KEY optional.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { companyIrKpis, companySecCover } from "../../../src/lib/ingest/sources/companyIr.ts";
import { companyPrices } from "../../../src/lib/ingest/sources/companyPrices.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [companyIrKpis, companySecCover, companyPrices],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
