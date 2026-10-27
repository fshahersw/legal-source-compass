// Read-only CourtListener lookup of MDL master-docket assignments (de-judges-data). For every target MDL without an assigned_to edge in
// corpus_ingest.relationships, reads the master docket's live header: by its recorded CourtListener docket id when there is one (the
// header's court + docket number must equal the JPML master docket exactly), else by court + docket_number_core with exactly one result
// whose court + normalized docket number equals the master docket. Nothing is inferred from names. Responses are archived with their
// provenance by scripts/ingest/courtlistener-client.mjs (rate ledger, global usage check, request budget); no database writes.
//
//   node scripts/enrichment/judge_xwalk/fetch_mdl_dockets.mjs --targets=<targets.json> --output=<acq dir> [--limit=N] [--execute]
// Re-running resumes: targets already read are skipped. The shared client defers (RATE_WINDOW_DEFERRED) when the account's hourly or daily
// CourtListener usage leaves less than its safety reserve; run again after the window.
//
// The API key comes only from the environment (COURTLISTENER_API_KEY); it is never written or logged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CourtListenerClient } from '../../ingest/courtlistener-client.mjs';
import { docketKeyFromNumber, parseDocketNumber } from '../../ingest/members-registry-lib.mjs';
import { fetchFreshDocketHeader } from '../../ingest/metadata-workflow.mjs';

const API = 'https://www.courtlistener.com/api/rest/v4';

/** docket_number_core as CourtListener stores it for district dockets: two-digit year + five-digit sequence ("2:04-cv-5184" -> "0405184"). */
export function docketCore(number) {
  const p = parseDocketNumber(number);
  return p ? `${String(p.year).slice(2)}${p.seq}` : null;
}

/** The person id at the end of a CourtListener people URL, or null. */
export function personId(url) {
  const m = String(url ?? '').match(/\/api\/rest\/v4\/people\/(\d+)\/?$/);
  return m ? m[1] : null;
}

/** One result row from a docket header and the target it was read for. */
export function resultRow(target, header, provenance, how) {
  const expected = docketKeyFromNumber(target.court, target.master_docket);
  const court = header.court_id ?? String(header.court ?? '').match(/\/courts\/([^/]+)\/$/)?.[1] ?? null;
  const observed = docketKeyFromNumber(court, header.docket_number);
  return {
    mdl: target.mdl, how, docket_id: String(header.id), court_id: court, docket_number: header.docket_number ?? null,
    expected_key: expected, observed_key: observed, identity_matches: Boolean(expected) && expected === observed,
    assigned_to: personId(header.assigned_to), assigned_to_str: header.assigned_to_str ?? null,
    referred_to: personId(header.referred_to), referred_to_str: header.referred_to_str ?? null,
    date_terminated: header.date_terminated ?? null, date_modified: header.date_modified ?? null,
    source_url: provenance.source_url, retrieved_at: provenance.retrieved_at, source_sha256: provenance.source_sha256,
  };
}

/**
 * Take the shared global rate lock (a directory with owner.json), exactly as the shared client does: a lock left by a process that is no
 * longer running (a killed run) is released, a live owner's lock is never taken. Only the two known lock artifacts are removed.
 */
export async function acquireLock(lock, { pid = process.pid, isAlive = defaultIsAlive } = {}) {
  await fs.mkdir(lock).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
    if (isAlive(owner.pid)) throw new Error('Another API collector holds the global rate lock.');
    await fs.unlink(path.join(lock, 'owner.json'));
    await fs.rmdir(lock);
    await fs.mkdir(lock);
  });
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid, createdAt: new Date().toISOString() }));
  return lock;
}

function defaultIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (check) { if (check.code === 'ESRCH') return false; throw check; }
}

class EnvKeyClient extends CourtListenerClient {
  // Same lock (with dead-owner recovery), ledger, usage check and limits as the shared client; only the key source differs (environment, not a
  // credentials file).
  async initialize() {
    const key = process.env.COURTLISTENER_API_KEY;
    if (!key) throw new Error('COURTLISTENER_API_KEY is not set');
    this.keys = { COURTLISTENER_API_KEY: key };
    await fs.mkdir(path.join(this.cache, 'api'), { recursive: true });
    this.lock = await acquireLock(path.join(this.cache, 'api-collector.lock'));
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    this.ledger = JSON.parse(await fs.readFile(path.join(this.cache, 'rate-ledger.json'), 'utf8').catch(() => '{"timestamps":[]}'));
    this.initialUsage = await this.usage();
    this.limits = this.initialUsage.current_usage.filter(x => x.scope === 'user');
    if (!this.limits.length || this.limits.some(x => x.blocked)) throw new Error('CourtListener API user scope unavailable or blocked');
    const at = Date.now();
    this.baseline = this.limits.map(x => ({ ...x, checkedAt: at, used: Math.max(0, x.used - this.ledger.timestamps.filter(t => t > at - x.window_seconds * 1000).length) }));
    console.log(JSON.stringify({ scope: 'courtlistener', verifiedLimits: this.limits.map(x => ({ rate: x.rate, remaining: x.remaining })), requestBudget: this.maxRequests }));
    return this;
  }
}

async function lookup(client, target) {
  if (/^[1-9]\d*$/.test(String(target.cl_docket_id ?? ''))) {
    const record = await fetchFreshDocketHeader(client, String(target.cl_docket_id));
    return [resultRow(target, record.data, record.provenance, 'recorded_docket_id')];
  }
  const core = docketCore(target.master_docket);
  if (!core || !target.court) return [{ mdl: target.mdl, how: 'not_searchable', identity_matches: false }];
  const url = `${API}/dockets/?court=${encodeURIComponent(target.court)}&docket_number_core=${core}`;
  const { data, provenance } = await client.request(url, { refresh: true });
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.some(r => r.docket_number_core != null && String(r.docket_number_core) !== core)) {
    return [{ mdl: target.mdl, how: 'filter_not_applied', identity_matches: false, source_url: provenance.source_url }];
  }
  const rows = results.map(r => resultRow(target, r, provenance, 'court_and_docket_number_core'));
  return rows.length ? rows : [{ mdl: target.mdl, how: 'no_result', identity_matches: false, source_url: provenance.source_url }];
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (!args.targets || !args.output) throw new Error('--targets and --output are required');
  const targets = JSON.parse(await fs.readFile(String(args.targets), 'utf8'));
  if (!Array.isArray(targets) || targets.length > 80 || targets.some(t => !/^\d{1,5}$/.test(String(t.mdl)))) throw new Error('Invalid targets');
  if (!args.execute) { console.log(JSON.stringify({ state: 'dry-run', targets: targets.length, database_writes: 0 })); return; }
  const output = path.resolve(String(args.output));
  const cache = path.join(output, 'courtlistener');
  await fs.mkdir(cache, { recursive: true });
  // Resume: rows already read (anything but an error) are kept; only the remaining targets are requested, at most --limit of them.
  const previous = JSON.parse(await fs.readFile(path.join(output, 'docket-assignments.json'), 'utf8').catch(() => '{"rows":[]}'));
  const done = new Set(previous.rows.filter(r => r.how !== 'error').map(r => String(r.mdl)));
  const limit = Number(args.limit ?? targets.length);
  const todo = targets.filter(t => !done.has(String(t.mdl))).slice(0, limit);
  const client = new EnvKeyClient(cache, todo.length + 2);
  const out = { schema_version: 'mdl-docket-assignments/1', database_writes: 0, rows: previous.rows.filter(r => r.how !== 'error'), complete: false };
  try {
    await client.initialize();
    for (const t of todo) {
      try { out.rows.push(...await lookup(client, t)); }
      catch (error) { out.rows.push({ mdl: t.mdl, how: 'error', error: String(error.message).slice(0, 200), identity_matches: false }); if (client.stopped) break; }
      await fs.writeFile(path.join(output, 'docket-assignments.json'), JSON.stringify(out, null, 1));
    }
    const read = new Set(out.rows.filter(r => r.how !== 'error').map(r => String(r.mdl)));
    out.complete = targets.every(t => read.has(String(t.mdl)));
  } finally {
    await fs.writeFile(path.join(output, 'docket-assignments.json'), JSON.stringify(out, null, 1));
    await client.close();
  }
  console.log(JSON.stringify({ rows: out.rows.length, matched: out.rows.filter(r => r.identity_matches).length, complete: out.complete }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
