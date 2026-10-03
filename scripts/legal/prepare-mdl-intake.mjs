import fs from 'node:fs';
import crypto from 'node:crypto';
import { mdlPacket } from '../../src/lib/legal/packets.ts';
import { recordKey } from '../../src/lib/legal/schema.ts';
const packet = mdlPacket.parse(JSON.parse(fs.readFileSync('src/lib/legal/mdl2738.server.json', 'utf8')));
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows = packet.records.map(record => ({ key: hash(record), record_key: JSON.parse(recordKey(record)), record }));
const edges = packet.edges.map(edge => ({ key: hash(edge), from_key: JSON.parse(recordKey(edge.from)), to_key: JSON.parse(recordKey(edge.to)), source_key: JSON.parse(recordKey(edge.source_record)), edge }));
const packetHash = hash(packet);
const originals = new Set(packet.records.map(r => r.source_url));
for (const record of packet.records) if (record.attributes.service_source_url) originals.add(record.attributes.service_source_url);
// Replaying this packet reuses its run rather than implying another acquisition.
const run = `${packetHash.slice(0, 8)}-${packetHash.slice(8, 12)}-${packetHash.slice(12, 16)}-${packetHash.slice(16, 20)}-${packetHash.slice(20, 32)}`;
const data = { rows, edges }; const json = JSON.stringify(data); const tag = `$legal_${hash(data)}$`;
if (json.includes(tag)) throw Error('SQL transport delimiter collision');
const sql = `begin;
do $intake$
declare batch jsonb := ${tag}${json}${tag}::jsonb; r jsonb;
begin
  insert into legal_atlas.ingest_runs(run_id,schema_version,source_manifest,status,finished_at,original_source_checks)
  values('${run}','legal-atlas/3.1',jsonb_build_object('scope','MDL-2738 reviewed official source packet','packet_sha256','${packetHash}','complete',false),'awaiting_audit',now(),${originals.size})
  on conflict(run_id) do nothing;
  if exists(select 1 from legal_atlas.ingest_runs where run_id='${run}' and source_manifest->>'packet_sha256'<>'${packetHash}') then raise exception 'Run identity collision'; end if;
  for r in select value from jsonb_array_elements(batch->'rows') loop
    if cardinality(legal_atlas.record_errors(r->'record'))>0 then raise exception 'Schema rejection: %',legal_atlas.record_errors(r->'record'); end if;
    if exists(select 1 from legal_atlas.staging where input_key=r->>'key' and source_record<>r->'record') then raise exception 'Retained source collision'; end if;
    if exists(select 1 from legal_atlas.records where record_key=r->'record_key' and payload<>r->'record') then raise exception 'Canonical version conflict'; end if;
    insert into legal_atlas.staging(input_key,run_id,source_name,source_year,source_record,candidate_records,schema_errors)
    values(r->>'key','${run}',r->'record'->>'source_name',case when r->'record'->>'date_type'<>'retrieved' then left(r->'record'->>'date',4)::integer end,r->'record',jsonb_build_array(r->'record'),'[]') on conflict(input_key) do nothing;
    insert into legal_atlas.records(record_key,input_key,type,id,version,payload,review_status)
    values(r->'record_key',r->>'key',(r->'record'->>'type')::legal_atlas.entity_type,r->'record'->>'id',r->'record'->>'version',r->'record','approved') on conflict(record_key) do nothing;
  end loop;
  for r in select value from jsonb_array_elements(batch->'edges') loop
    insert into legal_atlas.edges(edge_key,type,from_key,to_key,source_key,from_type,to_type,extraction_method,confidence,review_status,treatment,role,source_url,source_date,evidence)
    values(r->>'key',(r->'edge'->>'type')::legal_atlas.edge_type,r->'from_key',r->'to_key',r->'source_key',
      (r->'edge'->'from'->>'type')::legal_atlas.entity_type,(r->'edge'->'to'->>'type')::legal_atlas.entity_type,
      (r->'edge'->>'extraction_method')::legal_atlas.edge_method,(r->'edge'->>'confidence')::numeric,'approved',
      (r->'edge'->>'treatment')::legal_atlas.treatment,(r->'edge'->>'role')::legal_atlas.counsel_role,
      r->'edge'->>'source_url',(r->'edge'->>'date')::date,r->'edge'->'evidence') on conflict(edge_key) do nothing;
    if not exists(select 1 from legal_atlas.visible_edges where edge_key=r->>'key') then raise exception 'Reviewed packet edge is not visible'; end if;
  end loop;
end;
$intake$;
commit;
select jsonb_build_object('run_id','${run}','packet_sha256','${packetHash}','records',(select count(*) from legal_atlas.records where input_key in (select input_key from legal_atlas.staging where run_id='${run}')),'visible_edges',(select count(*) from legal_atlas.visible_edges),'complete',false) as receipt;
`;
fs.writeFileSync(process.argv[2], sql);
console.log(JSON.stringify({ run_id: run, records: rows.length, edges: edges.length, packet_sha256: packetHash, prepared_file: process.argv[2] }));
