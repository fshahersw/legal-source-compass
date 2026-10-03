// Rolling CourtListener quota from the persisted ledger (epoch-ms timestamps) against the live limits 25/min, 300/h, 1400/day.
import fs from 'node:fs';
const pass = 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const ledger = JSON.parse(fs.readFileSync(`${pass}/rate-ledger.json`, 'utf8'));
const now = Date.now();
const within = ms => ledger.timestamps.filter(t => now - t < ms).length;
const out = { now: new Date(now).toISOString(), last_minute: within(60_000), last_hour: within(3_600_000), last_24h: within(86_400_000), limits: { per_min: 25, per_hour: 300, per_day: 1400 } };
out.remaining = { min: out.limits.per_min - out.last_minute, hour: out.limits.per_hour - out.last_hour, day: out.limits.per_day - out.last_24h };
const first = ledger.timestamps.length ? new Date(Math.min(...ledger.timestamps.filter(t => now - t < 86_400_000))).toISOString() : null;
out.oldest_in_24h_window = first;
console.log(JSON.stringify(out));
const st = JSON.parse(fs.readFileSync(`${pass}/service-state.json`, 'utf8'));
console.log(JSON.stringify({ pid: st.pid, status: st.status, requests_this_service_run: st.requests, tasks_done: st.tasks_done, tasks_failed: st.tasks_failed, pending: st.pending, current_scope: st.current_scope, scope_records: st.scope_records, last_event_at: st.last_event_at }));
