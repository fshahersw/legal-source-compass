/**
 * Legal atlas Federal Register refresh: acquire -> normalize -> stage -> dry-run packet.
 *
 *   node scripts/legal/refresh-federal-register.mjs --out DIR --from YYYY-MM-DD [--through YYYY-MM-DD] [--held held.json]
 *   node scripts/legal/refresh-federal-register.mjs --out DIR --live-held [--through YYYY-MM-DD]
 *
 * Source: the official Federal Register API (public domain, no key). Nothing is written to the
 * database here. The packet (OUT/staging/config.json + stage.sqlite) is uploaded afterwards with
 * the existing reviewed intake: upload-stage.mjs, then upload-edges.mjs with the run id it prints.
 *
 * --live-held reads, through corpus_legal_fr_window_v3 (read-only, service role from the
 * environment), the newest publication date already held and the publications held from that
 * day on; the window then starts on that day and held publications are not restaged.
 * The run fails when any staged row would be rejected, because rejected rows raise the nightly
 * invalid count above the reviewed baseline. --allow-rejected keeps them for review instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { acquireFederalRegister } from './acquire-federal-register.mjs';
import { prepareWindow } from './prepare-fr-staging.mjs';
import { stageFiles, writeReports } from './stage.ts';
import { isIsoDay } from '../../src/lib/legal/frRefresh.ts';

const today = () => new Date().toISOString().slice(0, 10);

/** Read-only facts about a staged window, for review before any upload. */
export function packetSummary(config) {
  const db = new DatabaseSync(config.database, { readOnly: true });
  try {
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const inputs = Object.fromEntries(all('select status,count(*) n from inputs group by status').map(r => [r.status, r.n]));
    const records = Object.fromEntries(all('select type,count(*) n from records group by type order by type').map(r => [r.type, r.n]));
    const frTypes = Object.fromEntries(all("select json_extract(payload,'$.attributes.fr_document_type') t,count(*) n from records where type='fr_document' group by t order by t").map(r => [r.t ?? 'none', r.n]));
    const edges = Object.fromEntries(all("select json_extract(payload,'$.type') t,count(*) n from edges group by t order by t").map(r => [r.t, r.n]));
    const rejected = all("select native_id,issues_json from inputs where status='rejected' order by native_id limit 200").map(r => ({ id: r.native_id, issues: JSON.parse(r.issues_json) }));
    const unlinked = all("select id,json_extract(payload,'$.attributes.unlinked_regulation_id_numbers') u from records where type='fr_document' and json_extract(payload,'$.attributes.unlinked_regulation_id_numbers') is not null order by id").map(r => ({ id: r.id, regulation_id_numbers: JSON.parse(r.u) }));
    const dates = all("select min(json_extract(payload,'$.date')) first,max(json_extract(payload,'$.date')) last from records where type in ('fr_document','source_doc')")[0];
    const through = config.window?.through ?? today();
    const openComments = all("select count(*) n from records where type='fr_document' and json_extract(payload,'$.attributes.native.comments_close_on')>=?", through)[0].n;
    const shapes = all("select count(*) n from records where type='fr_document' and json_type(payload,'$.attributes.native.comments_close_on') is null")[0].n;
    return {
      source: 'Office of the Federal Register API v1, https://www.federalregister.gov/developers/documentation/api/v1 (public domain)',
      window: config.window ?? null, inputs, records_by_type: records, fr_document_type: frTypes, edges_by_type: edges,
      published: { first: dates?.first ?? null, last: dates?.last ?? null },
      open_comment_periods_at_through: { count: openComments, basis: `native comments_close_on >= ${through}` },
      fr_documents_missing_comments_close_on_field: shapes,
      unlinked_regulation_id_numbers: unlinked, rejected, review_status: 'pending', written_to_database: false,
    };
  } finally { db.close(); }
}

async function liveHeld(from) {
  const { adminClient } = await import('./admin-client.mjs');
  const result = await adminClient(process.env.LEGAL_ATLAS_CREDENTIALS)('corpus_legal_fr_window_v3', { p_from: from ?? null });
  if (!result || (result.latest_published !== null && !isIsoDay(result.latest_published)) || !Array.isArray(result.held)) throw Error('Unexpected corpus_legal_fr_window_v3 response');
  return result;
}

export async function refresh({ out, from, through = today(), held = [], live = false, allowRejected = false, acquire = acquireFederalRegister, now = today() }) {
  if (!out) throw Error('--out is required');
  let window = { from, through, held };
  if (live) {
    const first = await liveHeld(from);
    if (!first.latest_published && !from) throw Error('No held Federal Register publication; pass --from');
    const start = from ?? first.latest_published;
    // Held publications from the first day of the window on, by exact publisher URL.
    const state = from && from !== first.latest_published ? await liveHeld(start) : first;
    window = { from: start, through, held: state.held };
  }
  if (!isIsoDay(window.from) || !isIsoDay(window.through) || window.from > window.through) throw Error('Use --from (or --live-held) and --through as ISO dates with from <= through');
  if (window.through > now) throw Error('The window cannot end after today (UTC)');
  const native = path.join(out, 'native'); const staging = path.join(out, 'staging');
  await acquire({ destination: native, from: window.from, through: window.through });
  const config = prepareWindow(native, staging, window);
  await stageFiles(config.files, config.support_files, config.database);
  writeReports(config.database, config.output, config.end_year);
  const summary = packetSummary(config);
  const run = { generated_at: new Date().toISOString(), config: path.join(staging, 'config.json'), ...summary,
    next_steps: [
      `node scripts/legal/upload-stage.mjs ${path.join(staging, 'config.json')}   # prints run_id; credentials from the environment or a credential file argument`,
      `node scripts/legal/upload-edges.mjs ${path.join(staging, 'config.json')} <run_id>`,
    ] };
  fs.writeFileSync(path.join(out, 'packet-summary.json'), JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ window: config.window, inputs: summary.inputs, records_by_type: summary.records_by_type, edges_by_type: summary.edges_by_type, rejected: summary.rejected.length, packet: path.join(out, 'packet-summary.json'), written_to_database: false }));
  if (summary.rejected.length && !allowRejected) throw Error(`${summary.rejected.length} staged rows would be rejected; review ${path.join(out, 'packet-summary.json')} (or pass --allow-rejected)`);
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const heldFile = flag('--held');
  const heldJson = heldFile ? JSON.parse(fs.readFileSync(heldFile, 'utf8')) : [];
  try {
    await refresh({ out: flag('--out'), from: flag('--from'), through: flag('--through') ?? today(), held: Array.isArray(heldJson) ? heldJson : heldJson.held ?? [],
      live: args.includes('--live-held'), allowRejected: args.includes('--allow-rejected') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
