/** Usage: node run.mjs capture|land|daily --output=<private directory> [--sources=...] [--execute]. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SOURCES, ADAPTERS } from './adapters.mjs';
import { collectNhtsa } from './nhtsa.mjs';
import { publicCaptureClient, requireValue, isoDate, addDays, atomicJson, immutableWrite, payloadHash, MonitorError } from './core.mjs';
import { cloudClient, landPacket, validatePacket, recoverRun } from './cloud.mjs';

export function parseArgs(argv) {
  const [command, ...values] = argv; requireValue(['capture', 'land', 'daily', 'recover'].includes(command), 'COMMAND_REQUIRED');
  const options = { command };
  for (const value of values) {
    requireValue(value.startsWith('--'), 'ARGUMENT_INVALID'); const split = value.indexOf('='); const key = value.slice(2, split < 0 ? undefined : split);
    requireValue(['output', 'sources', 'from', 'through', 'mode', 'max-pages', 'max-records', 'execute', 'force', 'run-id'].includes(key) && !(key in options), 'ARGUMENT_INVALID');
    if (['execute', 'force'].includes(key)) { requireValue(split < 0, 'BOOLEAN_FLAG_MUST_BE_BARE'); options[key] = true; }
    else { requireValue(split > 0 && value.slice(split + 1).length > 0, 'ARGUMENT_VALUE_REQUIRED'); options[key] = value.slice(split + 1); }
  }
  requireValue(options.output, 'PRIVATE_OUTPUT_REQUIRED');
  if (command === 'recover') {
    requireValue(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options['run-id'] ?? ''), 'RUN_ID_INVALID');
    options['run-id'] = options['run-id'].toLowerCase();
    requireValue(!['sources', 'from', 'through', 'mode', 'force', 'max-pages', 'max-records'].some((key) => key in options), 'RECOVERY_SCOPE_IMMUTABLE');
  } else requireValue(!('run-id' in options), 'ARGUMENT_INVALID');
  options.output = path.resolve(options.output);
  requireValue(!options.output.split(path.sep).some((p) => ['public', '.output', 'src'].includes(p.toLowerCase())), 'PRIVATE_OUTPUT_REQUIRED');
  options.sources = options.sources ? options.sources.split(',') : Object.keys(SOURCES);
  requireValue(options.sources.length && options.sources.every((s) => Object.hasOwn(SOURCES, s)) && new Set(options.sources).size === options.sources.length, 'SOURCE_NOT_CONFIGURED');
  options.explicitFrom = options.from !== undefined;
  options.through = isoDate(options.through ?? new Date().toISOString().slice(0, 10)); options.from = isoDate(options.from ?? addDays(options.through, -7));
  requireValue(options.from <= options.through && Date.parse(options.through) - Date.parse(options.from) <= 90 * 86400000, 'WINDOW_INVALID');
  options.mode ??= command === 'daily' ? 'incremental' : 'initial'; requireValue(['initial', 'incremental', 'backfill'].includes(options.mode), 'RUN_MODE_INVALID');
  options.maxPages = Number(options['max-pages'] ?? 30); options.maxRecords = Number(options['max-records'] ?? 1500);
  requireValue(Number.isSafeInteger(options.maxPages) && options.maxPages >= 1 && options.maxPages <= 100 && Number.isSafeInteger(options.maxRecords) && options.maxRecords >= 1 && options.maxRecords <= 10000, 'BOUND_INVALID');
  return options;
}
export async function captureSource(source, options, dependencies = {}) {
  const directory = path.join(options.output, source); await fs.mkdir(directory, { recursive: true });
  const packetFile = path.join(directory, 'packet.json');
  try { await fs.access(packetFile); throw new MonitorError('PACKET_ALREADY_EXISTS_USE_LAND_OR_NEW_DIRECTORY'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const run = { run_id: randomUUID(), source_id: source, started_at: new Date().toISOString(), window_from: options.from, window_to: options.through };
  await atomicJson(path.join(directory, 'run.json'), run);
  const client = publicCaptureClient({ directory, hosts: SOURCES[source].hosts, ...dependencies });
  let result, status = 'completed', error = null;
  try { result = await (SOURCES[source].mode === 'nhtsa' ? collectNhtsa : ADAPTERS[SOURCES[source].mode])(client, source, { ...options, directory }); }
  catch (e) { status = 'failed'; error = e instanceof MonitorError ? e.code : 'SOURCE_CAPTURE_FAILED'; result = { rows: [], expected: null, scope: { selection: 'Requested source window could not be completed; no records projected', full_history: false, qualification: SOURCES[source].qualification } }; }
  const packet = { schema_version: 'regulatory-packet/1', ...run, completed_at: new Date().toISOString(), status, error_code: error, expected_count: result.expected, scope: { ...result.scope, mode: options.mode, collector_version: 'regulatory-collector/1', source_publisher_cadence: SOURCES[source].publisher_cadence, proposed_check_hours: SOURCES[source].hours, maximum_records: options.maxRecords, maximum_pages: options.maxPages }, captures: client.captures, rows: result.rows };
  validatePacket(packet); await immutableWrite(packetFile, JSON.stringify(packet, null, 2) + '\n');
  await atomicJson(path.join(directory, 'checkpoint.json'), packetSummary(packet)); return packet;
}
export function packetSummary(packet) { return { run_id: packet.run_id, source_id: packet.source_id, status: packet.status, expected_count: packet.expected_count, record_count: packet.rows.length, capture_count: packet.captures.length, packet_sha256: payloadHash(packet), error_code: packet.error_code, window_from: packet.window_from, window_to: packet.window_to }; }
export function isDue(source, overview, now = Date.now()) {
  const state = overview?.sources?.find((s) => s.id === source);
  if (!state?.latestCompletedAt) return true;
  const completed = Date.parse(state.latestCompletedAt);
  // UTC-aligned slots prevent a run's duration from suppressing the next scheduled poll.
  // Invalid freshness cannot establish that the current slot has already been covered.
  if (!Number.isFinite(completed)) return true;
  const bucketMs = SOURCES[source].hours * 3600000;
  return Math.floor(now / bucketMs) > Math.floor(completed / bucketMs);
}
export async function closeInterruptedRun(cloud, packet, error) {
  // Read the actual server count after a failed step. Never guess a count or publish partial rows.
  try {
    const overview = await cloud.rpc('corpus_regulatory_overview_v1'); const run = overview.runs.find((r) => r.id === packet.run_id);
    if (run?.status === 'running') return await cloud.rpc('corpus_regulatory_finish_run_v1', { p_run: packet.run_id, p_status: 'failed', p_observed_count: run.observedCount, p_error_code: error instanceof MonitorError ? error.code.toLowerCase() : 'intake_failed' });
    return { status: run?.status ?? 'not_opened' };
  } catch { return { status: 'closure_unverified', run_id: packet.run_id, action: 'Resume exact retained packet; do not mark completed or clear the source lease manually without readback.' }; }
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv); const needsCloud = options.command !== 'capture' && options.execute === true;
  requireValue(options.command !== 'daily' || options.execute === true, 'DAILY_REQUIRES_EXECUTE');
  requireValue(options.command !== 'recover' || options.execute === true, 'RECOVERY_REQUIRES_EXECUTE');
  const cloud = needsCloud ? cloudClient() : null; const overview = options.command === 'daily' ? await cloud.rpc('corpus_regulatory_overview_v1') : null;
  await fs.mkdir(options.output, { recursive: true });
  const lock = await fs.open(path.join(options.output, '.collector.lock'), 'wx').catch(() => { throw new MonitorError('COLLECTOR_DIRECTORY_LOCKED'); });
  const summaries = []; let failed = false;
  try {
    if (options.command === 'recover') {
      const result = await recoverRun({ runId: options['run-id'], output: options.output, cloud });
      await atomicJson(path.join(options.output, 'checkpoint.json'), { schema_version: 'regulatory-checkpoint/1', recovery: result });
      console.log(JSON.stringify(result)); return 0;
    }
    for (const source of options.sources) {
      if (options.command === 'daily' && !options.force && !isDue(source, overview)) { summaries.push({ source_id: source, status: 'not_due' }); continue; }
      const directory = path.join(options.output, source);
      let packet;
      if (options.command === 'land') packet = validatePacket(JSON.parse(await fs.readFile(path.join(directory, 'packet.json'), 'utf8')));
      else packet = await captureSource(source, { ...options, from: !options.explicitFrom && SOURCES[source].mode === 'openfda' ? addDays(options.through, -30) : options.from });
      requireValue(packet.source_id === source, 'PACKET_SOURCE_MISMATCH');
      const summary = packetSummary(packet);
      if (cloud) {
        try { summary.landing = await landPacket({ packet, directory, cloud }); }
        catch (e) { summary.landing = { status: 'failed', error_code: e instanceof MonitorError ? e.code : 'INTAKE_FAILED', closure: await closeInterruptedRun(cloud, packet, e) }; failed = true; }
      }
      failed ||= packet.status !== 'completed'; summaries.push(summary);
      await atomicJson(path.join(options.output, 'checkpoint.json'), { schema_version: 'regulatory-checkpoint/1', updated_at: new Date().toISOString(), sources: summaries });
      console.log(JSON.stringify(summary));
    }
    await atomicJson(path.join(options.output, 'checkpoint.json'), { schema_version: 'regulatory-checkpoint/1', updated_at: new Date().toISOString(), sources: summaries });
  } finally { await lock.close(); await fs.unlink(path.join(options.output, '.collector.lock')); }
  return failed ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(JSON.stringify({ status: 'failed', error_code: error instanceof MonitorError ? error.code : 'COLLECTOR_FAILED' })); process.exitCode = 1; });
}
