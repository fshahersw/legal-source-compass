/**
 * Shared helpers of the api-law full loads (wave 1025): type-stripping re-exec, polite JSON/text fetching with a request
 * ledger, gzip JSONL streams, file digests and the build manifest.
 *
 * Keys come only from the environment (DATA_GOV_API_KEY, loaded by the caller's shell from private/scratch/secrets.env)
 * and travel only in request headers; recorded URLs never carry a key. Nothing here prints a key.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BUILD = path.join(ROOT, "private/build/w1025_api-law");
export const ACQ = path.join(ROOT, "private/acq/w1025_api-law");
/** The repository's research User-Agent (scripts/enrichment/enforcement_actions/enf_common.py), owner contact. */
export const USER_AGENT = "LegalSourceAtlas/1.0 (legal-source-compass research; contact: notreelai@gmail.com)";

/** Re-run the calling script with TypeScript type stripping when Node does not strip types by default. */
export function ensureStripTypes(scriptUrl) {
  if (process.execArgv.includes("--experimental-strip-types") || process.features?.typescript) return;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(scriptUrl), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const KEY_PARAMS = /^(api[_-]?key|apikey|access_token|token|key)$/i;
export function recordableUrl(url) {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (KEY_PARAMS.test(k)) u.searchParams.delete(k);
  return u.href;
}

export function flag(args, name, fallback = undefined) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}

/**
 * A polite client: one request at a time per host with a minimum spacing, X-RateLimit-Remaining watched (below
 * `lowWater` the client waits `pauseMs` before the next request so a shared key is never run dry), Retry-After honoured on
 * 429/503, bounded retries with backoff, a request budget, and a ledger line per response.
 */
export function politeClient(opts) {
  const {
    minIntervalMs = 1000,
    lowWater = 100,
    pauseMs = 600_000,
    maxRequests = Infinity,
    headers = {},
    ledger = null,
    attempts = 6,
    timeoutMs = 90_000,
    log = (m) => console.error(m),
  } = opts;
  const lastAt = new Map();
  let used = 0;
  let remaining = null;
  async function spaced(host) {
    const prev = lastAt.get(host);
    if (prev !== undefined) {
      const wait = prev + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastAt.set(host, Date.now());
  }
  async function get(url, extraHeaders = {}) {
    const host = new URL(url).host;
    for (let attempt = 1; ; attempt++) {
      if (used >= maxRequests) throw new Error(`request budget of ${maxRequests} used up`);
      if (remaining !== null && remaining < lowWater) {
        log(`rate limit low (${remaining} left in the window); pausing ${Math.round(pauseMs / 1000)} s`);
        await sleep(pauseMs);
        remaining = null;
      }
      used++;
      await spaced(host);
      let res;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers, ...extraHeaders },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt >= attempts) throw new Error(`network error after ${attempt} attempts: ${error?.name ?? "error"}`);
        await sleep(3000 * 2 ** (attempt - 1));
        continue;
      }
      const rem = res.headers.get("x-ratelimit-remaining");
      if (rem !== null && /^\d+$/.test(rem)) remaining = Number(rem);
      if (res.status === 429 || res.status === 503) {
        const ra = res.headers.get("retry-after");
        const wait = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : 60_000 * attempt;
        await res.body?.cancel();
        if (attempt >= attempts) throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
        log(`HTTP ${res.status}; waiting ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < attempts) {
        await res.body?.cancel();
        await sleep(5000 * 2 ** (attempt - 1));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const record = {
        url: recordableUrl(url),
        status: res.status,
        bytes: buf.length,
        sha256: sha256(buf),
        retrieved_at: nowIso(),
      };
      if (ledger) fs.appendFileSync(ledger, JSON.stringify(record) + "\n");
      return { status: res.status, text: buf.toString("utf8"), buf, record, headers: res.headers };
    }
  }
  return {
    get,
    async getJson(url, extraHeaders) {
      const r = await get(url, extraHeaders);
      if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${r.record.url}`);
      return { body: JSON.parse(r.text), record: r.record };
    },
    get used() {
      return used;
    },
    get remaining() {
      return remaining;
    },
  };
}

/** Write rows as gzip JSONL (atomically: a .part file renamed when complete). Returns {path, rows, sha256, bytes}. */
export async function writeJsonlGz(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = file + ".part";
  const gz = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(part);
  const done = new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
    gz.on("error", reject);
  });
  gz.pipe(out);
  let n = 0;
  for (const row of rows) {
    if (!gz.write(JSON.stringify(row) + "\n")) await new Promise((r) => gz.once("drain", r));
    n++;
  }
  gz.end();
  await done;
  fs.renameSync(part, file);
  const buf = fs.readFileSync(file);
  return { path: path.relative(ROOT, file), rows: n, sha256: sha256(buf), bytes: buf.length };
}

/** Iterate the objects of a gzip JSONL (or plain JSONL) file. */
export async function* readJsonl(file) {
  const input = fs.createReadStream(file);
  const stream = file.endsWith(".gz") ? input.pipe(zlib.createGunzip()) : input;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

export function fileDigest(file) {
  const buf = fs.readFileSync(file);
  return { path: path.relative(ROOT, file), sha256: sha256(buf), bytes: buf.length };
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".part", JSON.stringify(value, null, 1) + "\n");
  fs.renameSync(file + ".part", file);
}

/** Read-only PostgREST GET with the admin credentials from the environment (never printed). */
export async function corpusGet(pathAndQuery, { range } = {}) {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_KEY;
  if (!url || !key) throw new Error("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (read-only use)");
  const headers = { apikey: key, Accept: "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  if (range) headers.Range = `${range[0]}-${range[1]}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url.replace(/\/$/, "") + "/rest/v1/" + pathAndQuery, {
      headers,
      signal: AbortSignal.timeout(180_000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(3000 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`corpus GET failed: HTTP ${res.status}`);
    return JSON.parse(text);
  }
}
