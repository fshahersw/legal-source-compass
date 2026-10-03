import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const receiptRoot='C:/Users/firas/.codex/private/seeger-weiss-cleanup-receipts-20261002';
const pinnedPlanSHA='88e6ca0b2182f2cc5b94e2b36127d5b630d52b7faee6b7d91b240be73c3a8e2e';
const downloads='C:/Users/firas/Downloads';
const allowedRoots=[
 'MATTER-ETL-BATCH-PIPELINE','SW-BULK/catalog','SW-BULK/AWS-BATCH1-DOCKETS','SW-BULK/publiclaw_registry_v2',
 'SW-BULK/corpus','SW-BULK/recap-pdfs','SW-BULK/catalog_test','SW-BULK/registry','SW-BULK/stateurls',
 'SW-BULK/_archive','SW-BULK/_staging','SW-BULK/source_gap_reconciliation_2026-08-22','SW-BULK/daubert_scan',
 'SW-BULK/phase2_source_catalog_v1_2026-08-22','SW-BULK/phase1_directory_contract_v3_2026-08-22',
 'Seeger_Weiss_Enriched_Sou','Seeger_Weiss_Enriched_Source_Registry_v4',
].map(x=>path.resolve(downloads,x));
const hash=b=>createHash('sha256').update(b).digest('hex');
const validSHA=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function boundedPath(file,roots){const resolved=path.resolve(file);if(!roots.some(r=>resolved.toLowerCase().startsWith(r.toLowerCase()+path.sep)))throw Error('Exact alias path is outside its approved roots');return resolved;}
export function validateExactSourceURI(value){
 if(typeof value!=='string'||!value.startsWith('file:///C:/Users/firas/Downloads/')||value.includes('\\')||/%(?:2f|5c)/i.test(value)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(value)))throw Error('Exact Downloads occurrence URI required');
 const url=new URL(value);if(url.search||url.hash||url.username||url.password||url.host)throw Error('Literal local occurrence URI required');
 const literal=fileURLToPath(url);if(literal.slice(2).includes(':'))throw Error('Alternate file streams rejected');return boundedPath(literal,allowedRoots);
}
const windowsReparseCheck=`$ErrorActionPreference='Stop'; $cursor=[Console]::In.ReadToEnd(); while($cursor){ $item=Get-Item -LiteralPath $cursor -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){[Console]::Out.Write('reject'); exit 0}; $parent=[IO.Path]::GetDirectoryName($cursor.TrimEnd('\\')); if($parent -eq $cursor){break}; $cursor=$parent }; [Console]::Out.Write('regular')`;
async function regularPath(file){
 const absolute=path.resolve(file);let ancestor=absolute;
 if(process.platform==='win32'){
  let result;try{result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsReparseCheck],{input:absolute,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{throw Error('Native regular file ancestry verification failed');}
  if(result!=='regular')throw Error('Alias Windows reparse point rejected');
 }
 while(ancestor){const s=await fs.lstat(ancestor);if(s.isSymbolicLink())throw Error('Alias symlink or junction rejected');const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
 const s=await fs.lstat(absolute);if(!s.isFile())throw Error('Alias requires a regular file');
 const real=await fs.realpath(absolute);if(real.toLowerCase()!==absolute.toLowerCase())throw Error('Alias path resolution differs');return{absolute,stat:s};
}
async function verifiedBytes(file,sha,bytes){
 if(!validSHA(sha)||!Number.isSafeInteger(bytes)||bytes<1)throw Error('Exact file SHA and bytes required');
 const before=await regularPath(file);if(before.stat.size!==bytes)throw Error('Exact alias file byte count differs');
 const h=createHash('sha256');let size=0;for await(const b of createReadStream(before.absolute)){h.update(b);size+=b.length;}
 const after=await fs.lstat(before.absolute);if(size!==bytes||h.digest('hex')!==sha||after.size!==before.stat.size||after.mtimeMs!==before.stat.mtimeMs)throw Error('Exact alias file hash or stability differs');return before.absolute;
}

/** Read-only resolver of an externally receipted, byte-identical file copy.
 * Original occurrence identity and provenance remain unchanged. No record or
 * publisher identity is merged, no files are created, and no fuzzy lookup occurs.
 */
export async function loadExactSourceFileAliases({aliasManifestPath,aliasManifestSha256,executeReceiptPath,executeReceiptSha256}){
 if(!validSHA(aliasManifestSha256)||!validSHA(executeReceiptSha256))throw Error('Pinned alias and execution receipt hashes required');
 const aliasPath=boundedPath(aliasManifestPath,[path.resolve(receiptRoot)]),receiptPath=boundedPath(executeReceiptPath,[path.resolve(receiptRoot)]);
 if(path.dirname(aliasPath)!==path.dirname(receiptPath)||path.basename(aliasPath)!=='source-file-aliases.jsonl'||path.basename(receiptPath)!=='execute-receipt.jsonl'||!/^run-[a-f0-9-]{36}$/.test(path.basename(path.dirname(aliasPath)))||path.dirname(path.dirname(aliasPath))!==path.resolve(receiptRoot))throw Error('Exact completed external alias receipt required');
 await regularPath(aliasPath);await regularPath(receiptPath);const aliasBytes=await fs.readFile(aliasPath),receiptBytes=await fs.readFile(receiptPath);
 if(hash(aliasBytes)!==aliasManifestSha256||hash(receiptBytes)!==executeReceiptSha256)throw Error('Alias receipt hash mismatch');
 const aliases=aliasBytes.toString('utf8').trim().split('\n').map(x=>JSON.parse(x));const receipts=receiptBytes.toString('utf8').trim().split('\n').map(x=>JSON.parse(x));
 const start=receipts[0],complete=receipts.at(-1);if(start.event!=='full_plan_prepared'||start.plan_sha256!==pinnedPlanSHA||start.external_alias_sha256!==aliasManifestSha256||start.deletion_enabled!==true||complete.event!=='complete'||complete.run_id!==start.run_id||complete.deleted_files!==aliases.length||complete.all_final_keepers_rehashed!==true||complete.validation_only!==false||receipts.some(x=>x.event==='failed'))throw Error('Alias deletion receipt is incomplete or inconsistent');
 const deleted=new Map(receipts.filter(x=>x.event==='deleted').map(x=>[x.original_file_uri,x]));if(deleted.size!==aliases.length)throw Error('Alias deletion occurrence counts differ');
 const index=new Map();const originalPaths=new Set();const keeperPaths=new Set();
 for(const row of aliases){const a=row.original_occurrence_alias,d=deleted.get(a?.original_file_uri);if(row.schema_version!=='retained-source-file-alias/1'||row.plan_sha256!==pinnedPlanSHA||row.run_id!==start.run_id||row.alias_status!=='validated_before_specific_file_deletion'||a?.payload_or_record_identity_merge_allowed!==false||a.original_occurrence_provenance_preserved!==true||!validSHA(a.original_file_sha256)||a.original_file_sha256!==a.retained_file_sha256||a.original_file_bytes!==a.retained_file_bytes||!Number.isSafeInteger(a.original_file_bytes)||a.original_file_bytes<1||d?.run_id!==start.run_id||d.original_sha256!==a.original_file_sha256||d.deleted_bytes!==a.original_file_bytes)throw Error('Exact alias qualification or deleted occurrence differs');
  const original=validateExactSourceURI(a.original_file_uri),retained=validateExactSourceURI(a.retained_file_uri);if(original.toLowerCase()===retained.toLowerCase()||path.resolve(d.retained_canonical.Path).toLowerCase()!==retained.toLowerCase()||d.retained_canonical.Sha256!==a.retained_file_sha256||d.retained_canonical.Bytes!==a.retained_file_bytes)throw Error('Exact retained keeper receipt differs');
  const key=a.original_file_uri+'|'+a.original_file_sha256;if(index.has(key))throw Error('Ambiguous exact source alias');index.set(key,{...a,original,retained});originalPaths.add(original.toLowerCase());keeperPaths.add(retained.toLowerCase());
 }
 if([...keeperPaths].some(x=>originalPaths.has(x)))throw Error('Retained alias is another deleted occurrence');
 return Object.freeze({aliasManifestSha256,executeReceiptSha256,planSha256:pinnedPlanSHA,runId:start.run_id,aliasCount:index.size,
  async resolve({originalFileURI,sourceFileSha256,sourceFileBytes}){
   const original=validateExactSourceURI(originalFileURI);if(!validSHA(sourceFileSha256)||!Number.isSafeInteger(sourceFileBytes)||sourceFileBytes<1)throw Error('Original occurrence hash and byte count required');
   let present=true;try{await fs.lstat(original);}catch(e){if(e.code==='ENOENT')present=false;else throw e;}
   let resolved=original,alias=null;
   if(!present){alias=index.get(originalFileURI+'|'+sourceFileSha256);if(!alias||alias.original_file_bytes!==sourceFileBytes)throw Error('No exact receipted alias for the missing source occurrence');resolved=alias.retained;}
   await verifiedBytes(resolved,sourceFileSha256,sourceFileBytes);
   return Object.freeze({originalOccurrenceFileURI:originalFileURI,resolvedFileURI:alias?.retained_file_uri??originalFileURI,resolvedLiteralPath:resolved,sourceFileSha256,sourceFileBytes,aliasApplied:Boolean(alias),aliasManifestSha256,executeReceiptSha256,planSha256:pinnedPlanSHA,originalOccurrenceProvenancePreserved:true,publisherIdentityMergeAllowed:false});
  }
 });
}
