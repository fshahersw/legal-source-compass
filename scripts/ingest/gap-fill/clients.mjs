// Read-only API clients. Credentials come only from environment variables and are sent only to the
// expected HTTPS origin; they are never logged, written to receipts, or placed in any output file.
import {archiveRaw, sleep, sha256} from './lib.mjs';

export const CL_ORIGIN = 'https://www.courtlistener.com';
export const DB_ORIGIN = 'https://api.docketbird.com';
const CL_READ = new Set(['search', 'dockets', 'docket-entries', 'recap-documents', 'parties', 'attorneys', 'courts', 'originating-court-information', 'api-usage']);
const DB_READ = new Set(['/cases', '/documents', '/documents/search']);
/** Read paths of the DocketBird REST API: the three list routes plus one case or one document by id. */
const DB_READ_ID = /^\/(cases|documents)\/[A-Za-z0-9._:-]+$/;

export class Stop extends Error { constructor(code, detail) { super(code + (detail ? ` ${detail}` : '')); this.code = code; } }

/**
 * CourtListener REST v4. The live usage endpoint is the authority for remaining quota: the account is shared with other
 * collectors, so the client refuses to start a request once the remaining daily/hourly/minute budget is at or below `reserve`.
 */
export class CourtListener {
  constructor({cacheDir, token = process.env.COURTLISTENER_API_TOKEN, fetchImpl = fetch, reserve = 25, maxRequests = 40, now = Date.now} = {}) {
    if (!token) throw new Stop('MISSING_CREDENTIAL', 'COURTLISTENER_API_TOKEN');
    Object.assign(this, {cacheDir, token, fetchImpl, reserve, maxRequests, now, sleepFn: sleep, requests: 0, usage: null, usageAt: 0, stopped: null});
  }
  validate(url) {
    const u = new URL(url);
    const m = u.pathname.match(/^\/api\/rest\/v4\/([a-z-]+)\//);
    if (u.origin !== CL_ORIGIN || u.username || u.password || !m || !CL_READ.has(m[1])) throw new Stop('REFUSED_URL', u.origin + u.pathname);
    return u;
  }
  async raw(url) {
    this.validate(url);
    return this.fetchImpl(url, {headers: {Authorization: `Token ${this.token}`, Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(120000)});
  }
  async refreshUsage() {
    const res = await this.raw(`${CL_ORIGIN}/api/rest/v4/api-usage/`);
    if (!res.ok) throw new Stop('USAGE_UNAVAILABLE', String(res.status));
    this.usage = await res.json(); this.usageAt = this.now();
    return this.usage;
  }
  /** Smallest remaining count across every `user` scope window (day, hour, minute). */
  remaining() { return Math.min(...this.usage.current_usage.filter(x => x.scope === 'user').map(x => x.remaining)); }
  async reserveSlot() {
    if (this.stopped) throw new Stop(this.stopped);
    if (this.requests >= this.maxRequests) throw new Stop('REQUEST_BUDGET_REACHED', String(this.maxRequests));
    if (!this.usage || this.requests % 5 === 0) await this.refreshUsage();
    const blocked = this.usage.current_usage.find(x => x.scope === 'user' && x.blocked);
    if (blocked) throw new Stop('RATE_BLOCKED', blocked.rate);
    const day = this.usage.current_usage.find(x => x.scope === 'user' && x.window_seconds === 86400);
    if (day && day.remaining <= this.reserve) throw new Stop('DAILY_RESERVE_REACHED', `remaining=${day.remaining} reserve=${this.reserve} reset_at=${day.reset_at}`);
    // Per-minute and per-hour windows: wait for them to reopen instead of provoking a 429 (waits are bounded; the live usage is re-read after each).
    for (let waits = 0; waits < 20; waits++) {
      const win = this.usage.current_usage.filter(x => x.scope === 'user' && x.window_seconds < 86400 && x.remaining <= 2).sort((a, b) => b.window_seconds - a.window_seconds)[0];
      if (!win) break;
      await this.sleepFn(win.window_seconds >= 3600 ? 300000 : 61000);
      await this.refreshUsage();
    }
  }
  /** One retained GET. Returns {data, receipt}; stops the whole scope on 401/403/429. */
  async get(url) {
    await this.reserveSlot();
    const res = await this.raw(url);
    this.requests++;
    if (this.usage) for (const x of this.usage.current_usage) if (x.scope === 'user') x.remaining = Math.max(0, x.remaining - 1);
    const bytes = Buffer.from(await res.arrayBuffer());
    const receipt = await archiveRaw(this.cacheDir, bytes, {source: 'courtlistener', source_url: url, request_method: 'GET', http_status: res.status, retrieved_at: new Date().toISOString(), schema_version: 'courtlistener-rest-v4.7/1'});
    if (res.status === 429) { this.stopped = `RATE_LIMIT_STOP Retry-After=${res.headers.get('retry-after') ?? 'not supplied'}`; throw new Stop(this.stopped); }
    if (res.status === 401 || res.status === 403) { this.stopped = `AUTHORIZATION_STOP ${res.status}`; throw new Stop(this.stopped); }
    if (res.status === 404) return {data: null, receipt};
    if (res.status !== 200) throw new Stop('HTTP_ERROR', String(res.status));
    return {data: JSON.parse(bytes.toString('utf8')), receipt};
  }
}

/**
 * DocketBird REST API. Reads only the account's own tracked cases and their docket sheets. The provider answers
 * an untracked case with "please follow it. Charges may apply": this client never follows a case, never downloads
 * a PDF, and records that answer as `untracked` instead of retrying.
 */
export class DocketBird {
  constructor({cacheDir, key = process.env.DOCKETBIRD_API_KEY, fetchImpl = fetch, maxRequests = 60, retryMs = 2000, minGapMs = 0, sleepFn = sleep} = {}) {
    if (!key) throw new Stop('MISSING_CREDENTIAL', 'DOCKETBIRD_API_KEY');
    Object.assign(this, {cacheDir, key, fetchImpl, maxRequests, retryMs, minGapMs, sleepFn, nextAt: 0, rateLimited: 0, requests: 0, stopped: null});
  }
  async get(pathname, params) {
    if (!DB_READ.has(pathname) && !(DB_READ_ID.test(pathname) && pathname !== '/documents/search')) throw new Stop('REFUSED_PATH', pathname);
    if (this.stopped) throw new Stop(this.stopped);
    if (this.requests >= this.maxRequests) throw new Stop('REQUEST_BUDGET_REACHED', String(this.maxRequests));
    const u = new URL(DB_ORIGIN + pathname);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
    let res, bytes, rateTries = 0;
    for (let attempt = 0; ; attempt++) {
      // Global pacing: one request slot every minGapMs across all workers.
      const due = Math.max(Date.now(), this.nextAt); this.nextAt = due + this.minGapMs; if (due > Date.now()) await this.sleepFn(due - Date.now());
      res = await this.fetchImpl(u, {headers: {Authorization: `Bearer ${this.key}`, Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(60000)});
      this.requests++;
      bytes = Buffer.from(await res.arrayBuffer());
      if (res.status === 429 && rateTries < 6) {
        // Back off (the provider sends no Retry-After): 20 s, 40 s, ... capped at 5 min, and slow the shared pace.
        this.rateLimited++; rateTries++; this.minGapMs = Math.min(5000, Math.max(this.minGapMs * 2, 500));
        await archiveRaw(this.cacheDir, bytes, {source: 'docketbird', source_url: u.toString(), request_method: 'GET', http_status: 429, retrieved_at: new Date().toISOString(), schema_version: 'docketbird-rest/1'});
        const wait = Math.min(300000, 20000 * 2 ** (rateTries - 1)); this.nextAt = Math.max(this.nextAt, Date.now() + wait); attempt--; continue;
      }
      if (res.status < 502 || res.status > 504 || attempt >= 3) break;
      await this.sleepFn(this.retryMs * 2 ** attempt);
    }
    const receipt = await archiveRaw(this.cacheDir, bytes, {source: 'docketbird', source_url: u.toString(), request_method: 'GET', http_status: res.status, retrieved_at: new Date().toISOString(), schema_version: 'docketbird-rest/1'});
    let body = null; try { body = JSON.parse(bytes.toString('utf8')); } catch { /* non-JSON body */ }
    if (res.status === 401) { this.stopped = 'AUTHORIZATION_STOP 401'; throw new Stop(this.stopped); }
    if (res.status === 429) { this.stopped = `RATE_LIMIT_STOP Retry-After=${res.headers.get('retry-after') ?? 'not supplied'}`; throw new Stop(this.stopped); }
    if (res.status === 403 && /does not have access to this case/i.test(body?.message ?? '')) return {untracked: true, data: null, receipt};
    if (res.status === 403) { this.stopped = 'AUTHORIZATION_STOP 403'; throw new Stop(this.stopped); }
    if (res.status === 504) return {timeout: true, data: null, receipt};
    if (res.status === 502 || res.status === 503) return {transient: true, data: null, receipt};
    if (res.status !== 200 || body?.status !== 'success') throw new Stop('HTTP_ERROR', String(res.status));
    return {data: body.data, receipt};
  }
}

export const recordSha256 = data => sha256(JSON.stringify(data));
