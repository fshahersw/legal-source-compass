/** Pure state model for the client access gate; the server independently enforces every request. */

export type AccessState =
  | { state: "checking" }
  /** The server reports enforcement off (CORPUS_REQUIRE_AUTH unset): everything renders without a session. */
  | { state: "open" }
  /** Enforcement on and no browser session: show the sign-in card. */
  | { state: "signed-out" }
  /** Enforcement on and the server verified the account. */
  | { state: "allowed"; email: string | null }
  /** Enforcement on, a browser session exists, but the server refused it (e.g. unconfirmed email). */
  | { state: "denied"; email: string | null };

/** What the server-side account probe returned. */
export type GateProbe =
  | { kind: "open" }
  | { kind: "allowed"; userId: string | null; email: string | null }
  | { kind: "rejected" };

/**
 * Resolve the gate from one probe. A rejected probe means enforcement is on and this browser is not admitted:
 * no browser session => sign in; a session the server refused => explain, never admit.
 */
export function resolveAccess(
  probe: GateProbe,
  session: { present: boolean; email: string | null },
): AccessState {
  if (probe.kind === "open") return { state: "open" };
  if (probe.kind === "allowed") return { state: "allowed", email: probe.email };
  return session.present ? { state: "denied", email: session.email } : { state: "signed-out" };
}

/** Interpret getCorpusSession()'s payload. Anything unexpected is a rejection (fail closed). */
export function probeFromSession(payload: unknown): GateProbe {
  if (payload && typeof payload === "object") {
    const p = payload as { required?: unknown; userId?: unknown; email?: unknown };
    if (p.required === false) return { kind: "open" };
    if (p.required === true)
      return {
        kind: "allowed",
        userId: typeof p.userId === "string" ? p.userId : null,
        email: typeof p.email === "string" ? p.email : null,
      };
  }
  return { kind: "rejected" };
}

/** Routes that must stay reachable without admission (they only talk to the auth provider). */
export const PUBLIC_AUTH_PATHS = ["/auth", "/reset-password"] as const;

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((p) => pathname === p || pathname === `${p}/`);
}

/** Only same-origin absolute paths may be used as a post-sign-in redirect. */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  if (value.length > 500) return undefined;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return undefined;
  }
  if (isPublicAuthPath(value.split(/[?#]/)[0] ?? "")) return undefined;
  return value;
}
