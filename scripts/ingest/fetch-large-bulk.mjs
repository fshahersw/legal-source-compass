import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { DEFAULT_CACHE } from './courtlistener-client.mjs';

const wanted=new Set(process.argv.slice(2).length?process.argv.slice(2):['citations','citation-map','fjc-integrated-database','dockets']);
const approvedMetadata=new Set(['citations','citation-map','fjc-integrated-database','dockets','opinion-clusters','originating-court-information','search_opinion_joined_by','search_opinioncluster_non_participating_judges','search_opinioncluster_panel','parentheticals','unmatched-citations']);
if([...wanted].some(type=>!approvedMetadata.has(type)))throw new Error('Only explicitly approved metadata snapshots may be downloaded by this job');
const inventory=JSON.parse(await fs.readFile(path.join(DEFAULT_CACHE,'bulk-inventory.json'),'utf8')).filter(x=>wanted.has(x.type));
if(inventory.length!==wanted.size)throw new Error('Requested bulk type missing from publisher inventory');
for(const item of inventory){
 const url=new URL(item.url);
 if(url.origin!=='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com'||!url.pathname.startsWith('/bulk-data/')||!url.pathname.endsWith('.csv.bz2'))throw new Error('Refusing a non-publisher metadata URL');
}
const directory=path.resolve('C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30');await fs.mkdir(directory,{recursive:true});
const disk=await fs.statfs(directory);const free=disk.bavail*disk.bsize;const required=inventory.reduce((a,b)=>a+b.bytes,0);
if(free<required+15_000_000_000)throw new Error('Insufficient disk reserve for metadata cache');
console.log(JSON.stringify({event:'disk_check',freeBytes:free,maximumDownloadBytes:required,directory}));
const manifestPath=path.join(directory,'download-manifest.json');
let manifest=JSON.parse(await fs.readFile(manifestPath,'utf8').catch(()=>'{"schema_version":"courtlistener-bulk-download/1","captures":[]}'));
let queue=Promise.resolve();const save=()=>{const text=JSON.stringify(manifest,null,2);queue=queue.then(()=>fs.writeFile(manifestPath,text));return queue;};
async function digest(filename){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
let cursor=0;
await Promise.allSettled(Array.from({length:3},async()=>{
 while(cursor<inventory.length){
  const item=inventory[cursor++];const filename=path.join(directory,path.basename(item.key));const part=`${filename}.part`;
  try{
   const existing=await fs.stat(filename).catch(()=>null);
   const previous=manifest.captures.find(x=>x.type===item.type&&x.status==='downloaded'&&x.url===item.url);
   if(existing?.size===item.bytes&&previous){
    const actual=await digest(filename);
    if(actual!==previous.sha256)throw new Error('Existing snapshot checksum differs from its original receipt');
    // Preserve actual original HTTP/retrieval provenance on an offline cache hit.
    console.log(JSON.stringify({event:'verified_cached',type:item.type,bytes:item.bytes,sha256:actual,path:filename}));continue;
   }
   let lastModified=null,etag=null;
   {
    const incomplete=await fs.stat(part).catch(()=>null);const offset=incomplete?.size??0;
    if(offset>item.bytes)throw new Error('Partial download larger than publisher inventory');
    const response=await fetch(item.url,{headers:offset?{Range:`bytes=${offset}-`}:{},redirect:'error',signal:AbortSignal.timeout(3_600_000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    let flags='w';
    if(offset&&response.status===206){const range=response.headers.get('content-range');if(!range?.startsWith(`bytes ${offset}-`)||!range.endsWith(`/${item.bytes}`))throw new Error('Range mismatch');flags='a';}
    else if(response.status!==200)throw new Error(`Unexpected bulk HTTP ${response.status}`);
    lastModified=response.headers.get('last-modified');etag=response.headers.get('etag');
    let received=flags==='a'?offset:0;let lastProgress=Date.now();
    const source=Readable.fromWeb(response.body);source.on('data',chunk=>{received+=chunk.length;if(Date.now()-lastProgress>15_000){lastProgress=Date.now();console.log(JSON.stringify({type:item.type,receivedBytes:received,totalBytes:item.bytes,percent:Math.floor(received/item.bytes*100)}));}});
    await pipeline(source,createWriteStream(part,{flags}));
    const stat=await fs.stat(part);if(stat.size!==item.bytes)throw new Error(`Size mismatch ${stat.size}/${item.bytes}`);await fs.rename(part,filename);
   }
   const capture={...item,path:filename,retrievedAt:new Date().toISOString(),httpStatus:200,sha256:await digest(filename),lastModified,etag,pdfDownloads:0,status:'downloaded'};
   manifest.captures=manifest.captures.filter(x=>x.type!==item.type).concat(capture);await save();console.log(JSON.stringify({event:'downloaded',type:item.type,bytes:item.bytes,sha256:capture.sha256,path:filename}));
  }catch(e){manifest.captures=manifest.captures.filter(x=>x.type!==item.type).concat({...item,status:'partial_or_failed',error:e.message,path:part});await save();console.log(JSON.stringify({event:'download_failed',type:item.type,error:e.message}));process.exitCode=1;}
 }
}));
await save();console.log(JSON.stringify({event:'download_batch_finished',captures:manifest.captures.map(x=>({type:x.type,status:x.status,bytes:x.bytes})),pdfDownloads:0}));
