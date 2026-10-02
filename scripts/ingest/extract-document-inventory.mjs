import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CACHE, sha256 } from './courtlistener-client.mjs';
const root=path.resolve(process.argv[2]??DEFAULT_CACHE);const directory=path.join(root,'live-normalized');
const text=await fs.readFile(path.join(directory,'docket-entries.jsonl'),'utf8');
const documents=new Map();
for(const line of text.trim().split('\n').filter(Boolean)){
 const entry=JSON.parse(line);
 for(const document of entry.data.recap_documents??[]){
  if(!Number.isInteger(document.id))throw new Error('Missing native RECAP document ID');
  // The REST entry exposes its docket as a resource URL, not docket_id.
  // Parse only the verified publisher's native resource path; captions never join.
  const docketResource=entry.data.docket;
  let docketId=entry.data.docket_id??null;
  if(docketId===null&&typeof docketResource==='string'){
   const resource=new URL(docketResource);
   const nativePath=resource.pathname.match(/^\/api\/rest\/v4\/dockets\/(\d+)\/$/);
   if(resource.origin==='https://www.courtlistener.com'&&nativePath)docketId=Number(nativePath[1]);
  }
  const data={...document,docket_entry_id:entry.data.id,docket_id:docketId};
  const record={schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:'recap-documents',native_id:String(document.id),data,provenance:{...entry.provenance,source_entity_type:'docket-entries',source_native_id:entry.native_id,nested_record:true,relationship_mapping:{docket_entry_id:'native containing entry ID',docket_id:'native docket resource URL or ID',source_docket_resource:docketResource??null},record_sha256:sha256(JSON.stringify(data))}};
  documents.set(String(document.id),record);
 }
}
const output=path.join(directory,'recap-documents.jsonl');await fs.writeFile(output,[...documents.values()].map(x=>JSON.stringify(x)).join('\n')+'\n');
const report={document_records:documents.size,available:0,not_available:0,unknown_availability:0,pdf_downloads:0,urls_not_independently_fetched:true};
for(const row of documents.values()){if(row.data.is_available===true)report.available++;else if(row.data.is_available===false)report.not_available++;else report.unknown_availability++;}
await fs.writeFile(path.join(root,'document-inventory-manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
