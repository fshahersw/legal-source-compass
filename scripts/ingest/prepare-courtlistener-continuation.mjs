/** Seed cursor/quota support in a fresh cache without rewriting any original captures. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifiedNativeDocketHeader, sourceDocketAllowsRelations } from './metadata-workflow.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
if(!args.previous||!args.headers||!args.output)throw new Error('Require previous pass, original header JSONL and fresh output directory');
const previous=path.resolve(args.previous),output=path.resolve(args.output);
if(previous===output)throw new Error('Continuation must use a distinct directory');
await fs.mkdir(output,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(previous,'cumulative-master-scope-manifest.json'),'utf8'));
const support=Buffer.from(await fs.readFile(args.headers));
const headers=new Map();
for(const line of support.toString('utf8').split(/\r?\n/).filter(Boolean)) {
 const record=JSON.parse(line);headers.set(record.native_id,verifiedNativeDocketHeader(record));
}
if(!args.ledger)throw new Error('Require explicit global quota ledger support');
const ledger=await fs.readFile(path.resolve(args.ledger));
for(const [name,bytes]of[
 ['live-backfill-manifest.json',Buffer.from(JSON.stringify({...manifest,continuation_started_at:new Date().toISOString(),run_status:'prepared'},null,2))],
 ['master-scope-counts.json',await fs.readFile(path.join(previous,'master-scope-counts.json'))],
 ['source-docket-headers.jsonl',support],['rate-ledger.json',ledger],
])await fs.writeFile(path.join(output,name),bytes,{flag:'wx'});
await fs.writeFile(path.join(output,'continuation-support-receipt.json'),JSON.stringify({schema_version:'courtlistener-continuation-support/1',originals_preserved:true,previous_pass:previous,header_support_sha256:createHash('sha256').update(support).digest('hex'),verified_native_headers:headers.size,source_unblocked_native_headers:[...headers.values()].filter(sourceDocketAllowsRelations).length,header_identity_and_payload_hashes_verified:true,quota_timestamps:JSON.parse(ledger).timestamps.length,pdf_downloads:0},null,2),{flag:'wx'});
console.log(JSON.stringify({output,scope_count:Object.keys(manifest.scopes).length,pdf_downloads:0}));
