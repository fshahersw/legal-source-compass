// Read-only CourtListener header refresh. Uses an exact, frozen provider-ID list;
// never interprets a master docket crosswalk as proof of member-case membership.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CourtListenerClient, sha256 } from './courtlistener-client.mjs';
import { docketKeyFromNumber as keyFromNumber } from './members-registry-lib.mjs';
import { verifiedNativeDocketHeader } from './metadata-workflow.mjs';

export function compareDocketIdentity(expected, record) {
  const header = verifiedNativeDocketHeader(record);
  const court = header.court_id ?? (typeof header.court === 'string'
    ? header.court.match(/\/courts\/([^/]+)\/$/)?.[1] ?? header.court : null);
  const observedKey = keyFromNumber(court, header.docket_number);
  return {
    mdl: expected.mdl, native_id: expected.id,
    expected_key: expected.key, observed_key: observedKey,
    identity_matches: expected.key === observedKey,
    blocked: header.blocked !== false || header.date_blocked != null,
    date_filed: header.date_filed ?? null,
    date_terminated: header.date_terminated ?? null,
    date_last_filing: header.date_last_filing ?? null,
    source_modified_at: header.date_modified ?? null,
    retrieved_at: record.provenance.retrieved_at,
    source_url: record.provenance.source_url,
    source_sha256: record.provenance.source_sha256,
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }));
  if (!args.expected || !args.output) throw Error('--expected and --output are required');
  const expected = JSON.parse(await fs.readFile(String(args.expected), 'utf8'));
  if (!Array.isArray(expected) || !expected.length || expected.length > 100
      || expected.some(e => !/^[1-9]\d*$/.test(e.id) || !/^\d+$/.test(e.mdl)
        || !e.key || keyFromNumber(e.court, e.number) !== e.key)) throw Error('Invalid frozen docket identities');
  const ids = [...new Set(expected.map(e => e.id))];
  if (!args.execute) {
    console.log(JSON.stringify({state: 'dry-run', exact_native_ids: ids.length, database_writes: 0})); return;
  }
  const output = path.resolve(String(args.output));
  await fs.mkdir(path.join(output, 'live-normalized'), {recursive: true});
  const client = new CourtListenerClient(output, ids.length);
  const receipt = {schema_version: 'priority-docket-refresh/1', expected_ids: ids,
    database_writes: 0, rows: [], complete: false};
  const save = () => fs.writeFile(path.join(output, 'refresh-receipt.json'), JSON.stringify(receipt, null, 2));
  try {
    await client.initialize();
    for (const id of ids) {
      const {data, provenance} = await client.request(`https://www.courtlistener.com/api/rest/v4/dockets/${id}/`);
      const record = {schema_version: 'courtlistener-rest-v4.7/1', source_system: 'courtlistener',
        entity_type: 'dockets', native_id: id, data,
        provenance: {...provenance, record_sha256: sha256(JSON.stringify(data))}};
      // Validate resource URI, native ID, raw payload and provenance before saving an import row.
      const matches = expected.filter(e => e.id === id).map(e => compareDocketIdentity(e, record));
      await fs.writeFile(path.join(output, `header-${id}.json`), JSON.stringify(record));
      receipt.rows.push(...matches); await save();
      console.log(JSON.stringify({completed: new Set(receipt.rows.map(r => r.native_id)).size,
        requested: ids.length, id, identity_matches: matches.every(m => m.identity_matches),
        blocked: matches.some(m => m.blocked)}));
    }
    const records = await Promise.all(ids.map(id => fs.readFile(path.join(output, `header-${id}.json`), 'utf8')));
    await fs.writeFile(path.join(output, 'live-normalized/dockets.jsonl'), records.join('\n') + '\n');
    receipt.complete = true; await save();
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
