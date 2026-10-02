import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const out = path.resolve(process.argv[2] ?? '../audit/2026-10-02/metadata');
const origin = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/';
await fs.mkdir(path.join(out, 'bulk'), { recursive: true });
const files = [];
let token;
do {
  const url = new URL(origin); url.searchParams.set('list-type','2'); url.searchParams.set('prefix','bulk-data/'); url.searchParams.set('max-keys','1000');
  if (token) url.searchParams.set('continuation-token', token);
  const response = await fetch(url, { redirect:'error', signal:AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`S3 index ${response.status}`);
  const xml = await response.text();
  for (const m of xml.matchAll(/<Contents>(.*?)<\/Contents>/g)) files.push({ key: m[1].match(/<Key>(.*?)<\/Key>/)[1], bytes: Number(m[1].match(/<Size>(.*?)<\/Size>/)[1]), lastModified:m[1].match(/<LastModified>(.*?)<\/LastModified>/)[1] });
  token = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1]?.replaceAll('&amp;','&');
} while(token);
const latest = new Map();
for (const f of files) {
  const match = f.key.match(/^bulk-data\/(.*)-(\d{4}-\d{2}-\d{2})\.(.*)$/);
  if (match && (!latest.has(match[1]) || match[2] > latest.get(match[1]).snapshot)) latest.set(match[1], { ...f, type:match[1], snapshot:match[2], url:new URL(f.key, origin).href });
}
const inventory = [...latest.values()];
await fs.writeFile(path.join(out,'bulk-inventory.json'), JSON.stringify(inventory,null,2));
const wanted = inventory.filter(f => /^(courts|court-appeals-to|courthouses|people-db-|people_db_|schema|load-bulk-data)/.test(f.type) && f.bytes < 20_000_000);
const captures = [];
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<wanted.length){
    const item=wanted[cursor++]; const dest=path.join(out,'bulk',path.basename(item.key));
    const existing=await fs.stat(dest).catch(()=>null);
    if(!existing || existing.size!==item.bytes){
      const response=await fetch(item.url,{redirect:'error',signal:AbortSignal.timeout(120_000)});
      if(!response.ok) throw new Error(`${item.type} ${response.status}`);
      await pipeline(Readable.fromWeb(response.body),createWriteStream(`${dest}.part`));
      const stat=await fs.stat(`${dest}.part`);if(stat.size!==item.bytes)throw new Error(`${item.type} byte mismatch`);
      await fs.rename(`${dest}.part`,dest);
    }
    const bytes=await fs.readFile(dest);
    const capture={...item,path:dest,retrievedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),httpStatus:200};
    captures.push(capture);console.log(JSON.stringify({type:item.type,snapshot:item.snapshot,bytes:item.bytes}));
  }
}));
captures.sort((a,b)=>a.type.localeCompare(b.type));
await fs.writeFile(path.join(out,'bulk-captures.json'),JSON.stringify(captures,null,2));
console.log(JSON.stringify({captures:captures.length,totalBytes:captures.reduce((a,b)=>a+b.bytes,0),out}));
