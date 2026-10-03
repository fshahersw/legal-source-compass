// DocketBird metadata collector for the matter-registry loop (agent: mdl-members).
// Read-only tools only (docketbird-mcp-client.mjs allow-list): get_case, get_docket_sheet, search_cases,
// find_litigation_relationships. Every RPC response is captured byte-exact with its sha256 by the client.
// Results are summarized into <cache>/results/<label>.json (task, retrieved_at, capture file, response sha256, parsed result).
// Stops on HTTP 401/403/429 or when a tool reports remaining_today <= --reserve (default 3).
//
// Usage: node --use-system-ca scripts/ingest/members-docketbird-collect.mjs --cache=<dir> --tasks=<file.json> [--concurrency=2] [--reserve=3]
// Task: {"label":"3047-case","tool":"get_case","args":{"case_id":"cand-4:2022-md-03047"}}
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DocketBirdClient } from './docketbird-mcp-client.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
if (!args.cache || !args.tasks) throw new Error('--cache and --tasks are required');
const cache = path.resolve(args.cache);
const concurrency = Number(args.concurrency ?? 2);
const reserve = Number(args.reserve ?? 3);
const tasks = JSON.parse(await fs.readFile(args.tasks, 'utf8'));
await fs.mkdir(path.join(cache, 'results'), { recursive: true });

const client = new DocketBirdClient(cache);
await client.initialize();
let stop = null;
const remaining = {};
const log = o => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

function unwrap(r) {
  if (r.isError) {
    const t = r.content?.find(x => x.type === 'text')?.text ?? 'provider error';
    throw new Error(t.startsWith('This question took too long') ? 'PROVIDER_QUERY_TIMEOUT' : 'PROVIDER_TOOL_ERROR: ' + t.slice(0, 160));
  }
  return r.structuredContent ?? JSON.parse(r.content.find(x => x.type === 'text').text);
}
async function runTask(task) {
  const out = path.join(cache, 'results', `${task.label}.json`);
  if (await fs.stat(out).then(() => true, () => false)) { log({ event: 'skip_existing', label: task.label }); return; }
  if (stop) throw new Error(stop);
  const before = client.sequence;
  let raw;
  try { raw = await client.call(task.tool, task.args); }
  catch (e) { if (/HTTP (401|403|429)/.test(e.message)) stop = e.message; throw e; }
  // The client names each capture <seq padded to 6>-<response sha256>.json. With several workers the shared
  // sequence is not reliable, so match the newest capture whose tool name and arguments equal this task.
  const names = (await fs.readdir(cache)).filter(n => /^\d{6}-[0-9a-f]{64}\.json$/.test(n)).sort().reverse().slice(0, 40);
  let capture = null, captureJson = null;
  for (const n of names) {
    const j = JSON.parse(await fs.readFile(path.join(cache, n), 'utf8'));
    if (j.method === 'tools/call' && j.params?.name === task.tool && JSON.stringify(j.params.arguments) === JSON.stringify(task.args)) { capture = n; captureJson = j; break; }
  }
  let result = null, error = null;
  try { result = unwrap(raw); } catch (e) { error = String(e.message); }
  if (result && Number.isInteger(result.remaining_today)) {
    remaining[task.tool] = result.remaining_today;
    if (result.remaining_today <= reserve) stop = `QUOTA_RESERVE tool=${task.tool} remaining_today=${result.remaining_today}`;
  }
  const summary = { schema_version: 'docketbird-mcp-capture/1', label: task.label, tool: task.tool, arguments: task.args, retrieved_at: captureJson?.retrieved_at ?? new Date().toISOString(),
    source_url: client.endpoint, capture_file: capture, response_sha256: captureJson?.response_sha256 ?? null, http_status: captureJson?.http_status ?? null, error, result };
  await fs.writeFile(out, JSON.stringify(summary, null, 1));
  log({ event: 'task_done', label: task.label, tool: task.tool, error, remaining_today: result?.remaining_today ?? null, num_records: result?.num_records ?? result?.entries_returned ?? result?.found ?? null });
}

let cursor = 0;
const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
  while (cursor < tasks.length) {
    if (stop) return;
    const task = tasks[cursor++];
    try { await runTask(task); }
    catch (e) { log({ event: 'task_error', label: task.label, error: String(e.message).slice(0, 200) }); }
  }
}));
log({ event: 'collector_done', stop, remaining });
