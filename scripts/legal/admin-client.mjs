import fs from 'node:fs';
export function adminClient(credentialFile) {
  const c = credentialFile ? JSON.parse(fs.readFileSync(credentialFile, 'utf8')) : process.env;
  const url = c.EXTERNAL_SUPABASE_URL; const key = c.EXTERNAL_SUPABASE_KEY;
  if (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || typeof key !== 'string') throw Error('External corpus server credentials are required');
  if (key.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
    if (claims.role !== 'service_role' || claims.ref !== 'xosqzzsnhxcyehcnirpa') throw Error('External corpus service role is required');
  } else if (!key.startsWith('sb_secret_')) throw Error('External corpus service role is required');
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {}) };
  return async (name, body) => {
    if (!['corpus_legal_stage_v3', 'corpus_legal_edges_v3', 'corpus_legal_register_archive_v3', 'corpus_legal_register_mdl_v3', 'corpus_legal_mdl_v3', 'corpus_legal_deploy_check_v3', 'corpus_legal_quality_v3'].includes(name)) throw Error('Unknown legal corpus operation');
    let r;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60000) });
        if (r.status !== 429 && r.status < 500) break;
        if (attempt === 5) break;
        const rawRetry = r.headers.get('retry-after');
        const retry = /^\d+(?:\.\d+)?$/.test(rawRetry ?? '') ? Number(rawRetry) * 1000 : Date.parse(rawRetry ?? '') - Date.now();
        await r.body?.cancel();
        // Never retry before a publisher's Retry-After time. The calling shell
        // yields while this background process waits, so the UI remains usable.
        let remaining = Math.max(1000 * 2 ** attempt, Number.isFinite(retry) ? retry : 0);
        while (remaining > 0) { const wait = Math.min(remaining, 30000); await new Promise(resolve => setTimeout(resolve, wait)); remaining -= wait; }
      } catch {
        if (attempt === 5) throw Error('Legal corpus connection failed after bounded retries; replay the same resumable upload');
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
    if (!r) throw Error('Legal corpus response unavailable');
    // Never include headers, credentials, source text, or request bodies in errors.
    if (!r.ok) {
      const error = await r.json().catch(() => ({}));
      throw Error(`Legal corpus RPC failed: HTTP ${r.status}, code ${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'unavailable'}`);
    }
    return r.json();
  };
}
