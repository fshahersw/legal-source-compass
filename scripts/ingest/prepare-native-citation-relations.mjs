/** Private native foreign-key edges; does not fetch opinion text, PDFs, or credentials. */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).flatMap((v, i, a) => v.startsWith('--') ? [[v.slice(2), a[i + 1]]] : []));
if (!args.jobs || !args.output || !/^[a-f0-9-]{36}$/i.test(args.run ?? '')) throw new Error('Use --jobs verified-job-index.json --output private-directory --run UUID');
const jobs = JSON.parse(await readFile(resolve(args.jobs), 'utf8'));
const output = resolve(args.output);
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = {
  clusters: { docket_id: 'dockets' },
  citations: { cluster_id: 'clusters' },
  'opinions-cited': { citing_opinion_id: 'opinions', cited_opinion_id: 'opinions' },
  search_opinioncluster_panel: { opinioncluster_id: 'clusters', person_id: 'people' },
  search_opinion_joined_by: { opinion_id: 'opinions', person_id: 'people' },
  parentheticals: { described_opinion_id: 'opinions', describing_opinion_id: 'opinions' },
  'unmatched-citations': { citing_opinion_id: 'opinions' },
};
const edges = new Map(), files = [];
function retain(row, field, toType, id, resourceUrl = null) {
  if (!/^\d+$/.test(String(id ?? '')) || String(id) === '0') throw new Error(`Invalid native ID in ${row.entity_type}.${field}`);
  const edge = { source_system: row.source_system, from_type: row.entity_type, from_id: String(row.native_id), field, to_type: toType, to_id: String(id), evidence_sha256: row.provenance.record_sha256, inferred: false, ...(resourceUrl ? { resource_url: resourceUrl } : {}) };
  const key = JSON.stringify([edge.source_system, edge.from_type, edge.from_id, edge.field, edge.to_type, edge.to_id, edge.evidence_sha256]);
  edges.set(key, edge);
}
for (const job of jobs) {
  const manifest = job.manifest;
  if (!manifest.input || manifest.input.endsWith('.part')) throw new Error('Only complete source files can generate relationships.');
  const sha = createHash('sha256'), stream = createReadStream(manifest.input);
  stream.on('data', bytes => sha.update(bytes));
  let records = 0, relevant = 0;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line); records++;
    if (row.source_system !== 'courtlistener' || !fields[row.entity_type]) continue;
    if (String(row.data.id) !== String(row.native_id) || !/^[a-f0-9]{64}$/.test(row.provenance?.record_sha256 ?? '')) throw new Error('Native relationship source identity or hash mismatch.');
    relevant++;
    for (const [field, type] of Object.entries(fields[row.entity_type])) {
      const id = row.data[field];
      if (id !== null && id !== undefined && id !== '') retain(row, field, type, id);
    }
    if (row.entity_type === 'clusters' && row.data.sub_opinions !== undefined) {
      if (!Array.isArray(row.data.sub_opinions)) throw new Error('Native sub_opinions must be an array.');
      for (const uri of row.data.sub_opinions) {
        const url = new URL(uri);
        const id = url.pathname.match(/^\/api\/rest\/v4\/opinions\/(\d+)\/$/)?.[1];
        if (url.origin !== 'https://www.courtlistener.com' || url.search || url.hash || !id) throw new Error('Unexpected native opinion resource URL.');
        retain(row, 'sub_opinions', 'opinions', id, uri);
      }
    }
  }
  const actual = sha.digest('hex');
  if (actual !== manifest.inputSha256 || records !== manifest.records) throw new Error(`Input receipt mismatch for ${job.name}`);
  files.push({ job: job.name, source_sha256: actual, records, relevant_records: relevant });
}
const rows = [...edges.values()];
const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
await writeFile(join(output, 'native-relations.jsonl'), jsonl);
const manifest = { schema_version: 'corpus-native-relations/1', run_id: args.run, files, relations: rows.length, relations_sha256: hash(jsonl), metadata_only: true, source_scope_complete: false, pdf_downloads: 0, semantics: 'Exact source foreign keys. Relation records preserve citing/cited direction; unresolved opinion endpoints remain retained. Source cluster IDs are never opinion IDs.', batches: [] };
for (let offset = 0; offset < rows.length; offset += 2000) {
  const batch = rows.slice(offset, offset + 2000), payload = JSON.stringify(batch), delimiter = `$native_${hash(payload).slice(0, 16)}$`;
  if (payload.includes(delimiter)) throw new Error('SQL delimiter collision.');
  const query = `with source as (select * from jsonb_to_recordset(${delimiter}${payload}${delimiter}::jsonb) as x(source_system text,from_type text,from_id text,field text,to_type text,to_id text,evidence_sha256 text,inferred boolean,resource_url text)), verified as materialized (select x.* from source x join corpus_ingest.entity_versions v on v.source_system=x.source_system and v.entity_type=x.from_type and v.native_id=x.from_id and v.payload_sha256=x.evidence_sha256 where (x.resource_url is null and v.data->>x.field=x.to_id) or (x.resource_url is not null and (case when jsonb_typeof(v.data->x.field)='array' then v.data->x.field else '[]'::jsonb end) @> jsonb_build_array(x.resource_url))), guard as materialized (select 1/(case when (select count(*) from verified)=${batch.length} then 1 else 0 end) as ok), written as (insert into corpus_ingest.relationships(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,inferred,target_present,run_id) select v.source_system,v.from_type,v.from_id,v.field,v.to_type,v.to_id,v.evidence_sha256,false,exists(select 1 from corpus_ingest.entities e where e.source_system=v.source_system and e.entity_type=v.to_type and e.native_id=v.to_id),'${args.run}'::uuid from verified v cross join guard g where g.ok=1 on conflict(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256) do update set target_present=excluded.target_present,run_id=excluded.run_id returning target_present) select jsonb_build_object('received',${batch.length},'relationships_written',count(*),'targets_present',count(*) filter(where target_present),'targets_unresolved',count(*) filter(where not target_present)) as result from written;\n`;
  const name = `batch-${String(manifest.batches.length).padStart(5, '0')}.sql`;
  await writeFile(join(output, name), query);
  manifest.batches.push({ name, records: batch.length, bytes: Buffer.byteLength(query), sha256: hash(query) });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ manifest: join(output, 'manifest.json'), relations: rows.length, batches: manifest.batches.length, sha256: manifest.relations_sha256 }));
