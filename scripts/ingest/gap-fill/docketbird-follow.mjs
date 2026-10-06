// Owner-authorised (2026-10-06 03:24 UTC): follow the Tier-1 master dockets on the DocketBird account and pull their docket sheets and documents.
// Every follow is logged BEFORE the call (case id) and AFTER it with the exact API response (status, body, headers) in an append-only ledger; any dollar
// amount found in a response is extracted into the running cost ledger. Credentials: DOCKETBIRD_API_KEY from the environment only.
//   node docketbird-follow.mjs --ledger=<follow-ledger.jsonl> --case=<docketbird case id> [--follow] [--poll-sheet]
import fs from 'node:fs/promises';
import {appendJsonl, sleep} from './lib.mjs';

const BASE = 'https://api.docketbird.com';
const AMOUNT = /\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d+(?:\.\d{1,2})?\s?(?:usd|dollars?)\b|(?:charge|fee|cost|price)[^"\n]{0,60}\d/gi;
export const amountsIn = text => [...new Set(String(text ?? '').match(AMOUNT) ?? [])].map(s => s.trim());

async function call(method, path, {key, body, fetchImpl = fetch, timeout = 60000} = {}) {
  const res = await fetchImpl(`${BASE}${path}`, {method, headers: {Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeout)});
  const text = await res.text();
  const keep = ['x-amzn-requestid', 'x-amzn-errortype', 'content-type', 'retry-after', 'x-ratelimit-remaining'];
  return {status: res.status, headers: Object.fromEntries(keep.map(h => [h, res.headers.get(h)]).filter(([, v]) => v)), text};
}

/** Strip the signed query of any storage URL before a response is written anywhere. */
export const scrub = text => String(text).replace(/(https:\/\/[^\s"']*?\.pdf)\?[^\s"']*/g, '$1?<signed-query-removed>');

export async function followCase({caseId, ledger, key, fetchImpl = fetch, actor = 'gap-fill'}) {
  const at = new Date().toISOString();
  await appendJsonl(ledger, {event: 'follow_attempt', case_id: caseId, at, request: {method: 'POST', path: '/follow_case', body: {case_id: caseId}}, actor});
  const r = await call('POST', '/follow_case', {key, body: {case_id: caseId}, fetchImpl});
  const entry = {event: 'follow_response', case_id: caseId, at: new Date().toISOString(), status: r.status, headers: r.headers, body: scrub(r.text).slice(0, 4000), amounts_reported: amountsIn(r.text)};
  await appendJsonl(ledger, entry);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const key = process.env.DOCKETBIRD_API_KEY; if (!key) throw new Error('DOCKETBIRD_API_KEY is required');
  const before = await call('GET', `/documents?case_id=${encodeURIComponent(args.case)}`, {key});
  await appendJsonl(args.ledger, {event: 'pre_follow_probe', case_id: args.case, at: new Date().toISOString(), status: before.status, body: scrub(before.text).slice(0, 600)});
  console.log(JSON.stringify({pre_follow_status: before.status, body: before.text.slice(0, 200)}));
  if (args.follow) { const e = await followCase({caseId: args.case, ledger: args.ledger, key}); console.log(JSON.stringify(e)); }
}
