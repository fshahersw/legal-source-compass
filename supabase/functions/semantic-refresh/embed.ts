/**
 * Embedding requests for the scheduled semantic refresh, configured exactly as scripts/semantic/embed.py + voyage.py built
 * the index: the same model, 1,024 dimensions, input type "document", base64 float32 responses, each value rounded to
 * float16 (round half to even, as numpy's astype(float16)) and written as load.py's vector_text does (format(x, ".5g")),
 * so pgvector stores exactly the halfvec the batch build stored.
 *
 * The key comes from the function's own secrets (VOYAGE_API_KEY), travels only in the Authorization header, and never
 * appears in a result, an error or a log line. The model is named only here (server code); run ledgers, notes and
 * published data carry the opaque index label instead.
 */

/** The model the index was built with (scripts/semantic/voyage.py MODEL). Server code only. */
export const EMBEDDING_MODEL = "voyage-law-2";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_INPUT_TYPE = "document";
export const EMBEDDING_URL = "https://api.voyageai.com/v1/embeddings";
/** Opaque label of the embedding configuration (semantic.corpora.index_version); the only name published data uses. */
export const INDEX_VERSION = "si-1";
const USER_AGENT = "LegalSourceAtlas/1.0 (scheduled semantic index refresh)";
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

// ------------------------------------------------------------------------------------------------- float16 and text
/** The float16 value nearest to a float32 value (ties to even; |x| >= 65520 overflows to infinity), as numpy rounds. */
export function toHalf(v: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const a = Math.abs(v);
  if (a >= 65520) return v > 0 ? Infinity : -Infinity;
  let exp = Math.floor(Math.log2(a));
  if (2 ** exp > a) exp -= 1;
  else if (2 ** (exp + 1) <= a) exp += 1;
  const quantumExp = Math.max(exp, -14) - 10;
  const q = a / 2 ** quantumExp; // exact: a has at most 24 significant bits
  let r = Math.floor(q);
  const frac = q - r;
  if (frac > 0.5 || (frac === 0.5 && r % 2 === 1)) r += 1;
  const out = r * 2 ** quantumExp;
  return v < 0 ? -out : out;
}

/** Python format(x, ".5g") of a float16 value (exact decimal expansion, round half to even, Python's 'g' rules). */
export function formatG5(h: number): string {
  if (h === 0) return Object.is(h, -0) ? "-0" : "0";
  if (Number.isNaN(h)) return "nan";
  if (!Number.isFinite(h)) return h > 0 ? "inf" : "-inf";
  const neg = h < 0;
  const a = Math.abs(h);
  let s = 0;
  while (!Number.isInteger(a * 2 ** s)) s += 1; // a float16 value needs at most 24 binary places
  const scaled = BigInt(a * 2 ** s) * 5n ** BigInt(s); // a = scaled / 10^s
  const digits = scaled.toString();
  let e10 = digits.length - s - 1;
  let n = BigInt(digits.slice(0, 5).padEnd(5, "0"));
  const rest = digits.slice(5);
  if (rest.length) {
    const first = rest.charCodeAt(0) - 48;
    const tail = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && (tail || n % 2n === 1n))) n += 1n;
  }
  if (n === 100000n) {
    n = 10000n;
    e10 += 1;
  }
  const d = n.toString();
  let body: string;
  if (e10 >= -4 && e10 < 5) {
    const point = e10 + 1;
    if (point <= 0) body = `0.${"0".repeat(-point)}${d}`;
    else if (point >= 5) body = d;
    else body = `${d.slice(0, point)}.${d.slice(point)}`;
    if (body.includes(".")) body = body.replace(/0+$/, "").replace(/\.$/, "");
  } else {
    const m = `${d[0]}.${d.slice(1)}`.replace(/0+$/, "").replace(/\.$/, "");
    body = `${m}e${e10 < 0 ? "-" : "+"}${String(Math.abs(e10)).padStart(2, "0")}`;
  }
  return (neg ? "-" : "") + body;
}

/** pgvector text of one float32 embedding, rounded to float16 exactly as the batch build stored it. */
export function halfvecLiteral(values: ArrayLike<number>): string {
  if (values.length !== EMBEDDING_DIMENSIONS) throw new Error("wrong embedding length");
  const out: string[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) throw new Error("embedding has a non-finite value");
    const h = toHalf(v);
    if (!Number.isFinite(h)) throw new Error("embedding value outside the float16 range");
    out[i] = formatG5(h);
  }
  return `[${out.join(",")}]`;
}

/** Little-endian float32 values of a base64 string. */
export function decodeFloat32Base64(b64: string): Float32Array {
  const bin = atob(b64);
  if (bin.length % 4) throw new Error("embedding bytes are not float32");
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

// ------------------------------------------------------------------------------------------------------------ client
export type EmbedBatch = { vectors: string[]; tokens: number };
export type Embedder = { embed(texts: string[]): Promise<EmbedBatch> };

export class EmbeddingError extends Error {
  readonly status: number;
  /** "no": the service answered with an error (nothing billed); "unknown": no answer, the request may have been billed. */
  readonly billed: "no" | "unknown";
  constructor(message: string, status: number, billed: "no" | "unknown") {
    super(message);
    this.name = "EmbeddingError";
    this.status = status;
    this.billed = billed;
  }
}

export type ClientOptions = {
  key: string;
  fetch?: typeof fetch;
  url?: string;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  maxRetryWaitMs?: number;
};

export function embeddingClient(opts: ClientOptions): Embedder {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = opts.maxAttempts ?? 3;
  const timeout = opts.timeoutMs ?? 60_000;
  const maxWait = opts.maxRetryWaitMs ?? 20_000;
  const scrub = (t: string) => (opts.key ? t.split(opts.key).join("<key>") : t);

  return {
    async embed(texts: string[]): Promise<EmbedBatch> {
      if (!texts.length || texts.length > 128 || texts.some((t) => !t.trim()))
        throw new EmbeddingError("a request needs 1 to 128 non-empty texts", 0, "no");
      const body = JSON.stringify({
        input: texts,
        model: EMBEDDING_MODEL,
        input_type: EMBEDDING_INPUT_TYPE,
        encoding_format: "base64",
      });
      let delay = 1500;
      let last = "no attempt";
      let lastStatus = 0;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let res: Response;
        try {
          res = await doFetch(opts.url ?? EMBEDDING_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${opts.key}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": USER_AGENT,
            },
            body,
            signal: AbortSignal.timeout(timeout),
          });
        } catch (error) {
          last = `network error (${error instanceof Error ? error.name : "error"})`;
          lastStatus = 0;
          if (attempt < attempts) {
            await sleep(delay);
            delay *= 2;
            continue;
          }
          throw new EmbeddingError(`embedding request failed: ${last}`, 0, "unknown");
        }
        if (res.status === 200) {
          const raw = await res.text();
          return parseResponse(raw, texts.length);
        }
        const text = scrub((await res.text()).slice(0, 200));
        last = `HTTP ${res.status}: ${text}`;
        lastStatus = res.status;
        if (!RETRY_STATUS.has(res.status) || attempt === attempts)
          throw new EmbeddingError(`embedding request failed (${last})`, res.status, "no");
        const ra = res.headers.get("retry-after");
        let wait = delay;
        if (ra && /^\d+(\.\d+)?$/.test(ra.trim())) wait = Math.max(wait, Number(ra.trim()) * 1000);
        if (wait > maxWait)
          throw new EmbeddingError(`embedding service asked to wait ${Math.round(wait / 1000)} s`, res.status, "no");
        await sleep(wait);
        delay *= 2;
      }
      throw new EmbeddingError(`embedding request failed (${last})`, lastStatus, "no");
    },
  };
}

function parseResponse(raw: string, n: number): EmbedBatch {
  try {
    const data = JSON.parse(raw) as {
      data?: { index?: number; embedding?: unknown }[];
      usage?: { total_tokens?: unknown };
    };
    const rows = [...(data.data ?? [])].sort((a, b) => Number(a.index) - Number(b.index));
    const tokens = Number(data.usage?.total_tokens);
    if (rows.length !== n || !Number.isInteger(tokens) || tokens < 0) throw new Error("shape");
    const vectors = rows.map((r) => {
      const e = r.embedding;
      const values =
        typeof e === "string"
          ? decodeFloat32Base64(e)
          : Array.isArray(e)
            ? Float32Array.from(e as number[])
            : null;
      if (!values) throw new Error("embedding");
      return halfvecLiteral(values);
    });
    return { vectors, tokens };
  } catch {
    throw new EmbeddingError("malformed embedding response", 200, "unknown");
  }
}
