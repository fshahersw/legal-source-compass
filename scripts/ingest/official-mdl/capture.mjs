// Captures official court MDL pages (HTML) politely and stores the raw bytes with provenance in the private run dir.
//   node --use-system-ca scripts/ingest/official-mdl/capture.mjs --mdl=2738,3060 [--no-index] [--run-dir=<dir>] [--base-interval-ms=2500] [--dry-run]
// Per fetch: raw body at <run>/captures/<host>/<sha256>.<ext>, plus one line in <run>/capture-index.jsonl (URL, final URL, HTTP status, sha256, bytes,
// retrieved_at, robots verdict, pacing, redirect chain). Nothing is parsed or interpreted here.
import path from 'node:path';
import { createPoliteClient, USER_AGENT, HostStopped, RobotsDisallowed } from './polite-fetch.mjs';
import { MATTERS, pagesFor } from './targets.mjs';
import { resolveRunDir, parseArgs, appendJsonl, writeFileOnce, hostDir, extFor } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const mdls = String(args.mdl ?? Object.keys(MATTERS).join(',')).split(',').map(x => x.trim()).filter(Boolean);
const targets = pagesFor(mdls, { includeIndex: !args['no-index'] });
const indexFile = path.join(runDir, 'capture-index.jsonl');
if (args['dry-run']) { console.log(JSON.stringify({ dry_run: true, run_dir: runDir, pages: targets.map(t => ({ mdl: t.mdl, id: t.id, url: t.url })) }, null, 1)); process.exit(0); }

const client = createPoliteClient({ baseIntervalMs: Number(args['base-interval-ms'] ?? 2500), onEvent: e => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })) });
const robotsLogged = new Set();
async function recordRobots(host, sampleUrl) {
  if (robotsLogged.has(host)) return; robotsLogged.add(host);
  const r = await client.robotsFor(sampleUrl);
  const bytes = Buffer.from(r.body_text ?? '', 'utf8');
  let file = null;
  if (r.sha256) { file = path.join('captures', host, 'robots-' + r.sha256 + '.txt'); writeFileOnce(path.join(runDir, file), bytes); }
  appendJsonl(indexFile, { schema_version: 'official-mdl-capture/1', role: 'robots', url: r.url, host, outcome: r.status === null ? 'network_error' : 'captured', http_status: r.status, sha256: r.sha256, bytes: r.bytes, retrieved_at: r.retrieved_at, body_file: file ? file.replaceAll('\\', '/') : null,
    robots_policy: { group: r.policy.group, crawl_delay_s: r.policy.crawlDelay, rules: r.policy.rules.length }, request: { method: 'GET', user_agent: USER_AGENT } });
}

let captured = 0, failed = 0;
for (const target of targets) {
  const base = { schema_version: 'official-mdl-capture/1', role: target.role, target_id: target.id, mdl: target.mdl, family: target.family, url: target.url, host: target.host, request: { method: 'GET', user_agent: USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } };
  try {
    await recordRobots(target.host, target.url);
    const result = await client.get(target.url);
    const ok = result.status === 200;
    const ext = extFor(result.content_type, result.final_url);
    const file = ok ? path.join('captures', target.host, result.sha256 + '.' + ext).replaceAll('\\', '/') : null;
    if (ok) writeFileOnce(path.join(runDir, file), result.body);
    appendJsonl(indexFile, { ...base, outcome: ok ? 'captured' : 'http_error', final_url: result.final_url, http_status: result.status, content_type: result.content_type, last_modified: result.last_modified, etag: result.etag, bytes: result.bytes, sha256: result.sha256, retrieved_at: result.retrieved_at, body_file: file,
      redirect_chain: result.redirect_chain, robots: result.robots, pace: result.pace });
    console.log(JSON.stringify({ mdl: target.mdl, id: target.id, status: result.status, bytes: result.bytes, sha256: result.sha256, file, robots: result.robots.verdict, interval_ms: result.pace.interval_ms }));
    ok ? captured++ : failed++;
  } catch (error) {
    failed++;
    const outcome = error instanceof RobotsDisallowed ? 'robots_disallowed' : error instanceof HostStopped ? 'host_stopped' : 'network_error';
    appendJsonl(indexFile, { ...base, outcome, error: String(error.message).slice(0, 200), robots_rule: error.rule ?? null, retrieved_at: new Date().toISOString() });
    console.log(JSON.stringify({ mdl: target.mdl, id: target.id, outcome, error: String(error.message).slice(0, 120), cause: error.cause?.code ?? null }));
  }
}
console.log(JSON.stringify({ done: true, captured, failed, hosts: client.state(), run_dir: runDir }));
if (failed) process.exitCode = 2;
