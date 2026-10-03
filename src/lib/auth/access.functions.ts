import { createServerFn } from "@tanstack/react-start";

/**
 * Account probe used by the client gate.
 * - Enforcement off (CORPUS_REQUIRE_AUTH unset): `{ required: false }`, nothing is read or set.
 * - Enforcement on: the global verified-account middleware must approve this request before any identity is returned.
 */
export const getCorpusSession = createServerFn({ method: "POST" }).handler(async () => {
  const { corpusAuthRequired } = await import("./accessPolicy");
  if (!corpusAuthRequired()) return { required: false as const, userId: null, email: null };
  const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
  const { requireCorpusAccess } = await import("./access.server");
  const { corpusRequestToken, corpusSessionCookie } = await import("./accessPolicy");
  const request = getRequest();
  const identity = await requireCorpusAccess(request);
  setResponseHeader("Set-Cookie", corpusSessionCookie(request, corpusRequestToken(request)));
  return { required: true as const, userId: identity.userId, email: identity.email };
});
