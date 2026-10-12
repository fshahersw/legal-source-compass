const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

async function discardBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // An errored stream can reject cancellation too. Preserve the original result/error.
  }
}

async function retry(
  call,
  { attempts = 5, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  consume,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await call();
      if (!TRANSIENT.has(response.status) || attempt === attempts - 1)
        return await consume(response);
    } catch (error) {
      await discardBody(response);
      if (attempt === attempts - 1) throw error;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    await discardBody(response);
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error("INVALID_RETRY_ATTEMPTS");
}

/** Only for idempotent, content-addressed storage requests; always verify uploaded bytes. */
export async function requestWithRetry(call, options = {}) {
  return retry(call, options, (response) => response);
}

/** A successful download includes its entire body. Incomplete bodies retry from byte zero. */
export async function readBytesWithRetry(call, options = {}) {
  return retry(call, options, async (response) => {
    if (!response.ok) {
      await discardBody(response);
      return { response, bytes: null };
    }
    return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
  });
}
