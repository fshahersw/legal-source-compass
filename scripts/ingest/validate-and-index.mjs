import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { DEFAULT_CACHE } from './courtlistener-client.mjs';

// Validation/indexing is offline. It never requests a source or changes originals.
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const cache=path.resolve(args.cache??DEFAULT_CACHE);
const directory=path.resolve(args.directory??path.join(cache,'live-normalized'));
const receipt=path.resolve(args.receipt??path.join(cache,'live-file-receipts.json'));
const files=(await fs.readdir(directory)).filter(x=>x.endsWith('.jsonl')).sort();
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceCounts=new Map();
const summaries=[];
let total=0;
for(const filename of files){
 const source=path.join(directory,filename);const records=new Map();const sources=new Set();
 const hash=createHash('sha256');let bytes=0;let rows=0;let oldest=null;let newest=null;
 const input=createReadStream(source);
 input.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});
 const reader=readline.createInterface({input,crlfDelay:Infinity});
 for await(const line of reader){
  if(!line.trim())continue;
  const record=JSON.parse(line);rows++;
  if(!record.native_id||!record.entity_type||!record.source_system||!record.schema_version)throw new Error(`${filename}:${rows} identity missing`);
  if(record.data.id!==undefined&&String(record.data.id)!==record.native_id)throw new Error(`${filename}:${rows} native identity mismatch`);
  const provenance=record.provenance;
  if(!/^[a-f0-9]{64}$/.test(provenance?.record_sha256??'')||!/^[a-f0-9]{64}$/.test(provenance?.source_sha256??''))throw new Error(`${filename}:${rows} SHA-256 missing`);
  const sourceUrl=new URL(provenance.source_url);
  if(sourceUrl.protocol!=='https:'||sourceUrl.username||sourceUrl.password)throw new Error(`${filename}:${rows} invalid source URL`);
  if(!Number.isFinite(Date.parse(provenance.retrieved_at)))throw new Error(`${filename}:${rows} retrieval date missing`);
  const canonicalSorted=record.schema_version.startsWith('courtlistener-bulk/')||record.schema_version.startsWith('courtlistener-native-fk/');
  const data=canonicalSorted?Object.fromEntries(Object.entries(record.data).sort(([a],[b])=>a<b?-1:a>b?1:0)):record.data;
  if(digest(JSON.stringify(data))!==provenance.record_sha256)throw new Error(`${filename}:${rows} record hash mismatch`);
  const identity=`${record.source_system}/${record.entity_type}/${record.native_id}`;
  if(!records.has(identity))records.set(identity,new Set());records.get(identity).add(provenance.record_sha256);
  sources.add(provenance.source_url);sourceCounts.set(sourceUrl.hostname,(sourceCounts.get(sourceUrl.hostname)??0)+1);
  oldest=oldest===null||provenance.retrieved_at<oldest?provenance.retrieved_at:oldest;
  newest=newest===null||provenance.retrieved_at>newest?provenance.retrieved_at:newest;
  if(record.entity_type==='recap-documents'&&!Number.isInteger(record.data.docket_id))throw new Error(`${filename}:${rows} native containing docket relation missing`);
 }
 const versions=[...records.values()].reduce((sum,set)=>sum+set.size,0);
 const summary={path:source,observations:rows,distinct_native_ids:records.size,distinct_native_versions:versions,source_urls:sources.size,bytes,sha256:hash.digest('hex'),earliest_retrieved_at:oldest,latest_retrieved_at:newest,record_hashes_verified:true,complete_file:true,pdf_downloads:0};
 summaries.push(summary);total+=rows;
 console.log(JSON.stringify({file:filename,observations:rows,distinct_native_ids:records.size,bytes,sha256:summary.sha256}));
}
const scopes=JSON.parse(await fs.readFile(path.join(cache,'live-backfill-manifest.json'),'utf8').catch(()=>'{"scopes":{}}'));
const scopeSummary=Object.entries(scopes.scopes).map(([scope,value])=>({scope,...value}));
const result={schema_version:'metadata-file-receipts/1',validated_at:new Date().toISOString(),files:summaries,total_observations:total,source_host_observations:Object.fromEntries(sourceCounts),scopes:scopeSummary,complete_files:true,complete_all_requested_scopes:scopeSummary.every(x=>x.complete===true),pdf_downloads:0,privacy:'private admin import; public projection requires structural and privacy review'};
await fs.writeFile(receipt,JSON.stringify(result,null,2));
console.log(JSON.stringify({receipt,total_observations:total,complete_all_requested_scopes:result.complete_all_requested_scopes,pdf_downloads:0}));
