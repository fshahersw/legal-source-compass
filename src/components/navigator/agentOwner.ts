/**
 * The browser's agent workspace key. With sign-in off, the agent's memory, folder and schedules belong to a random
 * 256-bit key kept in this browser; the server only ever stores its hash. Signed-in users own their workspace by
 * account instead, and the key is ignored for them.
 */
const KEY = "agent:owner:v1";
let memoryKey: string | null = null;

function randomKey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function agentOwnerKey(): string {
  if (memoryKey) return memoryKey;
  try {
    const got = localStorage.getItem(KEY);
    if (got && /^[a-f0-9]{64}$/.test(got)) return (memoryKey = got);
    const k = randomKey();
    localStorage.setItem(KEY, k);
    return (memoryKey = k);
  } catch {
    return (memoryKey = randomKey());
  }
}

export function agentHeaders(): Record<string, string> {
  return { "x-agent-owner": agentOwnerKey() };
}
