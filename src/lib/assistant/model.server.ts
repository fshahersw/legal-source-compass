/**
 * The assistant's model access, in one place: which key and model the server uses, and a single non-streaming call for
 * short generations (section summaries). The streaming agent loop reads the same configuration. Provider and model
 * names never reach the browser, and nothing here is imported by client code.
 */

type Env = Record<string, string | undefined>;

export type ModelConfig = { key: string; model: string; endpoint: string; version: string };

const DEFAULT_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** The configuration, or null when this server has no key (the caller says "not configured"). */
export function modelConfig(env: Env = process.env): ModelConfig | null {
  const key = env["ANTHROPIC_API_KEY"]?.trim();
  if (!key) return null;
  return {
    key,
    model: env["ASSISTANT_MODEL"]?.trim() || DEFAULT_MODEL,
    endpoint: ENDPOINT,
    version: API_VERSION,
  };
}

/** The model for short generations: ASSISTANT_SUMMARY_MODEL when set, otherwise the assistant's own. */
export function summaryModel(config: ModelConfig, env: Env = process.env): string {
  return env["ASSISTANT_SUMMARY_MODEL"]?.trim() || config.model;
}

/** Why a short generation failed, without the provider's words. */
export class ModelCallError extends Error {
  constructor(
    readonly kind: "timeout" | "busy" | "failed" | "empty" | "cancelled",
    readonly status = 0,
  ) {
    super(kind);
  }
}

const RETRY_STATUS = [429, 500, 502, 503, 529];

/**
 * One non-streaming completion: a system prompt, one user message, the text of the reply. Retries once on a transient
 * status, never past `timeoutMs` in total. Throws ModelCallError.
 */
export async function completeText(
  config: ModelConfig,
  request: {
    system: string;
    user: string;
    maxTokens: number;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
    model?: string | undefined;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort);
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.key,
          "anthropic-version": config.version,
        },
        body: JSON.stringify({
          model: request.model ?? config.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
        }),
      });
      if (response.ok || !RETRY_STATUS.includes(response.status)) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      throw new ModelCallError(status === 429 || status === 529 ? "busy" : "failed", status);
    }
    const body = (await response.json()) as { content?: { type?: string; text?: string }[] };
    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new ModelCallError("empty");
    return text;
  } catch (error) {
    if (error instanceof ModelCallError) throw error;
    if (timedOut) throw new ModelCallError("timeout");
    if (request.signal?.aborted) throw new ModelCallError("cancelled");
    throw new ModelCallError("failed");
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}
