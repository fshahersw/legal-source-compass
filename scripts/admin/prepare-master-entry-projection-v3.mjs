/** Prepare this dated continuation from the byte-pinned v1 contract. No DB/network.
 * The old contract/receipt is immutable. V3 explicitly holds the current dataset
 * while a larger snapshot is projected, then requires fresh full-field proof.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {reviewEntryPrivacy} from './master-entry-privacy.mjs';
import {verifiedNativeDocketHeader} from '../ingest/metadata-workflow.mjs';
const args=Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:[]).filter(x=>x.length));
if(!args.baseline||!args.prior||!args.continuation||!args.output)throw Error('Require --baseline --prior --continuation --output');
const baseline=path.resolve(args.baseline),prior=path.resolve(args.prior),pass=path.resolve(args.continuation),output=path.resolve(args.output);
const existing=await fs.readdir(output).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
if(existing.length)throw Error('Fresh v3 contract directory required; prepared and historical receipts are immutable');
const sha=b=>createHash('sha256').update(b).digest('hex'),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const run=await read(path.join(pass,'run.json')),audit=await read(path.join(pass,'capture-validation-receipt.json')),coverage=await read(path.join(pass,'live-cumulative-entry-scope-receipt.json'));
const validated=await read(path.join(pass,'live-import-validation.json'));
if(run.project_id!=='xosqzzsnhxcyehcnirpa'||run.id!==audit.run_id||validated.runId!==run.id||audit.capture_sha256_mismatches!==0||audit.capture_to_native_record_mismatches!==0||audit.native_relation_mismatches!==0||audit.pdf_downloads!==0||validated.observations!==19804||validated.batches!==49||coverage.total_native_entries!==24033||coverage.eligible_metadata_entries!==23919||coverage.complete_scope_count!==7||coverage.scope_count!==15)throw Error('Dated offline audit/count contract changed; independent review required');
const records=new Map(),headers=new Map();
for(const line of (await fs.readFile(path.join(pass,'source-docket-headers.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean)){const r=JSON.parse(line);headers.set(r.native_id,verifiedNativeDocketHeader(r));}
const compare=(a,b)=>Date.parse(b.provenance.retrieved_at)-Date.parse(a.provenance.retrieved_at)||Buffer.compare(Buffer.from(a.provenance.source_url),Buffer.from(b.provenance.source_url))||Buffer.compare(Buffer.from(a.provenance.record_sha256),Buffer.from(b.provenance.record_sha256));
for(const base of [baseline,prior,pass])for(const line of (await fs.readFile(path.join(base,'live-normalized/docket-entries.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean)){
 const r=JSON.parse(line);if(sha(JSON.stringify(r.data))!==r.provenance.record_sha256)throw Error('Native payload hash changed');const prev=records.get(r.native_id);if(!prev||compare(r,prev)<0)records.set(r.native_id,r);
}
let eligible=0,unsealed=0,blocked=0,sealed=0;
for(const r of records.values()){const u=new URL(r.data.docket),m=u.pathname.match(/^\/api\/rest\/v4\/dockets\/([0-9]+)\/$/);if(u.origin!=='https://www.courtlistener.com'||!m||u.search||u.hash)throw Error('Unexpected native docket');const p=reviewEntryPrivacy(r.data,headers.get(m[1]));blocked+=p.sourceBlocked;sealed+=p.explicitlySealed;if(p.eligible){eligible++;unsealed+=p.explicitUnsealedIds.length;}}
if(records.size!==24033||eligible!==23919||blocked!==40||sealed!==74)throw Error('Independent privacy totals changed');
const templatePath=new URL('./prepare-master-entry-projection.mjs',import.meta.url),bytes=await fs.readFile(templatePath);
// A template edit cannot silently change the reviewed v3 projection semantics.
const templateSha='ae2f62902e262963572d51218a4b31f25c39d3627cc5ab4de75ffe12877c7356';
if(sha(bytes)!==templateSha)throw Error('Pinned v1 source template changed; review v3 adaptation');
let code=bytes.toString('utf8');
const replace=(from,to)=>{if(!code.includes(from))throw Error('Missing reviewed template expression');code=code.replace(from,to);};
for(const file of ['master-entry-privacy.mjs','master-entry-facets.mjs'])replace(`'./${file}'`,JSON.stringify(pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,'')),file)).href));
replace("const run=await read(path.join(pass,'run.json')),verified=await read(path.join(pass,'private-independent-verification-receipt.json'));\nif(verified.run_id!==run.id||verified.native_edges!==73431||['storage_hash_mismatches','native_identity_mismatches','observation_provenance_errors','inferred_edges','edge_source_field_mismatches','target_presence_mismatches'].some(k=>verified[k]!==0))throw Error('Private intake has not passed independent verification');",`const run=await read(path.join(pass,'run.json'));\n// Prepared offline only. Root must import and pass private-verification.sql before execution.\nif(run.id!==${JSON.stringify(run.id)}||run.project_id!=='xosqzzsnhxcyehcnirpa')throw Error('Wrong dated continuation run');`);
replace('for(const base of [oldRoot,pass])','for(const base of [oldRoot,'+JSON.stringify(prior)+',pass])');
replace('sourceRuns:[run.scope.continuation_of,run.id]',"sourceRuns:['494cfa52-74c5-42ac-a770-80e46b9a3035',run.continuation_of,run.id]");
for(const [from,to]of [['15053','24033'],['14947','23919'],['66','74'],['3253',String(unsealed)]])code=code.replaceAll(new RegExp('\\b'+from+'\\b','g'),to);
code=code.replaceAll('courtlistener-master-entry-metadata-view/1','courtlistener-master-entry-metadata-view/3').replaceAll('project-master-entries-v1-','project-master-entries-v3-').replaceAll('master-entry-filter-facets-v1.json','master-entry-filter-facets-v3.json');
replace("'master-entry-privacy-review/1'","'master-entry-privacy-review/3'");
replace("'master-entry-filter-facets/1'","'master-entry-filter-facets/3'");
replace("const metadata={schema_version:version,",`const metadata={schema_version:version,prior_projection:{schema_version:'courtlistener-master-entry-metadata-view/1',source_native_entries:15053,eligible_entries:14947,source_signature_sha256:'3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1'},`);
replace('on conflict(id)do update set label=excluded.label,expected_records=excluded.expected_records,metadata=excluded.metadata,updated_at=now() where not public.corpus_datasets.ready and public.corpus_datasets.metadata->>\'schema_version\'=${esc(version)}',`on conflict(id)do update set label=excluded.label,ready=false,expected_records=excluded.expected_records,imported_records=0,metadata=excluded.metadata,updated_at=now() where (public.corpus_datasets.metadata->>'schema_version'='courtlistener-master-entry-metadata-view/1' and public.corpus_datasets.expected_records=14947 and public.corpus_datasets.metadata->>'source_signature_sha256'='3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1') or (not public.corpus_datasets.ready and public.corpus_datasets.metadata->>'schema_version'=\${esc(version)} and public.corpus_datasets.metadata->>'source_signature_sha256'='\${frozenSignature}')`);
code=code.replace('no implicit publication.','no implicit publication. V3 registration deliberately holds the prior verified current dataset. Execute only after the new private intake and native graph pass independent verification.');
const generatedDir=path.join(pass,'projection-generator-v3');await fs.mkdir(generatedDir,{recursive:true});const generated=path.join(generatedDir,'prepare-v3.generated.mjs');await fs.writeFile(generated,code);
const result=spawnSync(process.execPath,[generated,'--baseline',baseline,'--continuation',pass,'--output',output],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr||result.stdout);process.stdout.write(result.stdout);
const review=await read(path.join(output,'master-entry-privacy-review.json'));
if(review.sourceNativeEntries!==24033||review.eligibleEntries!==23919||review.explicitlyUnsealedDocumentAssociations!==unsealed||review.sourceRuns.length!==3)throw Error('Derived review mismatch');
const files=[];for(const file of (await fs.readdir(output)).sort()){const b=await fs.readFile(path.join(output,file));files.push({file,bytes:b.length,sha256:sha(b)});}
await fs.writeFile(path.join(pass,'master-entry-projection-v3-plan.json'),JSON.stringify({schema_version:'master-entry-projection-plan/3',run_id:run.id,project_id:run.project_id,dataset:'cl_master_entries',projection_schema:'courtlistener-master-entry-metadata-view/3',prior_published_projection_preserved:true,current_dataset_hold_explicit:true,prepared_only:true,database_executed:false,private_independent_verification_required:true,source_native_entries:24033,eligible_entries:23919,blocked_entries:40,explicitly_sealed_entries:74,explicit_unsealed_document_associations:unsealed,source_signature_sha256:review.sourceSignatureSha256,pinned_v1_generator_sha256:templateSha,derived_generator_sha256:sha(code),output,files},null,2)+'\n');
console.log(JSON.stringify({prepared_only:true,source_native_entries:24033,eligible_entries:23919,unsealed_document_associations:unsealed,source_signature_sha256:review.sourceSignatureSha256,output}));
