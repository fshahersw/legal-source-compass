// Ingests docket entries of dockets that CourtListener blocks at the source (MDL 2738 and others) from the routes that remain, into the private registry
// as `external-entry` entities (source_system sw-matter-registry, contract sw-matter-registry/1 v1.3):
//   govinfo        GovInfo USCOURTS package MODS (the court's published opinions/orders; the granule subtitle is the docket text)
//   official-court the court's own MDL page ("Orders" list: date, description, PDF link)
//   docketbird     DocketBird docket-sheet parts transcribed from the connector (db-results/<mdl>-sheet-*-part*.json); signed PDF links are never stored
// Nothing is inferred: entry numbers appear only when the source prints them (DocketBird document ids end in the entry number).
//
// node --use-system-ca scripts/ingest/members-ingest-external.mjs --mdl=2738 --run=<registry run uuid> [--dry-run=true]
import fs from 'node:fs';
import path from 'node:path';
import { rpc } from './members-pgrest.mjs';
import { registryRow, sha256 } from './members-registry-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdl = Number(args.mdl);
const run = args.run;
const dry = args['dry-run'] === 'true';
if (!mdl || !/^[0-9a-f-]{36}$/.test(run ?? '')) throw new Error('--mdl and --run are required');
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const CFG = {
  2738: { docket_key: 'njd:3:2016-md-02738', docketbird_case_id: 'njd-3:2016-md-02738', official_case_id: '3:16-md-02738', govinfo_package: 'USCOURTS-njd-3_16-md-02738',
    govinfo_granules: 'official-pages/govinfo-2738-granules.json', govinfo_mods_label: 'govinfo-mods-njd-3_16-md-02738',
    official_pages: [{ label: 'njd-talc-upcoming', kind: 'orders_list' }, { label: 'njd-talc-main', kind: 'minutes' }], host: 'https://www.njd.uscourts.gov' },
}[mdl];
if (!CFG) throw new Error(`no external sources configured for MDL ${mdl}`);
const matterId = `mdl:${mdl}`;
const index = new Map(fs.readFileSync(path.join(work, 'official-pages', 'fetch-index.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.label, r]));
const rows = []; const rels = []; const coverage = { govinfo: 0, 'official-court': 0, docketbird: 0 };
const add = (nativeId, data, prov) => { const r = registryRow('external-entry', nativeId, data, prov); rows.push(r); rels.push({ from_type: 'external-entry', from_id: nativeId, field: 'docket', to_type: 'docket', to_id: CFG.docket_key, evidence_sha256: r.provenance.record_sha256 }); return r; };
const noUser = u => (u ? String(u).replace(/([?&])user_id=[0-9]+(&|$)/, (m, p, tail) => (tail ? p : '')).replace(/[?&]$/, '') : u); // the connector adds the account's user_id to canonical links; it is dropped
const clean = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const isoDate = s => { // M/D/YY, MM/DD/YY, M-D-YYYY
  const m = String(s).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? (Number(m[3]) < 70 ? 2000 + Number(m[3]) : 1900 + Number(m[3])) : Number(m[3]);
  return `${y}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
};

// ----- GovInfo -----
{
  const g = JSON.parse(fs.readFileSync(path.join(work, CFG.govinfo_granules), 'utf8'));
  const mods = index.get(CFG.govinfo_mods_label);
  for (const x of g.granules) {
    const part = x.part_number;
    const pkgId = `${CFG.govinfo_package}-${part}`;
    add(`govinfo:${pkgId}`, {
      matter: matterId, docket_key: CFG.docket_key, provider: 'govinfo', provider_native_id: pkgId, entry_number: null, date_filed: x.date_issued || null, title: x.subtitle || null,
      url: `https://www.govinfo.gov/app/details/${CFG.govinfo_package}/${pkgId}`, pdf_url: x.pdf_url, pdf_free: true,
      source: { kind: 'govinfo_mods_granule', package: CFG.govinfo_package, mods_url: mods?.url ?? null, mods_sha256: g.sha256, retrieved_at: mods?.retrieved_at ?? null },
    }, { sourceUrl: mods?.url ?? `https://www.govinfo.gov/app/details/${CFG.govinfo_package}`, retrievedAt: mods?.retrieved_at ?? new Date().toISOString(), sourceSha256: g.sha256 });
    coverage.govinfo++;
  }
}

// ----- official court page -----
for (const pg of CFG.official_pages) {
  const rec = index.get(pg.label);
  if (!rec) continue;
  const html = fs.readFileSync(rec.file, 'utf8');
  if (pg.kind === 'orders_list') {
    for (const m of html.matchAll(/<p><a href="(\/sites\/[^"]+\.pdf)"[^>]*>([^<]*)<\/a><\/p>\s*<p>Date:\s*([^<]*)<\/p>\s*<p>Description:\s*([\s\S]*?)<\/p>/g)) {
      const url = CFG.host + m[1];
      add(`official-court:${url}`, {
        matter: matterId, docket_key: CFG.docket_key, provider: 'official-court', provider_native_id: url, entry_number: null, date_filed: isoDate(clean(m[3])), date_as_printed: clean(m[3]), title: clean(m[4]) || clean(m[2]),
        url: rec.final_url, pdf_url: url, pdf_free: true, link_label: clean(m[2]),
        source: { kind: 'court_mdl_page_orders_list', page_url: rec.final_url, page_sha256: rec.sha256, retrieved_at: rec.retrieved_at },
      }, { sourceUrl: rec.final_url, retrievedAt: rec.retrieved_at, sourceSha256: rec.sha256 });
      coverage['official-court']++;
    }
  } else if (pg.kind === 'minutes') {
    for (const m of html.matchAll(/<a href="(\/sites\/[^"]*Minutes[^"]*\.pdf)"[^>]*>([^<]*)<\/a>/gi)) {
      const url = CFG.host + m[1];
      const label = clean(m[2]);
      add(`official-court:${url}`, {
        matter: matterId, docket_key: CFG.docket_key, provider: 'official-court', provider_native_id: url, entry_number: null, date_filed: isoDate((label.match(/(\d{1,2}-\d{1,2}-\d{4})/) ?? [])[1] ?? ''), date_as_printed: (label.match(/(\d{1,2}-\d{1,2}-\d{4})/) ?? [])[1] ?? null, title: label,
        url: rec.final_url, pdf_url: url, pdf_free: true, link_label: label,
        source: { kind: 'court_mdl_page_link', page_url: rec.final_url, page_sha256: rec.sha256, retrieved_at: rec.retrieved_at },
      }, { sourceUrl: rec.final_url, retrievedAt: rec.retrieved_at, sourceSha256: rec.sha256 });
      coverage['official-court']++;
    }
  }
}

// ----- DocketBird sheet parts (transcribed connector output) -----
{
  const dir = path.join(work, 'db-results');
  const sheets = new Map(); // sort -> {summary, entries}
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = f.match(new RegExp(`^${mdl}-sheet-(chronological|recent)-part(\\d+)\\.json$`));
    if (!m) continue;
    const s = sheets.get(m[1]) ?? { entries: [], summary: null };
    s.entries.push(...(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries ?? []));
    sheets.set(m[1], s);
  }
  for (const [sort, s] of sheets) {
    const sumFile = path.join(dir, `${mdl}-sheet-${sort}-summary.json`);
    s.summary = fs.existsSync(sumFile) ? JSON.parse(fs.readFileSync(sumFile, 'utf8')) : null;
    if (!s.summary || s.summary.status === 'error' || s.summary.status === 'failed' || s.summary.entries_written !== s.entries.length) { console.log(JSON.stringify({ skipped: `docketbird ${sort}`, reason: 'no valid summary or count mismatch' })); continue; }
    for (const e of s.entries) {
      const m = String(e.document_id).match(/-(\d{5})(?:-(\d{3}))?$/);
      add(`docketbird:${e.document_id}`, {
        matter: matterId, docket_key: CFG.docket_key, provider: 'docketbird', provider_native_id: e.document_id, entry_number: m ? Number(m[1]) : null, attachment_number: m?.[2] ? Number(m[2]) : null,
        date_filed: e.date_filed ?? null, title: e.title ?? null, url: noUser(e.canonical_url) ?? noUser(s.summary.docket_sheet_url) ?? null, pdf_url: null, pdf_free: false, downloadable_at_provider: e.downloadable === true,
        source: { kind: 'docketbird_get_docket_sheet', sort, case_id: CFG.docketbird_case_id, retrieved_at: s.summary.retrieved_at_utc, channel: 'DocketBird MCP connector; transcribed; signed PDF links not stored' },
      }, { sourceUrl: noUser(e.canonical_url) ?? noUser(s.summary.docket_sheet_url) ?? `https://www.docketbird.com/cases?case_id=${CFG.docketbird_case_id}`, retrievedAt: s.summary.retrieved_at_utc });
      coverage.docketbird++;
    }
  }
}

console.log(JSON.stringify({ event: 'built', mdl, rows: rows.length, coverage, dry }));
if (!dry && rows.length) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await rpc('corpus_registry_intake_v1', { p_run: run, p_mode: 'sw-registry', p_rows: rows.slice(i, i + 500) });
    console.log(JSON.stringify({ posted: Math.min(rows.length, i + 500), new_versions: res.new_versions, entities_written: res.entities_written }));
  }
  for (let i = 0; i < rels.length; i += 2000) await rpc('corpus_registry_relationships_v1', { p_run: run, p_rows: rels.slice(i, i + 2000) });
  fs.writeFileSync(path.join(work, 'registry-staging', `external-coverage-${mdl}.json`), JSON.stringify({ mdl, at: new Date().toISOString(), coverage }, null, 1));
}
