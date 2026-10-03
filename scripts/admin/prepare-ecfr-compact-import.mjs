/** Lossless eCFR transport: send title/source constants once, preserving native hashes. */
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:[]).filter(x=>x.length));
if(!/^[0-9a-f-]{36}$/.test(args.run??'')||!args.input||!args.output)throw Error('Require --run UUID --input verified hierarchy JSONL --output private-directory');
const skip=Number(args['skip-records']??0);if(!Number.isSafeInteger(skip)||skip<0)throw Error('Invalid verified prefix');
await fs.mkdir(args.output,{recursive:true});const hash=x=>createHash('sha256').update(x).digest('hex');
const manifest={schema_version:'ecfr-lossless-compact-batches/1',run_id:args.run,skip_records:skip,input_sha256:null,source_records:0,records:0,round_trips_verified:0,batches:[]};
let template,rows=[],bytes=0;
function unpack(t,r){const n=r[2];return {title_number:t.title_number,title_name:t.title_name,node_type:n.type,node_identifier:n.identifier,heading:n.label??null,reserved:n.reserved??null,parent_native_id:r[0].includes('/')?r[0].slice(0,r[0].lastIndexOf('/')):null,child_native_ids:r[3],unidentified_headings:r[4],snapshot_as_of:t.snapshot_as_of,title_latest_amended_on:t.title_latest_amended_on,title_latest_issue_date:t.title_latest_issue_date,source_node:n};}
async function flush(){if(!rows.length)return;const doc=JSON.stringify({...template,rows}),delimiter=`$ecfr_${hash(doc).slice(0,16)}$`;if(doc.includes(delimiter))throw Error('Delimiter collision');
const query=`with source as(select ${delimiter}${doc}${delimiter}::jsonb doc),rows as(select jsonb_build_object('schema_version','ecfr-hierarchy-metadata/1','source_system','ecfr','entity_type','hierarchy-nodes','native_id',r->0,'data',jsonb_build_object('title_number',doc->'title_number','title_name',doc->'title_name','node_type',r->2->'type','node_identifier',r->2->'identifier','heading',r->2->'label','reserved',r->2->'reserved','parent_native_id',case when r->>0 like '%/%' then to_jsonb(regexp_replace(r->>0,'/[^/]+$','')) else 'null'::jsonb end,'child_native_ids',r->3,'unidentified_headings',r->4,'snapshot_as_of',doc->'snapshot_as_of','title_latest_amended_on',doc->'title_latest_amended_on','title_latest_issue_date',doc->'title_latest_issue_date','source_node',r->2),'provenance',doc->'common_provenance'||jsonb_build_object('record_sha256',r->1))envelope from source cross join lateral jsonb_array_elements(doc->'rows')r)select corpus_ingest.ingest_entities('${args.run}'::uuid,(select jsonb_agg(envelope)from rows))result;\n`;
const name=`batch-${String(manifest.batches.length).padStart(5,'0')}.sql`;await fs.writeFile(path.join(args.output,name),query);manifest.batches.push({name,records:rows.length,bytes:Buffer.byteLength(query),sha256:hash(query)});manifest.records+=rows.length;rows=[];bytes=0;}
const stream=createReadStream(args.input),inputHash=createHash('sha256');stream.on('data',b=>inputHash.update(b));
for await(const line of createInterface({input:stream,crlfDelay:Infinity})){if(!line.trim())continue;const e=JSON.parse(line);manifest.source_records++;if(e.schema_version!=='ecfr-hierarchy-metadata/1'||e.source_system!=='ecfr'||e.entity_type!=='hierarchy-nodes'||!/^[0-9a-f]{64}$/.test(e.provenance?.record_sha256??''))throw Error('Unexpected native envelope');
const d=e.data,provenance={...e.provenance};delete provenance.record_sha256;const t={title_number:d.title_number,title_name:d.title_name,snapshot_as_of:d.snapshot_as_of,title_latest_amended_on:d.title_latest_amended_on,title_latest_issue_date:d.title_latest_issue_date,common_provenance:provenance};
if(template&&!isDeepStrictEqual(template,t))await flush();template=t;
const r=[e.native_id,e.provenance.record_sha256,d.source_node,d.child_native_ids,d.unidentified_headings];if(!isDeepStrictEqual(unpack(t,r),d))throw Error('Lossless source round trip mismatch');manifest.round_trips_verified++;if(manifest.source_records<=skip)continue;
const size=Buffer.byteLength(JSON.stringify(r))+1;if(size>700000)throw Error('Oversized native node requires reviewed transport');if(rows.length&&(bytes+size>700000||rows.length>=10000))await flush();rows.push(r);bytes+=size;}
await flush();manifest.input_sha256=inputHash.digest('hex');await fs.writeFile(path.join(args.output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({records:manifest.records,batches:manifest.batches.length,source_records:manifest.source_records,round_trips_verified:manifest.round_trips_verified,input_sha256:manifest.input_sha256}));
