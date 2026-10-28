/**
 * Integrity of the navigator transcript the browser round-trips between rounds. The server signs the conversation it
 * holds (model turns, server tool results), the round and the ids of the browser calls it is waiting for; on resume
 * it accepts the transcript only when the signature matches, so a page cannot forge earlier tool results or skip the
 * round limit. The key is NAVIGATOR_SIGNING_KEY, or derived from the model key when that is unset. Server-only.
 */
type Env = Record<string, string | undefined>;

const enc = new TextEncoder();

async function hmacKey(env: Env): Promise<CryptoKey | null> {
  const explicit = env["NAVIGATOR_SIGNING_KEY"]?.trim();
  const base = explicit || env["ANTHROPIC_API_KEY"]?.trim();
  if (!base) return null;
  const raw = explicit
    ? enc.encode(explicit)
    : new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await crypto.subtle.importKey(
            "raw",
            enc.encode(base),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          ),
          enc.encode("navigator-transcript-v1"),
        ),
      );
  return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function signedPayload(
  transcript: string,
  round: number,
  pending: readonly string[],
): string {
  return `v1|${round}|${pending.join(",")}|${transcript}`;
}

export async function signTranscript(
  transcript: string,
  round: number,
  pending: readonly string[],
  env: Env = process.env,
): Promise<string | null> {
  const key = await hmacKey(env);
  if (!key) return null;
  return hex(
    await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload(transcript, round, pending))),
  );
}

/** Constant-time comparison of the expected and given signatures. */
export async function verifyTranscript(
  transcript: string,
  round: number,
  pending: readonly string[],
  signature: string,
  env: Env = process.env,
): Promise<boolean> {
  const expected = await signTranscript(transcript, round, pending, env);
  if (!expected || expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
