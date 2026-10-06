/** Minimal server-role PostgREST client for the corpus (public schema only). Credentials come from the environment only. */
export function corpusClient(env = process.env) {
  const url = env.EXTERNAL_SUPABASE_URL;
  const key = env.EXTERNAL_SUPABASE_KEY ?? env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || typeof key !== 'string') throw new Error('External corpus server credentials are required in the environment');
  if (key.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
    if (claims.role !== 'service_role' || claims.ref !== 'xosqzzsnhxcyehcnirpa') throw new Error('Service role required');
  } else if (!key.startsWith('sb_secret_')) throw new Error('Service role required');
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }) };

  async function request(method, pathAndQuery, { body, prefer, base = '/rest/v1/', raw, extraHeaders } = {}) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await fetch(url + base + pathAndQuery, {
          method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}), ...extraHeaders },
          body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'error', signal: AbortSignal.timeout(120000),
        });
      } catch {
        if (attempt >= 3) throw new Error('Corpus connection failed after bounded retries; the step is resumable');
        await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await r.body?.cancel();
        await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
        continue;
      }
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!r.ok) {
        let code = 'unavailable';
        try { const e = JSON.parse(buffer.toString('utf8')); if (/^[A-Z0-9_]+$/.test(e.code ?? '')) code = e.code; } catch { /* body is not JSON */ }
        // Never include request bodies, headers or credentials in errors.
        const error = new Error(`Corpus request failed: HTTP ${r.status}, code ${code}`);
        error.status = r.status;
        throw error;
      }
      return { buffer, headers: r.headers };
    }
  }
  const json = ({ buffer }) => (buffer.length ? JSON.parse(buffer.toString('utf8')) : null);
  return {
    request,
    get: async (q, opts) => json(await request('GET', q, opts)),
    count: async (q) => {
      const { headers: h } = await request('GET', q + (q.includes('?') ? '&' : '?') + 'select=id&limit=1', { prefer: 'count=exact' });
      return Number(h.get('content-range').split('/')[1]);
    },
    rpc: async (name, args) => json(await request('POST', `rpc/${name}`, { body: args })),
  };
}
