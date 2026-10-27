/**
 * Legal atlas Federal Register refresh: acquire -> normalize -> stage -> dry-run packet.
 *
 *   node scripts/legal/refresh-federal-register.mjs --out DIR --from YYYY-MM-DD [--through YYYY-MM-DD] [--held held.json]
 *   node scripts/legal/refresh-federal-register.mjs --out DIR --live-held [--through YYYY-MM-DD]
 *   ... [--native ACQUIRED_DIR]   reuse an earlier acquisition of the same window (no network)
 *
 * --out must be a new directory for every run, e.g. private/acq/<key>/fr-refresh-YYYY-MM-DD:
 * a staged packet is immutable, and an older acquisition holds periods outside a later window.
 * The run refuses an --out that already holds a packet. Rerunning the same command after an
 * interrupted acquisition (no packet yet) resumes it.
 *
 * Source: the official Federal Register API (public domain, no key). Nothing is written to the
 * database here. The packet (OUT/staging/config.json + stage.sqlite) is uploaded afterwards with
 * the existing reviewed intake: upload-stage.mjs, then upload-edges.mjs with the run id it prints.
 *
 * --live-held reads, through corpus_legal_fr_window_v3 (read-only, service role from the
 * environment), the newest publication date already held, the publications held from that
 * day on, and which of the window's staging input keys production has already staged; the
 * window starts on that day and neither held nor already-staged publications are restaged
 * (an already-staged one that is not held was rejected in production and needs manual review).
 * The run fails when any staged row would be rejected, because rejected rows raise the nightly
 * invalid count above the reviewed baseline. --allow-rejected keeps them for review instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { acquireFederalRegister } from './acquire-federal-register.mjs';
import { prepareWindow, windowInputKeys } from './prepare-fr-staging.mjs';
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
    const skippedFile = path.join(path.dirname(config.database), 'held-skipped.json');
    const alreadyStaged = fs.existsSync(skippedFile) ? JSON.parse(fs.readFileSync(skippedFile, 'utf8')).filter(s => s.reason === 'already_staged') : [];
    const shapes = all("select count(*) n from records where type='fr_document' and json_type(payload,'$.attributes.native.comments_close_on') is null")[0].n;
    return {
      source: 'Office of the Federal Register API v1, https://www.federalregister.gov/developers/documentation/api/v1 (public domain)',
      window: config.window ?? null, inputs, records_by_type: records, fr_document_type: frTypes, edges_by_type: edges,
      published: { first: dates?.first ?? null, last: dates?.last ?? null },
      open_comment_periods_at_through: { count: openComments, basis: `native comments_close_on >= ${through}` },
      fr_documents_missing_comments_close_on_field: shapes,
      unlinked_regulation_id_numbers: unlinked, rejected,
      // Staged in production before but not held (rejected there): not restaged, listed for manual review.
      already_staged_not_held: alreadyStaged,
      review_status: 'pending', written_to_database: false,
    };
  } finally { db.close(); }
}

/** A reader for corpus_legal_fr_window_v3 (read-only, service role from the environment). */
async function liveHeld() {
  const { adminClient } = await import('./admin-client.mjs');
  const call = adminClient(process.env.LEGAL_ATLAS_CREDENTIALS);
  return async (from, inputKeys = null) => {
    const result = await call('corpus_legal_fr_window_v3', { p_from: from ?? null, p_input_keys: inputKeys });
    if (!result || (result.latest_published !== null && !isIsoDay(result.latest_published)) || !Array.isArray(result.held) || !Array.isArray(result.staged)) throw Error('Unexpected corpus_legal_fr_window_v3 response');
    return result;
  };
}

const KEY_BATCH = 5000;
/** Held publications from `start` on, and which of `keys` production has already staged (batched request bodies). */
async function heldAndStaged(readWindow, start, keys) {
  const held = []; const staged = new Set();
  for (let i = 0; i === 0 || i < keys.length; i += KEY_BATCH) {
    const result = await readWindow(start, keys.slice(i, i + KEY_BATCH));
    if (i === 0) held.push(...result.held);
    for (const key of result.staged ?? []) staged.add(key);
  }
  return { held, staged: [...staged] };
}

/** An --out directory that already holds a packet is never reused (see the header). */
function assertFreshOut(out) {
  for (const used of ['staging', 'packet-summary.json']) {
    if (fs.existsSync(path.join(out, used))) throw Error(`${path.join(out, used)} exists; use a new --out directory for every run (e.g. fr-refresh-${today()})`);
  }
}

export async function refresh({ out, from, through = today(), held = [], live = false, allowRejected = false, native: acquired = null, acquire = acquireFederalRegister, readWindow = null, now = today() }) {
  if (!out) throw Error('--out is required');
  assertFreshOut(out);
  const read = live ? (readWindow ?? await liveHeld()) : null;
  let window = { from, through, held };
  if (live && !from) {
    // Without --from the window starts on the newest day already held (re-read, held rows skipped).
    window.from = (await read(null)).latest_published;
    if (!window.from) throw Error('No held Federal Register publication; pass --from');
  }
  if (!isIsoDay(window.from) || !isIsoDay(window.through) || window.from > window.through) throw Error('Use --from (or --live-held) and --through as ISO dates with from <= through');
  if (window.through > now) throw Error('The window cannot end after today (UTC)');
  const native = acquired ?? path.join(out, 'native'); const staging = path.join(out, 'staging');
  if (!acquired) await acquire({ destination: native, from: window.from, through: window.through });
  if (live) {
    // Held publications (exact publisher URL) and input keys already in production staging, read
    // after acquisition so the window's keys are known; neither is restaged.
    const live = await heldAndStaged(read, window.from, windowInputKeys(native, window.from, window.through));
    window = { ...window, ...live };
  }
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
      live: args.includes('--live-held'), allowRejected: args.includes('--allow-rejected'), native: flag('--native') ?? null });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
