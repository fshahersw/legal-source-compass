// Enumerates the GovInfo USCOURTS granules of the Tier-1/Tier-2 master dockets (and of the JPML packages handed over by mdl-members) and stores every record with provenance.
//   node --use-system-ca scripts/ingest/official-mdl/govinfo-discover.mjs --mdl=2738,3140 [--run-dir=<dir>] [--base-interval-ms=2500] [--max-mods-mb=400]
//   node --use-system-ca scripts/ingest/official-mdl/govinfo-discover.mjs --jpml-packages=USCOURTS-jpml-1_22-F-03047,...      (JPML packages: one granule each)
// Per package, two requests at >= 2.5 s (robots honoured, 403/429 stop the host): PREMIS (file list + GPO SHA-256 fixity + byte size) and the package MODS (titles/dates).
// A package that does not exist answers non-200 for PREMIS and is recorded as such; nothing else is requested for it.
// Output: raw bytes under <run>/captures/www.govinfo.gov/<sha256>.xml (MODS: .xml.gz, sha256 = hash of the UNCOMPRESSED bytes), entries in <run>/capture-index.jsonl (roles govinfo_premis,
//         govinfo_package_mods), <run>/govinfo/listings/<key>.granules.jsonl and <key>.summary.json (key = MDL number or the package id).
import fs from 'node:fs';
import path from 'node:path';
import { createPoliteClient, USER_AGENT, HostStopped, RobotsDisallowed } from './polite-fetch.mjs';
import { GOVINFO_MASTERS, packageId, caseIdOf, premisUrl, packageModsUrl, granulePdfUrl, parsePremis, parsePackageMods, sha256Hex } from './govinfo.mjs';
import { resolveRunDir, parseArgs, appendJsonl, writeFileOnce, latestCaptures, readBody, gzipBytes } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const maxModsBytes = Number(args['max-mods-mb'] ?? 400) * 1024 ** 2;
const indexFile = path.join(runDir, 'capture-index.jsonl');
const listingDir = path.join(runDir, 'govinfo', 'listings');
fs.mkdirSync(listingDir, { recursive: true });
const client = createPoliteClient({ baseIntervalMs: Number(args['base-interval-ms'] ?? 2500), onEvent: e => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })) });
let robotsLogged = false;
const cached = latestCaptures(runDir);
// GovInfo answers a missing package with a "Page Not Found" HTML page (HTTP 200 after a redirect to /error): that is a negative answer, not a document.
const isPremis = body => body.subarray(0, 4000).includes('<premis'), isMods = body => body.subarray(0, 4000).includes('<mods');
const NEGATIVE_PREFIX = Date.now() - 24 * 3600 * 1000;
const negative = new Map();
for (const e of fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []) if (e.outcome === 'not_found_page' && Date.parse(e.retrieved_at) > NEGATIVE_PREFIX) negative.set(e.url, e);

async function capture(role, key, url, { maxBytes, gzip = false }) {
  const hit = cached.get(url);
  if (hit && !args.refresh) {
    const body = readBody(runDir, hit);
    if (role === 'govinfo_premis' ? isPremis(body) : isMods(body)) return { status: 200, body, entry: hit, from_cache: true };
    return { status: 404, body, entry: { ...hit, outcome: 'not_found_page' }, from_cache: true };   // an earlier run stored the error page as a capture
  }
  if (negative.has(url) && !args.refresh) return { status: 404, body: Buffer.alloc(0), entry: negative.get(url), from_cache: true };
  if (!robotsLogged) {
    robotsLogged = true;
    const r = await client.robotsFor(url);
    const file = r.sha256 ? path.join('captures', 'www.govinfo.gov', 'robots-' + r.sha256 + '.txt').replaceAll('\\', '/') : null;
    if (file) writeFileOnce(path.join(runDir, file), Buffer.from(r.body_text ?? '', 'utf8'));
    appendJsonl(indexFile, { schema_version: 'official-mdl-capture/1', role: 'robots', url: r.url, host: 'www.govinfo.gov', outcome: r.status === null ? 'network_error' : 'captured', http_status: r.status, sha256: r.sha256, bytes: r.bytes, retrieved_at: r.retrieved_at, body_file: file,
      robots_policy: { group: r.policy.group, crawl_delay_s: r.policy.crawlDelay, rules: r.policy.rules.length }, request: { method: 'GET', user_agent: USER_AGENT } });
  }
  const result = await client.get(url, { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5', maxBytes });
  const wellFormed = result.status === 200 && (role === 'govinfo_premis' ? isPremis(result.body) : isMods(result.body));
  if (result.status === 200 && !wellFormed) {
    const entry = { schema_version: 'official-mdl-capture/1', role, target_id: key, url, host: 'www.govinfo.gov', outcome: 'not_found_page', final_url: result.final_url, http_status: result.status, content_type: result.content_type, bytes: result.bytes, sha256: result.sha256, retrieved_at: result.retrieved_at,
      body_file: null, note: 'HTTP 200 with an HTML page instead of the XML record: the package is not published on GovInfo', request: { method: 'GET', user_agent: USER_AGENT }, robots: result.robots, pace: result.pace };
    appendJsonl(indexFile, entry); negative.set(url, entry);
    return { status: 404, body: Buffer.alloc(0), entry, from_cache: false };
  }
  const ok = result.status === 200;
  let file = null, stored = null;
  if (ok) {
    const stem = path.join('captures', 'www.govinfo.gov', result.sha256 + '.xml').replaceAll('\\', '/');
    if (gzip) { file = stem + '.gz'; stored = gzipBytes(result.body); writeFileOnce(path.join(runDir, file), stored); } else { file = stem; writeFileOnce(path.join(runDir, file), result.body); }
  }
  const entry = { schema_version: 'official-mdl-capture/1', role, target_id: key, url, host: 'www.govinfo.gov', outcome: ok ? 'captured' : 'http_error', final_url: result.final_url, http_status: result.status, content_type: result.content_type,
    bytes: result.bytes, sha256: result.sha256, retrieved_at: result.retrieved_at, body_file: file, stored_encoding: gzip && ok ? 'gzip' : null, stored_bytes: stored ? stored.length : null, request: { method: 'GET', user_agent: USER_AGENT }, robots: result.robots, pace: result.pace };
  appendJsonl(indexFile, entry);
  return { status: result.status, body: result.body, entry, from_cache: false };
}

async function discoverPackage({ key, mdl, tier, court, pkg, caseId }) {
  const summary = { schema_version: 'official-mdl-govinfo-summary/1', key, mdl, tier, court, package_id: pkg, native_case_id: caseId, exists: false, stopped_reason: null, built_at: null };
  let premisRes;
  try { premisRes = await capture('govinfo_premis', key, premisUrl(pkg), { maxBytes: 20 * 1024 ** 2 }); } catch (error) {
    summary.stopped_reason = error instanceof HostStopped ? 'host_stopped:' + error.reason : error instanceof RobotsDisallowed ? 'robots_disallowed' : 'network_error:' + String(error.cause?.code ?? error.message).slice(0, 60);
    return { summary, rows: [] };
  }
  summary.premis = { status: premisRes.status, sha256: premisRes.entry.sha256, bytes: premisRes.entry.bytes, retrieved_at: premisRes.entry.retrieved_at, body_file: premisRes.entry.body_file };
  if (premisRes.status !== 200) { summary.note = 'package not published on GovInfo (PREMIS request answered ' + (premisRes.entry.outcome === 'not_found_page' ? 'with the "Page Not Found" page' : premisRes.status) + ')'; return { summary, rows: [] }; }
  const files = parsePremis(premisRes.body.toString('utf8'), pkg);
  summary.exists = true; summary.premis_granule_files = files.length;
  if (!files.length) { summary.note = 'package exists but PREMIS lists no granule PDF'; return { summary, rows: [] }; }
  let modsRes;
  try { modsRes = await capture('govinfo_package_mods', key, packageModsUrl(pkg), { maxBytes: maxModsBytes, gzip: true }); } catch (error) {
    summary.stopped_reason = error instanceof HostStopped ? 'host_stopped:' + error.reason : 'mods_fetch_failed:' + String(error.cause?.code ?? error.message).slice(0, 60);
    return { summary, rows: [] };
  }
  summary.mods = { status: modsRes.status, sha256: modsRes.entry.sha256, bytes: modsRes.entry.bytes, stored_bytes: modsRes.entry.stored_bytes, retrieved_at: modsRes.entry.retrieved_at, body_file: modsRes.entry.body_file };
  if (modsRes.status !== 200) { summary.stopped_reason = 'mods_http_' + modsRes.status; return { summary, rows: [] }; }
  const mods = parsePackageMods(modsRes.body.toString('utf8'), pkg);
  summary.package_title = mods.package_title; summary.mods_constituents = mods.constituents.length;
  const byId = new Map(mods.constituents.map(c => [c.granule_id, c]));
  const rows = [], problems = [];
  for (const f of files) {
    const g = byId.get(f.granule_id) ?? null;
    const row = { schema: 'official-mdl-govinfo-granule/1', key, mdl, tier, court, package_id: pkg, native_case_id: caseId, granule_id: f.granule_id, part: f.part,
      premis: { original_name: f.original_name, sha256: f.sha256, bytes: f.bytes, fdsys_id: f.fdsys_id, sha256_source: 'GPO PREMIS fixity (SHA-256 of the published PDF)', file: summary.premis },
      mods: g ? { docket_text: g.docket_text, subtitle: g.subtitle, date_issued: g.date_issued, case_title: g.case_title, court_name: g.court_name, search_title: g.search_title, docket_number_published: g.docket_number_published, pdf_url: g.pdf_url, fdsys_unique_id: g.fdsys_unique_id, file: summary.mods } : null,
      pdf_url: granulePdfUrl(pkg, f.part), problems: [] };
    if (!g) row.problems.push('granule_in_premis_but_not_in_mods');
    else if (g.pdf_url !== row.pdf_url) row.problems.push('mods_pdf_url_differs_from_expected_pattern');
    if (!f.sha256 || !f.bytes) row.problems.push('premis_fixity_missing');
    rows.push(row);
  }
  for (const c of mods.constituents) if (!files.some(f => f.granule_id === c.granule_id)) problems.push({ granule: c.granule_id, problem: 'granule_in_mods_but_not_in_premis' });
  summary.granules = rows.length; summary.problems = [...problems, ...rows.filter(r => r.problems.length).map(r => ({ granule: r.granule_id, problems: r.problems }))];
  summary.first_date = rows.map(r => r.mods?.date_issued).filter(Boolean).sort()[0] ?? null; summary.last_date = rows.map(r => r.mods?.date_issued).filter(Boolean).sort().at(-1) ?? null;
  summary.built_at = new Date().toISOString();
  return { summary, rows };
}

const jobs = [];
const jpmlJob = pkg => {
  const m = /^USCOURTS-jpml-\d+_\d{2}-F-0*(\d+)$/.exec(pkg);
  if (!m) throw Error('BAD_JPML_PACKAGE ' + pkg);
  return { key: pkg, mdl: m[1], tier: null, court: 'jpml', pkg, caseId: 'MDL No. ' + m[1] };
};
if (args['jpml-packages']) for (const pkg of String(args['jpml-packages']).split(',').map(x => x.trim()).filter(Boolean)) jobs.push(jpmlJob(pkg));
else if (args['jpml-probe']) {
  // --jpml-probe=2885:19|18|20,2924:19|20|21 : the JPML package year is the year the MDL docket was opened (not always the centralization year), so candidate years are probed with PREMIS (one small request each)
  const unresolved = [];
  for (const spec of String(args['jpml-probe']).split(',').map(x => x.trim()).filter(Boolean)) {
    const [mdl, years] = spec.split(':');
    let found = null;
    for (const yy of years.split('|')) {
      const pkg = `USCOURTS-jpml-1_${yy}-F-${String(Number(mdl)).padStart(5, '0')}`;
      const probe = await capture('govinfo_premis', pkg, premisUrl(pkg), { maxBytes: 20 * 1024 ** 2 });
      if (probe.status === 200) { found = pkg; break; }
    }
    if (found) jobs.push(jpmlJob(found)); else unresolved.push(mdl);
  }
  console.log(JSON.stringify({ jpml_probe: { resolved: jobs.map(j => j.pkg), unresolved } }));
}
else for (const mdl of String(args.mdl ?? GOVINFO_MASTERS.map(m => m.mdl).join(',')).split(',').map(x => x.trim()).filter(Boolean)) {
  const master = GOVINFO_MASTERS.find(m => m.mdl === mdl);
  if (!master) { console.log(JSON.stringify({ mdl, error: 'not a Tier-1/2 master' })); continue; }
  jobs.push({ key: mdl, mdl, tier: master.tier, court: master.court, pkg: packageId(master), caseId: caseIdOf(master) });
}
for (const job of jobs) {
  const { summary, rows } = await discoverPackage(job);
  fs.writeFileSync(path.join(listingDir, job.key + '.granules.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(path.join(listingDir, job.key + '.summary.json'), JSON.stringify({ ...summary, built_at: summary.built_at ?? new Date().toISOString() }, null, 1));
  console.log(JSON.stringify({ key: job.key, package: job.pkg, exists: summary.exists, granules: rows.length, premis_files: summary.premis_granule_files ?? 0, mods_constituents: summary.mods_constituents ?? null, mods_mb: summary.mods ? Math.round(summary.mods.bytes / 1048576 * 10) / 10 : null, first: summary.first_date ?? null, last: summary.last_date ?? null, problems: (summary.problems ?? []).length, stopped: summary.stopped_reason, note: summary.note ?? null }));
  if (summary.stopped_reason && /host_stopped|robots/.test(summary.stopped_reason)) break;
}
console.log(JSON.stringify({ done: true, hosts: client.state() }));
