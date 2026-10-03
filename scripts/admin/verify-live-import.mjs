/** Offline verification of prepared private live metadata; never prints native payloads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const args=Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:[]).filter(p=>p.length));
if(!args.root||!args.receipt||!args.output)throw Error('Use --root prepared-batch-directory --receipt stable-file-receipts.json --output private-validation.json');
const root=path.resolve(args.root);
const finalReceipt=JSON.parse(await fs.readFile(path.resolve(args.receipt),'utf8'));
const allowedTypes=['dockets','docket-entries','parties','attorneys','recap-documents','mdl-source-pages'];
// A continuation can contain only the types it actually acquired. Defaults retain
// the complete six-type first-pass contract; absent types are never fabricated.
const types=args.types?args.types.split(','):allowedTypes;
if(!types.length||new Set(types).size!==types.length||types.some(type=>!allowedTypes.includes(type)))throw Error('Invalid selected native metadata types');
if(types.includes('recap-documents')&&!types.includes('docket-entries'))throw Error('Nested document verification requires containing entry observations');
const digest=value=>createHash('sha256').update(value).digest('hex');
const nativeKey=r=>JSON.stringify([r.source_system,r.entity_type,r.native_id,r.provenance.record_sha256,r.provenance.source_url,r.provenance.retrieved_at]);
const resourceUrl=(value,type,id)=>{
 const u=new URL(value);
 if(u.origin!=='https://www.courtlistener.com'||u.username||u.password||u.hash||u.search)throw Error('Invalid CourtListener resource URL');
 const m=u.pathname.match(/^\/api\/rest\/v4\/([^/]+)\/([A-Za-z0-9_-]+)\/$/);
 if(!m||m[1]!==type||(id!==undefined&&m[2]!==String(id)))throw Error('Resource endpoint/native identity mismatch: '+type);
 return m[2];
};
const sourceEndpoint=(value,type)=>{
 const u=new URL(value);
 if(u.origin!=='https://www.courtlistener.com'||u.username||u.password||u.hash)throw Error('Invalid source endpoint');
 const m=u.pathname.match(/^\/api\/rest\/v4\/([^/]+)\/(?:[A-Za-z0-9_-]+\/)?$/);
 if(!m||m[1]!==type)throw Error('Wrong source endpoint for '+type);
};
const entryDockets=new Map(),documents=[],capturedDockets=new Set(),associationDockets=new Set();
const associations={partyTypes:0,partyAttorneys:0,attorneyRepresentations:0};
const nativeArray=(data,key)=>{
 if(data[key]==null)return [];
 if(!Array.isArray(data[key]))throw Error('Expected native association array: '+key);
 return data[key];
};
const nativeAssociation=(value)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid native association shape');
 return value;
};
let runId=null,total=0;
const summaries=[];
for(const type of types){
 const manifestPath=path.join(root,type,'manifest.json');
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 if(manifest.schemaVersion!=='corpus-ingest-batches/1'||manifest.metadataOnly!==true||!/^[a-f0-9-]{36}$/.test(manifest.runId))throw Error('Invalid manifest contract');
 if(runId&&runId!==manifest.runId)throw Error('Mixed intake runs');
 runId=manifest.runId;
 if(!manifest.input.endsWith('.jsonl'))throw Error('Only stable completed JSONL inputs are accepted');
 const inputBytes=await fs.readFile(manifest.input);
 if(digest(inputBytes)!==manifest.inputSha256)throw Error('Input file hash mismatch: '+type);
 const upstream=finalReceipt.files.find(f=>path.resolve(f.path)===path.resolve(manifest.input));
 if(!upstream||upstream.sha256!==manifest.inputSha256||upstream.complete_file!==true||upstream.observations!==manifest.records)throw Error('Input differs from stable receipt: '+type);
 const originals=inputBytes.toString('utf8').split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l));
 const originalKeys=originals.map(nativeKey);
 const keys=[],identities=new Set(),versions=new Set(),sources=new Set();
 const batchSummaries=[];
 for(const batch of manifest.batches){
  if(!/^batch-\d{5}\.sql$/.test(batch.name))throw Error('Unexpected batch filename');
  const file=path.join(root,type,batch.name),bytes=await fs.readFile(file);
  if(bytes.length!==batch.bytes||digest(bytes)!==batch.sha256)throw Error('Prepared SQL hash/size mismatch: '+type+'/'+batch.name);
  const match=bytes.toString('utf8').match(/^select corpus_ingest\.ingest_entities\('([^']+)'::uuid,(\$corpus_[0-9a-f]+\$)([\s\S]*)\2::jsonb\) as result;\s*$/);
  if(!match||match[1]!==manifest.runId)throw Error('Prepared SQL must contain only the approved intake call');
  const rows=JSON.parse(match[3]);
  if(match[3].includes(match[2]))throw Error('SQL delimiter collision');
  if(rows.length!==batch.records||rows.length>2000)throw Error('Prepared batch count mismatch');
  for(const r of rows){
   if(r.entity_type!==type||String(r.data.id??r.native_id)!==r.native_id||!r.schema_version||!r.provenance||!/^[a-f0-9]{64}$/.test(r.provenance.record_sha256)||!/^[a-f0-9]{64}$/.test(r.provenance.source_sha256)||!Number.isFinite(Date.parse(r.provenance.retrieved_at)))throw Error('Invalid identity/provenance: '+type);
   if(digest(JSON.stringify(r.data))!==r.provenance.record_sha256)throw Error('Native record hash mismatch: '+type);
   if(type==='mdl-source-pages'){
    const u=new URL(r.provenance.source_url);
    if(r.source_system!=='official-court'||u.protocol!=='https:'||!(u.hostname==='uscourts.gov'||u.hostname.endsWith('.uscourts.gov'))||u.username||u.password||r.data.source_url!==r.provenance.source_url||digest(r.provenance.source_url)!==r.native_id||r.provenance.pdf_downloads!==0)throw Error('Official page provenance mismatch');
   }else{
    if(r.source_system!=='courtlistener')throw Error('Unexpected live source system');
    resourceUrl(r.data.resource_uri,type,r.native_id);
    sourceEndpoint(r.provenance.source_url,type==='recap-documents'?'docket-entries':type);
    if(type==='dockets'){
     resourceUrl(r.provenance.source_url,type,r.native_id);capturedDockets.add(r.native_id);
     for(const [field,target]of [['court','courts'],['assigned_to','people'],['referred_to','people'],['appeal_from','courts'],['parent_docket','dockets']])if(r.data[field]!=null)resourceUrl(r.data[field],target);
     for(const [field,target]of [['panel','people'],['clusters','clusters']])for(const value of nativeArray(r.data,field))resourceUrl(value,target);
    }
    if(type==='docket-entries'){
     const docket=resourceUrl(r.data.docket,'dockets');
     if(entryDockets.has(r.native_id)&&entryDockets.get(r.native_id)!==docket)throw Error('Native entry assigned to inconsistent dockets');
     entryDockets.set(r.native_id,docket);
    }
    if(type==='recap-documents'){
     if(r.provenance.source_entity_type!=='docket-entries'||String(r.data.docket_entry_id)!==String(r.provenance.source_native_id)||!Number.isInteger(r.data.docket_id))throw Error('Nested document provenance mismatch');
     documents.push({entry:String(r.data.docket_entry_id),docket:String(r.data.docket_id)});
    }
    if(type==='parties'){
     for(const value of nativeArray(r.data,'party_types')){
      const association=nativeAssociation(value);
      if(association.docket_id==null)throw Error('Missing native party-type docket ID');
      associationDockets.add(resourceUrl(association.docket,'dockets',association.docket_id));associations.partyTypes++;
     }
     for(const value of nativeArray(r.data,'attorneys')){
      const association=nativeAssociation(value);
      if(association.attorney_id==null||association.docket_id==null)throw Error('Missing native party-attorney association ID');
      resourceUrl(association.attorney,'attorneys',association.attorney_id);
      associationDockets.add(resourceUrl(association.docket,'dockets',association.docket_id));associations.partyAttorneys++;
     }
    }
    if(type==='attorneys')for(const value of nativeArray(r.data,'parties_represented')){
     const association=nativeAssociation(value);
     resourceUrl(association.party,'parties');associationDockets.add(resourceUrl(association.docket,'dockets'));associations.attorneyRepresentations++;
    }
   }
   keys.push(nativeKey(r));identities.add(r.native_id);versions.add(r.native_id+'/'+r.provenance.record_sha256);sources.add(r.provenance.source_url);
  }
  batchSummaries.push({name:batch.name,records:batch.records,bytes:batch.bytes,sha256:batch.sha256,verified:true});
 }
 if(keys.length!==manifest.records||keys.length!==originalKeys.length||keys.some((k,i)=>k!==originalKeys[i]))throw Error('Prepared SQL differs from original observation sequence');
 summaries.push({entityType:type,observations:keys.length,distinctNativeIds:identities.size,distinctNativeVersions:versions.size,sourceUrls:sources.size,inputSha256:manifest.inputSha256,batches:batchSummaries});
 total+=keys.length;
}
for(const document of documents)if(entryDockets.get(document.entry)!==document.docket)throw Error('Nested document docket does not match its validated native containing entry');
const result={schemaVersion:'courtlistener-live-private-import-validation/1',validatedAt:new Date().toISOString(),runId,metadataOnly:true,pdfDownloads:0,observations:total,batches:summaries.reduce((n,f)=>n+f.batches.length,0),files:summaries,nativeAssociations:{...associations,distinctNestedDocketTargets:associationDockets.size,nestedDocketTargetsOutsideCapturedRecords:[...associationDockets].filter(id=>!capturedDockets.has(id)).length},sourceFilesComplete:true,completeAllRequestedScopes:finalReceipt.complete_all_requested_scopes===true,qualification:'Private observations retain each association\'s actual native docket/party/attorney IDs, including targets outside the query docket. Contact/caption fields remain private. This does not establish exhaustive docket, party, attorney, representation, or member-case coverage.'};
await fs.writeFile(path.resolve(args.output),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
