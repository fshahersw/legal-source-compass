// Polite HTTP client for official court websites (*.uscourts.gov). Node built-ins only.
//   * plain User-Agent that identifies the tool (no personal data)
//   * robots.txt is fetched once per host and honoured: Allow/Disallow (longest match wins, Allow wins ties) and Crawl-delay
//   * >= minIntervalMs between ANY two requests to one host (default 2500 ms; raised to Crawl-delay + 0.5 s when robots asks for more)
//   * 429 / 503: Retry-After honoured (bounded); 401 / 403: the host is stopped for the rest of the run (no evasion, no retries, no other hosts / proxies)
//   * redirects are followed manually and only within *.uscourts.gov over https
import { createHash } from 'node:crypto';

export const USER_AGENT = 'LegalSourceCompassCorpusBot/1.0 (official court MDL page archiver; polite pacing; contact via site owner)';
export const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');
const UA_TOKEN = 'legalsourcecompasscorpusbot';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseRobots(text) {
  const groups = [];
  let current = null, lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase(), value = line.slice(at + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', pattern: value });
    else if (key === 'crawl-delay') { const n = Number(value); if (Number.isFinite(n) && n >= 0) current.crawlDelay = n; }
  }
  return groups;
}
// The group that applies to this tool: the one naming it, else '*'. No group = everything allowed.
export function robotsPolicy(groups) {
  const named = groups.filter(g => g.agents.some(a => a !== '*' && UA_TOKEN.includes(a.replace(/[^a-z0-9]/g, '')) && a.length >= 3));
  const star = groups.filter(g => g.agents.includes('*'));
  const used = named.length ? named : star;
  return { rules: used.flatMap(g => g.rules), crawlDelay: used.map(g => g.crawlDelay).find(v => v !== null) ?? null, group: named.length ? 'named' : star.length ? '*' : 'none' };
}
function patternToRegExp(pattern) {
  let p = pattern, anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
}
export function robotsAllows(policy, pathAndQuery) {
  let best = null;
  for (const rule of policy.rules) {
    if (rule.pattern === '') continue; // "Disallow:" with no value allows everything
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) best = { length, allow: rule.allow, pattern: rule.pattern };
  }
  return { allowed: best ? best.allow : true, rule: best ? (best.allow ? 'Allow ' : 'Disallow ') + best.pattern : null };
}

export class HostStopped extends Error { constructor(host, reason) { super('HOST_STOPPED:' + reason); this.host = host; this.reason = reason; } }
export class RobotsDisallowed extends Error { constructor(url, rule) { super('ROBOTS_DISALLOWED'); this.url = url; this.rule = rule; } }

export function createPoliteClient({ fetchImpl = fetch, now = Date.now, pause = sleep, userAgent = USER_AGENT, baseIntervalMs = 2500, maxRetryAfterMs = 300000, onEvent = () => {}, timeoutMs = 90000 } = {}) {
  const hosts = new Map();
  const stateOf = host => { if (!hosts.has(host)) hosts.set(host, { lastAt: 0, robots: null, stopped: null, requests: 0 }); return hosts.get(host); };
  // Official government hosts only: court sites (*.uscourts.gov, never the ecf.* CM/ECF hosts) and the GPO's www.govinfo.gov (USCOURTS collection).
  function assertCourtUrl(value) {
    const u = new URL(value);
    const permittedHost = /^[a-z0-9.-]+\.uscourts\.gov$/.test(u.hostname) && !/^ecf\./.test(u.hostname) || u.hostname === 'www.govinfo.gov';
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !permittedHost) throw Error('URL_NOT_PERMITTED');
    return u;
  }
  async function spacing(host, st) {
    const interval = Math.max(baseIntervalMs, st.robots ? Math.ceil((st.robots.policy.crawlDelay ?? 0) * 1000) + (st.robots.policy.crawlDelay ? 500 : 0) : 0);
    const wait = st.lastAt + interval - now();
    if (wait > 0) await pause(wait);
    st.lastAt = now();
    st.requests++;
    return { interval_ms: interval, waited_ms: Math.max(0, wait) };
  }
  async function rawGet(u, st, { accept, maxBytes, method = 'GET' }) {
    const pace = await spacing(u.hostname, st);
    const started = now();
    const response = await fetchImpl(u.href, { method, headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const chunks = []; let bytes = 0;
    if (method !== 'HEAD' && response.body) {
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > maxBytes) { await response.body.cancel?.().catch(() => {}); throw Error('RESPONSE_TOO_LARGE'); } chunks.push(chunk); }
    }
    return { response, body: Buffer.concat(chunks), pace, request_started_at: new Date(started).toISOString() };
  }
  async function ensureRobots(u, st) {
    if (st.robots) return st.robots;
    const robotsUrl = new URL('/robots.txt', u.origin);
    let attempt = 0;
    for (;;) {
      try {
        const { response, body, pace } = await rawGet(robotsUrl, st, { accept: 'text/plain,*/*;q=0.5', maxBytes: 1 << 20 });
        const retrieved_at = new Date(now()).toISOString();
        const text = body.toString('utf8');
        let policy;
        if (response.status >= 200 && response.status < 300) policy = robotsPolicy(parseRobots(text));
        else if (response.status >= 400 && response.status < 500 && response.status !== 429) policy = { rules: [], crawlDelay: null, group: 'none (robots.txt answered ' + response.status + ')' };
        else if (attempt < 2) { attempt++; await pause(5000 * attempt); continue; }
        else policy = { rules: [{ allow: false, pattern: '/' }], crawlDelay: null, group: 'robots.txt unavailable (' + response.status + '): treated as disallow-all' };
        st.robots = { status: response.status, sha256: sha256Hex(body), bytes: body.length, retrieved_at, url: robotsUrl.href, policy, body_text: text.slice(0, 20000), pace };
        onEvent({ event: 'robots', host: u.hostname, status: response.status, crawl_delay_s: policy.crawlDelay, rules: policy.rules.length, group: policy.group });
        return st.robots;
      } catch (error) {
        if (attempt < 2) { attempt++; await pause(5000 * attempt); continue; }
        st.robots = { status: null, sha256: null, bytes: 0, retrieved_at: new Date(now()).toISOString(), url: robotsUrl.href, policy: { rules: [{ allow: false, pattern: '/' }], crawlDelay: null, group: 'robots.txt unreachable: treated as disallow-all' }, body_text: '', error: error.name };
        return st.robots;
      }
    }
  }
  // One logical GET (with redirects and Retry-After handling). Returns the final response; never throws for HTTP statuses.
  async function get(url, { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', maxBytes = 25 * 1024 ** 2, method = 'GET' } = {}) {
    let u = assertCourtUrl(url);
    const chain = [];
    for (let hop = 0; hop < 6; hop++) {
      const st = stateOf(u.hostname);
      if (st.stopped) throw new HostStopped(u.hostname, st.stopped);
      const robots = await ensureRobots(u, st);
      const verdict = robotsAllows(robots.policy, u.pathname + u.search);
      if (!verdict.allowed) throw new RobotsDisallowed(u.href, verdict.rule);
      let result;
      for (let retry = 0; ; retry++) {
        result = await rawGet(u, st, { accept, maxBytes, method });
        const status = result.response.status;
        if (status === 401 || status === 403) { st.stopped = 'http_' + status; onEvent({ event: 'host_stopped', host: u.hostname, status }); break; }
        if (status === 429 || status === 503) {
          const header = result.response.headers.get('retry-after');
          let waitMs = null;
          if (header) { const sec = Number(header); waitMs = Number.isFinite(sec) ? sec * 1000 : Math.max(0, Date.parse(header) - now()); }
          if (waitMs === null || !Number.isFinite(waitMs)) waitMs = 30000 * (retry + 1);
          if (retry >= 3 || waitMs > maxRetryAfterMs) { st.stopped = 'http_' + status + '_retry_after_' + Math.round(waitMs / 1000) + 's'; onEvent({ event: 'host_stopped', host: u.hostname, status, retry_after_ms: waitMs }); break; }
          onEvent({ event: 'retry_after', host: u.hostname, status, wait_ms: waitMs });
          await pause(waitMs + 500); continue;
        }
        break;
      }
      const { response, body } = result;
      const location = response.headers.get('location');
      chain.push({ url: u.href, status: response.status, location: location ?? null });
      if ([301, 302, 303, 307, 308].includes(response.status) && location) { u = assertCourtUrl(new URL(location, u).href); continue; }
      return {
        url, final_url: u.href, status: response.status, content_type: response.headers.get('content-type'), last_modified: response.headers.get('last-modified'), etag: response.headers.get('etag'), content_length: response.headers.get('content-length'),
        body, bytes: body.length, sha256: sha256Hex(body), retrieved_at: new Date(now()).toISOString(), redirect_chain: chain, host_stopped: stateOf(u.hostname).stopped,
        robots: { url: robots.url, status: robots.status, sha256: robots.sha256, retrieved_at: robots.retrieved_at, crawl_delay_s: robots.policy.crawlDelay, group: robots.policy.group, verdict: verdict.rule ?? 'allowed (no matching rule)' },
        pace: result.pace,
      };
    }
    throw Error('TOO_MANY_REDIRECTS');
  }
  return { get, robotsFor: async url => { const u = assertCourtUrl(url); return ensureRobots(u, stateOf(u.hostname)); }, state: () => Object.fromEntries([...hosts].map(([h, s]) => [h, { requests: s.requests, stopped: s.stopped, crawl_delay_s: s.robots?.policy.crawlDelay ?? null, robots_status: s.robots?.status ?? null }])) };
}
