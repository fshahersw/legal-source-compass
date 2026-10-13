import { createServerFn } from "@tanstack/react-start";
import type { RegulatoryQueryCapability, RegulatoryQueryInterpretation } from "./query";

async function queryAccess() {
  const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
  const { requireCorpusAccess } = await import("@/lib/auth/access.server");
  const request = getRequest();
  await requireCorpusAccess(request);
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Vary", "Authorization, Cookie");
  return request;
}

export const getRegulatoryQueryCapability = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegulatoryQueryCapability> => {
    await queryAccess();
    const { regulatoryQueryCapability } = await import("./query.server");
    return regulatoryQueryCapability();
  },
);

/** Public evidence query only; private investigation content is never loaded into this request. */
export const interpretRegulatoryQuery = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => value)
  .handler(async ({ data }): Promise<RegulatoryQueryInterpretation> => {
    const request = await queryAccess();
    if (Number(request.headers.get("content-length")) > 80_000)
      return {
        status: "invalid_input",
        summary: "The question is too long. Shorten it and try again.",
        limitations: [],
      };
    const { interpretRegulatoryQueryServer } = await import("./query.server");
    return interpretRegulatoryQueryServer(data);
  });
