import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// The input is a retained publisher inventory, not guessed filenames.
const [inventoryPath, destination, ...wanted] = process.argv.slice(2);
if(!inventoryPath||!destination||!wanted.length)throw Error('Usage: acquire-bulk.mjs INVENTORY DESTINATION TYPE...');
const inventory=JSON.parse(fs.readFileSync(inventoryPath,'utf8'));
const sources=(inventory.datasets??inventory).filter(x=>wanted.includes(x.type));
if(sources.length!==new Set(wanted).size)throw Error('Requested archive missing or duplicated in retained publisher inventory');
await fsp.mkdir(destination,{recursive:true});
const capturesPath=path.join(destination,'acquisitions.json');
const journal=fs.existsSync(capturesPath)?JSON.parse(fs.readFileSync(capturesPath,'utf8')):{schema_version:'round3-acquisitions/1',captures:[]};
const save=()=>{fs.writeFileSync(capturesPath+'.tmp',JSON.stringify(journal,null,2));fs.renameSync(capturesPath+'.tmp',capturesPath);};
async function digest(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
for(const source of sources){
 const url=new URL(source.source_url??source.url); const bytes=source.compressed_bytes??source.bytes;
 if(url.origin!=='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com'||!/^\/bulk-data\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2}\.csv\.bz2$/.test(url.pathname)||!Number.isSafeInteger(bytes)||bytes<1)throw Error('Invalid official archive descriptor');
 const target=path.join(destination,path.basename(url.pathname));const part=target+'.part';const old=journal.captures.find(x=>x.url===url.href);
 if(old?.complete&&fs.existsSync(target)){if(fs.statSync(target).size!==bytes||await digest(target)!==old.sha256)throw Error('Retained archive checksum mismatch');console.log(JSON.stringify({type:source.type,status:'verified-cache'}));continue;}
 const free=await fsp.statfs(destination);const existing=fs.existsSync(part)?fs.statSync(part).size:0;
 if(free.bavail*free.bsize<bytes-existing+5_000_000_000)throw Error(`Insufficient archive space for ${source.type}; ${bytes-existing+5_000_000_000} bytes including reserve required`);
 const offset=old?.etag&&existing<bytes?existing:0;
 const response=await fetch(url,{headers:offset?{Range:`bytes=${offset}-`,'If-Range':old.etag}:{},redirect:'error',signal:AbortSignal.timeout(60*60*1000)});
 if(!response.ok)throw Error(`Archive HTTP ${response.status}`);
 const etag=response.headers.get('etag');const publisherEtag=source.source_etag??null;
 if(publisherEtag&&etag!==publisherEtag)throw Error('Publisher archive changed since inventory; refresh and review inventory');
 const append=offset>0&&response.status===206;
 if(append&&response.headers.get('content-range')!==`bytes ${offset}-${bytes-1}/${bytes}`)throw Error('Archive range does not match the retained partial');
 if(!append&&response.status!==200)throw Error('Unexpected archive response');
 const capture={type:source.type,url:url.href,bytes,etag,retrieved_at:new Date().toISOString(),complete:false,path:target,sha256:null};
 journal.captures=journal.captures.filter(x=>x.url!==url.href).concat(capture);save();
 let received=append?offset:0,last=Date.now();const stream=Readable.fromWeb(response.body);
 stream.on('data',chunk=>{received+=chunk.length;if(Date.now()-last>15000){last=Date.now();console.log(JSON.stringify({type:source.type,bytes_received:received,bytes_total:bytes}));}});
 await pipeline(stream,fs.createWriteStream(part,{flags:append?'a':'w'}));
 if(fs.statSync(part).size!==bytes)throw Error('Archive byte count mismatch');
 capture.sha256=await digest(part);await fsp.rename(part,target);capture.complete=true;capture.finished_at=new Date().toISOString();save();
 console.log(JSON.stringify({type:source.type,status:'acquired',bytes,sha256:capture.sha256}));
}
