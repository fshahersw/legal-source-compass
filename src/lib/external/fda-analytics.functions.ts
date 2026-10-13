/** Read-only versioned FDA aggregates. No live publisher or administrative calls from the browser. */
import { createServerFn } from "@tanstack/react-start";
import { rpcPostOptional } from "./rest.server";
import { parseFdaAnalyticsEnvelope } from "@/lib/fda-analytics/validation";
import type { FdaAnalyticsEnvelope } from "@/lib/fda-analytics/types";

export const getFdaAnalyticsSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<FdaAnalyticsEnvelope | null> =>
    parseFdaAnalyticsEnvelope(await rpcPostOptional("corpus_fda_analytics_snapshot_v1", {})),
);
