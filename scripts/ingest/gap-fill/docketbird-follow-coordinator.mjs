// Single owner for DocketBird follow/billing decisions. Workers enqueue cases; this process follows once and records the ledger.
//   node docketbird-follow-coordinator.mjs --work=<dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson, appendJsonl, atomicWriteJson, sleep} from './lib.mjs';
import {followCase} from './docketbird-follow.mjs';

const key = () => process.env.DOCKETBIRD_API_KEY;

async function accessible(caseId) {
  const probe = await fetch(`https://api.docketbird.com/cases/${encodeURIComponent(caseId)}`, {headers: {Authorization: `Bearer ${key()}`}, signal: AbortSignal.timeout(60000)});
  return probe.status === 200;
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const work = path.resolve(args.work);
  const queue = path.join(work, 'follow-queue.jsonl');
  const ledger = path.join(work, 'follow-ledger.jsonl');
  const stateFile = path.join(work, 'follow-state.json');
  const st = await readJson(stateFile, {done: {}, stopped: null});
  if (!key()) throw new Error('DOCKETBIRD_API_KEY is required');
  await fs.mkdir(work, {recursive: true});
  let offset = 0;
  for (;;) {
    if (st.stopped) { console.log(JSON.stringify({STOPPED: st.stopped})); return; }
    const buf = await fs.readFile(queue).catch(() => Buffer.alloc(0));
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (; offset < lines.length; offset++) {
      const {case_id} = JSON.parse(lines[offset]);
      if (!case_id || st.done[case_id]) continue;
      if (await accessible(case_id)) {
        st.done[case_id] = 'already_accessible';
        await appendJsonl(ledger, {event: 'access_probe', case_id, at: new Date().toISOString(), status: 200});
        await atomicWriteJson(stateFile, st);
        continue;
      }
      const r = await followCase({caseId: case_id, ledger, key: key()});
      let body = null; try { body = JSON.parse(r.body); } catch { /* not JSON */ }
      if (r.status === 429) {
        await appendJsonl(ledger, {event: 'follow_rate_limit', case_id, at: new Date().toISOString()});
        await sleep(600000);
        offset--;
        continue;
      }
      if (r.status !== 200 || body?.status !== 'success' || r.amounts_reported.length) {
        st.stopped = {case_id, status: r.status, amounts: r.amounts_reported};
        await atomicWriteJson(path.join(work, 'stop.json'), {stopped_at: new Date().toISOString(), reason: 'FOLLOW_NOT_SUCCESS_OR_CHARGE', ...st.stopped});
        await atomicWriteJson(stateFile, st);
        process.exitCode = 3;
        return;
      }
      st.done[case_id] = r.at;
      await atomicWriteJson(stateFile, st);
    }
    await sleep(5000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e)); process.exitCode = 1; });
