// Minimal service_role PostgREST helper for the mdl-members scripts (public schema only).
// Credentials are read from the private file and never printed.
import fs from 'node:fs';

const credentialsFile = process.env.CORPUS_PREVIEW_CREDENTIALS ?? 'C:/Users/firas/.codex/private/legal-source-compass.preview.json';
let cfg;
function load() {
  if (cfg) return cfg;
  // Environment variables win over the private credentials file (nothing is written to disk).
  const c = process.env.EXTERNAL_SUPABASE_URL && (process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY)
    ? { EXTERNAL_SUPABASE_URL: process.env.EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_KEY: process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY }
    : JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  if (c.EXTERNAL_SUPABASE_URL !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || typeof c.EXTERNAL_SUPABASE_KEY !== 'string') throw new Error('Wrong server credentials project');
  const token = c.EXTERNAL_SUPABASE_KEY;
  cfg = { url: c.EXTERNAL_SUPABASE_URL, headers: { apikey: token, 'Content-Type': 'application/json', ...(token.startsWith('sb_') ? {} : { Authorization: `Bearer ${token}` }) } };
  return cfg;
}
export async function rest(pathAndQuery, { method = 'GET', body, prefer, range } = {}) {
  const { url, headers } = load();
  const h = { ...headers };
  if (prefer) h.Prefer = prefer;
  if (range) h.Range = `${range[0]}-${range[1]}`;
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(`${url}/rest/v1/${pathAndQuery}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
    catch (e) { if (attempt >= 3) throw new Error('network failure'); await new Promise(res => setTimeout(res, 1500 * 2 ** attempt)); continue; }
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(res => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) { const e = new Error(`HTTP ${r.status} ${data?.code ?? ''} ${String(data?.message ?? '').slice(0, 200)}`); e.status = r.status; throw e; }
    return { data, headers: r.headers };
  }
}
export async function rpc(name, args) { return (await rest(`rpc/${name}`, { method: 'POST', body: args })).data; }
