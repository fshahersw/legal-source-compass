import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/',target='ohsd-2:2018-md-02846-00517',hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(base+'pdf-library-v1/docketbird-queue-v2.jsonl');if(hash(bytes)!=='63388def0ea4f1b573fc8bfe59cc73dc3e476fd6063b00cf6152c7fdc19fde37')throw Error('Changed original queue');
const row=bytes.toString().split('\n').filter(Boolean).map(JSON.parse).find(x=>x.native_document_id===target);if(!row||!row.eligible)throw Error('Source qualified parent required');
const dir=base+'docketbird/pdf-failure-probe-v1';let selected=null;
for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),raw=fs.readFileSync(file),capture=JSON.parse(raw);if(capture.method!=='tools/call'||capture.params.name!=='get_document'||capture.params.arguments.document_id!==target)continue;
 const reply=JSON.parse(capture.original_rpc_response).result;if(reply.isError)throw Error('Provider failure');const data=reply.structuredContent??JSON.parse(reply.content.find(x=>x.type==='text').text),doc=data.document;
 if(doc.id!==target||doc.restricted!==false||![1,true].includes(doc.downloaded)||typeof doc.pdf_url!=='string'||hash(Buffer.from(capture.original_rpc_response))!==capture.response_sha256)throw Error('Fresh native document evidence mismatch');
 selected={...row,download_url:doc.pdf_url,durable_url:doc.canonical_url??row.durable_url,selected_source_record_sha256:hash(JSON.stringify(doc)),provider_flags:{restricted:doc.restricted,downloaded:doc.downloaded},origins:[...row.origins,{native_case_id:row.native_case_id,native_record_sha256:hash(JSON.stringify(doc)),native_record_hash_codec:'publisher-get-document-json-stringify/1',source_tool:'get_document',source_document_id:target,source_url:capture.source_url,source_response_sha256:capture.response_sha256,source_capture_file_sha256:hash(raw),source_capture_file:file,retrieved_at:capture.retrieved_at,parent_qualification:'exact already source-qualified native document identity',firm_scope_evidence_inherited_from_frozen_queue_sha256:hash(bytes)}]};
 console.log(JSON.stringify({provider_remaining_today:Number.isSafeInteger(data.remaining_today)?data.remaining_today:null,native_document_refreshed:true}));
}
if(!selected)throw Error('Fresh source absent');validateQueueRow(selected);const output=base+'pdf-library-gap-retry-v1';fs.mkdirSync(output,{recursive:true});const raw=Buffer.from(JSON.stringify(selected)+'\n');fs.writeFileSync(output+'/docketbird-gap-retry-queue-v1.jsonl',raw,{flag:'wx'});console.log(JSON.stringify({rows:1,sha256:hash(raw),bytes:raw.length}));
