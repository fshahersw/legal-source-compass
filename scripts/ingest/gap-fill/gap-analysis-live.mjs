// Exact, read-only gap counts over the live public read model (PostgREST, exact counts; no rows are modified).
// Credentials: EXTERNAL_SUPABASE_URL + EXTERNAL_SUPABASE_KEY (or EXTERNAL_SUPABASE_SERVICE_ROLE_KEY) from the environment only.
// "Gap" = JSON null, absent, empty string, or the literal display placeholder "Not recorded" at the stated path.
//   node scripts/ingest/gap-fill/gap-analysis-live.mjs [outFile]
import fs from 'node:fs/promises';

const URL_OK = 'https://xosqzzsnhxcyehcnirpa.supabase.co';
export const PLACEHOLDERS = ['Not recorded', 'not recorded'];

/** PostgREST `or` filter selecting blank values at a ->> path. */
export function blankFilter(path) {
  const parts = [`${path}.is.null`, `${path}.eq.`, ...PLACEHOLDERS.map(p => `${path}.eq.${p.replace(/ /g, '%20')}`)];
  return `or=(${parts.join(',')})`;
}

const cells = f => `item->cells->>${f}`;
const filt = f => `filters->>${f}`;

/** Field specs. `scope` narrows the denominator; `extra` narrows the numerator (a conditional gap). */
export const SPECS = [
  {entity: 'dockets (matter registry)', dataset: 'sw_matter_dockets_v1', fields: [
    {label: 'filing date', path: cells('filed')}, {label: 'termination date', path: cells('terminated')},
    {label: 'status (no_termination_date_recorded)', eq: [filt('status'), 'no_termination_date_recorded']},
    {label: 'caption', eq: [filt('has_caption'), 'false']}, {label: 'court', path: cells('court_id')}, {label: 'docket number', path: cells('docket_number')},
    {label: 'native case ids (none)', raw: 'filters->native_case_id=eq.%5B%5D'}]},
  {entity: 'dockets (CourtListener native)', dataset: 'cl_docket_metadata', fields: [
    {label: 'filing date', path: cells('date_filed')}, {label: 'termination date', path: cells('date_terminated')}, {label: 'docket number', path: cells('docket_number')},
    {label: 'court', path: cells('court_id')}, {label: 'FJC IDB association id', path: cells('idb_data_id')}, {label: 'last filing date', path: cells('date_last_filing')}]},
  {entity: 'docket entries (master dockets)', dataset: 'sw_docket_entries_v1', fields: [
    {label: 'filing date', path: cells('date_filed')}, {label: 'description', path: cells('description')}, {label: 'entry number', path: cells('entry_number')},
    {label: 'time filed', path: cells('time_filed')}, {label: 'no documents attached', raw: `${cells('documents')}=eq.0`},
    {label: 'description withheld (policy)', raw: `${cells('description_withheld')}=not.is.null`}]},
  {entity: 'documents (MDL docket documents)', dataset: 'mdl_docket_documents', fields: [
    {label: 'filing date', path: cells('entry_date_filed')}, {label: 'description', path: cells('description')}, {label: 'label (doc_type)', path: cells('doc_type')}]},
  {entity: 'parties (master dockets)', dataset: 'sw_matter_parties_v1', fields: [
    {label: 'party name', path: cells('party_name')}, {label: 'label (party_types)', path: cells('party_types')},
    {label: 'native party id', path: cells('native_party_id')}, {label: 'no counsel linked', raw: `${cells('counsel_count')}=eq.0`}, {label: 'name withheld', raw: `${cells('name_withheld')}=eq.true`}]},
  {entity: 'matters (JPML MDLs)', dataset: 'mdls', fields: [
    {label: 'status', path: 'item->>status'}, {label: 'CourtListener master docket id', path: 'item->>cl_docket_id'}, {label: 'date transferred', path: 'item->>date_transferred'},
    {label: 'master docket number', path: 'item->>master_docket'}, {label: 'transferee court (cl_court_id)', path: 'item->>cl_court_id'}, {label: 'judge unresolved', raw: 'item->>judge_resolved=eq.false'}]},
  {entity: 'matters (Seeger Weiss registry)', dataset: 'sw_matters_v1', fields: [
    {label: 'status', path: cells('status')}, {label: 'transferee court', path: cells('transferee_court')}, {label: 'judge as printed', path: cells('judge_as_printed')}]},
];

export class Live {
  constructor({url = process.env.EXTERNAL_SUPABASE_URL, key = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch} = {}) {
    if (url !== URL_OK || !key) throw new Error('Wrong or missing corpus credentials');
    this.url = url; this.headers = {apikey: key}; this.fetchImpl = fetchImpl;
  }
  async count(query) {
    for (let attempt = 0; ; attempt++) {
      const r = await this.fetchImpl(`${this.url}/rest/v1/corpus_records?select=id&${query}&limit=1`, {method: 'HEAD', headers: {...this.headers, Prefer: 'count=exact'}, signal: AbortSignal.timeout(120000)});
      if (r.ok || r.status === 206) { const m = (r.headers.get('content-range') ?? '').match(/\/(\d+)$/); if (!m) throw new Error('no count'); return Number(m[1]); }
      if (attempt >= 2 || r.status < 429) throw new Error(`HTTP ${r.status}`);
      await new Promise(res => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}

export async function measure(live, specs = SPECS) {
  const out = [];
  for (const s of specs) {
    const total = await live.count(`dataset=eq.${s.dataset}`);
    const fields = [];
    for (const f of s.fields) {
      const q = f.raw ?? (f.eq ? `${f.eq[0]}=eq.${f.eq[1]}` : blankFilter(f.path));
      try { const missing = await live.count(`dataset=eq.${s.dataset}&${q}`); fields.push({field: f.label, missing, of: total, pct: total ? Number((100 * missing / total).toFixed(2)) : null}); }
      catch (e) { fields.push({field: f.label, error: String(e.message), of: total}); }
    }
    out.push({entity: s.entity, dataset: s.dataset, rows: total, fields});
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = {basis: 'live PostgREST exact counts, public.corpus_records', measured_at: new Date().toISOString(), entities: await measure(new Live())};
  const text = JSON.stringify(result, null, 2);
  if (process.argv[2]) await fs.writeFile(process.argv[2], text);
  console.log(text);
}
