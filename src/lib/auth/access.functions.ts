import { createServerFn } from "@tanstack/react-start";

/** The global verified-account middleware must approve this request before any identity is returned. */
export const getCorpusSession = createServerFn({ method: "POST" }).handler(async () => {
  const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
  const { requireCorpusAccess } = await import("./access.server");
  const { corpusRequestToken, corpusSessionCookie } = await import("./accessPolicy");
  const request = getRequest();
  const identity = await requireCorpusAccess(request);
  setResponseHeader("Set-Cookie", corpusSessionCookie(request, corpusRequestToken(request)));
  return identity;
});
