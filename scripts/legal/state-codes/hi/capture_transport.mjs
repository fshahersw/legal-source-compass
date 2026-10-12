/** Bounded request scheduling and transient retry policy; no filesystem access. */
export function parseCaptureArgs(args) {
  let output = 'private/hawaii-capture', sections = false, rateMs = 250, positional = false, rateSeen = false;
  for (const arg of args) {
    if (arg === '--sections' && !sections) sections = true;
    else if (/^--rate-ms=\d+$/.test(arg) && !rateSeen) {
      rateMs = Number(arg.slice(10)); rateSeen = true;
      if (!Number.isSafeInteger(rateMs) || rateMs < 125 || rateMs > 60000) throw Error('Rate must be 125–60000 ms; at most 8 requests/second');
    } else if (!arg.startsWith('--') && !positional) { output = arg; positional = true; }
    else throw Error('Unknown, duplicate, or malformed capture argument: ' + arg);
  }
  return { output, sections, rateMs };
}

export function retryAfterMs(value, now = Date.now()) {
  if (value == null) return 0;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function createRequestGate({ rateMs, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let next = 0, cooldown = 0, stopped = false;
  return {
    async take() {
      while (true) {
        if (stopped) throw Object.assign(Error('Publisher acquisition is paused'), { stopAcquisition: true });
        const slot = Math.max(now(), next, cooldown); next = slot + rateMs;
        await sleep(Math.max(0, slot - now()));
        if (stopped) throw Object.assign(Error('Publisher acquisition is paused'), { stopAcquisition: true });
        if (now() >= cooldown) return;
      }
    },
    defer(ms) { cooldown = Math.max(cooldown, now() + ms); },
    stop() { stopped = true; },
  };
}

export function transientTransport(error) {
  const code = error?.cause?.code ?? error?.code ?? '';
  if (/CERT|TLS|SSL|REDIRECT/.test(code)) return false;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)
    || error?.name === 'TimeoutError'
    || (!code && error?.name === 'TypeError' && /fetch failed|network/i.test(error.message));
}

export async function fetchWithRetries(url, { gate, fetcher = fetch, consume, now = Date.now, attempts = 4 }) {
  const pause = message => { gate.stop(); return Object.assign(Error(message), { stopAcquisition: true }); };
  for (let attempt = 0; attempt < attempts; attempt++) {
    await gate.take();
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { 'User-Agent': 'LegalSourceAtlas-SourceCapture/1.0', Accept: 'text/html' } });
      if (response.status === 429 || response.status >= 500) {
        const wait = Math.max(2000 * 2 ** attempt, retryAfterMs(response.headers.get('retry-after'), now()));
        await response.body?.cancel();
        if (wait > 60000) throw pause(`Publisher Retry-After requires ${wait} ms; automatic acquisition paused: ${url}`);
        if (attempt + 1 === attempts) throw pause(`Publisher HTTP ${response.status} retry limit; acquisition paused: ${url}`);
        gate.defer(wait); continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel(); throw pause(`Publisher access response HTTP ${response.status}; acquisition paused: ${url}`);
      }
      if (response.status !== 200) { await response.body?.cancel(); throw Error(`HTTP ${response.status}: ${url}`); }
      const value = await consume(response);
      return { response, value, attempts: attempt + 1 };
    } catch (error) {
      if (error.stopAcquisition) throw error;
      if (!transientTransport(error)) {
        if (error?.code || error?.cause) throw pause(`Non-retryable source transport error; acquisition paused: ${url}`);
        throw error;
      }
      if (attempt + 1 === attempts) throw pause(`Transient transport retry limit; acquisition paused: ${url}`);
      gate.defer(2000 * 2 ** attempt);
    }
  }
  throw pause('Publisher retry limit');
}
