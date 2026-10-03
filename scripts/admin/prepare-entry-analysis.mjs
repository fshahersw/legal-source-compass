import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { reviewEntryPrivacy } from './master-entry-privacy.mjs';
import { aggregateEntryDates } from './entry-date-analysis.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((s, i, a) => s.startsWith('--') ? [s.slice(2), a[i + 1]] : []).filter(p => p.length));
if (!args.baseline || !args.continuation || !args.output) throw Error('Require --baseline --continuation --output');
const baseline = path.resolve(args.baseline), pass = path.resolve(args.continuation);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const privacy = await read(path.join(pass, 'master-entry-projection/master-entry-privacy-review.json'));
const coveragePath = path.join(pass, 'live-cumulative-entry-scope-receipt.json'), coverage = await read(coveragePath);
const entries = new Map(), dockets = new Map(), inputFiles = [];
const compare = (a, b) => Date.parse(b.provenance.retrieved_at) - Date.parse(a.provenance.retrieved_at)
  || Buffer.compare(Buffer.from(a.provenance.source_url), Buffer.from(b.provenance.source_url))
  || Buffer.compare(Buffer.from(a.provenance.record_sha256), Buffer.from(b.provenance.record_sha256));
const nativeUrlId = (value, type, idPattern) => {
  const u = new URL(value), match = u.pathname.match(new RegExp('^/api/rest/v4/' + type + '/(' + idPattern + ')/$'));
  if (u.origin !== 'https://www.courtlistener.com' || u.search || u.hash || u.username || u.password || !match) throw Error('Native source identity mismatch');
  return match[1];
};
for (const source of privacy.sourceFiles) {
  const bytes = await fs.readFile(source.path);
  if (bytes.length !== source.bytes || sha(bytes) !== source.sha256) throw Error('Frozen source changed');
  const type = source.path.endsWith('dockets.jsonl') ? 'dockets' : 'docket-entries', map = type === 'dockets' ? dockets : entries;
  inputFiles.push({ kind: type + '-native-jsonl', bytes: bytes.length, sha256: sha(bytes) });
  for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    if (sha(JSON.stringify(row.data)) !== row.provenance.record_sha256 || nativeUrlId(row.data.resource_uri, type, '[0-9]+') !== row.native_id) throw Error('Native payload identity/hash mismatch');
    const prior = map.get(row.native_id); if (!prior || compare(row, prior) < 0) map.set(row.native_id, row);
  }
}
const ordered = [...entries.values()].sort((a, b) => Buffer.compare(Buffer.from(a.native_id), Buffer.from(b.native_id)));
const signature = sha(ordered.map(r => [r.native_id, r.provenance.record_sha256, r.provenance.source_url, r.provenance.retrieved_at, r.provenance.source_sha256].join('\u001f')).join('\n'));
if (signature !== privacy.sourceSignatureSha256 || coverage.total_native_entries !== ordered.length || coverage.complete_scope_count !== 7 || coverage.scope_count !== 15) throw Error('Frozen source/coverage mismatch');
inputFiles.push({ kind: 'cumulative-entry-scope-receipt', bytes: (await fs.stat(coveragePath)).size, sha256: sha(await fs.readFile(coveragePath)) });
const courtPath = path.join(baseline, 'normalized/courts.jsonl'), courtBytes = await fs.readFile(courtPath), courts = new Map();
const referenceReceipt = await read(path.join(baseline, 'reference-file-receipts.json'));
const courtReceipt = referenceReceipt.files.find(file => file.path.endsWith('courts.jsonl'));
if (!courtReceipt?.complete_file || !courtReceipt.record_hashes_verified || courtReceipt.bytes !== courtBytes.length || courtReceipt.sha256 !== sha(courtBytes)) throw Error('Verified court reference file changed');
inputFiles.push({ kind: 'native-court-reference-jsonl', bytes: courtBytes.length, sha256: sha(courtBytes) });
for (const line of courtBytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line);
  const canonicalBulk = Object.fromEntries(Object.entries(row.data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  if (row.entity_type !== 'courts' || row.native_id !== row.data.id || sha(JSON.stringify(canonicalBulk)) !== row.provenance.record_sha256 || courts.has(row.native_id)) throw Error('Court reference identity/hash mismatch');
  courts.set(row.native_id, row);
}
const retrievals = ordered.map(r => r.provenance.retrieved_at).sort();
const capture = { first: retrievals[0], last: retrievals.at(-1) }, snapshotDate = capture.last.slice(0, 10);
const grouped = new Map(coverage.scopes.map(scope => [String(scope.docket_id), { source: scope, rows: [] }]));
for (const row of ordered) {
  const id = nativeUrlId(row.data.docket, 'dockets', '[0-9]+'), group = grouped.get(id);
  if (!group) throw Error('Unexpected native docket scope'); group.rows.push(row);
}
const scopes = [];
for (const [id, group] of grouped) {
  const header = dockets.get(id);
  if (!header || group.rows.length !== group.source.unique_native_entries || (group.source.complete && group.source.next != null)) throw Error('Docket coverage mismatch');
  const courtId = nativeUrlId(header.data.court, 'courts', '[a-zA-Z0-9._-]+'), court = courts.get(courtId);
  if (!court) throw Error('Unresolved native court reference');
  let blocked = 0, sealed = 0; const eligibleDates = [];
  for (const row of group.rows) {
    const reviewed = reviewEntryPrivacy(row.data, header.data);
    if (reviewed.sourceBlocked) blocked++; if (reviewed.explicitlySealed) sealed++;
    if (reviewed.eligible) eligibleDates.push(row.data.date_filed);
  }
  const number = typeof header.data.docket_number === 'string' ? header.data.docket_number.match(/(?:md|ml|mn)-0*([0-9]+)(?:$|-)/i)?.[1] ?? null : null;
  scopes.push({ nativeDocketId: id, sourceMdlNumber: number, complete: group.source.complete,
    capturedEntries: group.rows.length, eligibleEntries: eligibleDates.length,
    excludedEntries: group.rows.length - eligibleDates.length, sourceBlockedEntries: blocked, explicitlySealedEntries: sealed,
    ...aggregateEntryDates(eligibleDates, snapshotDate),
    court: { nativeId: courtId, name: court.data.full_name, resourceUrl: header.data.court,
      officialUrl: typeof court.data.url === 'string' && /^https?:\/\//.test(court.data.url) ? court.data.url : null,
      sourceAsOf: court.provenance.source_as_of ?? null, recordSha256: court.provenance.record_sha256,
      sourceUrl: court.provenance.source_url, sourceSha256: court.provenance.source_sha256 },
    sourceDocketUrl: 'https://www.courtlistener.com/docket/' + id + '/',
    entryListingUrl: eligibleDates.length ? '/data/cl_master_entries?f=' + encodeURIComponent(JSON.stringify({ native_docket_id: id })) : null,
    headerEvidence: { sourceUrl: header.provenance.source_url, retrievedAt: header.provenance.retrieved_at,
      recordSha256: header.provenance.record_sha256, sourceSha256: header.provenance.source_sha256 },
  });
}
scopes.sort((a, b) => a.nativeDocketId.localeCompare(b.nativeDocketId, 'en'));
const sum = field => scopes.reduce((n, scope) => n + scope[field], 0);
if (sum('capturedEntries') !== 15053 || sum('eligibleEntries') !== 14947 || sum('excludedEntries') !== 106 || sum('sourceBlockedEntries') !== 40 || sum('explicitlySealedEntries') !== 66 || scopes.filter(s => s.complete).reduce((n, s) => n + s.capturedEntries, 0) !== 14453) throw Error('Eligibility/coverage reconciliation failed');
const qualification = 'One unique source-native docket entry in a dated, source-selected snapshot. Timelines use only privacy-eligible native date_filed values. Completed pagination covers the publisher-returned entry collection at capture, not PACER completeness, all member cases or current membership. Partial scopes must not be compared as complete filing volumes. Court association records the source docket court, not governing state law. No captions, descriptions, contacts, PDF locators or contents are included; no outcome, likelihood or causation is inferred.';
const artifact = { schemaVersion: 'courtlistener-entry-analysis/1', generatedAt: new Date().toISOString(),
  sourceRuns: privacy.sourceRuns, sourceSignatureSha256: signature, grain: 'One unique native docket entry',
  snapshot: capture, sourceFiles: inputFiles, pdfDownloads: 0, qualification,
  scopeCount: scopes.length, completeScopeCount: scopes.filter(s => s.complete).length, partialScopeCount: scopes.filter(s => !s.complete).length,
  totals: { capturedEntries: sum('capturedEntries'), eligibleEntries: sum('eligibleEntries'), excludedEntries: sum('excludedEntries'),
    sourceBlockedEntries: sum('sourceBlockedEntries'), explicitlySealedEntries: sum('explicitlySealedEntries'),
    datedEntries: sum('datedEntries'), missingDateEntries: sum('missingDateEntries'), invalidDateEntries: sum('invalidDateEntries'), afterCaptureDateEntries: sum('afterCaptureDateEntries') }, scopes };
await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
await fs.writeFile(path.resolve(args.output), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ output: path.resolve(args.output), sha256: sha(await fs.readFile(path.resolve(args.output))), ...artifact.totals, completeScopes: artifact.completeScopeCount, partialScopes: artifact.partialScopeCount }));
