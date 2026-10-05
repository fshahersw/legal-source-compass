// Capture the Texas legislature's complete HTML-code archives from its own inventory.
// Raw archives are preserved; this does not certify current law or activate rules.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]??'private/audit-2026-10-05/full-state-codes/tx');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=name=>fs.readFileSync(path.join(root,name));
const inventoryBytes=read('download-index.json');
const inventoryReceipt=JSON.parse(read('download-index.receipt.json'));
if(hash(inventoryBytes)!==inventoryReceipt.sha256||inventoryReceipt.source_url!=='https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json')throw Error('Unverified publisher inventory');
const config=read('download-config.js'),configReceipt=JSON.parse(read('download-config.receipt.json'));
if(hash(config)!==configReceipt.sha256||!config.toString().includes('FileServerPath:"https://tcss.legis.texas.gov/resources"'))throw Error('Unverified publisher download host');
const inventory=JSON.parse(inventoryBytes).StatuteCode;
if(!Array.isArray(inventory)||new Set(inventory.map(x=>x.code)).size!==inventory.length)throw Error('Invalid code inventory');
fs.mkdirSync(path.join(root,'raw'),{recursive:true});fs.mkdirSync(path.join(root,'receipts'),{recursive:true});
function immutable(file,bytes){try{fs.writeFileSync(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}if(!fs.readFileSync(file).equals(bytes))throw Error('Existing evidence differs');}
const captures=[];let stopped=false;
for(const code of inventory){
 if(!/^[A-Z][A-Z0-9]$/.test(code.code)||code.Html!==`/Zips/${code.code}.htm.zip`)throw Error('Unexpected publisher archive locator');
 const sourceUrl='https://tcss.legis.texas.gov/resources'+code.Html;
 const receiptFile=path.join(root,'receipts',code.code+'.json');
 if(fs.existsSync(receiptFile)){const old=JSON.parse(fs.readFileSync(receiptFile));const bytes=read(old.raw_file);if(old.source_url!==sourceUrl||bytes.length!==old.bytes||hash(bytes)!==old.sha256)throw Error('Archive cache evidence mismatch');captures.push(old);continue;}
 if(stopped)break;
 try{
  const response=await fetch(sourceUrl,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok){await response.body?.cancel();throw Error('ARCHIVE_HTTP_'+response.status);}
  const blocks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>100_000_000)throw Error('Archive size limit');blocks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(blocks);if(bytes.length<22||bytes.readUInt32LE(0)!==0x04034b50)throw Error('Response is not a ZIP archive');
  const digest=hash(bytes),rawFile=`raw/${digest}.zip`;
  immutable(path.join(root,rawFile),bytes);
  const receipt={schema_version:'texas-statute-archive-capture/1',jurisdiction:'TX',code:code.code,code_name:code.CodeName,source_url:sourceUrl,retrieved_at:new Date().toISOString(),http_status:response.status,content_type:response.headers.get('content-type'),etag:response.headers.get('etag'),last_modified:response.headers.get('last-modified'),bytes:bytes.length,sha256:digest,raw_file:rawFile,inventory_sha256:inventoryReceipt.sha256,download_host_evidence_sha256:configReceipt.sha256,publication_allowed:false,calculation_activation_allowed:false};
  immutable(receiptFile,Buffer.from(JSON.stringify(receipt,null,2)+'\n'));captures.push(receipt);
  console.log(JSON.stringify({code:code.code,status:'captured',bytes:bytes.length,captured:captures.length,total:inventory.length}));
 }catch(error){const message=/^(ARCHIVE_HTTP_\d+|Archive size limit|Response is not a ZIP archive)$/.test(error.message)?error.message:error.name;const failure={code:code.code,source_url:sourceUrl,failed_at:new Date().toISOString(),error:message};fs.appendFileSync(path.join(root,'failures.jsonl'),JSON.stringify(failure)+'\n');console.log(JSON.stringify(failure));stopped=true;}
 if(!stopped)await new Promise(resolve=>setTimeout(resolve,1000));
}
const summary={schema_version:'texas-statute-archive-summary/1',observed_at:new Date().toISOString(),inventory_sha256:inventoryReceipt.sha256,expected_archives:inventory.length,captured_archives:captures.length,captured_bytes:captures.reduce((n,x)=>n+x.bytes,0),missing_codes:inventory.filter(x=>!captures.some(y=>y.code===x.code)).map(x=>x.code),archive_download_complete:captures.length===inventory.length,parsed:false,registered:false,published:false};
fs.writeFileSync(path.join(root,'acquisition-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
if(stopped)process.exitCode=2;
