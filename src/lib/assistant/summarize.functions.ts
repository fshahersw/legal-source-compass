/**
 * Server functions behind the AI kit (src/components/kit/ai):
 *
 *  - `summarizeSection({ data: SectionContext })`: the "What this shows" note for one section, written only from the
 *    figures sent, checked sentence by sentence against them, cached, rate limited per client. It returns the state to
 *    show (ok, thin, or unavailable with a reason); it does not throw for a bad payload or a model failure.
 *  - `getAiStatus()`: whether AI is configured on this server, so the kit can say so instead of failing on click.
 *
 * Account checks run in the global function middleware (src/start.ts) like every other server function.
 */
import { createServerFn } from "@tanstack/react-start";
import { MAX_SECTION_CONTEXT_BYTES } from "./sectionContext";
import type { SummaryResult } from "./summaryTypes";

/** A request this large cannot be a valid section context (8 KB plus envelope), so it is refused before parsing. */
const MAX_REQUEST_BYTES = MAX_SECTION_CONTEXT_BYTES * 2;

export type { SummaryResult };

export const summarizeSection = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => value)
  .handler(async ({ data }): Promise<SummaryResult> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_REQUEST_BYTES)
      return {
        status: "unavailable",
        reason: "invalid",
        message: "The section figures were too large, so nothing was sent.",
      };
    const { clientKey } = await import("./limits.server");
    const { summarizeSectionContext } = await import("./summarize.server");
    return summarizeSectionContext(data, { clientKey: clientKey(request), signal: request.signal });
  });

export const getAiStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ configured: boolean }> => {
    const { modelConfig } = await import("./model.server");
    return { configured: modelConfig() !== null };
  },
);
