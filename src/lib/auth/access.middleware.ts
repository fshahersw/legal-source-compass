import { createMiddleware } from "@tanstack/react-start";
import { isObsoleteDataAsset } from "./legacyDataAssets";

export const rejectObsoleteDataAssets = createMiddleware().server(({ request, next }) => {
  if (!isObsoleteDataAsset(request.url)) return next();
  return new Response("Snapshot not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

export const requireAccountCorpusFunction = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("./access.server");
    const corpusIdentity = await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    setResponseHeader("Vary", "Authorization, Cookie");
    return next({ context: { corpusIdentity } });
  },
);

/** Deny public HTTP calls before dispatch; the function guard also covers direct calls during SSR. */
export const requireAccountCorpusRequest = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    if (handlerType !== "serverFn") return next();
    const { requireCorpusAccess, corpusAccessErrorResponse } = await import("./access.server");
    try {
      await requireCorpusAccess(request);
    } catch (error) {
      return corpusAccessErrorResponse(error);
    }
    const result = await next();
    result.response.headers.set("Cache-Control", "private, no-store");
    result.response.headers.set("Vary", "Authorization, Cookie");
    return result;
  },
);
