import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_SPACING_MS = 1_000;
const USER_AGENT = "Legal-Source-Atlas/1.0 (public North Carolina statute source verification)";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function resolveOutput(base, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error(`Capture output must be a relative path: ${relativePath}`);
  }
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativePath);
  const relative = path.relative(resolvedBase, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Capture output escapes its base directory: ${relativePath}`);
  }
  return resolved;
}

async function inspectExistingPair(source, rawPath, receiptPath) {
  const [rawExists, receiptExists] = await Promise.all([
    fs.stat(rawPath).then(
      () => true,
      (error) => (error.code === "ENOENT" ? false : Promise.reject(error)),
    ),
    fs.stat(receiptPath).then(
      () => true,
      (error) => (error.code === "ENOENT" ? false : Promise.reject(error)),
    ),
  ]);
  if (!rawExists && !receiptExists) return { state: "new" };
  if (!rawExists || !receiptExists) {
    throw new Error(`${source.id}: partial existing capture output; refusing network request.`);
  }

  let receipt;
  let bytes;
  try {
    [receipt, bytes] = await Promise.all([
      fs.readFile(receiptPath, "utf8").then(JSON.parse),
      fs.readFile(rawPath),
    ]);
  } catch (cause) {
    throw new Error(
      `${source.id}: existing capture pair cannot be read; refusing network request. ${cause.message}`,
    );
  }

  const bodyHash = sha256(bytes);
  const validPair =
    receipt.schemaVersion === "nc-section-identity-source-capture/1" &&
    receipt.id === source.id &&
    receipt.requestedUrl === source.url &&
    receipt.requestMethod === "GET" &&
    receipt.rawPath === source.rawPath &&
    Number.isInteger(receipt.httpStatus) &&
    receipt.httpStatus === 200 &&
    receipt.outcome === "captured" &&
    receipt.bytes === bytes.length &&
    receipt.sha256 === bodyHash;

  if (!validPair) {
    throw new Error(
      `${source.id}: existing capture pair conflicts with requested URL or verified body metadata; refusing network request.`,
    );
  }
  return { state: "cached", bytes: bytes.length, sha256: bodyHash };
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body.cancel("Capture size exceeded configured limit").catch(() => {});
    throw new Error(
      `Response declared ${declaredLength} bytes, above the ${maxBytes} byte capture limit`,
    );
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel("Capture size exceeded configured limit").catch(() => {});
        throw new Error(`Response exceeded ${maxBytes} byte capture limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function responseFields(response) {
  return {
    finalUrl: response?.url || null,
    httpStatus: response?.status ?? null,
    contentType: response?.headers?.get("content-type") ?? null,
    contentLengthHeader: response?.headers?.get("content-length") ?? null,
  };
}

function makeReceipt({ source, startedAt, completedAt, response, bytes, outcome, rawPath, error }) {
  const receipt = {
    schemaVersion: "nc-section-identity-source-capture/1",
    id: source.id,
    requestedUrl: source.url,
    ...responseFields(response),
    requestMethod: "GET",
    retrievedAt: startedAt,
    completedAt,
    bytes: bytes?.length ?? 0,
    sha256: bytes ? sha256(bytes) : null,
    outcome,
    rawPath,
  };
  if (source.includeErrorField || error) receipt.error = error ?? null;
  return receipt;
}

async function writeFailureReceipt(receiptPath, receipt) {
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}

/**
 * Capture an ordered list of public NC statute source URLs.
 * Existing outputs are all validated before the first request, so a conflict
 * late in a list cannot follow earlier network activity.
 */
export async function captureSources({
  base,
  sources,
  fetchImpl = globalThis.fetch,
  sleepImpl = delay,
  now = () => new Date(),
  monotonicNow = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spacingMs = DEFAULT_SPACING_MS,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (!Array.isArray(sources) || sources.length === 0)
    throw new Error("At least one capture source is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  const seenIds = new Set();
  const seenPaths = new Set();
  const prepared = [];
  for (const source of sources) {
    if (!source || typeof source.id !== "string" || !source.id || typeof source.url !== "string") {
      throw new Error("Each capture source requires a non-empty id and URL.");
    }
    const parsedUrl = new URL(source.url);
    if (parsedUrl.protocol !== "https:")
      throw new Error(`${source.id}: only HTTPS source URLs are accepted.`);
    if (seenIds.has(source.id)) throw new Error(`Duplicate capture id: ${source.id}`);
    seenIds.add(source.id);

    const rawPath = resolveOutput(base, source.rawPath);
    const receiptPath = resolveOutput(base, source.receiptPath);
    for (const outputPath of [rawPath, receiptPath]) {
      if (seenPaths.has(outputPath))
        throw new Error(`Duplicate capture output path: ${outputPath}`);
      seenPaths.add(outputPath);
    }
    prepared.push({
      ...source,
      rawPath: source.rawPath,
      absoluteRawPath: rawPath,
      absoluteReceiptPath: receiptPath,
      maxBytes: source.maxBytes ?? maxBytes,
    });
  }

  await fs.mkdir(path.resolve(base), { recursive: true });
  await Promise.all(
    prepared.flatMap((source) => [
      fs.mkdir(path.dirname(source.absoluteRawPath), { recursive: true }),
      fs.mkdir(path.dirname(source.absoluteReceiptPath), { recursive: true }),
    ]),
  );

  // Complete preflight over every output before any request can be made.
  for (const source of prepared) {
    source.existing = await inspectExistingPair(
      source,
      source.absoluteRawPath,
      source.absoluteReceiptPath,
    );
  }

  const results = [];
  let lastRequestStarted = null;
  for (const source of prepared) {
    if (source.existing.state === "cached") {
      results.push({
        id: source.id,
        outcome: "verified_existing_capture",
        bytes: source.existing.bytes,
        sha256: source.existing.sha256,
      });
      continue;
    }

    if (lastRequestStarted !== null) {
      const waitMs = Math.max(0, spacingMs - (monotonicNow() - lastRequestStarted));
      if (waitMs) await sleepImpl(waitMs);
    }
    const startedAt = now().toISOString();
    lastRequestStarted = monotonicNow();

    let response;
    let bytes;
    let failure;
    try {
      response = await fetchImpl(source.url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      bytes = await readBoundedBody(response, source.maxBytes);
    } catch (cause) {
      failure = String(cause?.message || cause);
    }

    if (failure) {
      const receipt = makeReceipt({
        source,
        startedAt,
        completedAt: now().toISOString(),
        response,
        bytes: null,
        outcome: "transport_or_size_failure",
        rawPath: null,
        error: failure,
      });
      await writeFailureReceipt(source.absoluteReceiptPath, receipt);
      throw new Error(
        `${source.id} did not complete successfully; failure receipt preserved. ${failure}`,
      );
    }

    const successful = response.status === 200;
    const receipt = makeReceipt({
      source,
      startedAt,
      completedAt: now().toISOString(),
      response,
      bytes,
      outcome: successful ? "captured" : "http_error_body_preserved",
      rawPath: source.rawPath,
    });

    // Preserve complete non-200 bodies, including unsolicited partial responses.
    await fs.writeFile(source.absoluteRawPath, bytes, { flag: "wx" });
    await fs.writeFile(source.absoluteReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    results.push({
      id: source.id,
      outcome: receipt.outcome,
      httpStatus: response.status,
      bytes: bytes.length,
      sha256: receipt.sha256,
      rawPath: source.rawPath,
    });
    if (!successful)
      throw new Error(
        `${source.id} returned HTTP ${response.status}; failure body and receipt preserved.`,
      );
  }
  return results;
}
