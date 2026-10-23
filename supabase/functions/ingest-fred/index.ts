// Scheduled refresh: FRED series (Federal Reserve Bank of St. Louis API) → econ_fred_observations (source
// fred_observations) and econ_fred_series (source fred_series) (ingest/1). One function, two sources: the scheduler posts
// { "source": "fred_observations" | "fred_series" }; observations run first (see database/contracts/api-econ-v1.sql).
// Needs the function secret FRED_API_KEY (FRED requires it as a query parameter; recorded URLs never carry it).
// Logic and tests: src/lib/ingest/sources/fred.ts. Deploy with --no-verify-jwt; deployment notes at the top of
// database/contracts/ingest-v1.sql and in database/contracts/api-econ-v1.sql.
import { serveIngest } from "../../../src/lib/ingest/edge.ts";
import { fredObservations, fredSeries } from "../../../src/lib/ingest/sources/fred.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(
  serveIngest({
    sources: [fredObservations, fredSeries],
    env: (name) => Deno.env.get(name),
    waitUntil: (p) => EdgeRuntime.waitUntil(p),
  }),
);
