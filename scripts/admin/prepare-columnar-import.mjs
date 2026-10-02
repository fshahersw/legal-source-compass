/** Lossless metadata transport: native values, nulls, empty strings and provenance survive.
 * Uniform column names and source provenance are sent once per batch, with verified round trips.
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';

const args=Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:[]).filter(p=>p.length));
if(!args.run||!/^[0-9a-f-]{36}$/i.test(args.run)||!args.input||!args.output||args.input.endsWith('.part'))throw Error('Require --run UUID --input completed.jsonl --output private-directory');
const skip=Number(args['skip-records']??0);
if(!Number.isSafeInteger(skip)||skip<0)throw Error('Invalid verified prefix length');
const output=resolve(args.output);await mkdir(output,{recursive:true});
const hash=s=>createHash('sha256').update(s).digest('hex');
const manifest={schemaVersion:'corpus-columnar-batches/1',runId:args.run,input:resolve(args.input),inputSha256:null,skipRecords:skip,sourceRecords:0,records:0,roundTripsVerified:0,metadataOnly:true,batches:[]};
let template,packed=[],bytes=0;
const commonKeys=['source_url','source_as_of','retrieved_at','source_sha256','http_status'];
async function flush(){
 if(!packed.length)return;
 const doc=JSON.stringify({...template,rows:packed}),delimiter=`$columnar_${hash(doc).slice(0,16)}$`;
 if(doc.includes(delimiter))throw Error('SQL delimiter collision');
 const query=`with source as(select ${delimiter}${doc}${delimiter}::jsonb doc),rows as(select jsonb_build_object('schema_version',doc->'schema_version','source_system',doc->'source_system','entity_type',doc->'entity_type','native_id',r->0,'data',(select jsonb_object_agg(k.key,(r->3)->(k.n::int-1)) from jsonb_array_elements_text(doc->'columns') with ordinality k(key,n)),'provenance',(doc->'common_provenance')||(r->2)||jsonb_build_object('record_sha256',r->1,'native_entity_type',doc->'entity_type')) envelope from source cross join lateral jsonb_array_elements(doc->'rows') r) select corpus_ingest.ingest_entities('${args.run}'::uuid,(select jsonb_agg(envelope) from rows)) as result;\n`;
 const name=`batch-${String(manifest.batches.length).padStart(5,'0')}.sql`;
 await writeFile(join(output,name),query);manifest.batches.push({name,records:packed.length,bytes:Buffer.byteLength(query),sha256:hash(query)});
 manifest.records+=packed.length;packed=[];bytes=Buffer.byteLength(JSON.stringify(template))+1200;
}
const input=createReadStream(args.input),inputHash=createHash('sha256');input.on('data',b=>inputHash.update(b));
for await(const line of createInterface({input,crlfDelay:Infinity})){
 if(!line.trim())continue;
 const r=JSON.parse(line);manifest.sourceRecords++;
 if(!r.native_id||!r.source_system||!r.entity_type||!r.schema_version||!r.data||Array.isArray(r.data)||!/^[0-9a-f]{64}$/.test(r.provenance?.record_sha256??'')||!/^https?:\/\//.test(r.provenance?.source_url??''))throw Error('Invalid source contract');
 if(!template){template={schema_version:r.schema_version,source_system:r.source_system,entity_type:r.entity_type,columns:Object.keys(r.data),common_provenance:Object.fromEntries(commonKeys.filter(k=>Object.hasOwn(r.provenance,k)).map(k=>[k,r.provenance[k]]))};bytes=Buffer.byteLength(JSON.stringify(template))+1200;}
 if(r.schema_version!==template.schema_version||r.source_system!==template.source_system||r.entity_type!==template.entity_type||!isDeepStrictEqual(Object.keys(r.data),template.columns))throw Error('Mixed schema requires separate batches');
 const rest={...r.provenance};delete rest.record_sha256;
 for(const [k,v]of Object.entries(template.common_provenance)){if(!Object.hasOwn(rest,k))throw Error('Missing common provenance field');if(isDeepStrictEqual(rest[k],v))delete rest[k];}
 const row=[r.native_id,r.provenance.record_sha256,rest,template.columns.map(k=>r.data[k])];
 const decoded={...r,data:Object.fromEntries(template.columns.map((k,i)=>[k,row[3][i]])),provenance:{...template.common_provenance,...row[2],record_sha256:row[1]}};
 if(!isDeepStrictEqual(decoded,r))throw Error('Lossless source round trip failed');manifest.roundTripsVerified++;
 if(manifest.sourceRecords<=skip)continue;
 const size=Buffer.byteLength(JSON.stringify(row))+1;
 if(size>1550000)throw Error('Oversized native record requires separate reviewed transport');
 if(packed.length&&(bytes+size>1550000||packed.length>=10000))await flush();packed.push(row);bytes+=size;
}
await flush();if(skip>manifest.sourceRecords)throw Error('Prefix exceeds source');manifest.inputSha256=inputHash.digest('hex');await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({manifest:join(output,'manifest.json'),records:manifest.records,sourceRecords:manifest.sourceRecords,batches:manifest.batches.length,roundTripsVerified:manifest.roundTripsVerified,inputSha256:manifest.inputSha256}));
